//! M1 spike: a transparent top-level window rendered by the Windows composition
//! engine (Windows.UI.Composition hosted on a plain Win32 HWND).
//!
//! What it proves or disproves on THIS machine:
//!   * per-pixel transparency works on a Win32 window with no GDI redirection bitmap
//!   * 3D transforms (rotation + perspective) run on the compositor, so the app does
//!     no per-frame work
//!   * the process's idle memory footprint
//!
//! Flags:  --secs N      run time (default 20)
//!         --anim        continuous compositor-side 3D rotation
//!         --full        cover the whole primary monitor
//!         --big         animated card fills ~90% of the window (worst case for DisplayLink)
//!         --size WxH    window size (default 640x420)

mod text;

use std::time::{Duration, Instant};
use windows::{
    core::{h, w, Interface, Result, HSTRING},
    Foundation::TimeSpan,
    System::DispatcherQueueController,
    UI::{
        Color,
        Composition::{
            AnimationIterationBehavior, CompositionBrush, Compositor, ContainerVisual,
            Desktop::DesktopWindowTarget, SpriteVisual, Visual,
        },
    },
    Win32::{
        Foundation::{HWND, LPARAM, LRESULT, WPARAM},
        Graphics::Gdi::HBRUSH,
        System::{
            LibraryLoader::GetModuleHandleW,
            ProcessStatus::{K32GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS_EX},
            Threading::GetCurrentProcess,
            WinRT::{
                Composition::ICompositorDesktopInterop, CreateDispatcherQueueController,
                DispatcherQueueOptions, DQTAT_COM_NONE, DQTYPE_THREAD_CURRENT,
            },
        },
        UI::{
            HiDpi::{SetProcessDpiAwarenessContext, DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2},
            Input::KeyboardAndMouse::VK_ESCAPE,
            WindowsAndMessaging::*,
        },
    },
};
use windows_numerics::{Matrix4x4, Vector2, Vector3};

struct Args {
    secs: u64,
    anim: bool,
    full: bool,
    big: bool,
    text: bool,
    flat: bool,
    /// 0 = none, 3 = ACCENT_ENABLE_BLURBEHIND, 4 = ACCENT_ENABLE_ACRYLICBLURBEHIND
    blur: u32,
    size: (i32, i32),
}

/// Undocumented but long-standing user32 call that asks DWM to blur whatever is
/// behind the window. Resolved at runtime because it has no import library.
fn apply_blur(hwnd: HWND, state: u32) {
    #[repr(C)]
    struct Accent { state: u32, flags: u32, color_abgr: u32, anim: u32 }
    #[repr(C)]
    struct Data { attr: u32, data: *mut core::ffi::c_void, size: usize }
    type Fn = unsafe extern "system" fn(HWND, *mut Data) -> i32;
    unsafe {
        let Ok(lib) = GetModuleHandleW(w!("user32.dll")) else { return };
        let Some(f) = windows::Win32::System::LibraryLoader::GetProcAddress(lib, windows::core::s!("SetWindowCompositionAttribute")) else { return };
        let f: Fn = std::mem::transmute(f);
        // A faint dark tint (ABGR) so the blurred backdrop stays legible.
        let mut a = Accent { state, flags: 2, color_abgr: 0x33_20_14_10, anim: 0 };
        let mut d = Data { attr: 19, data: &mut a as *mut _ as *mut _, size: std::mem::size_of::<Accent>() };
        let ok = f(hwnd, &mut d);
        println!("blur: accent state {} -> {}", state, if ok != 0 { "applied" } else { "refused" });
    }
}

fn parse_args() -> Args {
    let mut a = Args { secs: 20, anim: false, full: false, big: false, text: false, flat: false, blur: 0, size: (640, 420) };
    let mut it = std::env::args().skip(1);
    while let Some(arg) = it.next() {
        match arg.as_str() {
            "--secs" => a.secs = it.next().and_then(|v| v.parse().ok()).unwrap_or(20),
            "--anim" => a.anim = true,
            "--full" => a.full = true,
            "--big" => a.big = true,
            "--text" => a.text = true,
            "--flat" => a.flat = true,
            "--blur" => a.blur = it.next().and_then(|v| v.parse().ok()).unwrap_or(3),
            "--size" => {
                if let Some(v) = it.next() {
                    if let Some((w, h)) = v.split_once('x') {
                        a.size = (w.parse().unwrap_or(640), h.parse().unwrap_or(420));
                    }
                }
            }
            _ => {}
        }
    }
    a
}

fn memory_mb() -> (f64, f64) {
    unsafe {
        let mut c = PROCESS_MEMORY_COUNTERS_EX::default();
        c.cb = std::mem::size_of::<PROCESS_MEMORY_COUNTERS_EX>() as u32;
        let ok = K32GetProcessMemoryInfo(GetCurrentProcess(), &mut c as *mut _ as *mut _, c.cb);
        if ok.as_bool() {
            (c.WorkingSetSize as f64 / 1_048_576.0, c.PrivateUsage as f64 / 1_048_576.0)
        } else {
            (0.0, 0.0)
        }
    }
}

extern "system" fn wndproc(hwnd: HWND, msg: u32, wp: WPARAM, lp: LPARAM) -> LRESULT {
    unsafe {
        match msg {
            WM_KEYDOWN if wp.0 as u32 == VK_ESCAPE.0 as u32 => {
                PostQuitMessage(0);
                LRESULT(0)
            }
            WM_DESTROY => {
                PostQuitMessage(0);
                LRESULT(0)
            }
            _ => DefWindowProcW(hwnd, msg, wp, lp),
        }
    }
}

fn color(a: u8, r: u8, g: u8, b: u8) -> Color {
    Color { A: a, R: r, G: g, B: b }
}

fn sprite(c: &Compositor, brush: &CompositionBrush, w: f32, h: f32, x: f32, y: f32) -> Result<SpriteVisual> {
    let s = c.CreateSpriteVisual()?;
    s.SetBrush(brush)?;
    s.SetSize(Vector2 { X: w, Y: h })?;
    s.SetOffset(Vector3 { X: x, Y: y, Z: 0.0 })?;
    Ok(s)
}

fn main() -> Result<()> {
    let args = parse_args();
    unsafe {
        let _ = SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);

        // Composition needs a dispatcher queue on the thread that owns the window.
        let _queue: DispatcherQueueController = CreateDispatcherQueueController(DispatcherQueueOptions {
            dwSize: std::mem::size_of::<DispatcherQueueOptions>() as u32,
            threadType: DQTYPE_THREAD_CURRENT,
            apartmentType: DQTAT_COM_NONE,
        })?;

        let hinst = GetModuleHandleW(None)?;
        let class = w!("UdaanSpike");
        RegisterClassW(&WNDCLASSW {
            hInstance: hinst.into(),
            lpszClassName: class,
            lpfnWndProc: Some(wndproc),
            hCursor: LoadCursorW(None, IDC_ARROW)?,
            hbrBackground: HBRUSH::default(),
            ..Default::default()
        });

        let (ww, wh, wx, wy) = if args.full {
            (GetSystemMetrics(SM_CXSCREEN), GetSystemMetrics(SM_CYSCREEN), 0, 0)
        } else {
            (args.size.0, args.size.1, 200, 160)
        };

        // WS_EX_NOREDIRECTIONBITMAP: no GDI surface, so the composition tree is the
        // only thing on screen and its alpha blends with the desktop.
        // Full-screen test windows must never take keyboard focus from whatever the
        // user is doing while we measure.
        let ex_noactivate = if args.full { WS_EX_NOACTIVATE } else { WINDOW_EX_STYLE(0) };
        let hwnd = CreateWindowExW(
            WS_EX_NOREDIRECTIONBITMAP | WS_EX_TOPMOST | WS_EX_TOOLWINDOW | ex_noactivate,
            class,
            w!("Udaan spike"),
            WS_POPUP | WS_VISIBLE,
            wx,
            wy,
            ww,
            wh,
            None,
            None,
            Some(hinst.into()),
            None,
        )?;

        if args.blur != 0 {
            apply_blur(hwnd, args.blur);
        }

        let compositor = Compositor::new()?;
        let interop: ICompositorDesktopInterop = compositor.cast()?;
        let target: DesktopWindowTarget = interop.CreateDesktopWindowTarget(hwnd, true)?;

        let root: ContainerVisual = compositor.CreateContainerVisual()?;
        root.SetSize(Vector2 { X: ww as f32, Y: wh as f32 })?;
        target.SetRoot(&root)?;

        // Perspective lives on the parent: children rotated in 3D are projected
        // through it, which is what makes a flat card read as a card in space.
        let stage: ContainerVisual = compositor.CreateContainerVisual()?;
        stage.SetSize(Vector2 { X: ww as f32, Y: wh as f32 })?;
        let d = 900.0f32;
        let persp = Matrix4x4 {
            M11: 1.0, M12: 0.0, M13: 0.0, M14: 0.0,
            M21: 0.0, M22: 1.0, M23: 0.0, M24: 0.0,
            M31: 0.0, M32: 0.0, M33: 1.0, M34: -1.0 / d,
            M41: 0.0, M42: 0.0, M43: 0.0, M44: 1.0,
        };
        // Centre the projection on the stage, not its top-left corner.
        let cx = ww as f32 / 2.0;
        let cy = wh as f32 / 2.0;
        let to_origin = Matrix4x4 { M11: 1.0, M22: 1.0, M33: 1.0, M44: 1.0, M41: -cx, M42: -cy, ..Default::default() };
        let from_origin = Matrix4x4 { M11: 1.0, M22: 1.0, M33: 1.0, M44: 1.0, M41: cx, M42: cy, ..Default::default() };
        stage.SetTransformMatrix(mul(mul(to_origin, persp), from_origin))?;
        root.Children()?.InsertAtTop(&stage)?;

        // A translucent glass-like panel: gradient with alpha, so the desktop shows through.
        let grad = compositor.CreateLinearGradientBrush()?;
        grad.SetStartPoint(Vector2 { X: 0.0, Y: 0.0 })?;
        grad.SetEndPoint(Vector2 { X: 0.0, Y: 1.0 })?;
        grad.ColorStops()?.Append(&compositor.CreateColorGradientStopWithOffsetAndColor(0.0, color(150, 70, 90, 130))?)?;
        grad.ColorStops()?.Append(&compositor.CreateColorGradientStopWithOffsetAndColor(1.0, color(110, 20, 30, 55))?)?;
        // --big: the animated card covers ~90% of the window, so nearly every pixel
        // changes every frame. This is the worst case for a USB-attached display.
        let (card_w, card_h) = if args.big {
            (ww as f32 * 0.9, wh as f32 * 0.9)
        } else {
            ((ww as f32 * 0.7).min(420.0), (wh as f32 * 0.6).min(260.0))
        };
        let card = sprite(&compositor, &grad.cast()?, card_w, card_h, cx - card_w / 2.0, cy - card_h / 2.0)?;
        // Rotate about the card's own centre.
        card.SetCenterPoint(Vector3 { X: card_w / 2.0, Y: card_h / 2.0, Z: 0.0 })?;
        card.SetRotationAxis(Vector3 { X: 0.0, Y: 1.0, Z: 0.0 })?;
        card.SetRotationAngleInDegrees(if args.flat { 0.0 } else { 22.0 })?;
        stage.Children()?.InsertAtTop(&card)?;

        // A solid accent chip on the card, to show text-sized detail stays crisp.
        let accent = compositor.CreateColorBrushWithColor(color(255, 120, 170, 255))?;
        let chip = sprite(&compositor, &accent.cast()?, 120.0, 12.0, 24.0, 24.0)?;
        card.Children()?.InsertAtTop(&chip)?;

        // --text: real UI text through D3D11 + Direct2D + DirectWrite into a composition surface.
        let _text_gpu = if args.text {
            let gpu = text::init(&compositor)?;
            println!("text: D3D11 feature level 0x{:x}", gpu.feature_level);
            let title = text::text_sprite(&gpu, &compositor, "Taskbar  -  Desktop  -  Title bar", 380, 36, 24.0, true)?;
            title.SetOffset(Vector3 { X: 24.0, Y: 56.0, Z: 0.0 })?;
            card.Children()?.InsertAtTop(&title)?;
            let body = text::text_sprite(&gpu, &compositor, "Segoe UI 14px: The quick brown fox jumps over the lazy dog 0123456789", 380, 60, 14.0, false)?;
            body.SetOffset(Vector3 { X: 24.0, Y: 104.0, Z: 0.0 })?;
            card.Children()?.InsertAtTop(&body)?;
            Some(gpu)
        } else {
            None
        };

        if args.anim {
            // The animation lives in the compositor: after this call the app does no
            // per-frame work at all.
            let a = compositor.CreateScalarKeyFrameAnimation()?;
            a.InsertKeyFrame(0.0, -35.0)?;
            a.InsertKeyFrame(1.0, 35.0)?;
            a.SetDuration(TimeSpan { Duration: 24_000_000 })?; // 2.4 s
            a.SetIterationBehavior(AnimationIterationBehavior::Forever)?;
            a.SetDirection(windows::UI::Composition::AnimationDirection::Alternate)?;
            let v: Visual = card.cast()?;
            v.StartAnimation(h!("RotationAngleInDegrees"), &a)?;
        }

        let started = Instant::now();
        let mut reported = [false; 3];
        let marks = [2u64, 8, args.secs.saturating_sub(1)];
        println!("spike: pid={} {}x{} anim={} full={}", std::process::id(), ww, wh, args.anim, args.full);

        let mut msg = MSG::default();
        // Poll for the report marks with a short timer; the loop otherwise blocks on messages.
        SetTimer(Some(hwnd), 1, 500, None);
        while GetMessageW(&mut msg, None, 0, 0).as_bool() {
            let _ = TranslateMessage(&msg);
            DispatchMessageW(&msg);
            let t = started.elapsed();
            for (i, m) in marks.iter().enumerate() {
                if !reported[i] && t >= Duration::from_secs(*m) {
                    reported[i] = true;
                    let (ws, pv) = memory_mb();
                    println!("t={:>2}s  working set {:>6.1} MB   private {:>6.1} MB", m, ws, pv);
                }
            }
            if t >= Duration::from_secs(args.secs) {
                break;
            }
        }
        let _ = HSTRING::new();
    }
    Ok(())
}

fn mul(a: Matrix4x4, b: Matrix4x4) -> Matrix4x4 {
    let r = |i: [f32; 4], j: [[f32; 4]; 4]| -> [f32; 4] {
        let mut o = [0.0; 4];
        for c in 0..4 {
            o[c] = i[0] * j[0][c] + i[1] * j[1][c] + i[2] * j[2][c] + i[3] * j[3][c];
        }
        o
    };
    let ar = |m: &Matrix4x4| [[m.M11, m.M12, m.M13, m.M14], [m.M21, m.M22, m.M23, m.M24], [m.M31, m.M32, m.M33, m.M34], [m.M41, m.M42, m.M43, m.M44]];
    let (aa, bb) = (ar(&a), ar(&b));
    let (r1, r2, r3, r4) = (r(aa[0], bb), r(aa[1], bb), r(aa[2], bb), r(aa[3], bb));
    Matrix4x4 {
        M11: r1[0], M12: r1[1], M13: r1[2], M14: r1[3],
        M21: r2[0], M22: r2[1], M23: r2[2], M24: r2[3],
        M31: r3[0], M32: r3[1], M33: r3[2], M34: r3[3],
        M41: r4[0], M42: r4[1], M43: r4[2], M44: r4[3],
    }
}
