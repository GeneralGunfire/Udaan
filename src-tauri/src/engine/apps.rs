//! Lifetime of Udaan's own app windows once the user closes them.
//!
//! Closing an app hides its window instead of destroying it, so reopening is instant. But a
//! hidden window still holds an entire webview (about 85 MB), and the timer that used to
//! destroy it lived inside that same hidden renderer. Open six apps and close them and you
//! were carrying roughly half a gigabyte of invisible windows for three minutes.
//!
//! The engine owns this now: a closed window is kept warm only briefly (shorter when the PC
//! is short of memory), only a couple of them are kept at once, and the oldest is destroyed
//! the moment that limit is exceeded. The timer is a single supervised thread that sleeps
//! until the next deadline, so it costs nothing while nothing is waiting.

use std::collections::HashMap;
use std::sync::{Condvar, Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

/// How long a closed app stays warm, by how much memory the PC can spare (see `resources`).
fn ttl_for(tier: super::resources::Tier) -> Duration {
  match tier {
    super::resources::Tier::Tight => Duration::from_secs(20),
    super::resources::Tier::Normal => Duration::from_secs(60),
    super::resources::Tier::Roomy => Duration::from_secs(180),
  }
}

/// At most this many closed windows are kept warm at once; only one when memory is tight.
fn max_warm(tier: super::resources::Tier) -> usize {
  if tier == super::resources::Tier::Tight {
    1
  } else {
    2
  }
}

struct Reaper {
  /// (window label, when to destroy it), oldest first.
  queue: Mutex<Vec<(String, Instant)>>,
  wake: Condvar,
}

static REAPER: OnceLock<Reaper> = OnceLock::new();

fn reaper() -> &'static Reaper {
  REAPER.get_or_init(|| Reaper { queue: Mutex::new(Vec::new()), wake: Condvar::new() })
}

/// Starts the reaper thread. Call once from setup.
pub fn start(app: AppHandle) {
  let _ = reaper();
  let _ = super::supervisor::spawn("app-reaper", super::supervisor::Restart::OnPanic, move || run(&app));
}

fn destroy_if_hidden(app: &AppHandle, label: &str) {
  if let Some(w) = app.get_webview_window(label) {
    if !w.is_visible().unwrap_or(false) {
      super::trace::line(&format!("reaping hidden app window '{label}'"));
      let _ = w.destroy();
    }
  }
}

fn run(app: &AppHandle) {
  let r = reaper();
  let mut q = r.queue.lock().unwrap_or_else(|e| e.into_inner());
  loop {
    let now = Instant::now();
    // Anything shown again in the meantime is no longer waiting to be reaped.
    q.retain(|(label, _)| app.get_webview_window(label).map(|w| !w.is_visible().unwrap_or(false)).unwrap_or(false));
    let (due, waiting): (Vec<_>, Vec<_>) = q.drain(..).partition(|(_, at)| *at <= now);
    *q = waiting;
    if !due.is_empty() {
      drop(q);
      for (label, _) in &due {
        destroy_if_hidden(app, label);
      }
      q = r.queue.lock().unwrap_or_else(|e| e.into_inner());
      continue;
    }
    q = match q.iter().map(|(_, at)| *at).min() {
      // Sleep exactly until the next deadline.
      Some(next) => r.wake.wait_timeout(q, next.saturating_duration_since(now)).unwrap_or_else(|e| e.into_inner()).0,
      // Nothing waiting: sleep until something is queued.
      None => r.wake.wait(q).unwrap_or_else(|e| e.into_inner()),
    };
  }
}

/// An app window was closed by the user: hide it and schedule it to be destroyed.
#[tauri::command]
pub fn engine_app_closed(app: AppHandle, window: tauri::WebviewWindow) -> Result<(), String> {
  let label = window.label().to_string();
  window.hide().map_err(|e| e.to_string())?;
  let overflow: Vec<String> = {
    let mut q = reaper().queue.lock().unwrap_or_else(|e| e.into_inner());
    q.retain(|(l, _)| *l != label);
    let tier = super::resources::refresh();
    q.push((label, Instant::now() + ttl_for(tier)));
    // Keep only the newest MAX_WARM; the rest are destroyed right away.
    let excess = q.len().saturating_sub(max_warm(tier));
    q.drain(..excess).map(|(l, _)| l).collect()
  };
  for l in overflow {
    destroy_if_hidden(&app, &l);
  }
  reaper().wake.notify_all();
  Ok(())
}

// ---------------------------------------------------------------------------------------
// Opening apps
// ---------------------------------------------------------------------------------------

const APP_LABEL_PREFIX: &str = "app-";

static PENDING_ARGS: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();

/// Browser flags for EVERY webview. WebView2 refuses windows that share a profile but
/// differ in flags, so tauri.conf.json carries this exact same string for the static
/// windows. `--renderer-process-limit` makes extra windows reuse an existing renderer
/// instead of each spawning its own (60-100 MB apiece).
pub const WEBVIEW_ARGS: &str = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --renderer-process-limit=2";


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
    let h = existing.hwnd().map_err(|e| e.to_string())?.0 as isize;
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
    return super::window_actions::force_foreground(h);
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
  super::governor::attach(&window);
  crate::webview_permissions::allow_media_capture(&window);
  if req.maximized {
    let _ = window.maximize();
  }
  Ok(())
}

/// Pre-warms a list of app windows by creating them hidden so the first
/// user-triggered open is instant (WebView2 is already running).
#[tauri::command]
pub async fn shell_prewarm_apps(app: AppHandle, app_ids: Vec<String>) -> Result<(), String> {
  // A pre-warmed window keeps a whole webview resident (about 85 MB each). Only when there is
  // plenty of room does that pay for itself; otherwise the paging it causes costs more than
  // the open time it saves.
  let tier = super::resources::refresh();
  if tier != super::resources::Tier::Roomy {
    super::trace::line(&format!("prewarm skipped: memory tier is {tier:?}"));
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
      super::governor::attach_prewarmed(&window);
      crate::webview_permissions::allow_media_capture(&window);
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

