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

use std::sync::{Condvar, Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};

/// How long a closed app stays warm when memory is comfortable.
const WARM_TTL: Duration = Duration::from_secs(180);
/// ...and when it is not.
const TIGHT_TTL: Duration = Duration::from_secs(20);
/// Below this much free memory, memory counts as tight.
const TIGHT_MB: u64 = 3000;
/// At most this many closed windows are kept warm at once.
const MAX_WARM: usize = 2;

struct Reaper {
  /// (window label, when to destroy it), oldest first.
  queue: Mutex<Vec<(String, Instant)>>,
  wake: Condvar,
}

static REAPER: OnceLock<Reaper> = OnceLock::new();

fn reaper() -> &'static Reaper {
  REAPER.get_or_init(|| Reaper { queue: Mutex::new(Vec::new()), wake: Condvar::new() })
}

fn ttl() -> Duration {
  if super::resources::available_mb() < TIGHT_MB {
    TIGHT_TTL
  } else {
    WARM_TTL
  }
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
    q.push((label, Instant::now() + ttl()));
    // Keep only the newest MAX_WARM; the rest are destroyed right away.
    let excess = q.len().saturating_sub(MAX_WARM);
    q.drain(..excess).map(|(l, _)| l).collect()
  };
  for l in overflow {
    destroy_if_hidden(&app, &l);
  }
  reaper().wake.notify_all();
  Ok(())
}
