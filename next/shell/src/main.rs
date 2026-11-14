//! Udaan Next shell, M3: the taskbar.
//!
//! A real AppBar (the OS reserves its strip of the screen, so maximised windows stop
//! above it) drawn entirely by the Windows composition engine. The window is exactly
//! the bar's shape, so the DWM blur behind it fits. Nothing animates unless the user
//! interacts: animations are springs that run on the compositor and then stop.
//!
//! Flags: --replace   also hide Explorer's own taskbar (restored on exit)
//!        --secs N    exit after N seconds (testing)
//!        --noblur    skip the blur-behind material
//! Panic exit: Ctrl+Alt+Shift+Q (always restores Explorer's taskbar).

mod text;

use std::cell::RefCell;
use text::{Align, Label, TextGpu};
use windows::{
    core::{h, w, Interface, Result},
    Foundation::TimeSpan,
    System::DispatcherQueueController,
    UI::{
        Color,
        Composition::{
            Compositor, ContainerVisual, Desktop::DesktopWindowTarget, SpriteVisual, Visual,
        },
    },
    Win32::{
        Foundation::{HWND, LPARAM, LRESULT, POINT, RECT, WPARAM},
        Graphics::Gdi::{GetMonitorInfoW, MonitorFromPoint, HBRUSH, MONITORINFO, MONITOR_DEFAULTTOPRIMARY},
        System::{
            LibraryLoader::{GetModuleHandleW, GetProcAddress},
            ProcessStatus::{K32GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS_EX},
            SystemInformation::GetLocalTime,
            Threading::GetCurrentProcess,
            WinRT::{
                Composition::ICompositorDesktopInterop, CreateDispatcherQueueController, DispatcherQueueOptions,
                DQTAT_COM_NONE, DQTYPE_THREAD_CURRENT,
            },
        },
        UI::{
            HiDpi::{GetDpiForWindow, SetProcessDpiAwarenessContext, DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2},
            Input::KeyboardAndMouse::{
                RegisterHotKey, TrackMouseEvent, MOD_ALT, MOD_CONTROL, MOD_SHIFT, TME_LEAVE, TRACKMOUSEEVENT,
            },
            Shell::{SHAppBarMessage, ABE_BOTTOM, ABM_NEW, ABM_QUERYPOS, ABM_REMOVE, ABM_SETPOS, APPBARDATA},
            WindowsAndMessaging::*,
        },
    },
};
use windows_numerics::{Vector2, Vector3};

const WM_APPBAR: u32 = WM_APP + 1;
const WM_MOUSELEAVE: u32 = 0x02A3;
const TIMER_CLOCK: usize = 1;
const TIMER_QUIT: usize = 2;
const HOTKEY_PANIC: i32 = 1;
const BAR_HEIGHT: f32 = 48.0; // logical pixels

struct Args {
    replace: bool,
    secs: u32,
    blur: bool,
}

struct App {
    compositor: Compositor,
    gpu: TextGpu,
    _target: DesktopWindowTarget,
    clock: Label,
    clock_text: String,
    start: SpriteVisual,
    start_hot: bool,
    start_rect: RECT,
    tracking: bool,
    explorer_tray: Option<HWND>,
}

thread_local! {
    static TASKBAR_CREATED: std::cell::Cell<u32> = const { std::cell::Cell::new(0) };
    static REPLACE: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
    static APP: RefCell<Option<App>> = const { RefCell::new(None) };
}

fn parse_args() -> Args {
    let mut a = Args { replace: false, secs: 0, blur: true };
    let mut it = std::env::args().skip(1);
    while let Some(arg) = it.next() {
        match arg.as_str() {
            "--replace" => a.replace = true,
            "--noblur" => a.blur = false,
            "--secs" => a.secs = it.next().and_then(|v| v.parse().ok()).unwrap_or(0),
            _ => {}
        }
    }
    a
}

/// Ask DWM to blur whatever is behind this window (undocumented but long-standing).
fn apply_blur(hwnd: HWND) {
    #[repr(C)]
    struct Accent { state: u32, flags: u32, color_abgr: u32, anim: u32 }
    #[repr(C)]
    struct Data { attr: u32, data: *mut core::ffi::c_void, size: usize }
    type F = unsafe extern "system" fn(HWND, *mut Data) -> i32;
    unsafe {
        let Ok(lib) = GetModuleHandleW(w!("user32.dll")) else { return };
        let Some(f) = GetProcAddress(lib, windows::core::s!("SetWindowCompositionAttribute")) else { return };
        let f: F = std::mem::transmute(f);
        let mut a = Accent { state: 3, flags: 2, color_abgr: 0x00_00_00_00, anim: 0 };
        let mut d = Data { attr: 19, data: &mut a as *mut _ as *mut _, size: std::mem::size_of::<Accent>() };
        f(hwnd, &mut d);
    }
}

fn memory_mb() -> (f64, f64) {
    unsafe {
        let mut c = PROCESS_MEMORY_COUNTERS_EX::default();
        c.cb = std::mem::size_of::<PROCESS_MEMORY_COUNTERS_EX>() as u32;
        if K32GetProcessMemoryInfo(GetCurrentProcess(), &mut c as *mut _ as *mut _, c.cb).as_bool() {
            (c.WorkingSetSize as f64 / 1_048_576.0, c.PrivateUsage as f64 / 1_048_576.0)
        } else {
            (0.0, 0.0)
        }
    }
}

fn clock_string() -> String {
    const DAYS: [&str; 7] = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const MONTHS: [&str; 12] = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    let t = unsafe { GetLocalTime() };
    format!(
        "{:02}:{:02}   {} {} {}",
        t.wHour,
        t.wMinute,
        DAYS[(t.wDayOfWeek as usize) % 7],
        t.wDay,
        MONTHS[((t.wMonth as usize).max(1) - 1) % 12]
    )
}

fn color(a: u8, r: u8, g: u8, b: u8) -> Color {
    Color { A: a, R: r, G: g, B: b }
}

fn sprite(c: &Compositor, brush: &windows::UI::Composition::CompositionBrush, w: f32, h: f32, x: f32, y: f32) -> Result<SpriteVisual> {
    let s = c.CreateSpriteVisual()?;
    s.SetBrush(brush)?;
    s.SetSize(Vector2 { X: w, Y: h })?;
    s.SetOffset(Vector3 { X: x, Y: y, Z: 0.0 })?;
    Ok(s)
}

fn monitor_rect() -> RECT {
    unsafe {
        let mon = MonitorFromPoint(POINT { x: 0, y: 0 }, MONITOR_DEFAULTTOPRIMARY);
        let mut mi = MONITORINFO { cbSize: std::mem::size_of::<MONITORINFO>() as u32, ..Default::default() };
        let _ = GetMonitorInfoW(mon, &mut mi);
        mi.rcMonitor
    }
}

fn appbar_data(hwnd: HWND) -> APPBARDATA {
    APPBARDATA { cbSize: std::mem::size_of::<APPBARDATA>() as u32, hWnd: hwnd, ..Default::default() }
}

/// Claim the bottom strip of the monitor and move the window onto it. Safe to call
/// again whenever the OS says the layout changed.
unsafe fn dock(hwnd: HWND, height_px: i32) {
    let mon = monitor_rect();
    let mut abd = appbar_data(hwnd);
    abd.uEdge = ABE_BOTTOM;
    abd.rc = mon;
    SHAppBarMessage(ABM_QUERYPOS, &mut abd);
    abd.rc.top = abd.rc.bottom - height_px;
    SHAppBarMessage(ABM_SETPOS, &mut abd);
    let r = abd.rc;
    let _ = SetWindowPos(hwnd, Some(HWND_TOPMOST), r.left, r.top, r.right - r.left, r.bottom - r.top, SWP_NOACTIVATE);
}

fn bar_height_px(hwnd: HWND) -> i32 {
    let dpi = unsafe { GetDpiForWindow(hwnd) }.max(96);
    (BAR_HEIGHT * dpi as f32 / 96.0).round() as i32
}

fn build(hwnd: HWND, explorer_tray: Option<HWND>) -> Result<App> {
    unsafe {
        let mut rc = RECT::default();
        GetClientRect(hwnd, &mut rc)?;
        let (w, h) = ((rc.right - rc.left) as f32, (rc.bottom - rc.top) as f32);
        let s = GetDpiForWindow(hwnd).max(96) as f32 / 96.0;

        let compositor = Compositor::new()?;
        let interop: ICompositorDesktopInterop = compositor.cast()?;
        let target = interop.CreateDesktopWindowTarget(hwnd, true)?;
        let root: ContainerVisual = compositor.CreateContainerVisual()?;
        root.SetSize(Vector2 { X: w, Y: h })?;
        target.SetRoot(&root)?;

        // Glass body: a faint vertical gradient over the blurred backdrop.
        let grad = compositor.CreateLinearGradientBrush()?;
        grad.SetStartPoint(Vector2 { X: 0.0, Y: 0.0 })?;
        grad.SetEndPoint(Vector2 { X: 0.0, Y: 1.0 })?;
        grad.ColorStops()?.Append(&compositor.CreateColorGradientStopWithOffsetAndColor(0.0, color(150, 34, 40, 56))?)?;
        grad.ColorStops()?.Append(&compositor.CreateColorGradientStopWithOffsetAndColor(1.0, color(185, 14, 17, 28))?)?;
        root.Children()?.InsertAtTop(&sprite(&compositor, &grad.cast()?, w, h, 0.0, 0.0)?)?;

        // One-pixel top highlight: the edge catching light.
        let hl = compositor.CreateColorBrushWithColor(color(46, 255, 255, 255))?;
        root.Children()?.InsertAtTop(&sprite(&compositor, &hl.cast()?, w, 1.0_f32.max(s.floor()), 0.0, 0.0)?)?;

        let gpu = TextGpu::new(&compositor)?;

        // Start chip (visual only for now): accent tile with a monogram.
        let chip = (36.0 * s).round();
        let cx = (12.0 * s).round();
        let cy = ((h - chip) / 2.0).round();
        let accent = compositor.CreateColorBrushWithColor(color(255, 96, 140, 255))?;
        let start = sprite(&compositor, &accent.cast()?, chip, chip, cx, cy)?;
        start.SetCenterPoint(Vector3 { X: chip / 2.0, Y: chip / 2.0, Z: 0.0 })?;
        let mono = gpu.label(&compositor, chip as u32, chip as u32, 18.0 * s, true, Align::Center, [1.0, 1.0, 1.0, 1.0])?;
        mono.set_text(&gpu, "U")?;
        start.Children()?.InsertAtTop(&mono.visual)?;
        root.Children()?.InsertAtTop(&start)?;
        let start_rect = RECT { left: cx as i32, top: cy as i32, right: (cx + chip) as i32, bottom: (cy + chip) as i32 };

        // Placeholder slots for where running apps will sit.
        let slot = (32.0 * s).round();
        let gap = (10.0 * s).round();
        let total = 5.0 * slot + 4.0 * gap;
        let slot_brush = compositor.CreateColorBrushWithColor(color(34, 255, 255, 255))?;
        for i in 0..5 {
            let x = ((w - total) / 2.0 + i as f32 * (slot + gap)).round();
            root.Children()?.InsertAtTop(&sprite(&compositor, &slot_brush.cast()?, slot, slot, x, ((h - slot) / 2.0).round())?)?;
        }

        // Clock, right-aligned.
        let (cw, ch) = ((220.0 * s) as u32, h as u32);
        let clock = gpu.label(&compositor, cw, ch, 13.0 * s, false, Align::Right, [0.93, 0.95, 1.0, 0.92])?;
        let clock_text = clock_string();
        clock.set_text(&gpu, &clock_text)?;
        clock.visual.SetOffset(Vector3 { X: w - cw as f32 - 16.0 * s, Y: 0.0, Z: 0.0 })?;
        root.Children()?.InsertAtTop(&clock.visual)?;

        Ok(App { compositor, gpu, _target: target, clock, clock_text, start, start_hot: false, start_rect, tracking: false, explorer_tray })
    }
}

/// Spring the start chip to a target scale. The spring runs on the compositor.
fn spring_start(app: &App, to: f32) {
    let go = || -> Result<()> {
        let v: Visual = app.start.cast()?;
        for prop in [h!("Scale.X"), h!("Scale.Y")] {
            let sp = app.compositor.CreateSpringScalarAnimation()?;
            let fv = windows::Foundation::PropertyValue::CreateSingle(to)?.cast::<windows::Foundation::IReference<f32>>()?;
            sp.SetFinalValue(&fv)?;
            sp.SetDampingRatio(0.55)?;
            sp.SetPeriod(TimeSpan { Duration: 450_000 })?;
            v.StartAnimation(prop, &sp)?;
        }
        Ok(())
    };
    let _ = go();
}

fn shutdown(hwnd: HWND) {
    unsafe {
        let mut abd = appbar_data(hwnd);
        SHAppBarMessage(ABM_REMOVE, &mut abd);
        APP.with(|a| {
            if let Some(app) = a.borrow().as_ref() {
                if let Some(t) = app.explorer_tray {
                    let _ = ShowWindow(t, SW_SHOWNA);
                }
            }
        });
        PostQuitMessage(0);
    }
}

extern "system" fn wndproc(hwnd: HWND, msg: u32, wp: WPARAM, lp: LPARAM) -> LRESULT {
    unsafe {
        // Explorer restarted: its taskbar is a new window (re-hide it) and appbar
        // registrations were dropped (re-register, re-dock).
        if msg != 0 && msg == TASKBAR_CREATED.with(|m| m.get()) {
            let mut abd = appbar_data(hwnd);
            abd.uCallbackMessage = WM_APPBAR;
            SHAppBarMessage(ABM_NEW, &mut abd);
            dock(hwnd, bar_height_px(hwnd));
            if REPLACE.with(|r| r.get()) {
                if let Ok(t) = FindWindowW(w!("Shell_TrayWnd"), None) {
                    let _ = ShowWindow(t, SW_HIDE);
                    APP.with(|a| {
                        if let Some(app) = a.borrow_mut().as_mut() {
                            app.explorer_tray = Some(t);
                        }
                    });
                }
            }
            return LRESULT(0);
        }
        match msg {
            WM_APPBAR => {
                match wp.0 as u32 {
                    1 => dock(hwnd, bar_height_px(hwnd)), // ABN_POSCHANGED
                    2 => {
                        // ABN_FULLSCREENAPP: lparam != 0 means a full-screen app took over.
                        let z = if lp.0 != 0 { HWND_BOTTOM } else { HWND_TOPMOST };
                        let _ = SetWindowPos(hwnd, Some(z), 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
                    }
                    _ => {}
                }
                LRESULT(0)
            }
            WM_DISPLAYCHANGE => {
                dock(hwnd, bar_height_px(hwnd));
                LRESULT(0)
            }
            WM_MOUSEMOVE => {
                let (x, y) = ((lp.0 & 0xffff) as i16 as i32, ((lp.0 >> 16) & 0xffff) as i16 as i32);
                APP.with(|a| {
                    if let Some(app) = a.borrow_mut().as_mut() {
                        let r = app.start_rect;
                        let hot = x >= r.left && x < r.right && y >= r.top && y < r.bottom;
                        if !app.tracking {
                            app.tracking = true;
                            let mut t = TRACKMOUSEEVENT { cbSize: std::mem::size_of::<TRACKMOUSEEVENT>() as u32, dwFlags: TME_LEAVE, hwndTrack: hwnd, dwHoverTime: 0 };
                            let _ = TrackMouseEvent(&mut t);
                        }
                        if hot != app.start_hot {
                            app.start_hot = hot;
                            spring_start(app, if hot { 1.14 } else { 1.0 });
                        }
                    }
                });
                LRESULT(0)
            }
            WM_MOUSELEAVE => {
                APP.with(|a| {
                    if let Some(app) = a.borrow_mut().as_mut() {
                        app.tracking = false;
                        if app.start_hot {
                            app.start_hot = false;
                            spring_start(app, 1.0);
                        }
                    }
                });
                LRESULT(0)
            }
            WM_TIMER => {
                if wp.0 == TIMER_QUIT {
                    shutdown(hwnd);
                } else if wp.0 == TIMER_CLOCK {
                    // Redraw only when the visible text actually changes.
                    APP.with(|a| {
                        if let Some(app) = a.borrow_mut().as_mut() {
                            let now = clock_string();
                            if now != app.clock_text {
                                let _ = app.clock.set_text(&app.gpu, &now);
                                app.clock_text = now;
                            }
                        }
                    });
                }
                LRESULT(0)
            }
            WM_HOTKEY => {
                shutdown(hwnd);
                LRESULT(0)
            }
            WM_MOUSEACTIVATE => LRESULT(MA_NOACTIVATE as isize),
            WM_DESTROY => {
                PostQuitMessage(0);
                LRESULT(0)
            }
            _ => DefWindowProcW(hwnd, msg, wp, lp),
        }
    }
}

fn main() -> Result<()> {
    let args = parse_args();
    unsafe {
        let _ = SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
        let _queue: DispatcherQueueController = CreateDispatcherQueueController(DispatcherQueueOptions {
            dwSize: std::mem::size_of::<DispatcherQueueOptions>() as u32,
            threadType: DQTYPE_THREAD_CURRENT,
            apartmentType: DQTAT_COM_NONE,
        })?;

        let hinst = GetModuleHandleW(None)?;
        let class = w!("UdaanNextTaskbar");
        RegisterClassW(&WNDCLASSW {
            hInstance: hinst.into(),
            lpszClassName: class,
            lpfnWndProc: Some(wndproc),
            hCursor: LoadCursorW(None, IDC_ARROW)?,
            hbrBackground: HBRUSH::default(),
            ..Default::default()
        });

        let mon = monitor_rect();
        let hwnd = CreateWindowExW(
            WS_EX_NOREDIRECTIONBITMAP | WS_EX_TOPMOST | WS_EX_TOOLWINDOW,
            class,
            w!("Udaan taskbar"),
            WS_POPUP,
            mon.left,
            mon.bottom - 48,
            mon.right - mon.left,
            48,
            None,
            None,
            Some(hinst.into()),
            None,
        )?;

        // Register, then size to the DPI-correct height, then build visuals at final size.
        let mut abd = appbar_data(hwnd);
        abd.uCallbackMessage = WM_APPBAR;
        SHAppBarMessage(ABM_NEW, &mut abd);
        dock(hwnd, bar_height_px(hwnd));

        if args.blur {
            apply_blur(hwnd);
        }

        // Only touch Explorer's taskbar when explicitly asked, and remember it to restore.
        let tray = if args.replace {
            let t = FindWindowW(w!("Shell_TrayWnd"), None).ok();
            if let Some(t) = t {
                let _ = ShowWindow(t, SW_HIDE);
            }
            // Guard process: restores Explorer's taskbar even if we crash or are killed.
            if let Ok(exe) = std::env::current_exe() {
                let wd = exe.with_file_name("watchdog.exe");
                let _ = std::process::Command::new(wd).arg(std::process::id().to_string()).spawn();
            }
            t
        } else {
            None
        };
        TASKBAR_CREATED.with(|m| m.set(RegisterWindowMessageW(w!("TaskbarCreated"))));
        REPLACE.with(|r| r.set(args.replace));

        let app = build(hwnd, tray)?;
        APP.with(|a| *a.borrow_mut() = Some(app));
        let _ = ShowWindow(hwnd, SW_SHOWNA);

        let _ = RegisterHotKey(Some(hwnd), HOTKEY_PANIC, MOD_CONTROL | MOD_ALT | MOD_SHIFT, 'Q' as u32);
        SetTimer(Some(hwnd), TIMER_CLOCK, 15_000, None);
        if args.secs > 0 {
            SetTimer(Some(hwnd), TIMER_QUIT, args.secs * 1000, None);
        }

        let mut r = RECT::default();
        let _ = GetWindowRect(hwnd, &mut r);
        println!("taskbar: pid={} rect=({},{})-({},{}) replace={}", std::process::id(), r.left, r.top, r.right, r.bottom, args.replace);

        let mut msg = MSG::default();
        let mut reported = false;
        let started = std::time::Instant::now();
        while GetMessageW(&mut msg, None, 0, 0).as_bool() {
            let _ = TranslateMessage(&msg);
            DispatchMessageW(&msg);
            if !reported && started.elapsed().as_secs() >= 3 {
                reported = true;
                let (ws, pv) = memory_mb();
                println!("memory: working set {ws:.1} MB, private {pv:.1} MB");
            }
        }
        let (ws, pv) = memory_mb();
        println!("exit: working set {ws:.1} MB, private {pv:.1} MB");
    }
    Ok(())
}
