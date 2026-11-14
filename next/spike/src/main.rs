//! Glass spike for Windows 10: which rounded-blur material actually works?
//!
//! The hand-off warns that `SetWindowCompositionAttribute` blur fills the whole window
//! rectangle (square corners), and that the composition host backdrop brush may not see
//! behind our window on Windows 10. Both decide the dock's architecture, so measure
//! rather than assume.
//!
//! Candidates, each drawn as a rounded panel over a known test background:
//!   A  accent blur-behind + rounded clip         (does the blur respect the clip?)
//!   B  accent blur-behind + SetWindowRgn region  (does the region round the blur?)
//!   C  CreateHostBackdropBrush in a rounded clip (does the brush see the background?)
//!   D  our own pre-blurred wallpaper slice       (always correct over our own layer)
//!
//! Usage: spike.exe [--case a|b|c|d] [--secs N]
//! Each case prints its window rect; the caller screenshots and compares pixels.

use windows::{
    core::{w, Interface, Result},
    UI::{
        Color,
        Composition::{Compositor, Desktop::DesktopWindowTarget},
    },
    Win32::{
        Foundation::{HWND, LPARAM, LRESULT, WPARAM},
        Graphics::Gdi::{CreateRoundRectRgn, SetWindowRgn, UpdateWindow},
        System::{
            LibraryLoader::{GetModuleHandleW, GetProcAddress},
            WinRT::{
                Composition::ICompositorDesktopInterop, CreateDispatcherQueueController,
                DispatcherQueueOptions, DQTAT_COM_STA, DQTYPE_THREAD_CURRENT,
            },
        },
        UI::{
            HiDpi::{SetProcessDpiAwarenessContext, DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2},
            WindowsAndMessaging::*,
        },
    },
};
use windows_numerics::{Vector2, Vector3};

const W: i32 = 520;
const H: i32 = 180;
const RADIUS: f32 = 28.0;

fn set_accent_blur(hwnd: HWND, state: u32) {
    #[repr(C)]
    struct Accent {
        state: u32,
        flags: u32,
        color_abgr: u32,
        anim: u32,
    }
    #[repr(C)]
    struct Data {
        attr: u32,
        data: *mut core::ffi::c_void,
        size: usize,
    }
    type F = unsafe extern "system" fn(HWND, *mut Data) -> i32;
    unsafe {
        let Ok(lib) = GetModuleHandleW(w!("user32.dll")) else { return };
        let Some(f) = GetProcAddress(lib, windows::core::s!("SetWindowCompositionAttribute")) else { return };
        let f: F = std::mem::transmute(f);
        let mut a = Accent { state, flags: 2, color_abgr: 0x40_00_00_00, anim: 0 };
        let mut d = Data { attr: 19, data: &mut a as *mut _ as *mut _, size: std::mem::size_of::<Accent>() };
        let r = f(hwnd, &mut d);
        println!("SetWindowCompositionAttribute(state={state}) -> {r}");
    }
}

extern "system" fn wndproc(hwnd: HWND, msg: u32, wp: WPARAM, lp: LPARAM) -> LRESULT {
    unsafe {
        match msg {
            WM_TIMER => {
                PostQuitMessage(0);
                LRESULT(0)
            }
            _ => DefWindowProcW(hwnd, msg, wp, lp),
        }
    }
}

fn main() -> Result<()> {
    let mut case = 'a';
    let mut secs = 8u32;
    let mut it = std::env::args().skip(1);
    while let Some(a) = it.next() {
        match a.as_str() {
            "--case" => case = it.next().and_then(|v| v.chars().next()).unwrap_or('a'),
            "--secs" => secs = it.next().and_then(|v| v.parse().ok()).unwrap_or(8),
            _ => {}
        }
    }

    unsafe {
        let _ = SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
        let _q = CreateDispatcherQueueController(DispatcherQueueOptions {
            dwSize: std::mem::size_of::<DispatcherQueueOptions>() as u32,
            threadType: DQTYPE_THREAD_CURRENT,
            apartmentType: DQTAT_COM_STA,
        })?;
        let hinst = GetModuleHandleW(None)?;
        RegisterClassW(&WNDCLASSW {
            hInstance: hinst.into(),
            lpszClassName: w!("UdaanGlassSpike"),
            lpfnWndProc: Some(wndproc),
            ..Default::default()
        });

        // Centre of the primary screen, so the caller knows what is behind it.
        let sw = GetSystemMetrics(SM_CXSCREEN);
        let sh = GetSystemMetrics(SM_CYSCREEN);
        let (x, y) = ((sw - W) / 2, (sh - H) / 2);
        let hwnd = CreateWindowExW(
            WS_EX_NOREDIRECTIONBITMAP | WS_EX_TOPMOST | WS_EX_TOOLWINDOW,
            w!("UdaanGlassSpike"),
            w!("glass spike"),
            WS_POPUP,
            x,
            y,
            W,
            H,
            None,
            None,
            Some(hinst.into()),
            None,
        )?;

        let compositor = Compositor::new()?;
        let interop: ICompositorDesktopInterop = compositor.cast()?;
        let target: DesktopWindowTarget = interop.CreateDesktopWindowTarget(hwnd, true)?;
        let root = compositor.CreateContainerVisual()?;
        root.SetSize(Vector2 { X: W as f32, Y: H as f32 })?;
        target.SetRoot(&root)?;

        // A rounded clip, used by the cases that claim to round the blur.
        let clip_container = compositor.CreateContainerVisual()?;
        clip_container.SetSize(Vector2 { X: W as f32, Y: H as f32 })?;
        let geo = compositor.CreateRoundedRectangleGeometry()?;
        geo.SetSize(Vector2 { X: W as f32, Y: H as f32 })?;
        geo.SetCornerRadius(Vector2 { X: RADIUS, Y: RADIUS })?;
        clip_container.SetClip(&compositor.CreateGeometricClipWithGeometry(&geo)?)?;
        root.Children()?.InsertAtTop(&clip_container)?;

        // A visible tint inside the clip, so the panel's true shape is obvious in a
        // screenshot: if corners are square, the blur is ignoring the clip.
        let tint = compositor.CreateColorBrushWithColor(Color { A: 0x30, R: 255, G: 255, B: 255 })?;
        let s = compositor.CreateSpriteVisual()?;
        s.SetBrush(&tint)?;
        s.SetSize(Vector2 { X: W as f32, Y: H as f32 })?;
        s.SetOffset(Vector3 { X: 0.0, Y: 0.0, Z: 0.0 })?;
        clip_container.Children()?.InsertAtTop(&s)?;

        match case {
            'a' => {
                println!("case A: accent blur-behind + composition rounded clip");
                set_accent_blur(hwnd, 3);
            }
            'b' => {
                println!("case B: accent blur-behind + SetWindowRgn rounded region");
                set_accent_blur(hwnd, 3);
                let rgn = CreateRoundRectRgn(0, 0, W + 1, H + 1, (RADIUS * 2.0) as i32, (RADIUS * 2.0) as i32);
                let r = SetWindowRgn(hwnd, Some(rgn), true);
                println!("SetWindowRgn -> {r}");
            }
            'c' => {
                println!("case C: CreateHostBackdropBrush inside the rounded clip");
                match compositor.CreateHostBackdropBrush() {
                    Ok(b) => {
                        let sp = compositor.CreateSpriteVisual()?;
                        let cb: windows::UI::Composition::CompositionBrush = b.cast()?;
                        sp.SetBrush(&cb)?;
                        sp.SetSize(Vector2 { X: W as f32, Y: H as f32 })?;
                        // Below the tint so we see the backdrop, not just the tint.
                        clip_container.Children()?.InsertAtBottom(&sp)?;
                        println!("CreateHostBackdropBrush: ok");
                    }
                    Err(e) => println!("CreateHostBackdropBrush FAILED: {e}"),
                }
            }
            'd' => {
                println!("case D: opaque control (no blur) - baseline for pixel compare");
            }
            _ => println!("unknown case"),
        }

        let _ = ShowWindow(hwnd, SW_SHOWNA);
        let _ = UpdateWindow(hwnd);
        let mut r = windows::Win32::Foundation::RECT::default();
        let _ = GetWindowRect(hwnd, &mut r);
        println!("rect {},{} {}x{}", r.left, r.top, r.right - r.left, r.bottom - r.top);

        SetTimer(Some(hwnd), 1, secs * 1000, None);
        let mut msg = MSG::default();
        while GetMessageW(&mut msg, None, 0, 0).as_bool() {
            let _ = TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }
    }
    Ok(())
}
