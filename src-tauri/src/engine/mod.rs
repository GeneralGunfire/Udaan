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
//! - [`desktop`]: the wallpaper/icons layer: always the bottom of the stack, fitted to the
//!   primary monitor, and recovered when monitors, DPI or Explorer change.
//! - [`governor`]: decides which webviews are actually allowed to render. A window nobody
//!   can see (hidden, minimised, or covered by a maximised window) stops compositing.
//! - [`pin`]: keeps the dock and menu bar on their screen edge, event-driven instead of by timer.
//! - [`watchdog`]: an external process that restores Explorer's taskbar even after a hard kill.
//! - [`trace`]: a small crash-safe breadcrumb log, because a release build has no console.

pub mod desktop;
pub mod governor;
pub mod guard;
pub mod pin;
pub mod resources;
pub mod supervisor;
pub mod trace;
pub mod watchdog;

use tauri::AppHandle;

/// Installs the engine: panic hook, breadcrumb log, and the webview governor on every
/// window that already exists. Call first thing in `setup`.
pub fn install(app: &AppHandle) {
  trace::init();
  install_panic_hook();
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
