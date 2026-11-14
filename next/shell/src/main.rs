//! Udaan Next shell, M3: the taskbar.
//!
//! One real AppBar per monitor (the OS reserves its strip, so maximised windows stop
//! above it), drawn by the Windows composition engine. Each bar window is exactly the
//! bar's shape, so the DWM blur behind it fits. Nothing animates unless the user
//! interacts: animations are springs that run on the compositor and then stop.
//!
//! A hidden "core" window owns what is not per-bar: the panic hotkey, timers, display
//! changes and Explorer-restart notifications.
//!
//! Flags: --replace   also hide Explorer's own taskbar (restored on exit; a watchdog
//!                    process restores it even if we crash)
//!        --autohide  bars slide away; the screen edge reveals them
//!        --secs N    exit after N seconds (testing)
//!        --noblur    skip the blur-behind material
//! Panic exit: Ctrl+Alt+Shift+Q.

mod text;

use std::cell::{Cell, RefCell};
use text::{Align, Label, TextGpu};
use windows::{
    core::{h, w, Interface, Result, BOOL},
    Foundation::TimeSpan,
    System::DispatcherQueueController,
    UI::{
        Color,
        Composition::{Compositor, ContainerVisual, Desktop::DesktopWindowTarget, SpriteVisual, Visual},
    },
    Win32::{
        Foundation::{HWND, LPARAM, LRESULT, RECT, WPARAM},
        Graphics::Gdi::{EnumDisplayMonitors, GetMonitorInfoW, HBRUSH, HDC, HMONITOR, MONITORINFO},
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
            Shell::{
                SHAppBarMessage, ABE_BOTTOM, ABM_NEW, ABM_QUERYPOS, ABM_REMOVE, ABM_SETAUTOHIDEBAR, ABM_SETPOS,
                APPBARDATA,
            },
            WindowsAndMessaging::*,
        },
    },
};
use windows_numerics::{Vector2, Vector3};

const WM_APPBAR: u32 = WM_APP + 1;
const WM_MOUSELEAVE: u32 = 0x02A3;
const WM_DPICHANGED_: u32 = 0x02E0;
const TIMER_CLOCK: usize = 1;
const TIMER_QUIT: usize = 2;
const TIMER_HIDE: usize = 10; // per bar: delay before sliding away
const TIMER_SHRINK: usize = 11; // per bar: shrink window to the trigger strip after the slide
const HOTKEY_PANIC: i32 = 1;
const BAR_HEIGHT: f32 = 48.0; // logical pixels
const TRIGGER_PX: i32 = 2;

struct Args {
    replace: bool,
    autohide: bool,
    secs: u32,
    blur: bool,
}

/// Everything drawn inside one bar window.
struct Vis {
    compositor: Compositor,
    gpu: TextGpu,
    _target: DesktopWindowTarget,
    content: ContainerVisual,
    clock: Label,
    clock_text: String,
    start: SpriteVisual,
    start_hot: bool,
    start_rect: RECT,
    tracking: bool,
    height: f32,
}

struct Bar {
    hwnd: HWND,
    mon: RECT,
    /// True only if the OS granted us the auto-hide slot for this edge.
    autohide: bool,
    shown: bool,
    vis: Option<Vis>,
}

thread_local! {
    static BARS: RefCell<Vec<Bar>> = const { RefCell::new(Vec::new()) };
    static CORE: Cell<HWND> = const { Cell::new(HWND(std::ptr::null_mut())) };
    static TASKBAR_CREATED: Cell<u32> = const { Cell::new(0) };
    static TRAY: Cell<Option<HWND>> = const { Cell::new(None) };
    static ARGS: Cell<(bool, bool, bool)> = const { Cell::new((false, false, true)) }; // replace, autohide, blur
}

fn parse_args() -> Args {
    let mut a = Args { replace: false, autohide: false, secs: 0, blur: true };
    let mut it = std::env::args().skip(1);
    while let Some(arg) = it.next() {
        match arg.as_str() {
            "--replace" => a.replace = true,
            "--autohide" => a.autohide = true,
            "--noblur" => a.blur = false,
            "--secs" => a.secs = it.next().and_then(|v| v.parse().ok()).unwrap_or(0),
            _ => {}
        }
    }
    a
}

/// Run `f` on the bar that owns `hwnd`. Skips (returns None) if the registry is already
/// borrowed, which can only happen on a re-entrant message.
fn with_bar<R>(hwnd: HWND, f: impl FnOnce(&mut Bar) -> R) -> Option<R> {
    BARS.with(|b| {
        let mut g = b.try_borrow_mut().ok()?;
        g.iter_mut().find(|bar| bar.hwnd == hwnd).map(f)
    })
}

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
        let mut a = Accent { state: 3, flags: 2, color_abgr: 0, anim: 0 };
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

unsafe extern "system" fn collect_monitor(_m: HMONITOR, _dc: HDC, rc: *mut RECT, data: LPARAM) -> BOOL {
    let v = &mut *(data.0 as *mut Vec<RECT>);
    v.push(*rc);
    BOOL(1)
}

/// Monitor rectangles, primary first.
fn monitors() -> Vec<RECT> {
    let mut v: Vec<RECT> = Vec::new();
    unsafe {
        let _ = EnumDisplayMonitors(None, None, Some(collect_monitor), LPARAM(&mut v as *mut _ as isize));
    }
    v.sort_by_key(|r| !(r.left == 0 && r.top == 0));
    let _ = GetMonitorInfoW; // (kept for per-monitor work-area queries later)
    let _ = MONITORINFO::default;
    v
}

fn appbar_data(hwnd: HWND) -> APPBARDATA {
    APPBARDATA { cbSize: std::mem::size_of::<APPBARDATA>() as u32, hWnd: hwnd, ..Default::default() }
}

fn bar_height_px(hwnd: HWND) -> i32 {
    let dpi = unsafe { GetDpiForWindow(hwnd) }.max(96);
    (BAR_HEIGHT * dpi as f32 / 96.0).round() as i32
}

/// Put the window where it belongs. Normal bars claim their strip from the OS;
/// auto-hide bars only occupy the screen edge (a thin trigger strip while hidden).
unsafe fn place(bar: &Bar) {
    let h = bar_height_px(bar.hwnd);
    let mon = bar.mon;
    if bar.autohide {
        let hh = if bar.shown { h } else { TRIGGER_PX };
        let _ = SetWindowPos(bar.hwnd, Some(HWND_TOPMOST), mon.left, mon.bottom - hh, mon.right - mon.left, hh, SWP_NOACTIVATE);
    } else {
        let mut abd = appbar_data(bar.hwnd);
        abd.uEdge = ABE_BOTTOM;
        abd.rc = mon;
        SHAppBarMessage(ABM_QUERYPOS, &mut abd);
        abd.rc.top = abd.rc.bottom - h;
        SHAppBarMessage(ABM_SETPOS, &mut abd);
        let r = abd.rc;
        let _ = SetWindowPos(bar.hwnd, Some(HWND_TOPMOST), r.left, r.top, r.right - r.left, r.bottom - r.top, SWP_NOACTIVATE);
    }
}

/// Register with the shell. Returns whether auto-hide was granted (if requested).
unsafe fn register(hwnd: HWND, want_autohide: bool) -> bool {
    let mut abd = appbar_data(hwnd);
    abd.uCallbackMessage = WM_APPBAR;
    SHAppBarMessage(ABM_NEW, &mut abd);
    if want_autohide {
        abd.uEdge = ABE_BOTTOM;
        abd.lParam = LPARAM(1);
        return SHAppBarMessage(ABM_SETAUTOHIDEBAR, &mut abd) != 0;
    }
    false
}

fn build(hwnd: HWND, shown: bool) -> Result<Vis> {
    unsafe {
        let mut rc = RECT::default();
        GetClientRect(hwnd, &mut rc)?;
        // Content is laid out at full bar height even when the window is a thin strip.
        let h = bar_height_px(hwnd) as f32;
        let w = (rc.right - rc.left) as f32;
        let s = GetDpiForWindow(hwnd).max(96) as f32 / 96.0;

        let compositor = Compositor::new()?;
        let interop: ICompositorDesktopInterop = compositor.cast()?;
        let target = interop.CreateDesktopWindowTarget(hwnd, true)?;
        let root: ContainerVisual = compositor.CreateContainerVisual()?;
        root.SetSize(Vector2 { X: w, Y: h })?;
        target.SetRoot(&root)?;

        // Everything lives under `content`, so sliding the bar is one property.
        let content: ContainerVisual = compositor.CreateContainerVisual()?;
        content.SetSize(Vector2 { X: w, Y: h })?;
        content.SetOffset(Vector3 { X: 0.0, Y: if shown { 0.0 } else { h }, Z: 0.0 })?;
        root.Children()?.InsertAtTop(&content)?;

        let grad = compositor.CreateLinearGradientBrush()?;
        grad.SetStartPoint(Vector2 { X: 0.0, Y: 0.0 })?;
        grad.SetEndPoint(Vector2 { X: 0.0, Y: 1.0 })?;
        grad.ColorStops()?.Append(&compositor.CreateColorGradientStopWithOffsetAndColor(0.0, color(150, 34, 40, 56))?)?;
        grad.ColorStops()?.Append(&compositor.CreateColorGradientStopWithOffsetAndColor(1.0, color(185, 14, 17, 28))?)?;
        content.Children()?.InsertAtTop(&sprite(&compositor, &grad.cast()?, w, h, 0.0, 0.0)?)?;

        let hl = compositor.CreateColorBrushWithColor(color(46, 255, 255, 255))?;
        content.Children()?.InsertAtTop(&sprite(&compositor, &hl.cast()?, w, 1.0_f32.max(s.floor()), 0.0, 0.0)?)?;

        let gpu = TextGpu::new(&compositor)?;

        let chip = (36.0 * s).round();
        let cx = (12.0 * s).round();
        let cy = ((h - chip) / 2.0).round();
        let accent = compositor.CreateColorBrushWithColor(color(255, 96, 140, 255))?;
        let start = sprite(&compositor, &accent.cast()?, chip, chip, cx, cy)?;
        start.SetCenterPoint(Vector3 { X: chip / 2.0, Y: chip / 2.0, Z: 0.0 })?;
        let mono = gpu.label(&compositor, chip as u32, chip as u32, 18.0 * s, true, Align::Center, [1.0, 1.0, 1.0, 1.0])?;
        mono.set_text(&gpu, "U")?;
        start.Children()?.InsertAtTop(&mono.visual)?;
        content.Children()?.InsertAtTop(&start)?;
        let start_rect = RECT { left: cx as i32, top: cy as i32, right: (cx + chip) as i32, bottom: (cy + chip) as i32 };

        let slot = (32.0 * s).round();
        let gap = (10.0 * s).round();
        let total = 5.0 * slot + 4.0 * gap;
        let slot_brush = compositor.CreateColorBrushWithColor(color(34, 255, 255, 255))?;
        for i in 0..5 {
            let x = ((w - total) / 2.0 + i as f32 * (slot + gap)).round();
            content.Children()?.InsertAtTop(&sprite(&compositor, &slot_brush.cast()?, slot, slot, x, ((h - slot) / 2.0).round())?)?;
        }

        let (cw, ch) = ((220.0 * s) as u32, h as u32);
        let clock = gpu.label(&compositor, cw, ch, 13.0 * s, false, Align::Right, [0.93, 0.95, 1.0, 0.92])?;
        let clock_text = clock_string();
        clock.set_text(&gpu, &clock_text)?;
        clock.visual.SetOffset(Vector3 { X: w - cw as f32 - 16.0 * s, Y: 0.0, Z: 0.0 })?;
        content.Children()?.InsertAtTop(&clock.visual)?;

        Ok(Vis { compositor, gpu, _target: target, content, clock, clock_text, start, start_hot: false, start_rect, tracking: false, height: h })
    }
}

fn spring(compositor: &Compositor, v: &Visual, prop: &windows::core::HSTRING, to: f32, damping: f32, period_100ns: i64) {
    let go = || -> Result<()> {
        let sp = compositor.CreateSpringScalarAnimation()?;
        let fv = windows::Foundation::PropertyValue::CreateSingle(to)?.cast::<windows::Foundation::IReference<f32>>()?;
        sp.SetFinalValue(&fv)?;
        sp.SetDampingRatio(damping)?;
        sp.SetPeriod(TimeSpan { Duration: period_100ns })?;
        v.StartAnimation(prop, &sp)
    };
    let _ = go();
}

fn spring_start(vis: &Vis, to: f32) {
    if let Ok(v) = vis.start.cast::<Visual>() {
        spring(&vis.compositor, &v, h!("Scale.X"), to, 0.55, 450_000);
        spring(&vis.compositor, &v, h!("Scale.Y"), to, 0.55, 450_000);
    }
}

/// Slide the whole bar in or out (auto-hide). Critically damped: no bounce on a bar edge.
unsafe fn slide(bar: &mut Bar, show: bool) {
    if bar.shown == show {
        return;
    }
    bar.shown = show;
    let _ = KillTimer(Some(bar.hwnd), TIMER_HIDE);
    let _ = KillTimer(Some(bar.hwnd), TIMER_SHRINK);
    if show {
        place(bar); // grow the window first so there is room to draw
    }
    if let Some(vis) = &bar.vis {
        if let Ok(v) = vis.content.cast::<Visual>() {
            spring(&vis.compositor, &v, h!("Offset.Y"), if show { 0.0 } else { vis.height }, 1.0, 700_000);
        }
    }
    if !show {
        SetTimer(Some(bar.hwnd), TIMER_SHRINK, 320, None); // shrink once the slide has finished
    }
}

fn create_bar(mon: RECT, want_autohide: bool, blur: bool) -> Result<()> {
    unsafe {
        let hinst = GetModuleHandleW(None)?;
        let hwnd = CreateWindowExW(
            WS_EX_NOREDIRECTIONBITMAP | WS_EX_TOPMOST | WS_EX_TOOLWINDOW,
            w!("UdaanNextTaskbar"),
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
        let autohide = register(hwnd, want_autohide);
        if want_autohide && !autohide {
            println!("autohide: not granted by the shell for monitor at ({},{}); using a docked bar", mon.left, mon.top);
        }
        let mut bar = Bar { hwnd, mon, autohide, shown: !autohide, vis: None };
        place(&bar);
        if blur {
            apply_blur(hwnd);
        }
        bar.vis = Some(build(hwnd, bar.shown)?);
        let _ = ShowWindow(hwnd, SW_SHOWNA);
        BARS.with(|b| b.borrow_mut().push(bar));
    }
    Ok(())
}

/// Tear down every bar and rebuild for the monitors that exist now.
fn sync_bars() {
    let old: Vec<Bar> = BARS.with(|b| std::mem::take(&mut *b.borrow_mut()));
    unsafe {
        for mut bar in old {
            let mut abd = appbar_data(bar.hwnd);
            if bar.autohide {
                abd.uEdge = ABE_BOTTOM;
                abd.lParam = LPARAM(0);
                SHAppBarMessage(ABM_SETAUTOHIDEBAR, &mut abd);
            }
            SHAppBarMessage(ABM_REMOVE, &mut abd);
            bar.vis = None; // release the composition target before the window goes
            let _ = DestroyWindow(bar.hwnd);
        }
    }
    let (_, autohide, blur) = ARGS.with(|a| a.get());
    for mon in monitors() {
        if let Err(e) = create_bar(mon, autohide, blur) {
            println!("bar for monitor ({},{}) failed: {e}", mon.left, mon.top);
        }
    }
    println!("bars: {} (monitors: {})", BARS.with(|b| b.borrow().len()), monitors().len());
}

fn shutdown() {
    let old: Vec<Bar> = BARS.with(|b| std::mem::take(&mut *b.borrow_mut()));
    unsafe {
        for bar in &old {
            let mut abd = appbar_data(bar.hwnd);
            if bar.autohide {
                abd.uEdge = ABE_BOTTOM;
                abd.lParam = LPARAM(0);
                SHAppBarMessage(ABM_SETAUTOHIDEBAR, &mut abd);
            }
            SHAppBarMessage(ABM_REMOVE, &mut abd);
        }
        if let Some(t) = TRAY.with(|t| t.get()) {
            let _ = ShowWindow(t, SW_SHOWNA);
        }
        PostQuitMessage(0);
    }
    drop(old);
}

extern "system" fn bar_proc(hwnd: HWND, msg: u32, wp: WPARAM, lp: LPARAM) -> LRESULT {
    unsafe {
        match msg {
            WM_APPBAR => {
                match wp.0 as u32 {
                    1 => {
                        with_bar(hwnd, |b| place(b));
                    }
                    2 => {
                        // ABN_FULLSCREENAPP: lparam != 0 means a full-screen app took over.
                        let z = if lp.0 != 0 { HWND_BOTTOM } else { HWND_TOPMOST };
                        let _ = SetWindowPos(hwnd, Some(z), 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
                    }
                    _ => {}
                }
                LRESULT(0)
            }
            WM_DPICHANGED_ => {
                // New scale: every size in the scene changes, so rebuild at the new scale.
                with_bar(hwnd, |b| {
                    b.vis = None;
                    place(b);
                    b.vis = build(b.hwnd, b.shown).ok();
                });
                LRESULT(0)
            }
            WM_MOUSEMOVE => {
                let (x, y) = ((lp.0 & 0xffff) as i16 as i32, ((lp.0 >> 16) & 0xffff) as i16 as i32);
                with_bar(hwnd, |b| {
                    if b.autohide {
                        if !b.shown {
                            slide(b, true);
                        } else {
                            let _ = KillTimer(Some(hwnd), TIMER_HIDE);
                        }
                    }
                    if let Some(v) = b.vis.as_mut() {
                        let r = v.start_rect;
                        let hot = b.shown && x >= r.left && x < r.right && y >= r.top && y < r.bottom;
                        if !v.tracking {
                            v.tracking = true;
                            let mut t = TRACKMOUSEEVENT { cbSize: std::mem::size_of::<TRACKMOUSEEVENT>() as u32, dwFlags: TME_LEAVE, hwndTrack: hwnd, dwHoverTime: 0 };
                            let _ = TrackMouseEvent(&mut t);
                        }
                        if hot != v.start_hot {
                            v.start_hot = hot;
                            spring_start(v, if hot { 1.14 } else { 1.0 });
                        }
                    }
                });
                LRESULT(0)
            }
            WM_MOUSELEAVE => {
                with_bar(hwnd, |b| {
                    if let Some(v) = b.vis.as_mut() {
                        v.tracking = false;
                        if v.start_hot {
                            v.start_hot = false;
                            spring_start(v, 1.0);
                        }
                    }
                    if b.autohide && b.shown {
                        SetTimer(Some(hwnd), TIMER_HIDE, 450, None);
                    }
                });
                LRESULT(0)
            }
            WM_TIMER => {
                let id = wp.0;
                if id == TIMER_HIDE {
                    let _ = KillTimer(Some(hwnd), TIMER_HIDE);
                    with_bar(hwnd, |b| slide(b, false));
                } else if id == TIMER_SHRINK {
                    let _ = KillTimer(Some(hwnd), TIMER_SHRINK);
                    with_bar(hwnd, |b| {
                        if !b.shown {
                            place(b);
                        }
                    });
                }
                LRESULT(0)
            }
            WM_MOUSEACTIVATE => LRESULT(MA_NOACTIVATE as isize),
            _ => DefWindowProcW(hwnd, msg, wp, lp),
        }
    }
}

extern "system" fn core_proc(hwnd: HWND, msg: u32, wp: WPARAM, lp: LPARAM) -> LRESULT {
    unsafe {
        // Explorer restarted: appbar registrations were dropped and its taskbar is a new
        // window (re-hide it if we are replacing it).
        if msg != 0 && msg == TASKBAR_CREATED.with(|m| m.get()) {
            let (replace, _, _) = ARGS.with(|a| a.get());
            let bars: Vec<(HWND, bool)> = BARS.with(|b| b.borrow().iter().map(|x| (x.hwnd, x.autohide)).collect());
            for (bh, ah) in bars {
                register(bh, ah);
            }
            BARS.with(|b| {
                for bar in b.borrow().iter() {
                    place(bar);
                }
            });
            if replace {
                if let Ok(t) = FindWindowW(w!("Shell_TrayWnd"), None) {
                    let _ = ShowWindow(t, SW_HIDE);
                    TRAY.with(|c| c.set(Some(t)));
                }
            }
            return LRESULT(0);
        }
        match msg {
            WM_DISPLAYCHANGE => {
                sync_bars();
                LRESULT(0)
            }
            WM_TIMER => {
                if wp.0 == TIMER_QUIT {
                    shutdown();
                } else if wp.0 == TIMER_CLOCK {
                    // Redraw only when the visible text actually changes.
                    BARS.with(|b| {
                        for bar in b.borrow_mut().iter_mut() {
                            if let Some(v) = bar.vis.as_mut() {
                                let now = clock_string();
                                if now != v.clock_text {
                                    let _ = v.clock.set_text(&v.gpu, &now);
                                    v.clock_text = now;
                                }
                            }
                        }
                    });
                }
                LRESULT(0)
            }
            WM_HOTKEY => {
                shutdown();
                LRESULT(0)
            }
            _ => DefWindowProcW(hwnd, msg, wp, lp),
        }
    }
}

fn main() -> Result<()> {
    let args = parse_args();
    ARGS.with(|a| a.set((args.replace, args.autohide, args.blur)));
    unsafe {
        let _ = SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
        let _queue: DispatcherQueueController = CreateDispatcherQueueController(DispatcherQueueOptions {
            dwSize: std::mem::size_of::<DispatcherQueueOptions>() as u32,
            threadType: DQTYPE_THREAD_CURRENT,
            apartmentType: DQTAT_COM_NONE,
        })?;

        let hinst = GetModuleHandleW(None)?;
        RegisterClassW(&WNDCLASSW {
            hInstance: hinst.into(),
            lpszClassName: w!("UdaanNextTaskbar"),
            lpfnWndProc: Some(bar_proc),
            hCursor: LoadCursorW(None, IDC_ARROW)?,
            hbrBackground: HBRUSH::default(),
            ..Default::default()
        });
        RegisterClassW(&WNDCLASSW { hInstance: hinst.into(), lpszClassName: w!("UdaanNextCore"), lpfnWndProc: Some(core_proc), ..Default::default() });

        // Hidden top-level window (not message-only: those miss broadcast messages such
        // as display changes and TaskbarCreated).
        let core = CreateWindowExW(WS_EX_TOOLWINDOW, w!("UdaanNextCore"), w!("Udaan core"), WS_POPUP, 0, 0, 0, 0, None, None, Some(hinst.into()), None)?;
        CORE.with(|c| c.set(core));
        TASKBAR_CREATED.with(|m| m.set(RegisterWindowMessageW(w!("TaskbarCreated"))));

        if args.replace {
            if let Ok(t) = FindWindowW(w!("Shell_TrayWnd"), None) {
                let _ = ShowWindow(t, SW_HIDE);
                TRAY.with(|c| c.set(Some(t)));
            }
            // Guard process: restores Explorer's taskbar even if we crash or are killed.
            if let Ok(exe) = std::env::current_exe() {
                let _ = std::process::Command::new(exe.with_file_name("watchdog.exe")).arg(std::process::id().to_string()).spawn();
            }
        }

        sync_bars();

        let _ = RegisterHotKey(Some(core), HOTKEY_PANIC, MOD_CONTROL | MOD_ALT | MOD_SHIFT, 'Q' as u32);
        SetTimer(Some(core), TIMER_CLOCK, 15_000, None);
        if args.secs > 0 {
            SetTimer(Some(core), TIMER_QUIT, args.secs * 1000, None);
        }

        BARS.with(|b| {
            for bar in b.borrow().iter() {
                let mut r = RECT::default();
                let _ = GetWindowRect(bar.hwnd, &mut r);
                println!("bar: rect=({},{})-({},{}) autohide={} replace={}", r.left, r.top, r.right, r.bottom, bar.autohide, args.replace);
            }
        });

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
    }
    Ok(())
}
