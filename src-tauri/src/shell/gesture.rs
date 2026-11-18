//! The drag-up gesture: press near the bottom edge of the screen, drag
//! upward past the dock while holding, and the 3D window switcher opens and
//! follows the pointer until release. A low-level mouse hook watches for
//! it; the hook only records and forwards, never blocks input.
//!
//! Also captures window snapshots (PrintWindow) for the switcher's cards,
//! since live DWM thumbnails can't be transformed in 3D.

use serde::Serialize;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicI32, AtomicU32, AtomicU8, Ordering};
use std::sync::OnceLock;
use tauri::{AppHandle, Emitter};

/// Tick time (ms, same clock as the keyboard hook) of the last real mouse
/// button press, so a Ctrl+click is never mistaken for a Ctrl tap.
pub(crate) static LAST_CLICK_MS: AtomicU32 = AtomicU32::new(0);

static APP: OnceLock<AppHandle> = OnceLock::new();
static ENABLED: AtomicBool = AtomicBool::new(true);
/// 0 idle, 1 armed (pressed in the start strip), 2 active (switcher open).
static STATE: AtomicU8 = AtomicU8::new(0);
static START_Y: AtomicI32 = AtomicI32::new(0);
static LAST_EMIT: AtomicI32 = AtomicI32::new(0);
/// Whether the pointer is in the band along the bottom edge the dock cares about.
static IN_DOCK_BAND: AtomicBool = AtomicBool::new(false);
static LAST_DOCK_EMIT: AtomicI32 = AtomicI32::new(0);
/// Height of that band in physical px (set by the dock to its window height).
static DOCK_BAND: AtomicI32 = AtomicI32::new(140);

/// How close to the bottom edge the press must start (physical px).
const START_STRIP: i32 = 32;
/// How far up the drag must travel before the switcher opens, as a percent of the screen's height
/// (Settings → Window Switcher; 50 is the middle of the screen). The needed distance is worked out
/// from the monitor under the pointer when the press starts.
static RISE_PERCENT: AtomicI32 = AtomicI32::new(50);
static RISE_NEEDED: AtomicI32 = AtomicI32::new(150);

#[derive(Clone, Serialize)]
struct Point {
  x: i32,
  y: i32,
}

fn emit(event: &str, x: i32, y: i32) {
  if let Some(app) = APP.get() {
    let _ = app.emit(event, Point { x, y });
  }
}

#[cfg(target_os = "windows")]
mod imp {
  use super::*;
  use windows_sys::Win32::Foundation::{LPARAM, LRESULT, POINT, WPARAM};
  use windows_sys::Win32::Graphics::Gdi::{GetMonitorInfoW, MonitorFromPoint, MONITORINFO, MONITOR_DEFAULTTONEAREST};
  use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
  use windows_sys::Win32::UI::WindowsAndMessaging::*;

  fn monitor_bottom(p: POINT) -> i32 {
    monitor_span(p).1
  }

  /// The top and bottom of the monitor under the point.
  fn monitor_span(p: POINT) -> (i32, i32) {
    unsafe {
      let mon = MonitorFromPoint(p, MONITOR_DEFAULTTONEAREST);
      let mut mi: MONITORINFO = std::mem::zeroed();
      mi.cbSize = std::mem::size_of::<MONITORINFO>() as u32;
      if GetMonitorInfoW(mon, &mut mi) == 0 {
        return (0, i32::MAX);
      }
      (mi.rcMonitor.top, mi.rcMonitor.bottom)
    }
  }

  unsafe extern "system" fn on_mouse(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if code >= 0 && ENABLED.load(Ordering::Relaxed) {
      let info = &*(lparam as *const MSLLHOOKSTRUCT);
      // Ignore input we or other tools injected.
      if info.flags & LLMHF_INJECTED == 0 {
        let p = info.pt;
        if matches!(wparam as u32, WM_LBUTTONDOWN | WM_RBUTTONDOWN | WM_MBUTTONDOWN | WM_XBUTTONDOWN) {
          LAST_CLICK_MS.store(info.time, Ordering::Relaxed);
          // A click in the TV's player area gives that browser the keyboard.
          if crate::tv::point_in_host(p.x, p.y) {
            std::thread::spawn(crate::tv::focus_active);
          }
        }
        match wparam as u32 {
          WM_LBUTTONDOWN => {
            if p.y >= monitor_bottom(p) - START_STRIP && !crate::engine::tracker::last_is_fullscreen() {
              START_Y.store(p.y, Ordering::Relaxed);
              let (top, bottom) = monitor_span(p);
              let needed = ((bottom - top) as i64 * RISE_PERCENT.load(Ordering::Relaxed) as i64 / 100) as i32;
              RISE_NEEDED.store(needed.max(120), Ordering::Relaxed);
              STATE.store(1, Ordering::Relaxed);
            } else {
              STATE.store(0, Ordering::Relaxed);
            }
          }
          WM_MOUSEMOVE if {
            // The dock's reveal/hover tracking, pushed instead of polled:
            // positions while the pointer is near the bottom edge, and one
            // final report when it leaves.
            let bottom = monitor_bottom(p);
            let in_band = p.y >= bottom - DOCK_BAND.load(Ordering::Relaxed);
            let was = IN_DOCK_BAND.swap(in_band, Ordering::Relaxed);
            let now = (info.time & 0x7fff_ffff) as i32;
            if in_band && (!was || now - LAST_DOCK_EMIT.load(Ordering::Relaxed) >= 16) {
              LAST_DOCK_EMIT.store(now, Ordering::Relaxed);
              emit("dock://pointer", p.x, p.y);
            } else if was && !in_band {
              emit("dock://pointer", p.x, -1);
            }
            false
          } => {}
          WM_MOUSEMOVE => match STATE.load(Ordering::Relaxed) {
            1 if START_Y.load(Ordering::Relaxed) - p.y >= RISE_NEEDED.load(Ordering::Relaxed) => {
              STATE.store(2, Ordering::Relaxed);
              emit("gesture://start", p.x, p.y);
            }
            2 => {
              // ~60 Hz is plenty for the carousel.
              let now = (info.time & 0x7fff_ffff) as i32;
              if now - LAST_EMIT.load(Ordering::Relaxed) >= 15 {
                LAST_EMIT.store(now, Ordering::Relaxed);
                emit("gesture://move", p.x, p.y);
              }
            }
            _ => {}
          },
          WM_LBUTTONUP => {
            if STATE.swap(0, Ordering::Relaxed) == 2 {
              emit("gesture://end", p.x, p.y);
            }
          }
          WM_RBUTTONDOWN => {
            // Right-click while dragging cancels.
            if STATE.swap(0, Ordering::Relaxed) == 2 {
              emit("gesture://cancel", p.x, p.y);
            }
          }
          _ => {}
        }
      }
    }
    CallNextHookEx(std::ptr::null_mut(), code, wparam, lparam)
  }

  pub fn start() {
    std::thread::Builder::new()
      .name("udaan-gesture-hook".into())
      .spawn(|| unsafe {
        let hook = SetWindowsHookExW(WH_MOUSE_LL, Some(on_mouse), GetModuleHandleW(std::ptr::null()), 0);
        if hook.is_null() {
          eprintln!("[gesture] mouse hook failed");
          return;
        }
        let mut msg: MSG = std::mem::zeroed();
        while GetMessageW(&mut msg, std::ptr::null_mut(), 0, 0) > 0 {
          TranslateMessage(&msg);
          DispatchMessageW(&msg);
        }
        UnhookWindowsHookEx(hook);
      })
      .expect("spawn gesture hook");
  }

  /// A PNG data URL of the window's content, scaled to `max_w` wide.
  pub fn snapshot(h: isize, max_w: u32) -> Option<String> {
    use base64::Engine;
    use windows_sys::Win32::Foundation::RECT;
    use windows_sys::Win32::Graphics::Gdi::*;
    use windows_sys::Win32::Storage::Xps::{PrintWindow, PRINT_WINDOW_FLAGS};
    unsafe {
      let hwnd = h as windows_sys::Win32::Foundation::HWND;
      if IsIconic(hwnd) != 0 {
        return None;
      }
      let mut r: RECT = std::mem::zeroed();
      GetWindowRect(hwnd, &mut r);
      let (w, hgt) = (r.right - r.left, r.bottom - r.top);
      if w <= 0 || hgt <= 0 || w > 8000 || hgt > 8000 {
        return None;
      }
      let screen = GetDC(std::ptr::null_mut());
      let dc = CreateCompatibleDC(screen);
      let bmp = CreateCompatibleBitmap(screen, w, hgt);
      let old = SelectObject(dc, bmp);
      // PW_RENDERFULLCONTENT (2): captures GPU-composed content (browsers, WebView2).
      let ok = PrintWindow(hwnd, dc, 2 as PRINT_WINDOW_FLAGS) != 0;
      let mut info: BITMAPINFO = std::mem::zeroed();
      info.bmiHeader.biSize = std::mem::size_of::<BITMAPINFOHEADER>() as u32;
      info.bmiHeader.biWidth = w;
      info.bmiHeader.biHeight = -hgt;
      info.bmiHeader.biPlanes = 1;
      info.bmiHeader.biBitCount = 32;
      let mut buf = vec![0u8; (w * hgt * 4) as usize];
      let got = ok && GetDIBits(dc, bmp, 0, hgt as u32, buf.as_mut_ptr() as *mut _, &mut info, DIB_RGB_COLORS) != 0;
      SelectObject(dc, old);
      DeleteObject(bmp);
      DeleteDC(dc);
      ReleaseDC(std::ptr::null_mut(), screen);
      if !got {
        return None;
      }
      for px in buf.chunks_exact_mut(4) {
        px.swap(0, 2);
        px[3] = 255;
      }
      let img = image::RgbaImage::from_raw(w as u32, hgt as u32, buf)?;
      let scale = (max_w as f32 / w as f32).min(1.0);
      let img = image::imageops::resize(&img, ((w as f32 * scale) as u32).max(1), ((hgt as f32 * scale) as u32).max(1), image::imageops::FilterType::Triangle);
      let mut out = std::io::Cursor::new(Vec::new());
      image::DynamicImage::ImageRgba8(img).to_rgb8().write_to(&mut out, image::ImageFormat::Jpeg).ok()?;
      Some(format!("data:image/jpeg;base64,{}", base64::engine::general_purpose::STANDARD.encode(out.into_inner())))
    }
  }
}

pub fn start(app: AppHandle) {
  if APP.set(app).is_err() {
    return;
  }
  #[cfg(target_os = "windows")]
  imp::start();
}

/// The dock tells the hook how tall a band along the bottom it needs reports for.
#[tauri::command]
pub fn shell_set_dock_band(height_px: i32) {
  DOCK_BAND.store(height_px.max(4), Ordering::Relaxed);
}

#[tauri::command]
pub fn shell_set_gesture(enabled: bool) {
  ENABLED.store(enabled, Ordering::Relaxed);
}

/// How far up the screen a drag must reach to open the switcher, as a percent of its height (25 to 70).
#[tauri::command]
pub fn shell_set_gesture_distance(percent: i32) {
  RISE_PERCENT.store(percent.clamp(25, 70), Ordering::Relaxed);
}

/// The longest pause between the two Ctrl taps, in milliseconds (200 to 600).
#[tauri::command]
pub fn shell_set_ctrl_gap(ms: u32) {
  crate::engine::keyboard::set_gap_ms(ms);
}

#[tauri::command]
pub async fn shell_window_snapshots(handles: Vec<isize>, max_width: u32) -> HashMap<String, Option<String>> {
  tauri::async_runtime::spawn_blocking(move || {
    handles
      .into_iter()
      .map(|h| {
        #[cfg(target_os = "windows")]
        let shot = imp::snapshot(h, max_width);
        #[cfg(not(target_os = "windows"))]
        let shot: Option<String> = { let _ = max_width; None };
        (h.to_string(), shot)
      })
      .collect()
  })
  .await
  .unwrap_or_default()
}
