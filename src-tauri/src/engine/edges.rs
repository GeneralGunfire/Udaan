//! Edge-bound bars: the dock and the menu bar.
//!
//! A bar lives against one edge of a monitor. It may RESERVE a strip of the screen (so
//! maximised windows stop at it, via a Windows AppBar) or just overlay (auto-hide). Either
//! way the engine puts the window exactly where it belongs, in one call, and keeps it there.
//!
//! This replaces what used to be five separate things that had to be called in the right
//! order by each window: reserve the strip, place the window, show it, place it again, and
//! then keep re-placing it on a timer, with the clean-up scattered across the close handler
//! and the exit handler. Now there is one call and one owner:
//!
//! - [`engine_edge_bind`] reserves (if asked), places the window on its strip, and starts
//!   keeping it there.
//! - The engine re-checks the bar on real window events (see [`reassert`]), and again when
//!   another AppBar changes the layout (the AppBar callback), moving only if it has drifted.
//! - The reservation is removed when the window is destroyed, on exit, and on a main-thread
//!   panic, through the undo guard, so the user's work area can never be left shrunk.

use super::popup::Rect;
use serde::Deserialize;
use std::collections::HashMap;
use std::sync::Mutex;
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, RECT, WPARAM};
use windows::Win32::Graphics::Gdi::{GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST};
use windows::Win32::UI::Shell::{
  DefSubclassProc, RemoveWindowSubclass, SHAppBarMessage, SetWindowSubclass, ABE_BOTTOM, ABE_TOP, ABM_NEW, ABM_QUERYPOS,
  ABM_REMOVE, ABM_SETPOS, APPBARDATA,
};
use windows::Win32::UI::WindowsAndMessaging::{
  GetWindowLongW, GetWindowRect, SetWindowPos, GWL_EXSTYLE, HWND_TOPMOST, SWP_NOACTIVATE, WM_APP, WM_NCDESTROY, WS_EX_TOPMOST,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Edge {
  Top,
  Bottom,
}

#[derive(Clone, Copy)]
struct Bar {
  edge: Edge,
  /// Thickness of the window itself, in physical pixels.
  window_px: i32,
  /// Thickness of the strip reserved from the work area; 0 means overlay (reserve nothing).
  reserve_px: i32,
  /// Length of the window along the edge; 0 = the whole edge. A floating dock is narrower and centred.
  width_px: i32,
  /// Gap between the window and the screen edge (a floating dock hovers above the edge).
  inset_px: i32,
  registered: bool,
  /// The strip the system last gave us (only meaningful while reserving).
  strip: RECT,
}

static BARS: Mutex<Option<HashMap<isize, Bar>>> = Mutex::new(None);

fn with_bars<R>(f: impl FnOnce(&mut HashMap<isize, Bar>) -> R) -> R {
  let mut g = BARS.lock().unwrap_or_else(|e| e.into_inner());
  f(g.get_or_insert_with(HashMap::new))
}

/// The AppBar callback message: the system tells a registered bar when the layout changes.
const WM_EDGE_NOTIFY: u32 = WM_APP + 0x45;
const ABN_POSCHANGED: usize = 1;
const SUBCLASS_ID: usize = 0x55_45_44; // "UED"

fn monitor_rect(hwnd: HWND) -> RECT {
  unsafe {
    let mon = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
    let mut mi = MONITORINFO { cbSize: std::mem::size_of::<MONITORINFO>() as u32, ..Default::default() };
    let _ = GetMonitorInfoW(mon, &mut mi);
    mi.rcMonitor
  }
}

/// The monitor rectangle a bar that reserves nothing (an overlay, such as an auto-hiding dock) is placed against.
/// For the bottom edge that is the work area's bottom, not the monitor's: a bar that reserves its strip is moved
/// by the system to sit above whatever already holds the bottom (the Windows taskbar keeps its strip even while
/// hidden), so an overlay has to start from the same line or the bar would sit lower in one mode than the other.
fn overlay_rect(hwnd: HWND, edge: Edge) -> RECT {
  unsafe {
    let mon = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
    let mut mi = MONITORINFO { cbSize: std::mem::size_of::<MONITORINFO>() as u32, ..Default::default() };
    let _ = GetMonitorInfoW(mon, &mut mi);
    let mut r = mi.rcMonitor;
    if edge == Edge::Bottom && mi.rcWork.bottom > mi.rcMonitor.top && mi.rcWork.bottom <= mi.rcMonitor.bottom {
      r.bottom = mi.rcWork.bottom;
    }
    r
  }
}

/// The strip of thickness `px` against `edge` of the monitor.
fn edge_strip(edge: Edge, m: &RECT, px: i32) -> RECT {
  match edge {
    Edge::Top => RECT { left: m.left, top: m.top, right: m.right, bottom: m.top + px },
    Edge::Bottom => RECT { left: m.left, top: m.bottom - px, right: m.right, bottom: m.bottom },
  }
}

/// The window's rectangle: `window_px` thick, anchored to the outer side of `strip`.
fn window_rect(edge: Edge, strip: &RECT, window_px: i32) -> RECT {
  match edge {
    Edge::Top => RECT { left: strip.left, top: strip.top, right: strip.right, bottom: strip.top + window_px },
    Edge::Bottom => RECT { left: strip.left, top: strip.bottom - window_px, right: strip.right, bottom: strip.bottom },
  }
}

/// The window's rectangle for a bar: the strip's rectangle, narrowed and centred if the bar is
/// floating, and lifted off the edge by its inset.
fn bar_rect(bar: &Bar, strip: &RECT) -> RECT {
  let mut r = window_rect(bar.edge, strip, bar.window_px);
  if bar.width_px > 0 {
    let mid = (strip.left + strip.right) / 2;
    r.left = mid - bar.width_px / 2;
    r.right = r.left + bar.width_px;
  }
  if bar.inset_px > 0 {
    match bar.edge {
      Edge::Bottom => {
        r.top -= bar.inset_px;
        r.bottom -= bar.inset_px;
      }
      Edge::Top => {
        r.top += bar.inset_px;
        r.bottom += bar.inset_px;
      }
    }
  }
  r
}

fn appbar_data(hwnd: HWND, edge: Edge) -> APPBARDATA {
  APPBARDATA {
    cbSize: std::mem::size_of::<APPBARDATA>() as u32,
    hWnd: hwnd,
    uCallbackMessage: WM_EDGE_NOTIFY,
    uEdge: if edge == Edge::Top { ABE_TOP } else { ABE_BOTTOM },
    ..Default::default()
  }
}

fn guard_name(h: isize) -> String {
  format!("appbar:{h}")
}

fn remove_appbar(h: isize) {
  let mut d = appbar_data(HWND(h as *mut core::ffi::c_void), Edge::Top);
  unsafe {
    SHAppBarMessage(ABM_REMOVE, &mut d);
  }
}

/// Asks the system for the strip and takes it. The system may move it to sit beside other
/// bars; the thickness is always ours.
fn reserve_strip(hwnd: HWND, bar: &mut Bar, m: &RECT) -> RECT {
  let mut d = appbar_data(hwnd, bar.edge);
  unsafe {
    if !bar.registered {
      SHAppBarMessage(ABM_NEW, &mut d);
      bar.registered = true;
      let h = hwnd.0 as isize;
      super::guard::register(guard_name(h), move || remove_appbar(h));
    }
    d.rc = edge_strip(bar.edge, m, bar.reserve_px);
    SHAppBarMessage(ABM_QUERYPOS, &mut d);
    match bar.edge {
      Edge::Top => d.rc.bottom = d.rc.top + bar.reserve_px,
      Edge::Bottom => d.rc.top = d.rc.bottom - bar.reserve_px,
    }
    SHAppBarMessage(ABM_SETPOS, &mut d);
  }
  d.rc
}

/// Moves the window onto `r` and keeps it topmost, only if it is not already there.
fn place(hwnd: HWND, r: &RECT) {
  unsafe {
    let mut cur = RECT::default();
    let _ = GetWindowRect(hwnd, &mut cur);
    let topmost = (GetWindowLongW(hwnd, GWL_EXSTYLE) as u32) & WS_EX_TOPMOST.0 != 0;
    let same = cur.left == r.left && cur.top == r.top && cur.right == r.right && cur.bottom == r.bottom;
    if topmost && same {
      return;
    }
    let _ = SetWindowPos(hwnd, Some(HWND_TOPMOST), r.left, r.top, r.right - r.left, r.bottom - r.top, SWP_NOACTIVATE);
  }
}

fn to_rect(r: &RECT) -> Rect {
  Rect { left: r.left, top: r.top, right: r.right, bottom: r.bottom }
}

unsafe extern "system" fn subclass_proc(hwnd: HWND, msg: u32, wp: WPARAM, lp: LPARAM, _id: usize, _data: usize) -> LRESULT {
  let h = hwnd.0 as isize;
  match msg {
    WM_EDGE_NOTIFY if wp.0 == ABN_POSCHANGED => {
      // Another bar changed the layout. Re-ask for our strip, and act only if it moved:
      // answering every notification would have two bars chasing each other forever.
      if let Some(mut bar) = with_bars(|b| b.get(&h).copied()) {
        if bar.reserve_px > 0 {
          let before = bar.strip;
          let strip = reserve_strip(hwnd, &mut bar, &monitor_rect(hwnd));
          let moved = (strip.left, strip.top, strip.right, strip.bottom) != (before.left, before.top, before.right, before.bottom);
          bar.strip = strip;
          with_bars(|b| b.insert(h, bar));
          if moved {
            place(hwnd, &bar_rect(&bar, &strip));
          }
        }
      }
    }
    WM_NCDESTROY => {
      if with_bars(|b| b.remove(&h)).map(|b| b.registered).unwrap_or(false) {
        remove_appbar(h);
        super::guard::cancel(&guard_name(h));
      }
      let _ = RemoveWindowSubclass(hwnd, Some(subclass_proc), SUBCLASS_ID);
    }
    _ => {}
  }
  DefSubclassProc(hwnd, msg, wp, lp)
}

/// Binds the calling window to an edge of its monitor and returns the rectangle it was
/// placed on. `window_px` is the window's thickness; `reserve_px` is how much of the work
/// area to claim (0 = overlay, claim nothing). Safe to call again to change either.
#[tauri::command]
pub fn engine_edge_bind(window: tauri::WebviewWindow, edge: Edge, window_px: i32, reserve_px: i32, width_px: Option<i32>, inset_px: Option<i32>) -> Result<Rect, String> {
  let hwnd = window.hwnd().map_err(|e| e.to_string())?;
  let h = hwnd.0 as isize;
  let m = monitor_rect(hwnd);

  let mut bar = with_bars(|b| b.get(&h).copied()).unwrap_or(Bar {
    edge,
    window_px,
    reserve_px,
    width_px: 0,
    inset_px: 0,
    registered: false,
    strip: RECT::default(),
  });
  // Changing edge means the old reservation is on the wrong side: release it first.
  if bar.registered && bar.edge != edge {
    remove_appbar(h);
    super::guard::cancel(&guard_name(h));
    bar.registered = false;
  }
  bar.edge = edge;
  bar.window_px = window_px.max(1);
  bar.reserve_px = reserve_px.max(0);
  bar.width_px = width_px.unwrap_or(0).max(0);
  bar.inset_px = inset_px.unwrap_or(0).max(0);

  let strip = if bar.reserve_px > 0 {
    reserve_strip(hwnd, &mut bar, &m)
  } else {
    if bar.registered {
      remove_appbar(h);
      super::guard::cancel(&guard_name(h));
      bar.registered = false;
    }
    edge_strip(edge, &overlay_rect(hwnd, edge), bar.window_px)
  };
  bar.strip = strip;
  let rect = bar_rect(&bar, &strip);
  place(hwnd, &rect);
  with_bars(|b| b.insert(h, bar));
  unsafe {
    // Idempotent: attaching again only replaces the same subclass.
    let _ = SetWindowSubclass(hwnd, Some(subclass_proc), SUBCLASS_ID, 0);
  }
  Ok(to_rect(&rect))
}

/// Gives the strip back and stops managing the window's position (the window itself is left
/// as it is). Used when a bar hides, for example while something is full-screen.
#[tauri::command]
pub fn engine_edge_release(window: tauri::WebviewWindow) -> Result<(), String> {
  let hwnd = window.hwnd().map_err(|e| e.to_string())?;
  let h = hwnd.0 as isize;
  if with_bars(|b| b.remove(&h)).map(|b| b.registered).unwrap_or(false) {
    remove_appbar(h);
    super::guard::cancel(&guard_name(h));
  }
  Ok(())
}

/// Called by the shell worker whenever a real window event arrives: puts any bar that has
/// drifted (moved, resized, or lost topmost) back on its strip. Stands down while something
/// is full-screen, since the bars hide themselves then.
pub fn reassert(fullscreen: bool) {
  if fullscreen {
    return;
  }
  let bars: Vec<(isize, Bar)> = with_bars(|b| b.iter().map(|(k, v)| (*k, *v)).collect());
  for (h, bar) in bars {
    let hwnd = HWND(h as *mut core::ffi::c_void);
    let strip = if bar.reserve_px > 0 { bar.strip } else { edge_strip(bar.edge, &overlay_rect(hwnd, bar.edge), bar.window_px) };
    place(hwnd, &bar_rect(&bar, &strip));
  }
}

/// Whether every bound bar is on its strip and topmost. With `heal`, moves any that are not.
/// Returns (bars, bars that were off).
pub fn check(heal: bool) -> (usize, usize) {
  let bars: Vec<(isize, Bar)> = with_bars(|b| b.iter().map(|(k, v)| (*k, *v)).collect());
  let mut off = 0;
  for (h, bar) in &bars {
    let hwnd = HWND(*h as *mut core::ffi::c_void);
    let strip = if bar.reserve_px > 0 { bar.strip } else { edge_strip(bar.edge, &overlay_rect(hwnd, bar.edge), bar.window_px) };
    let want = bar_rect(&bar, &strip);
    let mut cur = RECT::default();
    unsafe {
      let _ = GetWindowRect(hwnd, &mut cur);
    }
    let topmost = unsafe { (GetWindowLongW(hwnd, GWL_EXSTYLE) as u32) & WS_EX_TOPMOST.0 != 0 };
    let same = (cur.left, cur.top, cur.right, cur.bottom) == (want.left, want.top, want.right, want.bottom);
    if !(same && topmost) {
      off += 1;
      if heal {
        place(hwnd, &want);
      }
    }
  }
  (bars.len(), off)
}

#[cfg(test)]
mod tests {
  use super::*;

  const MON: RECT = RECT { left: 0, top: 0, right: 1920, bottom: 1080 };

  #[test]
  fn strips_sit_against_their_edge() {
    let top = edge_strip(Edge::Top, &MON, 34);
    assert_eq!((top.left, top.top, top.right, top.bottom), (0, 0, 1920, 34));
    let bottom = edge_strip(Edge::Bottom, &MON, 56);
    assert_eq!((bottom.left, bottom.top, bottom.right, bottom.bottom), (0, 1024, 1920, 1080));
  }

  #[test]
  fn a_window_taller_than_its_strip_grows_away_from_the_edge() {
    // The dock reserves 56 px but its window is 114 px tall (room for labels above the bar).
    let strip = edge_strip(Edge::Bottom, &MON, 56);
    let w = window_rect(Edge::Bottom, &strip, 114);
    assert_eq!((w.top, w.bottom), (1080 - 114, 1080), "anchored to the bottom, extending upward");
    // and a top bar's window grows downward from the top
    let top = edge_strip(Edge::Top, &MON, 34);
    let tw = window_rect(Edge::Top, &top, 34);
    assert_eq!((tw.top, tw.bottom), (0, 34));
  }

  #[test]
  fn on_a_second_monitor_the_strip_follows_that_monitor() {
    let second = RECT { left: 1920, top: 0, right: 3840, bottom: 1080 };
    let s = edge_strip(Edge::Bottom, &second, 56);
    assert_eq!((s.left, s.right), (1920, 3840));
  }
}
