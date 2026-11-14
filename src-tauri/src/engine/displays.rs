//! The monitors: an accurate model of what is plugged in, and a notice when it changes.
//!
//! Everything else in the engine used to assume one monitor (the primary), found by asking
//! "which monitor is this window nearest" at the moment it needed an answer. This is the one
//! place that knows the whole layout: each monitor's full area, its work area (minus bars), its
//! scale, and which is primary. Bars already bind to whichever monitor their window is on
//! (see [`super::edges`]), so with this the UI can place one on every monitor and follow a
//! monitor being plugged in or removed.

use super::popup::Rect;
use serde::Serialize;
use std::sync::OnceLock;
use tauri::{AppHandle, Emitter};
use windows::core::BOOL;
use windows::Win32::Foundation::{LPARAM, RECT};
use windows::Win32::Graphics::Gdi::{EnumDisplayMonitors, GetMonitorInfoW, HDC, HMONITOR, MONITORINFO, MONITORINFOEXW};
use windows::Win32::UI::HiDpi::{GetDpiForMonitor, MDT_EFFECTIVE_DPI};

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Display {
  /// The system's name for it, such as `\.\DISPLAY1`. Stable while the monitor stays plugged in.
  pub id: String,
  pub primary: bool,
  /// The whole monitor, in virtual-screen pixels.
  pub rect: Rect,
  /// The area windows may use (the monitor minus the dock and menu bar).
  pub work: Rect,
  pub dpi: u32,
  /// 1.0 at 100%, 1.5 at 150%, and so on.
  pub scale: f32,
}

pub fn scale_from_dpi(dpi: u32) -> f32 {
  dpi as f32 / 96.0
}

fn to_rect(r: RECT) -> Rect {
  Rect { left: r.left, top: r.top, right: r.right, bottom: r.bottom }
}

unsafe extern "system" fn collect(mon: HMONITOR, _dc: HDC, _rc: *mut RECT, data: LPARAM) -> BOOL {
  let out = &mut *(data.0 as *mut Vec<Display>);
  let mut info = MONITORINFOEXW::default();
  info.monitorInfo.cbSize = std::mem::size_of::<MONITORINFOEXW>() as u32;
  if GetMonitorInfoW(mon, &mut info as *mut MONITORINFOEXW as *mut MONITORINFO).as_bool() {
    let (mut dx, mut dy) = (96u32, 96u32);
    let _ = GetDpiForMonitor(mon, MDT_EFFECTIVE_DPI, &mut dx, &mut dy);
    let len = info.szDevice.iter().position(|c| *c == 0).unwrap_or(info.szDevice.len());
    out.push(Display {
      id: String::from_utf16_lossy(&info.szDevice[..len]),
      primary: info.monitorInfo.dwFlags & 1 != 0, // MONITORINFOF_PRIMARY
      rect: to_rect(info.monitorInfo.rcMonitor),
      work: to_rect(info.monitorInfo.rcWork),
      dpi: dx,
      scale: scale_from_dpi(dx),
    });
  }
  BOOL(1)
}

/// Every monitor, primary first, then left to right.
pub fn list() -> Vec<Display> {
  let mut out: Vec<Display> = Vec::new();
  unsafe {
    let _ = EnumDisplayMonitors(None, None, Some(collect), LPARAM(&mut out as *mut _ as isize));
  }
  out.sort_by_key(|d| (!d.primary, d.rect.left, d.rect.top));
  out
}

static APP: OnceLock<AppHandle> = OnceLock::new();

pub fn init(app: &AppHandle) {
  let _ = APP.set(app.clone());
}

/// The layout changed: tell every window the new one.
pub fn announce() {
  if let Some(app) = APP.get() {
    let _ = app.emit("displays://changed", list());
  }
}

/// The monitors, for windows that need to place themselves.
#[tauri::command(async)]
pub fn displays_list() -> Vec<Display> {
  list()
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn scale_is_dpi_over_96() {
    assert_eq!(scale_from_dpi(96), 1.0);
    assert_eq!(scale_from_dpi(144), 1.5);
    assert_eq!(scale_from_dpi(192), 2.0);
  }

  #[test]
  fn this_pc_reports_exactly_one_primary_monitor_with_a_sane_layout() {
    let d = list();
    assert!(!d.is_empty(), "at least one monitor");
    assert_eq!(d.iter().filter(|x| x.primary).count(), 1);
    assert!(d[0].primary, "the primary comes first");
    for m in &d {
      assert!(m.rect.width() > 0 && m.rect.height() > 0);
      assert!(m.work.left >= m.rect.left && m.work.right <= m.rect.right && m.work.top >= m.rect.top && m.work.bottom <= m.rect.bottom, "the work area lies inside the monitor");
      assert!(m.scale >= 1.0);
      assert!(!m.id.is_empty());
    }
  }
}
