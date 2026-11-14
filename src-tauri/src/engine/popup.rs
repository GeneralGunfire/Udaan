//! Popup manager: where a popup goes, and when it goes away.
//!
//! A popup (a menu, a panel, a flyout) is a small window that appears next to the thing that
//! opened it. Getting that right is the same problem every time, so it lives here once:
//!
//! - [`place`] is a pure function that decides the rectangle: next to the anchor, flipped to
//!   the other side when there is no room, clamped inside the monitor's work area, shrunk if
//!   it is bigger than the screen. It is unit tested and knows nothing about windows.
//! - [`engine_popup_open`] applies that rectangle and shows the window in ONE call, so a popup
//!   never appears at the wrong size or place and then jumps. The popup UI measures its
//!   content, asks for that size, and the engine does the rest.
//! - A popup that loses focus is hidden by the engine (and the UI told), which is how a native
//!   menu dismisses itself when you click elsewhere.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use tauri::{AppHandle, Emitter};
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, POINT, WPARAM};
use windows::Win32::Graphics::Gdi::{CreateRoundRectRgn, SetWindowRgn, GetMonitorInfoW, MonitorFromPoint, MONITORINFO, MONITOR_DEFAULTTONEAREST};
use windows::Win32::UI::Shell::{DefSubclassProc, RemoveWindowSubclass, SetWindowSubclass};
use windows::Win32::UI::WindowsAndMessaging::{
  SetWindowPos, HWND_TOPMOST, SWP_NOACTIVATE, WA_INACTIVE, WM_ACTIVATE, WM_NCDESTROY,
};

pub use super::geometry::Rect;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Placement {
  /// Centred under the anchor; flips above if there is no room below.
  Below,
  /// Centred over the anchor; flips below if there is no room above.
  Above,
  /// Beside the anchor, centred vertically; flips to the left if there is no room.
  Right,
  /// Beside the anchor, centred vertically; flips to the right if there is no room.
  Left,
  /// Top-left corner at a point (a context menu); flips up and/or left at the screen edge.
  Point,
  /// A full-height sheet against the right edge of the work area.
  SheetRight,
}

/// Decides where a popup of `size` goes. `work` is the monitor's work area, `gap` the space
/// between the anchor and the popup, `margin` the minimum distance kept from the work area's
/// edges. Returns the rectangle and the placement actually used (it can differ from the one
/// asked for when the popup had to flip).
pub fn place(anchor: Rect, size: (i32, i32), want: Placement, work: Rect, gap: i32, margin: i32) -> (Rect, Placement) {
  let inner = Rect { left: work.left + margin, top: work.top + margin, right: work.right - margin, bottom: work.bottom - margin };
  let w = size.0.clamp(1, inner.width().max(1));
  let mut h = size.1.clamp(1, inner.height().max(1));
  let (cx, cy) = ((anchor.left + anchor.right) / 2, (anchor.top + anchor.bottom) / 2);
  let mut used = want;

  let (x, y) = match want {
    Placement::Below | Placement::Above => {
      let room_below = inner.bottom - anchor.bottom - gap;
      let room_above = anchor.top - gap - inner.top;
      let go_below = match want {
        Placement::Below => h <= room_below || room_below >= room_above,
        _ => !(h <= room_above || room_above >= room_below),
      };
      used = if go_below { Placement::Below } else { Placement::Above };
      (cx - w / 2, if go_below { anchor.bottom + gap } else { anchor.top - gap - h })
    }
    Placement::Right | Placement::Left => {
      let room_right = inner.right - anchor.right - gap;
      let room_left = anchor.left - gap - inner.left;
      let go_right = match want {
        Placement::Right => w <= room_right || room_right >= room_left,
        _ => !(w <= room_left || room_left >= room_right),
      };
      used = if go_right { Placement::Right } else { Placement::Left };
      (if go_right { anchor.right + gap } else { anchor.left - gap - w }, cy - h / 2)
    }
    Placement::Point => {
      let x = if anchor.left + w > inner.right { anchor.left - w } else { anchor.left };
      let y = if anchor.top + h > inner.bottom { anchor.top - h } else { anchor.top };
      (x, y)
    }
    Placement::SheetRight => {
      h = inner.height();
      (inner.right - w, inner.top)
    }
  };

  // Last resort: whatever side it landed on, it must be fully inside the work area.
  let x = x.clamp(inner.left, (inner.right - w).max(inner.left));
  let y = y.clamp(inner.top, (inner.bottom - h).max(inner.top));
  (Rect { left: x, top: y, right: x + w, bottom: y + h }, used)
}

// ---------------------------------------------------------------------------------------
// Windows: applying a placement, and dismissing on focus loss
// ---------------------------------------------------------------------------------------

const SUBCLASS_ID: usize = 0x55_50_50; // "UPP"
const GAP: i32 = 6;
const MARGIN: i32 = 8;

struct Open {
  anchor: Rect,
  placement: Placement,
  /// Corner radius in logical px; 0 = square. The window is cut to this shape so the
  /// compositor's blur follows the card's corners instead of filling a rectangle.
  radius: i32,
}

static OPEN: Mutex<Option<HashMap<isize, Open>>> = Mutex::new(None);
static APP: OnceLock<AppHandle> = OnceLock::new();

fn with_open<R>(f: impl FnOnce(&mut HashMap<isize, Open>) -> R) -> R {
  let mut g = OPEN.lock().unwrap_or_else(|e| e.into_inner());
  f(g.get_or_insert_with(HashMap::new))
}

/// Work area (the monitor minus the dock and menu bar) of the monitor nearest a point.
fn work_area_at(x: i32, y: i32) -> Rect {
  unsafe {
    let mon = MonitorFromPoint(POINT { x, y }, MONITOR_DEFAULTTONEAREST);
    let mut mi = MONITORINFO { cbSize: std::mem::size_of::<MONITORINFO>() as u32, ..Default::default() };
    let _ = GetMonitorInfoW(mon, &mut mi);
    Rect { left: mi.rcWork.left, top: mi.rcWork.top, right: mi.rcWork.right, bottom: mi.rcWork.bottom }
  }
}

unsafe extern "system" fn subclass_proc(hwnd: HWND, msg: u32, wp: WPARAM, lp: LPARAM, _id: usize, _data: usize) -> LRESULT {
  match msg {
    // The popup lost focus (the user clicked elsewhere): hide it and tell the UI.
    WM_ACTIVATE if (wp.0 & 0xFFFF) as u32 == WA_INACTIVE => {
      let h = hwnd.0 as isize;
      if with_open(|o| o.remove(&h)).is_some() {
        super::trace::line("popup dismissed (lost focus)");
        let _ = windows::Win32::UI::WindowsAndMessaging::ShowWindow(hwnd, windows::Win32::UI::WindowsAndMessaging::SW_HIDE);
        if let Some(app) = APP.get() {
          let _ = app.emit("engine://popup-dismissed", h);
        }
      }
    }
    WM_NCDESTROY => {
      with_open(|o| o.remove(&(hwnd.0 as isize)));
      let _ = RemoveWindowSubclass(hwnd, Some(subclass_proc), SUBCLASS_ID);
    }
    _ => {}
  }
  DefSubclassProc(hwnd, msg, wp, lp)
}

fn apply(hwnd: HWND, r: Rect, radius: i32) {
  unsafe {
    let _ = SetWindowPos(hwnd, Some(HWND_TOPMOST), r.left, r.top, r.width(), r.height(), SWP_NOACTIVATE);
    if radius > 0 {
      let dpi = windows::Win32::UI::HiDpi::GetDpiForWindow(hwnd).max(96) as i32;
      let d = (radius * dpi / 96) * 2;
      // The system owns the region after this call.
      let rgn = CreateRoundRectRgn(0, 0, r.width() + 1, r.height() + 1, d, d);
      let _ = SetWindowRgn(hwnd, Some(rgn), true);
    } else {
      let _ = SetWindowRgn(hwnd, None, true);
    }
  }
}

/// Places the calling window next to `anchor` (physical pixels, screen coordinates) and shows
/// it, in one step. Returns the rectangle it was given and the placement actually used.
#[tauri::command]
pub fn engine_popup_open(
  app: AppHandle,
  window: tauri::WebviewWindow,
  anchor: Rect,
  width: i32,
  height: i32,
  placement: Placement,
  focus: Option<bool>,
  radius: Option<i32>,
) -> Result<(Rect, Placement), String> {
  let _ = APP.set(app);
  let hwnd = window.hwnd().map_err(|e| e.to_string())?;
  let work = work_area_at((anchor.left + anchor.right) / 2, (anchor.top + anchor.bottom) / 2);
  let (rect, used) = place(anchor, (width, height), placement, work, GAP, MARGIN);
  let key = hwnd.0 as isize;
  let first = with_open(|o| o.insert(key, Open { anchor, placement, radius: radius.unwrap_or(0) }).is_none());
  unsafe {
    // Idempotent: attaching twice only replaces the same subclass.
    let _ = SetWindowSubclass(hwnd, Some(subclass_proc), SUBCLASS_ID, 0);
  }
  apply(hwnd, rect, radius.unwrap_or(0));
  // Always make sure it is visible: the open-state table can outlive a hidden window, and a popup that
  // is placed but never shown is exactly the 'nothing opens' failure.
  let _ = first;
  // Shown with the system call, not the window library's `show()`: a popup dismissed on focus loss is
  // hidden natively (below), the library's own idea of 'visible' is then stale, and its `show()` would
  // do nothing, so no popup would ever open again after the first dismissal.
  unsafe {
    use windows::Win32::UI::WindowsAndMessaging::{ShowWindow, SW_SHOW, SW_SHOWNOACTIVATE};
    // A tooltip must never take focus from what the user is working in.
    let _ = ShowWindow(hwnd, if focus.unwrap_or(true) { SW_SHOW } else { SW_SHOWNOACTIVATE });
  }
  super::trace::line(&format!("popup open at {},{} {}x{}", rect.left, rect.top, rect.width(), rect.height()));
  if focus.unwrap_or(true) {
    let _ = window.set_focus();
  }
  Ok((rect, used))
}

/// The popup's content changed size: keep it anchored where it was, moving and resizing in
/// one call (no frame at the old size or place).
#[tauri::command]
pub fn engine_popup_resize(window: tauri::WebviewWindow, width: i32, height: i32) -> Result<Option<Rect>, String> {
  let hwnd = window.hwnd().map_err(|e| e.to_string())?;
  let Some((anchor, placement, radius)) = with_open(|o| o.get(&(hwnd.0 as isize)).map(|s| (s.anchor, s.placement, s.radius))) else {
    return Ok(None);
  };
  let work = work_area_at((anchor.left + anchor.right) / 2, (anchor.top + anchor.bottom) / 2);
  let (rect, _) = place(anchor, (width, height), placement, work, GAP, MARGIN);
  apply(hwnd, rect, radius);
  Ok(Some(rect))
}

/// Hides the popup.
#[tauri::command]
pub fn engine_popup_close(window: tauri::WebviewWindow) -> Result<(), String> {
  let hwnd = window.hwnd().map_err(|e| e.to_string())?;
  with_open(|o| o.remove(&(hwnd.0 as isize)));
  window.hide().map_err(|e| e.to_string())
}


// ---------------------------------------------------------------------------------------
// Click-away: a click anywhere outside an open popup closes it
// ---------------------------------------------------------------------------------------

static WATCH_GEN: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

/// While a popup is open, watches the mouse buttons: the first press outside the popup's window
/// (on the desktop, another app, the bar...) is announced as `engine://popup-outside` and the watch
/// ends. A window-focus signal is not enough: clicking the desktop, which never takes focus, would
/// leave the popup open. The thread exists only while a popup is open and wakes every 20 ms.
#[tauri::command]
pub fn engine_popup_watch(app: AppHandle, window: tauri::WebviewWindow, on: bool) -> Result<(), String> {
  use std::sync::atomic::Ordering;
  use windows::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON, VK_MBUTTON, VK_RBUTTON};
  use windows::Win32::UI::WindowsAndMessaging::{GetCursorPos, GetWindowRect};
  let gen = WATCH_GEN.fetch_add(1, Ordering::SeqCst) + 1;
  if !on {
    return Ok(());
  }
  let h = window.hwnd().map_err(|e| e.to_string())?.0 as isize;
  std::thread::Builder::new()
    .name("popup-watch".into())
    .spawn(move || {
      let down = || unsafe { [VK_LBUTTON, VK_RBUTTON, VK_MBUTTON].iter().any(|k| (GetAsyncKeyState(k.0 as i32) as u16) & 0x8000 != 0) };
      // A button already held (the click that opened the popup) must not count.
      let mut was_down = true;
      let started = std::time::Instant::now();
      loop {
        std::thread::sleep(std::time::Duration::from_millis(20));
        if WATCH_GEN.load(Ordering::SeqCst) != gen || started.elapsed() > std::time::Duration::from_secs(600) {
          return;
        }
        let now = down();
        if now && !was_down {
          let mut p = POINT::default();
          let mut r = windows::Win32::Foundation::RECT::default();
          unsafe {
            let _ = GetCursorPos(&mut p);
            let _ = GetWindowRect(HWND(h as *mut core::ffi::c_void), &mut r);
          }
          let inside = p.x >= r.left && p.x < r.right && p.y >= r.top && p.y < r.bottom;
          if !inside {
            super::trace::line("popup click-away");
            let _ = app.emit("engine://popup-outside", ());
            return;
          }
        }
        was_down = now;
      }
    })
    .map_err(|e| e.to_string())?;
  Ok(())
}

/// Cuts the calling window to a rounded rectangle of its current size, so the compositor's blur
/// follows the card's corners instead of filling a square. Call again after any resize.
#[tauri::command]
pub fn engine_window_round(window: tauri::WebviewWindow, radius: i32) -> Result<(), String> {
  use windows::Win32::UI::WindowsAndMessaging::GetWindowRect;
  let hwnd = window.hwnd().map_err(|e| e.to_string())?;
  let mut r = windows::Win32::Foundation::RECT::default();
  unsafe {
    let _ = GetWindowRect(hwnd, &mut r);
    let dpi = windows::Win32::UI::HiDpi::GetDpiForWindow(hwnd).max(96) as i32;
    let d = (radius.max(0) * dpi / 96) * 2;
    // A window with a region falls back to the classic frame (a title bar with buttons) unless it has
    // no caption or border at all, so make sure it has none, and do not force a redraw of the frame.
    use windows::Win32::UI::WindowsAndMessaging::{
      GetWindowLongW, SetWindowLongW, SetWindowPos, GWL_STYLE, SWP_FRAMECHANGED, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER, WS_BORDER, WS_CAPTION, WS_DLGFRAME, WS_MAXIMIZEBOX, WS_MINIMIZEBOX, WS_SYSMENU, WS_THICKFRAME,
    };
    let style = GetWindowLongW(hwnd, GWL_STYLE) as u32;
    let strip = WS_CAPTION.0 | WS_BORDER.0 | WS_DLGFRAME.0 | WS_THICKFRAME.0 | WS_SYSMENU.0 | WS_MINIMIZEBOX.0 | WS_MAXIMIZEBOX.0;
    if style & strip != 0 {
      SetWindowLongW(hwnd, GWL_STYLE, (style & !strip) as i32);
      let _ = SetWindowPos(hwnd, None, 0, 0, 0, 0, SWP_FRAMECHANGED | SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE);
    }
    let rgn = CreateRoundRectRgn(0, 0, (r.right - r.left) + 1, (r.bottom - r.top) + 1, d, d);
    let _ = SetWindowRgn(hwnd, Some(rgn), false);
  }
  Ok(())
}

#[cfg(test)]
mod tests {
  use super::*;

  const WORK: Rect = Rect { left: 0, top: 34, right: 1920, bottom: 1010 };
  fn r(l: i32, t: i32, rr: i32, b: i32) -> Rect {
    Rect { left: l, top: t, right: rr, bottom: b }
  }

  #[test]
  fn below_the_menu_bar_when_there_is_room() {
    let menu_item = r(1700, 0, 1740, 34);
    let (p, used) = place(menu_item, (300, 400), Placement::Below, WORK, 6, 8);
    assert_eq!(used, Placement::Below);
    // The 6 px gap would put it at 40, but the 8 px margin from the work area's edge wins.
    assert_eq!(p.top, 34 + 8);
    assert_eq!(p.height(), 400);
    assert!(p.right <= WORK.right - 8, "kept clear of the right edge");
  }

  #[test]
  fn flips_above_when_there_is_no_room_below() {
    let dock_icon = r(900, 990, 960, 1050);
    let (p, used) = place(dock_icon, (300, 400), Placement::Below, WORK, 6, 8);
    assert_eq!(used, Placement::Above);
    assert_eq!(p.bottom, 990 - 6);
  }

  #[test]
  fn above_flips_below_when_there_is_no_room_above() {
    let near_top = r(900, 40, 960, 70);
    let (p, used) = place(near_top, (300, 800), Placement::Above, WORK, 6, 8);
    assert_eq!(used, Placement::Below);
    assert!(p.top >= 70);
  }

  #[test]
  fn clamps_horizontally_at_the_screen_edge() {
    let corner = r(1880, 0, 1920, 34);
    let (p, _) = place(corner, (300, 200), Placement::Below, WORK, 6, 8);
    assert_eq!(p.right, 1920 - 8);
    assert_eq!(p.width(), 300);
  }

  #[test]
  fn a_context_menu_flips_up_and_left_at_the_corner() {
    let click = r(1900, 1000, 1900, 1000);
    let (p, used) = place(click, (200, 300), Placement::Point, WORK, 6, 8);
    assert_eq!(used, Placement::Point);
    assert_eq!(p.right, 1900, "flipped left of the click");
    assert_eq!(p.bottom, 1000, "flipped above the click");
    // and left alone when there is room
    let (q, _) = place(r(100, 100, 100, 100), (200, 300), Placement::Point, WORK, 6, 8);
    assert_eq!((q.left, q.top), (100, 100));
  }

  #[test]
  fn a_sheet_fills_the_height_of_the_work_area_on_the_right() {
    let (p, _) = place(r(0, 0, 0, 0), (380, 100), Placement::SheetRight, WORK, 6, 8);
    assert_eq!(p.right, 1920 - 8);
    assert_eq!((p.top, p.bottom), (34 + 8, 1010 - 8));
  }

  #[test]
  fn a_popup_bigger_than_the_screen_is_shrunk_to_fit() {
    let (p, _) = place(r(900, 0, 960, 34), (5000, 5000), Placement::Below, WORK, 6, 8);
    assert!(p.width() <= WORK.width() - 16);
    assert!(p.height() <= WORK.height() - 16);
    assert!(p.left >= WORK.left + 8 && p.top >= WORK.top + 8);
  }

  #[test]
  fn works_on_a_second_monitor_with_an_offset_work_area() {
    let second = r(1920, 0, 3840, 1040);
    let anchor = r(3800, 1000, 3840, 1040);
    let (p, used) = place(anchor, (300, 300), Placement::Below, second, 6, 8);
    assert_eq!(used, Placement::Above);
    assert!(p.left >= 1920 + 8 && p.right <= 3840 - 8);
    assert!(p.bottom <= anchor.top);
  }

  #[test]
  fn beside_the_anchor_flips_to_the_left_at_the_right_edge() {
    let item = r(1850, 400, 1910, 440);
    let (p, used) = place(item, (300, 200), Placement::Right, WORK, 6, 8);
    assert_eq!(used, Placement::Left);
    assert_eq!(p.right, 1850 - 6);
  }
}
