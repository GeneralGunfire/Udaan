//! Udaan's OS shell core.
//!
//! - A live registry of top-level windows, driven by `SetWinEventHook`
//!   instead of polling, pushed to every webview as `shell://snapshot`.
//! - Udaan's own apps are real OS windows (label `app-<id>`), so they
//!   interleave with native programs, snap natively, and show up in the same
//!   registry tagged with their `appId`.
//! - The desktop window is kept at the bottom of the z-order (just above
//!   Explorer's Progman/WorkerW if Explorer is still running).
//! - A low-level keyboard hook gives Udaan the Win key and Win+<key> combos.

use serde::Serialize;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Mutex, OnceLock};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

mod icons;
pub mod fs;
pub mod clipboard;
pub mod verbs;
pub mod apps;
pub mod session;
pub mod corners;
pub mod media;
pub mod live_audio;
pub mod edge_light;
pub mod procs;
pub mod network;
pub mod gesture;
pub mod material;

const APP_LABEL_PREFIX: &str = "app-";

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ShellWindow {
  pub handle: isize,
  pub title: String,
  pub process_name: String,
  pub exe_path: Option<String>,
  pub is_minimized: bool,
  pub is_maximized: bool,
  pub app_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct ShellSnapshot {
  pub windows: Vec<ShellWindow>,
  pub foreground: isize,
  /// True while the foreground window covers its whole monitor (a game,
  /// a video, F11 browser) — the dock hides itself, like Explorer does.
  pub fullscreen: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HotkeyEvent {
  pub id: String,
}

enum Msg {
  Changed { slow: bool },
  Hotkey(&'static str),
}

static SENDER: OnceLock<Mutex<mpsc::Sender<Msg>>> = OnceLock::new();
static LAST: OnceLock<Mutex<ShellSnapshot>> = OnceLock::new();
static SHELL_CHROME_HIDDEN: AtomicBool = AtomicBool::new(false);
static PENDING_ARGS: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();
static DESKTOP_STASH: OnceLock<Mutex<Vec<isize>>> = OnceLock::new();

fn send(msg: Msg) {
  if let Some(tx) = SENDER.get() {
    let _ = tx.lock().unwrap().send(msg);
  }
}

pub(crate) fn send_hotkey(id: &'static str) {
  send(Msg::Hotkey(id));
}

pub(crate) fn last_is_fullscreen() -> bool {
  last().lock().map(|s| s.fullscreen).unwrap_or(false)
}

fn last() -> &'static Mutex<ShellSnapshot> {
  LAST.get_or_init(|| Mutex::new(ShellSnapshot::default()))
}

fn build_snapshot(app: &AppHandle) -> ShellSnapshot {
  let own_pid = std::process::id();
  let own_labels: HashMap<isize, String> = app
    .webview_windows()
    .into_iter()
    .filter_map(|(label, w)| hwnd_of(&w).ok().map(|h| (h, label)))
    .collect();

  let windows = crate::taskbar::win::list_windows()
    .into_iter()
    .filter_map(|w| {
      let app_id = if w.pid == own_pid {
        // Only Udaan's app windows are "apps"; the desktop, dock and popup
        // are shell chrome and never appear in their own dock.
        let label = own_labels.get(&w.handle)?;
        Some(label.strip_prefix(APP_LABEL_PREFIX)?.to_string())
      } else {
        None
      };
      Some(ShellWindow {
        handle: w.handle,
        title: w.title,
        process_name: w.process_name,
        exe_path: w.exe_path,
        is_minimized: w.is_minimized,
        is_maximized: w.is_maximized,
        app_id,
      })
    })
    .collect();

  let foreground = win::foreground();
  let fullscreen = foreground != 0
    && !own_labels.contains_key(&foreground)
    && win::covers_monitor(foreground);
  ShellSnapshot { windows, foreground, fullscreen }
}

fn hwnd_of(w: &tauri::WebviewWindow) -> Result<isize, String> {
  #[cfg(target_os = "windows")]
  {
    w.hwnd().map(|h| h.0 as isize).map_err(|e| e.to_string())
  }
  #[cfg(not(target_os = "windows"))]
  {
    let _ = w;
    Err("unsupported".into())
  }
}

/// Starts the event hook thread and the coalescing worker. Called once
/// from `lib.rs` setup.
pub fn start(app: AppHandle) {
  let (tx, rx) = mpsc::channel::<Msg>();
  if SENDER.set(Mutex::new(tx)).is_err() {
    return;
  }
  win::start_hook_thread();

  // Supervised: this worker feeds the dock and every window list. A panic here used to
  // kill window tracking for the rest of the session; now it is recorded and restarted
  // (the receiver lives in the closure, so queued messages survive the restart).
  crate::engine::supervisor::spawn("shell-worker", crate::engine::supervisor::Restart::OnPanic, move || {
    worker(&app, &rx)
  })
  .expect("spawn shell worker");
}

fn worker(app: &AppHandle, rx: &mpsc::Receiver<Msg>) {
  const RECONCILE: Duration = Duration::from_secs(3);
  publish(app);
  loop {
    let mut slow_only = true;
    // Sleep until a real window event. The 3 s wake-up exists only to keep Explorer's
    // taskbar hidden after it restarts, so it is needed only while we hide it.
    let first = if SHELL_CHROME_HIDDEN.load(Ordering::Relaxed) {
      rx.recv_timeout(RECONCILE)
    } else {
      rx.recv().map_err(|_| mpsc::RecvTimeoutError::Disconnected)
    };
    match first {
      Ok(Msg::Hotkey(id)) => {
        let _ = app.emit("shell://hotkey", HotkeyEvent { id: id.to_string() });
        continue;
      }
      Ok(Msg::Changed { slow }) => slow_only &= slow,
      Err(mpsc::RecvTimeoutError::Timeout) => {
        if SHELL_CHROME_HIDDEN.load(Ordering::Relaxed) {
          // Explorer re-shows its taskbar after it restarts or after
          // display changes; keep it hidden while Udaan owns the shell.
          win::set_explorer_chrome_visible(false);
        }
      }
      Err(mpsc::RecvTimeoutError::Disconnected) => return,
    }
    // Own window shown/hidden events arrive here too, but they never change the snapshot
    // (shell chrome is excluded from it), so settle the desktop's visibility every pass.
    // Coalesce bursts: a window opening fires CREATE, SHOW, NAMECHANGE and
    // FOREGROUND within a few ms. Moves/resizes only need to settle.
    let window = if slow_only { Duration::from_millis(250) } else { Duration::from_millis(16) };
    let deadline = std::time::Instant::now() + window;
    while let Some(left) = deadline.checked_duration_since(std::time::Instant::now()) {
      match rx.recv_timeout(left) {
        Ok(Msg::Hotkey(id)) => {
          let _ = app.emit("shell://hotkey", HotkeyEvent { id: id.to_string() });
        }
        Ok(Msg::Changed { .. }) => {}
        Err(_) => break,
      }
    }
    publish(app);
  }
}

fn publish(app: &AppHandle) {
  let snap = build_snapshot(app);
  // The engine decides from the real window state which webviews may render.
  crate::engine::governor::reconcile(app, &snap);
  crate::engine::edges::reassert(snap.fullscreen);
  let windows_changed = {
    let mut prev = last().lock().unwrap();
    if *prev == snap {
      return;
    }
    let changed = prev.windows != snap.windows;
    *prev = snap.clone();
    changed
  };
  // Only the shell surfaces that show windows get the list; a focus change
  // alone is a tiny event. Sending the full list to every app window on
  // every focus change was measurable lag while switching.
  let to_shell = |t: &tauri::EventTarget| matches!(t, tauri::EventTarget::WebviewWindow { label } if SHELL_LISTENERS.contains(&label.as_str()));
  if windows_changed {
    win::set_known(snap.windows.iter().map(|w| w.handle).collect());
    let _ = app.emit_filter("shell://snapshot", &snap, to_shell);
  } else {
    let _ = app.emit_filter("shell://foreground", Foreground { foreground: snap.foreground, fullscreen: snap.fullscreen }, to_shell);
  }
}

const SHELL_LISTENERS: &[&str] = &["main", "taskbar", "launcher", "menubar"];

/// Browser flags for EVERY webview. WebView2 refuses windows that share a profile but
/// differ in flags, so tauri.conf.json carries this exact same string for the static
/// windows. `--renderer-process-limit` makes extra windows reuse an existing renderer
/// instead of each spawning its own (60-100 MB apiece).
pub const WEBVIEW_ARGS: &str = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --renderer-process-limit=2";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Foreground {
  foreground: isize,
  fullscreen: bool,
}

// ---------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------

/// Real shell icons for many paths at once (desktop icons, dock pins).
#[tauri::command]
pub async fn shell_file_icons(paths: Vec<String>) -> HashMap<String, Option<String>> {
  tauri::async_runtime::spawn_blocking(move || {
    paths.into_iter().map(|p| { let icon = icons::file_icon(&p); (p, icon) }).collect()
  })
  .await
  .unwrap_or_default()
}

#[tauri::command]
pub async fn shell_app_names(paths: Vec<String>) -> HashMap<String, String> {
  tauri::async_runtime::spawn_blocking(move || {
    paths.into_iter().map(|p| { let n = icons::app_display_name(&p); (p, n) }).collect()
  })
  .await
  .unwrap_or_default()
}

/// Resolves launch targets for many executable names at once (dock pins).
#[tauri::command]
pub async fn shell_resolve_launch(exes: Vec<String>) -> HashMap<String, Option<String>> {
  tauri::async_runtime::spawn_blocking(move || {
    exes.into_iter().map(|e| { let t = crate::installed_apps::resolve_launch_target(&e); (e, t) }).collect()
  })
  .await
  .unwrap_or_default()
}

/// Each window's restored ("normal") size in physical px, valid even while
/// minimized, so previews keep the right aspect ratio.
#[tauri::command]
pub fn shell_window_sizes(handles: Vec<isize>) -> HashMap<isize, (i32, i32)> {
  handles.into_iter().filter_map(|h| win::normal_size(h).map(|s| (h, s))).collect()
}

/// A window's own icon (WM_GETICON), for programs with no readable exe icon.
#[tauri::command]
pub async fn shell_window_icons(handles: Vec<isize>) -> HashMap<isize, Option<String>> {
  tauri::async_runtime::spawn_blocking(move || handles.into_iter().map(|h| (h, win::window_icon(h))).collect())
    .await
    .unwrap_or_default()
}

#[derive(Debug, Clone, Copy, serde::Deserialize)]
pub struct Zone {
  pub x: f64,
  pub y: f64,
  pub w: f64,
  pub h: f64,
}

/// Moves a window into a fraction of its monitor's work area (Snap
/// Layouts), restoring it first if maximized. Compensates for the
/// invisible resize border Windows adds, so snapped windows meet edge to
/// edge with no gaps.
#[tauri::command]
pub fn shell_snap_window(handle: isize, zone: Zone) -> Result<(), String> {
  win::snap(handle, zone)
}

/// Snaps the calling window (Udaan app windows don't know their HWND).
#[tauri::command]
pub fn shell_snap_self(window: tauri::WebviewWindow, zone: Zone) -> Result<(), String> {
  win::snap(hwnd_of(&window)?, zone)
}

#[tauri::command]
pub fn shell_invalidate_icon(path: String) {
  icons::invalidate(&path);
}

#[tauri::command]
pub fn shell_snapshot(app: AppHandle) -> ShellSnapshot {
  let snap = build_snapshot(&app);
  *last().lock().unwrap() = snap.clone();
  snap
}

#[tauri::command]
pub fn shell_focus_window(handle: isize) -> Result<(), String> {
  win::force_foreground(handle)
}

#[tauri::command]
pub fn shell_minimize_window(handle: isize) -> Result<(), String> {
  win::show(handle, win::Show::Minimize);
  Ok(())
}

/// Virtual desktops: shows or hides a batch of real windows by handle in
/// one call. Hidden windows drop out of Alt-Tab and the taskbar entirely
/// (not minimized — a window parked on another desktop shouldn't look
/// "minimized" when you switch back to it). `focus_after` is the window
/// to bring to the foreground once the shown set is visible, so switching
/// to a desktop restores whichever window was focused there last.
#[tauri::command]
pub fn shell_set_windows_hidden(hide: Vec<isize>, show: Vec<isize>, focus_after: Option<isize>) -> Result<(), String> {
  for h in hide {
    win::show(h, win::Show::Hide);
  }
  for h in &show {
    win::show(*h, win::Show::Unhide);
  }
  if let Some(h) = focus_after {
    let _ = win::force_foreground(h);
  }
  Ok(())
}

#[tauri::command]
pub fn shell_toggle_maximize_window(handle: isize) -> Result<(), String> {
  win::toggle_maximize(handle);
  Ok(())
}

#[tauri::command]
pub fn shell_close_window(handle: isize) -> Result<(), String> {
  crate::taskbar::win::close_window(handle)
}

/// Win+D semantics: first call minimizes every app window and remembers
/// them; the next call (if nothing was restored by hand in between)
/// brings exactly those back.
#[tauri::command]
pub fn shell_toggle_desktop(app: AppHandle) -> Result<bool, String> {
  let stash = DESKTOP_STASH.get_or_init(|| Mutex::new(Vec::new()));
  let snap = build_snapshot(&app);
  let mut stash = stash.lock().unwrap();
  let any_visible = snap.windows.iter().any(|w| !w.is_minimized);
  if any_visible {
    stash.clear();
    for w in snap.windows.iter().filter(|w| !w.is_minimized) {
      stash.push(w.handle);
      win::show(w.handle, win::Show::Minimize);
    }
    Ok(true)
  } else {
    for h in stash.drain(..).rev() {
      win::show(h, win::Show::Restore);
    }
    Ok(false)
  }
}

/// Hides (or restores) Explorer's taskbar(s) and desktop icon layer.
/// Always restored on exit — see `restore_on_exit`.
#[tauri::command]
pub fn shell_set_explorer_chrome_hidden(hidden: bool) {
  SHELL_CHROME_HIDDEN.store(hidden, Ordering::Relaxed);
  win::set_explorer_chrome_visible(!hidden);
  // Whatever happens to us from here on, Explorer's taskbar comes back.
  if hidden {
    crate::engine::guard::register("explorer-chrome", || win::set_explorer_chrome_visible(true));
    // The undo above can't run if we are killed outright; this separate process can.
    crate::engine::watchdog::ensure_started();
  } else {
    crate::engine::guard::cancel("explorer-chrome");
  }
}

/// The desktop layer saw a display, DPI or work-area change: tell every shell window so
/// each re-places itself.
pub(crate) fn notify_display_changed() {
  send_hotkey("display-changed");
}

/// Explorer restarted (its taskbar was re-created). If we are hiding Explorer's chrome,
/// hide the new one too.
pub(crate) fn on_explorer_restarted() {
  if SHELL_CHROME_HIDDEN.load(Ordering::Relaxed) {
    win::set_explorer_chrome_visible(false);
  }
}

pub fn restore_on_exit() {
  if SHELL_CHROME_HIDDEN.swap(false, Ordering::Relaxed) {
    win::set_explorer_chrome_visible(true);
  }
  win::set_keyboard_hook(false);
}

#[tauri::command]
pub fn shell_set_keyboard_hook(enabled: bool) {
  win::set_keyboard_hook(enabled);
  if enabled {
    crate::engine::guard::register("keyboard-hook", || win::set_keyboard_hook(false));
  } else {
    crate::engine::guard::cancel("keyboard-hook");
  }
}

#[derive(Debug, Clone, Copy, Serialize)]
pub struct Rect {
  pub left: i32,
  pub top: i32,
  pub right: i32,
  pub bottom: i32,
}

/// Asks the compositor to blur the desktop behind the CALLING window.
///
/// This is what makes shell surfaces real glass rather than a tinted
/// rectangle: a webview can only blur its own pixels, so the one surface it
/// can never blur is the desktop it floats over. See `shell::material`.
///
/// Returns what the system actually gave us, because the webview must paint
/// a different tint depending on whether a real blur landed — two full tints
/// stacked turn any surface to mud.
#[tauri::command]
pub fn shell_set_material(
  window: tauri::WebviewWindow,
  material: material::Material,
  tint: u32,
  dark: bool,
  rounded: bool,
) -> Result<material::Applied, String> {
  let hwnd = hwnd_of(&window)?;
  let applied = material::apply(hwnd, material, tint, dark);
  material::set_corners(hwnd, rounded);
  Ok(applied)
}

/// Sets the CALLING window's outer rectangle (physical px) in one step.
#[tauri::command]
pub fn shell_set_window_rect(window: tauri::WebviewWindow, x: i32, y: i32, w: i32, h: i32) -> Result<(), String> {
  let hwnd = hwnd_of(&window)?;
  win::set_rect(hwnd, x, y, w, h);
  Ok(())
}

/// The monitor rect (physical px) and work area of the monitor the
/// calling window is on.
#[tauri::command]
pub fn shell_monitor_of(window: tauri::WebviewWindow) -> Result<(Rect, Rect), String> {
  let hwnd = hwnd_of(&window)?;
  win::monitor_rects(hwnd)
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenAppRequest {
  pub app_id: String,
  pub title: String,
  pub width: f64,
  pub height: f64,
  pub min_width: f64,
  pub min_height: f64,
  pub x: Option<f64>,
  pub y: Option<f64>,
  pub maximized: bool,
  /// Opaque launch arguments (JSON) handed to the app on mount, or
  /// delivered live as `shell://app-args` if the app is already open.
  pub args: Option<String>,
}

/// Opens (or focuses) one of Udaan's own apps as a real OS window. Async
/// because creating a webview window from a synchronous command
/// deadlocks on Windows.
#[tauri::command]
pub async fn shell_open_app(app: AppHandle, req: OpenAppRequest) -> Result<(), String> {
  if req.app_id.is_empty()
    || !req.app_id.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
  {
    return Err(format!("invalid app id {:?}", req.app_id));
  }
  let label = format!("{APP_LABEL_PREFIX}{}", req.app_id);

  if let Some(existing) = app.get_webview_window(&label) {
    if let Some(args) = req.args {
      let _ = existing.emit_to(&label, "shell://app-args", args);
    }
    let h = hwnd_of(&existing)?;
    if !existing.is_visible().unwrap_or(true) {
      // A kept-warm or previously closed window comes back at the size and
      // place requested now, not whatever it was created with.
      let _ = existing.set_size(tauri::LogicalSize::new(req.width, req.height));
      match (req.x, req.y) {
        (Some(x), Some(y)) => {
          let _ = existing.set_position(tauri::LogicalPosition::new(x, y));
        }
        _ => {
          let _ = existing.center();
        }
      }
    }
    let _ = existing.show();
    return win::force_foreground(h);
  }

  if let Some(args) = req.args {
    PENDING_ARGS.get_or_init(|| Mutex::new(HashMap::new())).lock().unwrap().insert(label.clone(), args);
  }

  let url = tauri::WebviewUrl::App(format!("index.html?window=app&app={}", req.app_id).into());
  let mut builder = tauri::WebviewWindowBuilder::new(&app, &label, url)
    .title(&req.title)
    .inner_size(req.width, req.height)
    .min_inner_size(req.min_width, req.min_height)
    .decorations(false)
    .additional_browser_args(WEBVIEW_ARGS)
    .shadow(true)
    .visible(false)
    .skip_taskbar(true)
    .background_color(tauri::window::Color(11, 15, 22, 255));
  builder = match (req.x, req.y) {
    (Some(x), Some(y)) => builder.position(x, y),
    _ => builder.center(),
  };
  let window = builder.build().map_err(|e| format!("could not open {}: {e}", req.app_id))?;
  crate::engine::governor::attach(&window);
  crate::webview_permissions::allow_media_capture(&window);
  if let Ok(h) = hwnd_of(&window) {
    win::round_corners(h);
  }
  if req.maximized {
    let _ = window.maximize();
  }
  Ok(())
}

/// Pre-warms a list of app windows by creating them hidden so the first
/// user-triggered open is instant (WebView2 is already running).
#[tauri::command]
pub async fn shell_prewarm_apps(app: AppHandle, app_ids: Vec<String>) -> Result<(), String> {
  // A pre-warmed window keeps a whole webview resident (about 85 MB each). On a PC without
  // headroom that costs more in paging than it saves in open time, so skip it.
  let cost = 90 * app_ids.len() as u64;
  if !crate::engine::resources::can_spare(cost) {
    crate::engine::trace::line(&format!(
      "prewarm skipped: {} MB available, wanted {} MB plus reserve",
      crate::engine::resources::available_mb(),
      cost
    ));
    return Ok(());
  }
  for app_id in app_ids {
    if app_id.is_empty()
      || !app_id.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
    {
      continue;
    }
    let label = format!("{APP_LABEL_PREFIX}{}", app_id);
    if app.get_webview_window(&label).is_some() {
      continue; // already warm
    }
    // `warm` keeps the window hidden until it is actually opened.
    let url = tauri::WebviewUrl::App(format!("index.html?window=app&app={}&warm=1", app_id).into());
    if let Ok(window) = tauri::WebviewWindowBuilder::new(&app, &label, url)
      .title(&app_id)
      .inner_size(1024.0, 700.0)
      .decorations(false)
      .additional_browser_args(WEBVIEW_ARGS)
      .shadow(true)
      .visible(false)
      .skip_taskbar(true)
      .background_color(tauri::window::Color(11, 15, 22, 255))
      .center()
      .build()
    {
      crate::engine::governor::attach_prewarmed(&window);
      crate::webview_permissions::allow_media_capture(&window);
      if let Ok(h) = hwnd_of(&window) {
        win::round_corners(h);
      }
    }
  }
  Ok(())
}

/// Called once by an app window after it mounts; returns (and clears)
/// the launch arguments it was opened with.
#[tauri::command]
pub fn shell_take_app_args(window: tauri::WebviewWindow) -> Option<String> {
  PENDING_ARGS.get().and_then(|m| m.lock().unwrap().remove(window.label()))
}

/// Pins the desktop window to the bottom of the z-order and spans it over
/// its whole monitor. Called once from setup.
pub fn install_desktop(window: &tauri::WebviewWindow) -> Result<(), String> {
  let hwnd = hwnd_of(window)?;
  crate::engine::desktop::install(window)?;
  if session::claim_shell(hwnd) {
    log::info!("[shell] Udaan is the session shell; starting startup programs");
    std::thread::spawn(session::run_startup_programs);
  }
  Ok(())
}

// ---------------------------------------------------------------------
// Windows implementation
// ---------------------------------------------------------------------

#[cfg(target_os = "windows")]
mod win {
  use super::{send, Msg, Rect};
  use std::collections::HashSet;
  use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
  use std::sync::{Mutex, OnceLock};
  use windows_sys::Win32::Foundation::{HWND, LPARAM, LRESULT, RECT, WPARAM};
  use windows_sys::Win32::Graphics::Gdi::{
    GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST,
  };
  use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
  use windows_sys::Win32::System::Threading::{AttachThreadInput, GetCurrentThreadId};
  use windows_sys::Win32::UI::Accessibility::{SetWinEventHook, HWINEVENTHOOK};
  use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
    GetAsyncKeyState, SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, VK_LBUTTON,
    VK_LSHIFT, VK_LWIN, VK_MBUTTON, VK_MENU, VK_RBUTTON, VK_RSHIFT, VK_RWIN,
  };
  use windows_sys::Win32::UI::Shell::{
    DefSubclassProc, SHAppBarMessage, SetWindowSubclass, ABE_BOTTOM, ABE_TOP, ABM_NEW, ABM_QUERYPOS,
    ABM_REMOVE, ABM_SETPOS, APPBARDATA,
  };
  use windows_sys::Win32::UI::WindowsAndMessaging::*;

  static KNOWN: OnceLock<Mutex<HashSet<isize>>> = OnceLock::new();
  static HOOK_THREAD: AtomicU32 = AtomicU32::new(0);
  const WM_HOOK_ON: u32 = WM_APP + 1;
  const WM_HOOK_OFF: u32 = WM_APP + 2;

  pub fn set_known(handles: HashSet<isize>) {
    *KNOWN.get_or_init(|| Mutex::new(HashSet::new())).lock().unwrap() = handles;
  }

  fn is_known(h: isize) -> bool {
    KNOWN.get().map(|k| k.lock().unwrap().contains(&h)).unwrap_or(false)
  }

  pub fn foreground() -> isize {
    unsafe { GetForegroundWindow() as isize }
  }

  pub fn monitor_rects(hwnd: isize) -> Result<(Rect, Rect), String> {
    unsafe {
      let mon = MonitorFromWindow(hwnd as HWND, MONITOR_DEFAULTTONEAREST);
      let mut mi: MONITORINFO = std::mem::zeroed();
      mi.cbSize = std::mem::size_of::<MONITORINFO>() as u32;
      if GetMonitorInfoW(mon, &mut mi) == 0 {
        return Err("GetMonitorInfoW failed".into());
      }
      Ok((to_rect(mi.rcMonitor), to_rect(mi.rcWork)))
    }
  }

  fn to_rect(r: RECT) -> Rect {
    Rect { left: r.left, top: r.top, right: r.right, bottom: r.bottom }
  }

  pub fn covers_monitor(h: isize) -> bool {
    unsafe {
      let hwnd = h as HWND;
      if IsIconic(hwnd) != 0 || class_is(hwnd, &["Progman", "WorkerW"]) {
        return false;
      }
      let mut r: RECT = std::mem::zeroed();
      if GetWindowRect(hwnd, &mut r) == 0 {
        return false;
      }
      match monitor_rects(h) {
        Ok((m, _)) => r.left <= m.left && r.top <= m.top && r.right >= m.right && r.bottom >= m.bottom,
        Err(_) => false,
      }
    }
  }

  unsafe fn class_is(hwnd: HWND, names: &[&str]) -> bool {
    let mut buf = [0u16; 64];
    let n = GetClassNameW(hwnd, buf.as_mut_ptr(), buf.len() as i32);
    if n <= 0 {
      return false;
    }
    let class = String::from_utf16_lossy(&buf[..n as usize]);
    names.iter().any(|c| *c == class)
  }

  pub enum Show {
    Minimize,
    Restore,
    /// Fully hidden: not in Alt-Tab, not in the taskbar. Used for virtual
    /// desktops — a window on another desktop is hidden, not minimized, so
    /// restoring it later doesn't look like "unminimizing" to the user.
    Hide,
    /// Un-hides a window hidden via `Hide`, without activating it (so
    /// switching to a desktop doesn't steal focus from whichever window on
    /// it the user last had focused — that part is handled separately by
    /// explicitly focusing the right one after the whole set is shown).
    Unhide,
  }

  pub fn show(h: isize, how: Show) {
    unsafe {
      ShowWindow(h as HWND, match how {
        Show::Minimize => SW_MINIMIZE,
        Show::Restore => SW_RESTORE,
        Show::Hide => SW_HIDE,
        Show::Unhide => SW_SHOWNOACTIVATE,
      });
    }
  }

  /// Rounds an undecorated window's corners via DWM. Windows 11 auto-rounds
  /// decorated windows, but `decorations(false)` opts out of that, so a
  /// window with a native shadow shows the shadow starting at a sharp
  /// square corner — a visible dark hairline against light wallpaper.
  pub fn round_corners(_h: isize) {
    // Temporarily disabled: a build with this active crashed on launch
    // with STATUS_ILLEGAL_INSTRUCTION (0xc000001d). Not yet root-caused —
    // disabling to isolate whether this DWM call is the actual fault site
    // before re-enabling. See Cargo.toml's profile.release comment for
    // the related LTO revert from the same investigation.
  }

  pub fn snap(h: isize, z: super::Zone) -> Result<(), String> {
    use windows_sys::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_EXTENDED_FRAME_BOUNDS};
    unsafe {
      let hwnd = h as HWND;
      if IsZoomed(hwnd) != 0 || IsIconic(hwnd) != 0 {
        ShowWindow(hwnd, SW_RESTORE);
      }
      let (_, work) = monitor_rects(h)?;
      let ww = (work.right - work.left) as f64;
      let wh = (work.bottom - work.top) as f64;
      let target = RECT {
        left: work.left + (z.x * ww).round() as i32,
        top: work.top + (z.y * wh).round() as i32,
        right: work.left + ((z.x + z.w) * ww).round() as i32,
        bottom: work.top + ((z.y + z.h) * wh).round() as i32,
      };
      // Invisible border = window rect minus the visible frame bounds.
      let mut outer: RECT = std::mem::zeroed();
      let mut frame: RECT = std::mem::zeroed();
      GetWindowRect(hwnd, &mut outer);
      let ok = DwmGetWindowAttribute(hwnd, DWMWA_EXTENDED_FRAME_BOUNDS as _, &mut frame as *mut RECT as *mut _, std::mem::size_of::<RECT>() as u32) >= 0;
      let (l, t, r, b) = if ok {
        (frame.left - outer.left, frame.top - outer.top, outer.right - frame.right, outer.bottom - frame.bottom)
      } else {
        (0, 0, 0, 0)
      };
      if SetWindowPos(
        hwnd,
        std::ptr::null_mut(),
        target.left - l,
        target.top - t,
        target.right - target.left + l + r,
        target.bottom - target.top + t + b,
        SWP_NOZORDER | SWP_NOACTIVATE,
      ) == 0
      {
        return Err("Couldn't move that window.".into());
      }
    }
    Ok(())
  }

  pub fn window_icon(h: isize) -> Option<String> {
    crate::taskbar::win::cached_icon(h as HWND)
  }

  pub fn normal_size(h: isize) -> Option<(i32, i32)> {
    unsafe {
      let hwnd = h as HWND;
      if IsZoomed(hwnd) != 0 {
        let mut r: RECT = std::mem::zeroed();
        if GetWindowRect(hwnd, &mut r) != 0 {
          return Some((r.right - r.left, r.bottom - r.top));
        }
      }
      let mut wp: WINDOWPLACEMENT = std::mem::zeroed();
      wp.length = std::mem::size_of::<WINDOWPLACEMENT>() as u32;
      if GetWindowPlacement(hwnd, &mut wp) == 0 {
        return None;
      }
      let r = wp.rcNormalPosition;
      Some((r.right - r.left, r.bottom - r.top))
    }
  }

  pub fn toggle_maximize(h: isize) {
    unsafe {
      let hwnd = h as HWND;
      ShowWindow(hwnd, if IsZoomed(hwnd) != 0 { SW_RESTORE } else { SW_MAXIMIZE });
    }
  }

  fn tap_key(vk: u16) {
    let mk = |flags| INPUT {
      r#type: INPUT_KEYBOARD,
      Anonymous: INPUT_0 {
        ki: KEYBDINPUT { wVk: vk, wScan: 0, dwFlags: flags, time: 0, dwExtraInfo: 0 },
      },
    };
    let inputs = [mk(0), mk(KEYEVENTF_KEYUP)];
    unsafe {
      SendInput(inputs.len() as u32, inputs.as_ptr(), std::mem::size_of::<INPUT>() as i32);
    }
  }

  /// Windows only lets the foreground process hand focus away. From a
  /// background process `SetForegroundWindow` just flashes the taskbar
  /// button. Escalate: plain call → attach to the foreground thread's
  /// input queue → a synthetic Alt tap (which counts as "user input" and
  /// lifts the foreground lock).
  pub fn force_foreground(h: isize) -> Result<(), String> {
    unsafe {
      let hwnd = h as HWND;
      if IsWindow(hwnd) == 0 {
        return Err("That window has closed.".into());
      }
      if IsIconic(hwnd) != 0 {
        ShowWindow(hwnd, SW_RESTORE);
      }
      if SetForegroundWindow(hwnd) != 0 && GetForegroundWindow() == hwnd {
        return Ok(());
      }
      let fg = GetForegroundWindow();
      let fg_thread = GetWindowThreadProcessId(fg, std::ptr::null_mut());
      let me = GetCurrentThreadId();
      if fg_thread != 0 && fg_thread != me {
        AttachThreadInput(me, fg_thread, 1);
        BringWindowToTop(hwnd);
        SetForegroundWindow(hwnd);
        AttachThreadInput(me, fg_thread, 0);
      }
      if GetForegroundWindow() != hwnd {
        tap_key(VK_MENU);
        SetForegroundWindow(hwnd);
      }
      if GetForegroundWindow() == hwnd {
        Ok(())
      } else {
        Err("Windows refused to bring that window forward.".into())
      }
    }
  }

  fn find_all(class: &str) -> Vec<HWND> {
    let wide: Vec<u16> = class.encode_utf16().chain(std::iter::once(0)).collect();
    let mut out = Vec::new();
    unsafe {
      let mut h = FindWindowExW(std::ptr::null_mut(), std::ptr::null_mut(), wide.as_ptr(), std::ptr::null());
      while !h.is_null() {
        out.push(h);
        h = FindWindowExW(std::ptr::null_mut(), h, wide.as_ptr(), std::ptr::null());
      }
    }
    out
  }

  pub fn set_explorer_chrome_visible(visible: bool) {
    let cmd = if visible { SW_SHOW } else { SW_HIDE };
    for class in ["Shell_TrayWnd", "Shell_SecondaryTrayWnd"] {
      for h in find_all(class) {
        unsafe {
          let is_visible = IsWindowVisible(h) != 0;
          if is_visible != visible {
            ShowWindow(h, cmd);
          }
        }
      }
    }
  }

  /// Moves the window to the rect only if it isn't already there, so a
  /// periodic check never causes a visible nudge or repaint.
  /// Moves and resizes in a single call, so the window never shows an in-between frame.
  pub fn set_rect(h: isize, x: i32, y: i32, w: i32, hgt: i32) {
    unsafe {
      SetWindowPos(h as HWND, std::ptr::null_mut(), x, y, w, hgt, SWP_NOZORDER | SWP_NOACTIVATE);
    }
  }
  // --- Event hook + keyboard hook thread -------------------------------

  unsafe extern "system" fn on_win_event(
    _hook: HWINEVENTHOOK,
    event: u32,
    hwnd: HWND,
    id_object: i32,
    id_child: i32,
    _thread: u32,
    _time: u32,
  ) {
    if event != EVENT_SYSTEM_FOREGROUND && (id_object != OBJID_WINDOW || id_child != CHILDID_SELF as i32) {
      return;
    }
    let h = hwnd as isize;
    let relevant = match event {
      EVENT_OBJECT_DESTROY | EVENT_OBJECT_HIDE | EVENT_OBJECT_CLOAKED => is_known(h),
      EVENT_SYSTEM_FOREGROUND => true,
      _ => !hwnd.is_null() && (is_known(h) || GetAncestor(hwnd, GA_ROOT) == hwnd),
    };
    if !relevant {
      return;
    }
    let slow = event == EVENT_OBJECT_LOCATIONCHANGE;
    if slow && !is_known(h) {
      return;
    }
    send(Msg::Changed { slow });
  }

  static HOOK_ENABLED: AtomicBool = AtomicBool::new(false);
  static KB_HOOK: Mutex<usize> = Mutex::new(0);
  static WIN_DOWN: AtomicBool = AtomicBool::new(false);
  static WIN_COMBO: AtomicBool = AtomicBool::new(false);
  static SHIFT_DOWN: AtomicBool = AtomicBool::new(false);
  static CTRL_DOWN: AtomicBool = AtomicBool::new(false);
  // Double-tap Ctrl opens the 3D switcher. Strict on purpose, so ordinary
  // Ctrl shortcuts and Ctrl+click never trigger it: each tap must be a short,
  // lone press (no other key, no mouse button, no Shift/Alt/Win), and the two
  // taps must follow each other closely with nothing in between.
  /// Tick time of the current Ctrl press.
  static DT_PRESS_AT: AtomicU32 = AtomicU32::new(0);
  /// The current press was spoiled by another key, a click, or a modifier.
  static DT_DIRTY: AtomicBool = AtomicBool::new(false);
  /// A clean first tap has been released and is waiting for its partner.
  static DT_ARMED: AtomicBool = AtomicBool::new(false);
  /// Tick time the first tap was released.
  static DT_FIRST_UP: AtomicU32 = AtomicU32::new(0);
  /// Longest a Ctrl press may be held and still count as a tap.
  const DT_MAX_HOLD_MS: u32 = 220;
  /// Longest pause between the first tap's release and the second press.
  const DT_MAX_GAP_MS: u32 = 350;

  /// True when a mouse button was pressed at or after tick `t`.
  fn clicked_since(t: u32) -> bool {
    let c = super::gesture::LAST_CLICK_MS.load(Ordering::Relaxed);
    c != 0 && c.wrapping_sub(t) < 0x8000_0000
  }

  fn mouse_button_down() -> bool {
    unsafe { [VK_LBUTTON, VK_RBUTTON, VK_MBUTTON].iter().any(|&b| GetAsyncKeyState(b as i32) as u16 & 0x8000 != 0) }
  }

  fn combo(vk: u32) -> Option<&'static str> {
    Some(match vk {
      0x44 => "show-desktop",   // D
      0x45 => "file-explorer",  // E
      0x41 => "quick-settings", // A
      0x4E => "notifications",  // N
      0x53 | 0x51 => "search",  // S, Q
      0x09 => "task-view",      // Tab
      0x5A => "snap-layouts",   // Z
      0x31 => "dock-1",
      0x32 => "dock-2",
      0x33 => "dock-3",
      0x34 => "dock-4",
      0x35 => "dock-5",
      0x36 => "dock-6",
      0x37 => "dock-7",
      0x38 => "dock-8",
      0x39 => "dock-9",
      _ => return None,
    })
  }

  unsafe fn foreground_is_own_process() -> bool {
    let mut pid = 0u32;
    GetWindowThreadProcessId(GetForegroundWindow(), &mut pid);
    pid == std::process::id()
  }

  unsafe extern "system" fn on_key(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if code == HC_ACTION as i32 && HOOK_ENABLED.load(Ordering::Relaxed) {
      let k = &*(lparam as *const KBDLLHOOKSTRUCT);
      if k.flags & LLKHF_INJECTED == 0 {
        let msg = wparam as u32;
        let down = msg == WM_KEYDOWN || msg == WM_SYSKEYDOWN;
        let vk = k.vkCode;
        if vk == VK_LSHIFT as u32 || vk == VK_RSHIFT as u32 {
          SHIFT_DOWN.store(down, Ordering::Relaxed);
        } else if matches!(vk, 0x11 | 0xA2 | 0xA3) {
          // Ctrl: Win+Ctrl+… belongs to Windows (virtual desktops).
          let was_down = CTRL_DOWN.swap(down, Ordering::Relaxed);
          if down && WIN_DOWN.load(Ordering::Relaxed) {
            WIN_COMBO.store(true, Ordering::Relaxed);
          }
          if down && !was_down {
            // A fresh press (auto-repeat of a held key is ignored).
            let busy = SHIFT_DOWN.load(Ordering::Relaxed)
              || WIN_DOWN.load(Ordering::Relaxed)
              || (k.flags & LLKHF_ALTDOWN) != 0
              || mouse_button_down();
            DT_DIRTY.store(busy, Ordering::Relaxed);
            DT_PRESS_AT.store(k.time, Ordering::Relaxed);
            if DT_ARMED.load(Ordering::Relaxed)
              && (busy
                || k.time.wrapping_sub(DT_FIRST_UP.load(Ordering::Relaxed)) > DT_MAX_GAP_MS
                || clicked_since(DT_FIRST_UP.load(Ordering::Relaxed)))
            {
              DT_ARMED.store(false, Ordering::Relaxed);
            }
          } else if !down && was_down {
            let press = DT_PRESS_AT.load(Ordering::Relaxed);
            let clean = !DT_DIRTY.load(Ordering::Relaxed) && k.time.wrapping_sub(press) <= DT_MAX_HOLD_MS && !clicked_since(press);
            if !clean {
              DT_ARMED.store(false, Ordering::Relaxed);
            } else if DT_ARMED.load(Ordering::Relaxed) && press.wrapping_sub(DT_FIRST_UP.load(Ordering::Relaxed)) <= DT_MAX_GAP_MS {
              DT_ARMED.store(false, Ordering::Relaxed);
              send(Msg::Hotkey("switcher-ctrl"));
            } else {
              DT_ARMED.store(true, Ordering::Relaxed);
              DT_FIRST_UP.store(k.time, Ordering::Relaxed);
            }
          }
        } else if vk == VK_LWIN as u32 || vk == VK_RWIN as u32 {
          if down {
            if !WIN_DOWN.swap(true, Ordering::Relaxed) {
              WIN_COMBO.store(false, Ordering::Relaxed);
            }
          } else {
            WIN_DOWN.store(false, Ordering::Relaxed);
            if !WIN_COMBO.swap(false, Ordering::Relaxed) {
              // A lone Win tap. The unassigned VK 0xE8 "masks" it so
              // Explorer doesn't also open its Start menu (the technique
              // AutoHotkey uses), then Udaan opens its own.
              tap_key(0xE8);
              send(Msg::Hotkey("start"));
            }
          }
        } else if down && vk == 0xC0 && (k.flags & LLKHF_ALTDOWN) != 0 && !WIN_DOWN.load(Ordering::Relaxed) {
          // Alt+` / Alt+Shift+`: cycle windows of the front app (macOS Cmd+`).
          send(Msg::Hotkey(if SHIFT_DOWN.load(Ordering::Relaxed) { "prev-app-window" } else { "next-app-window" }));
          return 1;
        } else if down && WIN_DOWN.load(Ordering::Relaxed) {
          WIN_COMBO.store(true, Ordering::Relaxed);
          let modified = SHIFT_DOWN.load(Ordering::Relaxed) || CTRL_DOWN.load(Ordering::Relaxed) || (k.flags & LLKHF_ALTDOWN) != 0;
          if !modified {
            if let Some(id) = combo(vk) {
              // Win+Z only means Snap Layouts for Udaan's own windows.
              if id == "snap-layouts" && !foreground_is_own_process() {
                return CallNextHookEx(std::ptr::null_mut(), code, wparam, lparam);
              }
              send(Msg::Hotkey(id));
              return 1;
            }
          }
          // Everything else (Win+L, Win+R, Win+Arrows, Win+Shift+S...)
          // passes through to Windows unchanged.
        }
        // Any other key — a letter, Shift, Alt, Win — spoils a tap in progress
        // and breaks a half-finished double-tap.
        if down && !matches!(vk, 0x11 | 0xA2 | 0xA3) {
          DT_DIRTY.store(true, Ordering::Relaxed);
          DT_ARMED.store(false, Ordering::Relaxed);
        }
      }
    }
    CallNextHookEx(std::ptr::null_mut(), code, wparam, lparam)
  }

  unsafe fn install_kb_hook() {
    let mut guard = KB_HOOK.lock().unwrap();
    if *guard != 0 {
      return;
    }
    let hook = SetWindowsHookExW(WH_KEYBOARD_LL, Some(on_key), GetModuleHandleW(std::ptr::null()), 0);
    *guard = hook as usize;
  }

  unsafe fn remove_kb_hook() {
    let mut guard = KB_HOOK.lock().unwrap();
    if *guard != 0 {
      UnhookWindowsHookEx(*guard as _);
      *guard = 0;
    }
  }

  pub fn set_keyboard_hook(enabled: bool) {
    HOOK_ENABLED.store(enabled, Ordering::Relaxed);
    let t = HOOK_THREAD.load(Ordering::Relaxed);
    if t != 0 {
      unsafe {
        PostThreadMessageW(t, if enabled { WM_HOOK_ON } else { WM_HOOK_OFF }, 0, 0);
      }
    }
  }

  pub fn start_hook_thread() {
    std::thread::Builder::new()
      .name("udaan-shell-hooks".into())
      .spawn(|| unsafe {
        HOOK_THREAD.store(GetCurrentThreadId(), Ordering::Relaxed);
        let flags = WINEVENT_OUTOFCONTEXT;
        let ranges: [(u32, u32); 6] = [
          (EVENT_SYSTEM_FOREGROUND, EVENT_SYSTEM_FOREGROUND),
          (EVENT_SYSTEM_MINIMIZESTART, EVENT_SYSTEM_MINIMIZEEND),
          (EVENT_OBJECT_CREATE, EVENT_OBJECT_HIDE),
          (EVENT_OBJECT_LOCATIONCHANGE, EVENT_OBJECT_NAMECHANGE),
          (EVENT_OBJECT_CLOAKED, EVENT_OBJECT_UNCLOAKED),
          (EVENT_SYSTEM_MOVESIZEEND, EVENT_SYSTEM_MOVESIZEEND),
        ];
        for (min, max) in ranges {
          SetWinEventHook(min, max, std::ptr::null_mut(), Some(on_win_event), 0, 0, flags);
        }
        if HOOK_ENABLED.load(Ordering::Relaxed) {
          install_kb_hook();
        }
        let mut msg: MSG = std::mem::zeroed();
        while GetMessageW(&mut msg, std::ptr::null_mut(), 0, 0) > 0 {
          match msg.message {
            WM_HOOK_ON => install_kb_hook(),
            WM_HOOK_OFF => remove_kb_hook(),
            _ => {
              TranslateMessage(&msg);
              DispatchMessageW(&msg);
            }
          }
        }
        remove_kb_hook();
      })
      .expect("spawn shell hook thread");
  }
}

#[cfg(not(target_os = "windows"))]
mod win {
  use super::Rect;
  pub fn set_known(_: std::collections::HashSet<isize>) {}
  pub fn foreground() -> isize {
    0
  }
  pub fn covers_monitor(_: isize) -> bool {
    false
  }
  pub enum Show {
    Minimize,
    Restore,
    Hide,
    Unhide,
  }
  pub fn show(_: isize, _: Show) {}
  pub fn toggle_maximize(_: isize) {}
  pub fn normal_size(_: isize) -> Option<(i32, i32)> {
    None
  }
  pub fn window_icon(_: isize) -> Option<String> {
    None
  }
  pub fn snap(_: isize, _: super::Zone) -> Result<(), String> {
    Err("Windows only".into())
  }
  pub fn round_corners(_: isize) {}
  pub fn force_foreground(_: isize) -> Result<(), String> {
    Err("Windows only".into())
  }
  pub fn set_explorer_chrome_visible(_: bool) {}
  pub fn set_keyboard_hook(_: bool) {}
  pub fn start_hook_thread() {}
  pub fn set_rect(_: isize, _: i32, _: i32, _: i32, _: i32) {}
  pub fn monitor_rects(_: isize) -> Result<(Rect, Rect), String> {
    Err("Windows only".into())
  }
}

#[cfg(all(test, target_os = "windows"))]
mod tests {
  #[test]
  fn shell_icon_for_explorer_exe_is_a_real_png() {
    let icon = super::icons::file_icon(r"C:\Windows\explorer.exe").expect("explorer.exe has an icon");
    assert!(icon.starts_with("data:image/png;base64,"));
    assert!(icon.len() > 1000, "icon suspiciously small: {} bytes", icon.len());
  }

  #[test]
  fn shell_icon_for_folder_and_unknown_extension() {
    assert!(super::icons::file_icon(r"C:\Windows").is_some());
    assert!(super::icons::file_icon(r"C:\Windows\win.ini").is_some());
  }

  #[test]
  fn clipboard_file_list_round_trips_with_cut_flag() {
    let path = std::env::temp_dir().join("udaan-clip-test.txt");
    std::fs::write(&path, "x").unwrap();
    let p = path.to_string_lossy().into_owned();
    super::clipboard::shell_clipboard_set_files(vec![p.clone()], true).unwrap();
    let got = super::clipboard::shell_clipboard_get_files().unwrap();
    assert_eq!(got.paths, vec![p.clone()]);
    assert!(got.cut);
    super::clipboard::shell_clipboard_set_files(vec![p.clone()], false).unwrap();
    assert!(!super::clipboard::shell_clipboard_get_files().unwrap().cut);
  }

  #[test]
  fn window_list_applies_alt_tab_rules() {
    let list = crate::taskbar::win::list_windows();
    for w in &list {
      assert!(!w.title.is_empty());
      assert!(w.pid != 0);
    }
    println!("{} windows: {:?}", list.len(), list.iter().map(|w| (&w.title, &w.process_name, w.is_maximized)).collect::<Vec<_>>());
  }

  #[test]
  fn app_display_name_reads_file_description() {
    let name = super::icons::app_display_name(r"C:\Windows\explorer.exe");
    assert_eq!(name, "Windows Explorer");
  }

  #[test]
  fn recycle_bin_is_readable() {
    let items = trash::os_limited::list().expect("recycle bin list");
    println!("recycle bin items: {}", items.len());
  }
}

#[cfg(all(test, target_os = "windows"))]
mod pin_tests {
  #[test]
  fn resolves_users_pinned_apps() {
    for exe in ["Code.exe", "Claude.exe", "NortonPrivateBrowser.exe", "explorer.exe"] {
      println!("{exe} -> {:?}", crate::installed_apps::resolve_launch_target(exe));
    }
  }
}
