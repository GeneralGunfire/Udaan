//! Udaan Next shell.
//!
//! One Rust process, one Compositor and one GPU device (see `engine`), hosting three
//! kinds of window on Windows composition:
//!   - the desktop layer, parented behind the desktop icons (wallpaper + widgets),
//!   - a floating glass dock per monitor,
//!   - a top menu bar per monitor.
//!
//! Nothing animates unless the user interacts; springs run on the compositor and stop.
//! A hidden "core" window owns what is not per-window: the panic hotkey, timers,
//! display/theme changes, Explorer-restart notifications, the window-change hook and
//! theme hot reload.
//!
//! Flags: --replace   also hide Explorer's own taskbar (restored on exit / by watchdog)
//!        --autohide  the dock slides away; the screen edge reveals it
//!        --secs N    exit after N seconds (testing)
//!        --notop     no top bar
//!        --nodock    no dock
//!        --nodesktop no desktop layer (keep the user's own wallpaper visible)
//! Panic exit: Ctrl+Alt+Shift+Q.

mod apps;
mod desktop;
mod dock;
mod engine;
mod gfx;
mod motion;
mod scene;
mod theme;
mod topbar;
mod win;

use desktop::Desktop;
use dock::Dock;
use engine::Engine;
use std::cell::RefCell;
use std::path::PathBuf;
use std::rc::Rc;
use theme::{DockApp, Theme};
use topbar::TopBar;
use windows::{
    core::{w, Result},
    Win32::{
        Foundation::{HANDLE, HWND, LPARAM, LRESULT, WPARAM},
        Storage::FileSystem::{
            FindCloseChangeNotification, FindFirstChangeNotificationW, FindNextChangeNotification,
            FILE_NOTIFY_CHANGE_LAST_WRITE, FILE_NOTIFY_CHANGE_SIZE,
        },
        System::{
            SystemInformation::GetLocalTime,
            Threading::INFINITE,
            WinRT::{CreateDispatcherQueueController, DispatcherQueueOptions, DQTAT_COM_STA, DQTYPE_THREAD_CURRENT},
        },
        UI::{
            HiDpi::{SetProcessDpiAwarenessContext, DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2},
            Input::KeyboardAndMouse::{RegisterHotKey, MOD_ALT, MOD_CONTROL, MOD_SHIFT},
            WindowsAndMessaging::*,
        },
    },
};

const TIMER_CLOCK: usize = 1;
const TIMER_QUIT: usize = 2;
const TIMER_RESCAN: usize = 3;
const TIMER_SETTING: usize = 4;
const TIMER_FILE: usize = 5;
const HOTKEY_PANIC: i32 = 1;

struct Args {
    replace: bool,
    autohide: bool,
    secs: u32,
    top: bool,
    dock: bool,
    desktop: bool,
}

struct App {
    args: Args,
    engine: Rc<Engine>,
    theme: Theme,
    theme_dir: PathBuf,
    dock_apps: Vec<DockApp>,
    dark: bool,
    transparent: bool,
    desktop: Option<Desktop>,
    docks: Vec<Dock>,
    bars: Vec<TopBar>,
    tray: Option<HWND>,
    taskbar_created: u32,
    front_name: String,
}

thread_local! {
    static APP: RefCell<Option<App>> = const { RefCell::new(None) };
}

/// Run `f` on the app state unless it is already borrowed (re-entrant message).
fn with_app<R>(f: impl FnOnce(&mut App) -> R) -> Option<R> {
    APP.with(|a| {
        let mut g = a.try_borrow_mut().ok()?;
        g.as_mut().map(f)
    })
}

fn parse_args() -> Args {
    let mut a = Args { replace: false, autohide: false, secs: 0, top: true, dock: true, desktop: true };
    let mut it = std::env::args().skip(1);
    while let Some(arg) = it.next() {
        match arg.as_str() {
            "--replace" => a.replace = true,
            "--autohide" => a.autohide = true,
            "--notop" => a.top = false,
            "--nodock" => a.dock = false,
            "--nodesktop" => a.desktop = false,
            "--secs" => a.secs = it.next().and_then(|v| v.parse().ok()).unwrap_or(0),
            _ => {}
        }
    }
    a
}

fn clock_string() -> String {
    const DAYS: [&str; 7] = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const MONTHS: [&str; 12] = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    let t = unsafe { GetLocalTime() };
    format!(
        "{} {} {}   {:02}:{:02}",
        DAYS[(t.wDayOfWeek as usize) % 7],
        t.wDay,
        MONTHS[((t.wMonth as usize).max(1) - 1) % 12],
        t.wHour,
        t.wMinute
    )
}

impl App {
    fn front_app_name(&self) -> String {
        apps::foreground()
            .map(|w| apps::description(&w.path))
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "Udaan".to_string())
    }

    /// Tear down and rebuild every shell window for the monitors that exist now.
    fn sync_windows(&mut self) {
        if let Some(d) = self.desktop.take() {
            d.destroy();
        }
        for d in self.docks.drain(..) {
            d.destroy();
        }
        for b in self.bars.drain(..) {
            b.destroy();
        }
        self.front_name = self.front_app_name();

        if self.args.desktop {
            match Desktop::create(&self.engine, &self.theme, self.dark) {
                Ok(d) => self.desktop = Some(d),
                Err(e) => println!("desktop layer failed: {e}"),
            }
        }
        for mon in win::monitors() {
            if self.args.top {
                match TopBar::create(&self.engine, mon, &self.theme, self.dark, &self.front_name) {
                    Ok(b) => self.bars.push(b),
                    Err(e) => println!("top bar for ({},{}) failed: {e}", mon.left, mon.top),
                }
            }
            if self.args.dock {
                match Dock::create(&self.engine, mon, &self.theme, &self.dock_apps, self.args.autohide, self.dark, self.transparent) {
                    Ok(d) => self.docks.push(d),
                    Err(e) => println!("dock for ({},{}) failed: {e}", mon.left, mon.top),
                }
            }
        }
        let clock = clock_string();
        for b in self.bars.iter_mut() {
            b.set_clock(&clock);
        }
        self.rescan();
        println!(
            "windows: desktop={} {} dock(s), {} top bar(s), {} monitor(s), {} cached text formats",
            self.desktop.is_some(),
            self.docks.len(),
            self.bars.len(),
            win::monitors().len(),
            self.engine.cached_format_count()
        );
    }

    /// Rebuild visuals in place (theme reload, light/dark change) without touching
    /// AppBar registrations.
    fn restyle(&mut self) {
        self.engine.clear_format_cache();
        let name = self.front_app_name();
        if let Some(d) = self.desktop.as_mut() {
            if let Err(e) = d.rebuild(&self.engine, &self.theme, self.dark) {
                println!("desktop rebuild failed: {e}");
            }
        }
        for d in self.docks.iter_mut() {
            if let Err(e) = d.rebuild(&self.engine, &self.theme, &self.dock_apps, self.dark, self.transparent) {
                println!("dock rebuild failed: {e}");
            }
        }
        for b in self.bars.iter_mut() {
            if let Err(e) = b.rebuild(&self.engine, &self.theme, self.dark, &name) {
                println!("top bar rebuild failed: {e}");
            }
        }
        let clock = clock_string();
        for b in self.bars.iter_mut() {
            b.set_clock(&clock);
        }
        self.rescan();
    }

    fn reload_theme(&mut self) {
        self.theme = theme::load_theme(&self.theme_dir);
        self.dock_apps = theme::load_dock(&self.theme_dir);
        self.restyle();
        println!("theme: reloaded");
    }

    fn rescan(&mut self) {
        let windows = apps::scan();
        for d in self.docks.iter_mut() {
            d.set_running(&windows, &self.theme);
        }
        let name = self.front_app_name();
        if name != self.front_name {
            self.front_name = name.clone();
            for b in self.bars.iter_mut() {
                b.set_app(&self.theme, &name);
            }
        }
    }

    fn tick_clock(&mut self) {
        let now = clock_string();
        for b in self.bars.iter_mut() {
            b.set_clock(&now);
        }
        if let Some(d) = self.desktop.as_mut() {
            let (time, date) = desktop::time_strings();
            d.set_clock(&time, &date);
        }
    }

    fn explorer_restarted(&mut self) {
        for d in &self.docks {
            d.re_register();
            d.place(&self.theme);
        }
        for b in &self.bars {
            b.re_register();
            b.place();
        }
        if let Some(d) = self.desktop.as_mut() {
            d.re_embed();
        }
        if self.args.replace {
            self.hide_tray();
        }
    }

    fn hide_tray(&mut self) {
        unsafe {
            if let Ok(t) = FindWindowW(w!("Shell_TrayWnd"), None) {
                let _ = ShowWindow(t, SW_HIDE);
                self.tray = Some(t);
            }
        }
    }

    fn shutdown(&mut self) {
        for d in &self.docks {
            d.unregister();
        }
        for b in &self.bars {
            b.unregister();
        }
        if let Some(t) = self.tray {
            unsafe {
                let _ = ShowWindow(t, SW_SHOWNA);
            }
        }
        unsafe {
            PostQuitMessage(0);
        }
    }
}

extern "system" fn dock_proc(hwnd: HWND, msg: u32, wp: WPARAM, lp: LPARAM) -> LRESULT {
    unsafe {
        let handled = with_app(|app| {
            let theme = app.theme.clone();
            let engine = app.engine.clone();
            let (dark, transparent) = (app.dark, app.transparent);
            let apps_list = app.dock_apps.clone();
            let Some(d) = app.docks.iter_mut().find(|d| d.hwnd == hwnd) else { return false };
            match msg {
                win::WM_APPBAR => {
                    match wp.0 as u32 {
                        1 => d.place(&theme),
                        2 => {
                            let z = if lp.0 != 0 { HWND_BOTTOM } else { HWND_TOPMOST };
                            let _ = SetWindowPos(hwnd, Some(z), 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
                        }
                        _ => {}
                    }
                    true
                }
                win::WM_DPICHANGED => {
                    let _ = d.rebuild(&engine, &theme, &apps_list, dark, transparent);
                    true
                }
                WM_MOUSEMOVE => {
                    let (x, y) = win::lparam_xy(lp);
                    d.mouse_move(&theme, x, y);
                    true
                }
                win::WM_MOUSELEAVE => {
                    d.mouse_leave(&theme);
                    true
                }
                WM_LBUTTONDOWN => {
                    let (x, y) = win::lparam_xy(lp);
                    d.button_down(&theme, x, y);
                    true
                }
                WM_LBUTTONUP => {
                    let (x, y) = win::lparam_xy(lp);
                    d.button_up(&theme, x, y);
                    true
                }
                WM_TIMER => {
                    if wp.0 == dock::TIMER_HIDE {
                        let _ = KillTimer(Some(hwnd), dock::TIMER_HIDE);
                        d.slide(&theme, false);
                    } else if wp.0 == dock::TIMER_SHRINK {
                        let _ = KillTimer(Some(hwnd), dock::TIMER_SHRINK);
                        d.shrink_if_hidden(&theme);
                    } else if wp.0 == dock::TIMER_REGION {
                        d.shrink_region();
                    } else if wp.0 == dock::TIMER_RAMP {
                        d.tick_ramp(&theme);
                    }
                    true
                }
                _ => false,
            }
        })
        .unwrap_or(false);
        if handled {
            return LRESULT(0);
        }
        match msg {
            WM_MOUSEACTIVATE => LRESULT(MA_NOACTIVATE as isize),
            _ => DefWindowProcW(hwnd, msg, wp, lp),
        }
    }
}

extern "system" fn bar_proc(hwnd: HWND, msg: u32, wp: WPARAM, lp: LPARAM) -> LRESULT {
    unsafe {
        let handled = with_app(|app| {
            let theme = app.theme.clone();
            let engine = app.engine.clone();
            let dark = app.dark;
            let name = app.front_name.clone();
            let Some(b) = app.bars.iter_mut().find(|b| b.hwnd == hwnd) else { return false };
            match msg {
                win::WM_APPBAR => {
                    if wp.0 as u32 == 1 {
                        b.place();
                    } else if wp.0 as u32 == 2 {
                        let z = if lp.0 != 0 { HWND_BOTTOM } else { HWND_TOPMOST };
                        let _ = SetWindowPos(hwnd, Some(z), 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
                    }
                    true
                }
                win::WM_DPICHANGED => {
                    let _ = b.rebuild(&engine, &theme, dark, &name);
                    true
                }
                WM_MOUSEMOVE => {
                    let (x, y) = win::lparam_xy(lp);
                    b.mouse_move(&theme, x, y);
                    true
                }
                win::WM_MOUSELEAVE => {
                    b.mouse_leave(&theme);
                    true
                }
                _ => false,
            }
        })
        .unwrap_or(false);
        if handled {
            return LRESULT(0);
        }
        match msg {
            WM_MOUSEACTIVATE => LRESULT(MA_NOACTIVATE as isize),
            _ => DefWindowProcW(hwnd, msg, wp, lp),
        }
    }
}

/// The desktop layer takes no input: clicks go to the real desktop below it.
extern "system" fn desktop_proc(hwnd: HWND, msg: u32, wp: WPARAM, lp: LPARAM) -> LRESULT {
    unsafe {
        match msg {
            WM_NCHITTEST => LRESULT(HTTRANSPARENT as isize),
            WM_MOUSEACTIVATE => LRESULT(MA_NOACTIVATE as isize),
            _ => DefWindowProcW(hwnd, msg, wp, lp),
        }
    }
}

extern "system" fn core_proc(hwnd: HWND, msg: u32, wp: WPARAM, lp: LPARAM) -> LRESULT {
    unsafe {
        let taskbar_created = with_app(|a| a.taskbar_created).unwrap_or(0);
        if msg != 0 && msg == taskbar_created {
            with_app(|a| a.explorer_restarted());
            return LRESULT(0);
        }
        match msg {
            WM_DISPLAYCHANGE => {
                with_app(|a| a.sync_windows());
                LRESULT(0)
            }
            WM_SETTINGCHANGE => {
                // Light/dark or transparency (ImmersiveColorSet), or the work area
                // moved. Debounce: these arrive in bursts.
                SetTimer(Some(hwnd), TIMER_SETTING, 250, None);
                LRESULT(0)
            }
            apps::WM_WINDOWS_CHANGED => {
                SetTimer(Some(hwnd), TIMER_RESCAN, 150, None);
                LRESULT(0)
            }
            WM_TIMER => {
                match wp.0 {
                    TIMER_QUIT => {
                        with_app(|a| a.shutdown());
                    }
                    TIMER_CLOCK => {
                        with_app(|a| a.tick_clock());
                    }
                    TIMER_RESCAN => {
                        let _ = KillTimer(Some(hwnd), TIMER_RESCAN);
                        with_app(|a| a.rescan());
                    }
                    TIMER_FILE => {
                        let _ = KillTimer(Some(hwnd), TIMER_FILE);
                        with_app(|a| a.reload_theme());
                    }
                    TIMER_SETTING => {
                        let _ = KillTimer(Some(hwnd), TIMER_SETTING);
                        with_app(|a| {
                            let (dark, tr) = (win::system_dark(), win::transparency_enabled());
                            if dark != a.dark || tr != a.transparent {
                                a.dark = dark;
                                a.transparent = tr;
                                a.restyle();
                                println!("theme: system {} / transparency {}", if dark { "dark" } else { "light" }, tr);
                            }
                        });
                    }
                    _ => {}
                }
                LRESULT(0)
            }
            WM_HOTKEY => {
                with_app(|a| a.shutdown());
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
        let _queue = CreateDispatcherQueueController(DispatcherQueueOptions {
            dwSize: std::mem::size_of::<DispatcherQueueOptions>() as u32,
            threadType: DQTYPE_THREAD_CURRENT,
            apartmentType: DQTAT_COM_STA,
        })?;

        win::register_class(dock::CLASS, Some(dock_proc));
        win::register_class(topbar::CLASS, Some(bar_proc));
        win::register_class(desktop::CLASS, Some(desktop_proc));
        win::register_class(w!("UdaanNextCore"), Some(core_proc));

        // Hidden top-level window (not message-only: those miss broadcasts such as
        // display changes, setting changes and TaskbarCreated).
        let hinst = windows::Win32::System::LibraryLoader::GetModuleHandleW(None)?;
        let core = CreateWindowExW(WS_EX_TOOLWINDOW, w!("UdaanNextCore"), w!("Udaan core"), WS_POPUP, 0, 0, 0, 0, None, None, Some(hinst.into()), None)?;

        let theme_dir = theme::dir();
        println!("theme: {}", theme_dir.display());
        let engine = Engine::new()?;
        let mut app = App {
            theme: theme::load_theme(&theme_dir),
            dock_apps: theme::load_dock(&theme_dir),
            theme_dir: theme_dir.clone(),
            dark: win::system_dark(),
            transparent: win::transparency_enabled(),
            engine,
            desktop: None,
            docks: Vec::new(),
            bars: Vec::new(),
            tray: None,
            taskbar_created: RegisterWindowMessageW(w!("TaskbarCreated")),
            front_name: String::new(),
            args,
        };
        println!(
            "theme: system {} / transparency {} / {} dock apps",
            if app.dark { "dark" } else { "light" },
            app.transparent,
            app.dock_apps.len()
        );

        if app.args.replace {
            app.hide_tray();
            if let Ok(exe) = std::env::current_exe() {
                let _ = std::process::Command::new(exe.with_file_name("watchdog.exe")).arg(std::process::id().to_string()).spawn();
            }
        }
        let secs = app.args.secs;
        APP.with(|a| *a.borrow_mut() = Some(app));
        with_app(|a| a.sync_windows());
        let _hooks = apps::install_hooks(core);

        let _ = RegisterHotKey(Some(core), HOTKEY_PANIC, MOD_CONTROL | MOD_ALT | MOD_SHIFT, 'Q' as u32);
        SetTimer(Some(core), TIMER_CLOCK, 10_000, None);
        if secs > 0 {
            SetTimer(Some(core), TIMER_QUIT, secs * 1000, None);
        }

        with_app(|a| {
            for d in &a.docks {
                let r = win::window_rect(d.hwnd);
                println!("dock: rect=({},{})-({},{}) autohide={}", r.left, r.top, r.right, r.bottom, d.autohide);
            }
            for b in &a.bars {
                let r = win::window_rect(b.hwnd);
                println!("topbar: rect=({},{})-({},{})", r.left, r.top, r.right, r.bottom);
            }
        });

        // Theme hot reload: a directory change handle woken by the message loop.
        let dir_w: Vec<u16> = {
            use std::os::windows::ffi::OsStrExt;
            theme_dir.as_os_str().encode_wide().chain(std::iter::once(0)).collect()
        };
        let watch: Option<HANDLE> =
            FindFirstChangeNotificationW(windows::core::PCWSTR(dir_w.as_ptr()), false, FILE_NOTIFY_CHANGE_LAST_WRITE | FILE_NOTIFY_CHANGE_SIZE).ok();

        let mut msg = MSG::default();
        let mut reported = false;
        let started = std::time::Instant::now();
        let handles: Vec<HANDLE> = watch.into_iter().collect();
        loop {
            // Block until either the theme folder changes or a message arrives.
            // No MWMO_INPUTAVAILABLE: with it, the wait returns immediately whenever
            // input is already in the queue, and the loop spins at several percent of
            // a core instead of sleeping. Measured: 4.5% -> ~0.
            let r = MsgWaitForMultipleObjectsEx(Some(&handles), INFINITE, QS_ALLINPUT, MSG_WAIT_FOR_MULTIPLE_OBJECTS_EX_FLAGS(0));
            if !handles.is_empty() && r.0 == 0 {
                let _ = FindNextChangeNotification(handles[0]);
                SetTimer(Some(core), TIMER_FILE, 200, None); // editors write in bursts
            }
            while PeekMessageW(&mut msg, None, 0, 0, PM_REMOVE).as_bool() {
                if msg.message == WM_QUIT {
                    if let Some(h) = watch {
                        let _ = FindCloseChangeNotification(h);
                    }
                    APP.with(|a| *a.borrow_mut() = None);
                    return Ok(());
                }
                let _ = TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
            if !reported && started.elapsed().as_secs() >= 3 {
                reported = true;
                let (ws, pv) = win::memory_mb();
                println!("memory: working set {ws:.1} MB, private {pv:.1} MB");
            }
        }
    }
}
