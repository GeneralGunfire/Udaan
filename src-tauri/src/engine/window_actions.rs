//! Window actions: everything the shell does *to* other programs' windows.
//!
//! Focus a window (even though Windows only lets the foreground process hand focus away), minimise,
//! maximise, close, snap into a zone of the work area, hide or unhide a batch (virtual desktops),
//! show the desktop and bring it back, and report a window's size and icon.
//!
//! This replaces the raw-pointer code that lived inside the old shell module. The Win32 calls go
//! through the typed `windows` bindings, and the parts that are really arithmetic (where a snap
//! zone lands, compensating for the invisible resize border, whether a window covers a monitor) are
//! pure functions with tests. The command names are unchanged, so nothing that calls them changes.

use super::geometry::Rect;
use serde::Deserialize;
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::AppHandle;
use windows::Win32::Foundation::{HWND, LPARAM, RECT, WPARAM};
use windows::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_EXTENDED_FRAME_BOUNDS};
use windows::Win32::Graphics::Gdi::{GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST};
use windows::Win32::System::Threading::{AttachThreadInput, GetCurrentThreadId};
use windows::Win32::UI::Input::KeyboardAndMouse::{SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYBD_EVENT_FLAGS, KEYEVENTF_KEYUP, VK_MENU, VIRTUAL_KEY};
use windows::Win32::UI::WindowsAndMessaging::{
  BringWindowToTop, GetClassNameW, GetForegroundWindow, GetWindowPlacement, GetWindowRect, GetWindowThreadProcessId, IsIconic, IsWindow, IsZoomed,
  PostMessageW, SetForegroundWindow, SetWindowPos, ShowWindow, SWP_NOACTIVATE, SWP_NOZORDER, SW_HIDE, SW_MAXIMIZE, SW_MINIMIZE, SW_RESTORE,
  SW_SHOWNOACTIVATE, WINDOWPLACEMENT, WM_CLOSE,
};

fn hw(h: isize) -> HWND {
  HWND(h as *mut core::ffi::c_void)
}

// ---------------------------------------------------------------------------------------
// Pure geometry
// ---------------------------------------------------------------------------------------

/// A fraction of a monitor's work area: x, y, width and height, each 0 to 1.
#[derive(Debug, Clone, Copy, Deserialize)]
pub struct Zone {
  pub x: f64,
  pub y: f64,
  pub w: f64,
  pub h: f64,
}

/// Where a snap zone lands inside a work area, in pixels. Edges are rounded individually (not
/// position-plus-size) so two neighbouring zones meet exactly with no gap or overlap.
pub fn zone_rect(work: Rect, z: Zone) -> Rect {
  let (ww, wh) = (work.width() as f64, work.height() as f64);
  Rect {
    left: work.left + (z.x * ww).round() as i32,
    top: work.top + (z.y * wh).round() as i32,
    right: work.left + ((z.x + z.w) * ww).round() as i32,
    bottom: work.top + ((z.y + z.h) * wh).round() as i32,
  }
}

/// Windows draws an invisible resize border around most windows, so the rectangle you set and the
/// edges you see differ. To make the VISIBLE edges land on `target`, grow the rectangle you set by
/// the border (the gap between the full window rectangle and the visible frame) on each side.
pub fn compensate_border(target: Rect, outer: Rect, frame: Rect) -> Rect {
  let (l, t, r, b) = (frame.left - outer.left, frame.top - outer.top, outer.right - frame.right, outer.bottom - frame.bottom);
  Rect { left: target.left - l, top: target.top - t, right: target.right + r, bottom: target.bottom + b }
}

/// Whether a window's rectangle covers a whole monitor (a game, a video, a full-screen browser).
pub fn covers_monitor_rect(window: Rect, monitor: Rect) -> bool {
  window.covers(&monitor)
}

// ---------------------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------------------

pub fn foreground() -> isize {
  unsafe { GetForegroundWindow().0 as isize }
}

/// The full area and the work area of the monitor a window is on.
pub fn monitor_rects(h: isize) -> Result<(Rect, Rect), String> {
  unsafe {
    let mon = MonitorFromWindow(hw(h), MONITOR_DEFAULTTONEAREST);
    let mut mi = MONITORINFO { cbSize: std::mem::size_of::<MONITORINFO>() as u32, ..Default::default() };
    if !GetMonitorInfoW(mon, &mut mi).as_bool() {
      return Err("GetMonitorInfoW failed".into());
    }
    Ok((mi.rcMonitor.into(), mi.rcWork.into()))
  }
}

fn class_is(h: HWND, names: &[&str]) -> bool {
  let mut buf = [0u16; 64];
  let n = unsafe { GetClassNameW(h, &mut buf) };
  if n <= 0 {
    return false;
  }
  let class = String::from_utf16_lossy(&buf[..n as usize]);
  names.iter().any(|c| *c == class)
}

/// True if the window fills its whole monitor, other than Explorer's own desktop windows.
pub fn covers_monitor(h: isize) -> bool {
  let hwnd = hw(h);
  unsafe {
    if IsIconic(hwnd).as_bool() || class_is(hwnd, &["Progman", "WorkerW"]) {
      return false;
    }
    let mut r = RECT::default();
    if GetWindowRect(hwnd, &mut r).is_err() {
      return false;
    }
    match monitor_rects(h) {
      Ok((m, _)) => covers_monitor_rect(r.into(), m),
      Err(_) => false,
    }
  }
}

/// A window's restored ("normal") size, valid even while minimised, so previews keep the right
/// aspect ratio.
pub fn normal_size(h: isize) -> Option<(i32, i32)> {
  let hwnd = hw(h);
  unsafe {
    if IsZoomed(hwnd).as_bool() {
      let mut r = RECT::default();
      if GetWindowRect(hwnd, &mut r).is_ok() {
        return Some((r.right - r.left, r.bottom - r.top));
      }
    }
    let mut wp = WINDOWPLACEMENT { length: std::mem::size_of::<WINDOWPLACEMENT>() as u32, ..Default::default() };
    GetWindowPlacement(hwnd, &mut wp).ok()?;
    let r = wp.rcNormalPosition;
    Some((r.right - r.left, r.bottom - r.top))
  }
}

// ---------------------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------------------

/// Presses and releases a virtual key (a synthetic keystroke).
pub fn tap_virtual_key(vk: u16) {
  tap_key(VIRTUAL_KEY(vk));
}

fn tap_key(vk: VIRTUAL_KEY) {
  let key = |flags: KEYBD_EVENT_FLAGS| INPUT {
    r#type: INPUT_KEYBOARD,
    Anonymous: INPUT_0 { ki: KEYBDINPUT { wVk: vk, wScan: 0, dwFlags: flags, time: 0, dwExtraInfo: 0 } },
  };
  let inputs = [key(KEYBD_EVENT_FLAGS(0)), key(KEYEVENTF_KEYUP)];
  unsafe {
    SendInput(&inputs, std::mem::size_of::<INPUT>() as i32);
  }
}

/// Brings a window to the front. Windows only lets the foreground process hand focus away; from a
/// background process a plain `SetForegroundWindow` just flashes the taskbar button. So escalate:
/// the plain call, then attach to the foreground thread's input queue, then a synthetic Alt tap
/// (which counts as user input and lifts the foreground lock).
pub fn force_foreground(h: isize) -> Result<(), String> {
  let hwnd = hw(h);
  unsafe {
    if !IsWindow(Some(hwnd)).as_bool() {
      return Err("That window has closed.".into());
    }
    if IsIconic(hwnd).as_bool() {
      let _ = ShowWindow(hwnd, SW_RESTORE);
    }
    if SetForegroundWindow(hwnd).as_bool() && GetForegroundWindow() == hwnd {
      return Ok(());
    }
    let fg = GetForegroundWindow();
    let fg_thread = GetWindowThreadProcessId(fg, None);
    let me = GetCurrentThreadId();
    if fg_thread != 0 && fg_thread != me {
      let _ = AttachThreadInput(me, fg_thread, true);
      let _ = BringWindowToTop(hwnd);
      let _ = SetForegroundWindow(hwnd);
      let _ = AttachThreadInput(me, fg_thread, false);
    }
    if GetForegroundWindow() != hwnd {
      tap_key(VK_MENU);
      let _ = SetForegroundWindow(hwnd);
    }
    if GetForegroundWindow() == hwnd {
      Ok(())
    } else {
      Err("Windows refused to bring that window forward.".into())
    }
  }
}

/// How to change a window's visibility.
#[derive(Clone, Copy)]
pub enum Show {
  Minimize,
  Restore,
  /// Fully hidden: not in Alt+Tab, not on the taskbar. Used for virtual desktops, where a window
  /// parked on another desktop is hidden, not minimised, so bringing it back doesn't look like
  /// "unminimising".
  Hide,
  /// Un-hides a window hidden with `Hide`, without activating it, so switching desktops does not
  /// steal focus (the right window is focused explicitly afterwards).
  Unhide,
}

pub fn set_show(h: isize, how: Show) {
  let cmd = match how {
    Show::Minimize => SW_MINIMIZE,
    Show::Restore => SW_RESTORE,
    Show::Hide => SW_HIDE,
    Show::Unhide => SW_SHOWNOACTIVATE,
  };
  unsafe {
    let _ = ShowWindow(hw(h), cmd);
  }
}

pub fn toggle_maximize(h: isize) {
  let hwnd = hw(h);
  unsafe {
    let _ = ShowWindow(hwnd, if IsZoomed(hwnd).as_bool() { SW_RESTORE } else { SW_MAXIMIZE });
  }
}

/// Moves and resizes in one call, so the window never shows an in-between frame.
pub fn set_rect(h: isize, r: Rect) {
  unsafe {
    let _ = SetWindowPos(hw(h), None, r.left, r.top, r.width(), r.height(), SWP_NOZORDER | SWP_NOACTIVATE);
  }
}

/// Asks the window to close itself with `WM_CLOSE`, as its own close button would. Posted (not
/// sent) so an unresponsive app can never block us, and the app still gets to ask "save changes?".
pub fn close(h: isize) -> Result<(), String> {
  unsafe { PostMessageW(Some(hw(h)), WM_CLOSE, WPARAM(0), LPARAM(0)) }.map_err(|_| "Could not close that window; it may have already closed.".to_string())
}

/// Moves a window into a zone of its monitor's work area (Snap Layouts), restoring it first if it
/// is maximised or minimised, with the invisible border compensated so snapped windows meet edge to
/// edge.
pub fn snap(h: isize, z: Zone) -> Result<(), String> {
  let hwnd = hw(h);
  unsafe {
    if IsZoomed(hwnd).as_bool() || IsIconic(hwnd).as_bool() {
      let _ = ShowWindow(hwnd, SW_RESTORE);
    }
    let (_, work) = monitor_rects(h)?;
    let target = zone_rect(work, z);
    let mut outer = RECT::default();
    let mut frame = RECT::default();
    let _ = GetWindowRect(hwnd, &mut outer);
    let have_frame = DwmGetWindowAttribute(hwnd, DWMWA_EXTENDED_FRAME_BOUNDS, &mut frame as *mut RECT as *mut _, std::mem::size_of::<RECT>() as u32).is_ok();
    let r = if have_frame { compensate_border(target, outer.into(), frame.into()) } else { target };
    SetWindowPos(hwnd, None, r.left, r.top, r.width(), r.height(), SWP_NOZORDER | SWP_NOACTIVATE).map_err(|_| "Couldn't move that window.".to_string())
  }
}

// ---------------------------------------------------------------------------------------
// Show desktop
// ---------------------------------------------------------------------------------------

static DESKTOP_STASH: Mutex<Vec<isize>> = Mutex::new(Vec::new());

/// What "show desktop" should do, given which windows are open and what was stashed last time.
#[derive(Debug, PartialEq, Eq)]
pub enum DesktopAction {
  /// Minimise these (they are remembered so they can be brought back).
  Minimise(Vec<isize>),
  /// Restore these, newest first.
  Restore(Vec<isize>),
}

/// Win+D semantics: if any window is showing, minimise them all and remember which; if none are
/// (and nothing was restored by hand in between), bring back exactly those.
pub fn plan_show_desktop(windows: &[(isize, bool)], stash: &[isize]) -> DesktopAction {
  let visible: Vec<isize> = windows.iter().filter(|(_, minimised)| !minimised).map(|(h, _)| *h).collect();
  if visible.is_empty() {
    DesktopAction::Restore(stash.iter().rev().copied().collect())
  } else {
    DesktopAction::Minimise(visible)
  }
}

// ---------------------------------------------------------------------------------------
// Commands (names unchanged)
// ---------------------------------------------------------------------------------------

/// Each window's restored size in physical pixels.
#[tauri::command]
pub fn shell_window_sizes(handles: Vec<isize>) -> HashMap<isize, (i32, i32)> {
  handles.into_iter().filter_map(|h| normal_size(h).map(|s| (h, s))).collect()
}

/// A window's own icon (WM_GETICON), for programs with no readable exe icon.
#[tauri::command]
pub async fn shell_window_icons(handles: Vec<isize>) -> HashMap<isize, Option<String>> {
  tauri::async_runtime::spawn_blocking(move || handles.into_iter().map(|h| (h, crate::engine::windowlist::win::cached_icon(h as _))).collect())
    .await
    .unwrap_or_default()
}

#[tauri::command]
pub fn shell_snap_window(handle: isize, zone: Zone) -> Result<(), String> {
  snap(handle, zone)
}

/// Snaps the calling window (Udaan's app windows don't know their own handle).
#[tauri::command]
pub fn shell_snap_self(window: tauri::WebviewWindow, zone: Zone) -> Result<(), String> {
  snap(window.hwnd().map_err(|e| e.to_string())?.0 as isize, zone)
}

#[tauri::command]
pub fn shell_focus_window(handle: isize) -> Result<(), String> {
  force_foreground(handle)
}

#[tauri::command]
pub fn shell_minimize_window(handle: isize) -> Result<(), String> {
  set_show(handle, Show::Minimize);
  Ok(())
}

/// Virtual desktops: hides and shows a batch of real windows by handle in one call. `focus_after` is
/// brought to the front once the shown set is visible, so switching desktops restores whichever
/// window was focused there last.
#[tauri::command]
pub fn shell_set_windows_hidden(hide: Vec<isize>, show: Vec<isize>, focus_after: Option<isize>) -> Result<(), String> {
  for h in hide {
    set_show(h, Show::Hide);
  }
  for h in &show {
    set_show(*h, Show::Unhide);
  }
  if let Some(h) = focus_after {
    let _ = force_foreground(h);
  }
  Ok(())
}

#[tauri::command]
pub fn shell_toggle_maximize_window(handle: isize) -> Result<(), String> {
  toggle_maximize(handle);
  Ok(())
}

#[tauri::command]
pub fn shell_close_window(handle: isize) -> Result<(), String> {
  close(handle)
}

/// Win+D: the first call minimises every app window and remembers them; the next brings exactly
/// those back. Returns true if it minimised.
#[tauri::command]
pub fn shell_toggle_desktop(app: AppHandle) -> Result<bool, String> {
  let snap = super::tracker::snapshot(&app);
  let windows: Vec<(isize, bool)> = snap.windows.iter().map(|w| (w.handle, w.is_minimized)).collect();
  let mut stash = DESKTOP_STASH.lock().unwrap_or_else(|e| e.into_inner());
  match plan_show_desktop(&windows, &stash) {
    DesktopAction::Minimise(list) => {
      stash.clear();
      for h in list {
        stash.push(h);
        set_show(h, Show::Minimize);
      }
      Ok(true)
    }
    DesktopAction::Restore(list) => {
      stash.clear();
      for h in list {
        set_show(h, Show::Restore);
      }
      Ok(false)
    }
  }
}

/// Places the calling window at an exact rectangle in one call.
#[tauri::command]
pub fn shell_set_window_rect(window: tauri::WebviewWindow, x: i32, y: i32, w: i32, h: i32) -> Result<(), String> {
  set_rect(window.hwnd().map_err(|e| e.to_string())?.0 as isize, Rect { left: x, top: y, right: x + w, bottom: y + h });
  Ok(())
}

/// The full area and work area of the monitor the calling window is on.
#[tauri::command]
pub fn shell_monitor_of(window: tauri::WebviewWindow) -> Result<(Rect, Rect), String> {
  monitor_rects(window.hwnd().map_err(|e| e.to_string())?.0 as isize)
}

#[cfg(test)]
mod tests {
  use super::*;

  const WORK: Rect = Rect { left: 0, top: 34, right: 1920, bottom: 1010 };

  #[test]
  fn zones_land_inside_the_work_area_and_neighbours_meet_exactly() {
    let left = zone_rect(WORK, Zone { x: 0.0, y: 0.0, w: 0.5, h: 1.0 });
    let right = zone_rect(WORK, Zone { x: 0.5, y: 0.0, w: 0.5, h: 1.0 });
    assert_eq!((left.left, left.top, left.bottom), (0, 34, 1010));
    assert_eq!(left.right, right.left, "no gap and no overlap between neighbours");
    assert_eq!(right.right, 1920);
    // an odd split still meets exactly (rounding each edge, not position plus size)
    let third = zone_rect(WORK, Zone { x: 0.0, y: 0.0, w: 1.0 / 3.0, h: 1.0 });
    let rest = zone_rect(WORK, Zone { x: 1.0 / 3.0, y: 0.0, w: 2.0 / 3.0, h: 1.0 });
    assert_eq!(third.right, rest.left);
  }

  #[test]
  fn the_invisible_border_is_compensated_so_visible_edges_land_on_target() {
    // a window whose rectangle is 7 px bigger than its visible frame on the left, right and bottom
    let outer = Rect { left: 100, top: 100, right: 807, bottom: 607 };
    let frame = Rect { left: 107, top: 100, right: 800, bottom: 600 };
    let target = Rect { left: 0, top: 34, right: 960, bottom: 1010 };
    let set = compensate_border(target, outer, frame);
    assert_eq!(set, Rect { left: -7, top: 34, right: 967, bottom: 1017 });
    // with no border (frame == outer) the target is used as is
    assert_eq!(compensate_border(target, outer, outer), target);
  }

  #[test]
  fn a_window_covering_its_monitor_is_full_screen() {
    let mon = Rect { left: 0, top: 0, right: 1920, bottom: 1080 };
    assert!(covers_monitor_rect(mon, mon));
    assert!(covers_monitor_rect(Rect { left: -8, top: -8, right: 1928, bottom: 1088 }, mon), "a maximised frame overhangs");
    assert!(!covers_monitor_rect(Rect { left: 0, top: 34, right: 1920, bottom: 1080 }, mon), "below a menu bar is not full screen");
  }

  #[test]
  fn show_desktop_minimises_what_is_visible_then_restores_those_newest_first() {
    // two showing, one already minimised: minimise the two
    let open = [(1, false), (2, true), (3, false)];
    assert_eq!(plan_show_desktop(&open, &[]), DesktopAction::Minimise(vec![1, 3]));
    // everything minimised: bring back what was stashed, in reverse
    let all_min = [(1, true), (3, true)];
    assert_eq!(plan_show_desktop(&all_min, &[1, 3]), DesktopAction::Restore(vec![3, 1]));
    // nothing open and nothing stashed: nothing to do
    assert_eq!(plan_show_desktop(&[], &[]), DesktopAction::Restore(vec![]));
  }

  #[test]
  fn this_pc_has_a_foreground_window_and_monitor_geometry() {
    let fg = foreground();
    assert_ne!(fg, 0, "there is a foreground window on a real desktop");
    let (m, w) = monitor_rects(fg).unwrap();
    assert!(m.covers(&w), "the work area lies within the monitor");
  }
}
