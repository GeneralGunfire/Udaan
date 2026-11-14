//! The Udaan engine: the layer every OS-facing service stands on.
//!
//! The shell used to be a set of independent modules that each spawned their own
//! unsupervised threads, changed the OS in their own way and cleaned up (or didn't) in
//! their own way. One panic silently killed a feature for the rest of the session, and
//! a crash could leave the user's taskbar hidden. The engine replaces that with a few
//! small, strict pieces:
//!
//! - [`supervisor`]: every background service runs under supervision. A panic is caught,
//!   recorded, and the service restarted with backoff; health is queryable.
//! - [`guard`]: every change made to the OS registers its own undo. All undos run on
//!   exit and on a main-thread panic, so the OS is never left altered.
//! - [`apps`]: how long closed app windows stay warm; capped, shorter when RAM is tight.
//! - [`desktop`]: the wallpaper/icons layer: always the bottom of the stack, fitted to the
//!   primary monitor, and recovered when monitors, DPI or Explorer change.
//! - [`desktop_items`]: what is on the desktop, as Explorer would show it, kept current.
//! - [`displays`]: every monitor (area, work area, scale, primary) and a notice when they change.
//! - [`doctor`]: checks the engine's own invariants and repairs them after a display change or an
//!   Explorer restart.
//! - [`governor`]: decides which webviews are actually allowed to render. A window nobody
//!   can see (hidden, minimised, or covered by a maximised window) stops compositing.
//! - [`keyboard`]: the Win key, Win+<key>, double-tap Ctrl and Alt+`, as a tested state machine.
//! - [`notify`]: notifications from arrival to expiry: policy, history, banner queue and timers.
//! - [`popup`]: where a popup goes (flip, clamp, fit) and when it dismisses itself.
//! - [`edges`]: the dock and menu bar: reserve a strip, sit exactly on it, stay there, and give
//!   it back however the window ends.
//! - [`wallpaper_packs`]: packs (cars, windows, abstract...) and automatic changing on a timer.
//! - [`windowlist`]: listing real windows (Alt+Tab rules), their icons, and the Expose live thumbnails.
//! - [`window_actions`]: focus, snap, minimise, show desktop and the other things done to windows.
//! - [`wallpapers`]: a library of pictures on disk, served at the size they are shown.
//! - [`watchdog`]: an external process that restores Explorer's taskbar even after a hard kill.
//! - [`search`]: the Start search index: apps, settings, actions and files, ranked, with frecency.
//! - [`stores`]: databases that open resiliently; a damaged one is set aside, never fatal.
//! - [`trace`]: a small crash-safe breadcrumb log, because a release build has no console.

pub mod apps;
pub mod desktop;
pub mod desktop_items;
pub mod displays;
pub mod doctor;
pub mod edges;
pub mod explorer;
pub mod governor;
pub mod geometry;
pub mod guard;
pub mod keyboard;
pub mod notify;
pub mod popup;
pub mod resources;
pub mod search;
pub mod stores;
pub mod supervisor;
pub mod tracker;
pub mod trace;
pub mod wallpaper_packs;
pub mod wallpapers;
pub mod windowlist;
pub mod window_actions;
pub mod watchdog;

use tauri::AppHandle;

/// Installs the engine: panic hook, breadcrumb log, and the webview governor on every
/// window that already exists. Call first thing in `setup`.
pub fn install(app: &AppHandle) {
  trace::init();
  install_panic_hook();
  displays::init(app);
  governor::attach_all(app);
  trace::line("engine installed");
}

/// Creates the shell's windows (desktop, dock, menu bar, popups). They are declared in
/// `tauri.conf.json` with `"create": false` so Tauri does not start loading their pages
/// until this runs, after every piece of managed state exists. Previously the pages
/// started loading before `setup` had finished, and a command invoked early could hit
/// state that was not registered yet ("state not managed").
pub fn create_windows(app: &AppHandle) {
  use tauri::WebviewWindowBuilder;
  let configs = app.config().app.windows.clone();
  for cfg in &configs {
    let label = cfg.label.clone();
    match WebviewWindowBuilder::from_config(app, cfg).and_then(|b| b.build()) {
      Ok(w) => {
        governor::attach(&w);
        trace::line(&format!("window created: {label}"));
      }
      Err(e) => trace::line(&format!("window '{label}' failed to create: {e}")),
    }
  }
}

/// A panic on the main thread would otherwise leave Explorer's taskbar hidden and the
/// keyboard hook installed. Run every registered undo before the process unwinds.
fn install_panic_hook() {
  let previous = std::panic::take_hook();
  std::panic::set_hook(Box::new(move |info| {
    let thread = std::thread::current();
    let name = thread.name().unwrap_or("unnamed").to_string();
    trace::line(&format!("PANIC on thread '{name}': {info}"));
    if name == "main" {
      guard::run_all();
    }
    previous(info);
  }));
}

/// Health of every supervised service, for the diagnostics panel and for tests.
#[tauri::command]
pub fn engine_health() -> Vec<supervisor::ServiceHealth> {
  supervisor::health()
}

/// Raises the calling window to the top of the topmost layer without moving, resizing or
/// focusing it. The lock screen uses this to stay in front when something tries to cover it.
#[tauri::command]
pub fn engine_raise_topmost(window: tauri::WebviewWindow) -> Result<(), String> {
  use windows::Win32::UI::WindowsAndMessaging::{SetWindowPos, HWND_TOPMOST, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE};
  let hwnd = window.hwnd().map_err(|e| e.to_string())?;
  unsafe { SetWindowPos(hwnd, Some(HWND_TOPMOST), 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE) }.map_err(|e| e.to_string())
}
