//! Edge pins: keeps the dock and menu bar flush against their screen edge and topmost.
//!
//! Other windows can nudge a shell bar off its edge or climb above it. The frontends
//! used to fight that with a timer that called into Rust every two seconds for the whole
//! session, waking a renderer, the IPC bridge and the UI thread each time. A pin makes it
//! event-driven: the window registers its edge once, and the shell worker re-checks it
//! whenever a real window event arrives (a window appeared, moved, or took the
//! foreground), correcting it only if it has actually drifted. While something is
//! full-screen the pin stands down, as the bars hide themselves then.

use std::collections::HashMap;
use std::sync::Mutex;

#[derive(Clone, Copy, PartialEq)]
pub enum Edge {
  Top,
  Bottom,
}

#[derive(Clone, Copy)]
struct Pin {
  hwnd: isize,
  edge: Edge,
  height_px: i32,
}

static PINS: Mutex<Option<HashMap<String, Pin>>> = Mutex::new(None);

fn with_pins<R>(f: impl FnOnce(&mut HashMap<String, Pin>) -> R) -> R {
  let mut g = PINS.lock().unwrap_or_else(|e| e.into_inner());
  f(g.get_or_insert_with(HashMap::new))
}

/// Pins the calling window to a screen edge. Applies it immediately, and keeps it there
/// until [`engine_unpin`]. Call again to change the height (scale or layout change).
#[tauri::command]
pub fn engine_pin(window: tauri::WebviewWindow, edge: String, height_px: i32) -> Result<(), String> {
  let edge = match edge.as_str() {
    "top" => Edge::Top,
    "bottom" => Edge::Bottom,
    other => return Err(format!("unknown edge '{other}'")),
  };
  let hwnd = window.hwnd().map_err(|e| e.to_string())?.0 as isize;
  let pin = Pin { hwnd, edge, height_px };
  with_pins(|p| p.insert(window.label().to_string(), pin));
  crate::shell::enforce_pin(hwnd, edge == Edge::Top, height_px)
}

#[tauri::command]
pub fn engine_unpin(window: tauri::WebviewWindow) {
  with_pins(|p| p.remove(window.label()));
}

/// Called from the shell worker on every pass. Cheap: one rect and one style read per pin.
pub fn reassert(fullscreen: bool) {
  if fullscreen {
    return;
  }
  let pins: Vec<Pin> = with_pins(|p| p.values().copied().collect());
  for pin in pins {
    let _ = crate::shell::enforce_pin(pin.hwnd, pin.edge == Edge::Top, pin.height_px);
  }
}
