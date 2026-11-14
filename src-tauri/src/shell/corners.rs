//! Hot corners: resting the pointer in a screen corner fires an action.
//! Polls GetCursorPos natively (no IPC) and only emits when a corner is hit.

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

static ENABLED: AtomicBool = AtomicBool::new(false);
static STARTED: AtomicBool = AtomicBool::new(false);

const POLL: Duration = Duration::from_millis(60);
const DWELL: Duration = Duration::from_millis(140);

#[cfg(target_os = "windows")]
fn sample() -> Option<&'static str> {
  use windows_sys::Win32::Foundation::POINT;
  use windows_sys::Win32::Graphics::Gdi::{GetMonitorInfoW, MonitorFromPoint, MONITORINFO, MONITOR_DEFAULTTONEAREST};
  use windows_sys::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON, VK_RBUTTON};
  use windows_sys::Win32::UI::WindowsAndMessaging::GetCursorPos;
  unsafe {
    // Never while dragging something.
    if GetAsyncKeyState(VK_LBUTTON as i32) < 0 || GetAsyncKeyState(VK_RBUTTON as i32) < 0 {
      return None;
    }
    let mut p = POINT { x: 0, y: 0 };
    if GetCursorPos(&mut p) == 0 {
      return None;
    }
    let mon = MonitorFromPoint(p, MONITOR_DEFAULTTONEAREST);
    let mut mi: MONITORINFO = std::mem::zeroed();
    mi.cbSize = std::mem::size_of::<MONITORINFO>() as u32;
    if GetMonitorInfoW(mon, &mut mi) == 0 {
      return None;
    }
    let r = mi.rcMonitor;
    let left = p.x <= r.left;
    let right = p.x >= r.right - 1;
    let top = p.y <= r.top;
    let bottom = p.y >= r.bottom - 1;
    match (left, right, top, bottom) {
      (true, _, true, _) => Some("corner-tl"),
      (_, true, true, _) => Some("corner-tr"),
      (true, _, _, true) => Some("corner-bl"),
      (_, true, _, true) => Some("corner-br"),
      _ => None,
    }
  }
}

#[cfg(not(target_os = "windows"))]
fn sample() -> Option<&'static str> {
  None
}

pub fn set_enabled(enabled: bool) {
  ENABLED.store(enabled, Ordering::Relaxed);
  if !enabled || STARTED.swap(true, Ordering::Relaxed) {
    return;
  }
  std::thread::Builder::new()
    .name("udaan-hot-corners".into())
    .spawn(|| {
      let mut current: Option<(&'static str, Instant)> = None;
      let mut fired = false;
      loop {
        std::thread::sleep(POLL);
        if !ENABLED.load(Ordering::Relaxed) {
          current = None;
          continue;
        }
        let hit = sample();
        match (hit, current) {
          (Some(c), Some((prev, since))) if c == prev => {
            if !fired && since.elapsed() >= DWELL && !crate::engine::tracker::last_is_fullscreen() {
              fired = true;
              crate::engine::keyboard::emit_hotkey(c);
            }
          }
          (Some(c), _) => {
            current = Some((c, Instant::now()));
            fired = false;
          }
          (None, _) => {
            current = None;
            fired = false;
          }
        }
      }
    })
    .expect("spawn hot corners");
}

#[tauri::command]
pub fn shell_set_hot_corners(enabled: bool) {
  set_enabled(enabled);
}
