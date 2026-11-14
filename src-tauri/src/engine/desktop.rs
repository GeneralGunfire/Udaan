//! The desktop layer: Udaan's wallpaper, icons and widgets window.
//!
//! It is the bottom of the stack. Nothing may ever appear beneath it, it must always
//! cover the primary monitor exactly, and it has to survive the things that disturb a
//! desktop: monitors changing, DPI changing, and Explorer restarting. All of that lives
//! here, in one place, with one path for each event.
//!
//! How it stays at the bottom: every attempt to move or re-order the window is
//! intercepted (`WM_WINDOWPOSCHANGING`) and rewritten so it lands directly above
//! Explorer's own desktop windows (Progman / WorkerW) if they exist, otherwise at the very
//! bottom. So clicking it, showing it or Win+D can never raise it above a real window.

use std::sync::atomic::{AtomicIsize, AtomicU32, Ordering};
use windows::core::w;
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, POINT, RECT, WPARAM};
use windows::Win32::Graphics::Gdi::{GetMonitorInfoW, MonitorFromPoint, MONITORINFO, MONITOR_DEFAULTTOPRIMARY};
use windows::Win32::UI::Shell::{DefSubclassProc, SetWindowSubclass};
use windows::Win32::UI::WindowsAndMessaging::*;

const SUBCLASS_ID: usize = 0x55_44_44; // "UDD"
const WM_DPICHANGED_: u32 = 0x02E0;

/// The registered "TaskbarCreated" message: broadcast when Explorer (re)starts.
static TASKBAR_CREATED: AtomicU32 = AtomicU32::new(0);
/// The desktop window, remembered so it can be checked later.
static DESKTOP: AtomicIsize = AtomicIsize::new(0);

/// The rectangle of the primary monitor. The desktop always belongs to the primary
/// monitor, not to "whichever monitor the window is nearest", which can drift to the
/// wrong one when a display configuration changes.
fn primary_rect() -> Option<RECT> {
  unsafe {
    let mon = MonitorFromPoint(POINT { x: 0, y: 0 }, MONITOR_DEFAULTTOPRIMARY);
    let mut mi = MONITORINFO { cbSize: std::mem::size_of::<MONITORINFO>() as u32, ..Default::default() };
    GetMonitorInfoW(mon, &mut mi).as_bool().then_some(mi.rcMonitor)
  }
}

/// Fits the window to the primary monitor, at the bottom of the stack.
fn refit(hwnd: HWND) {
  if let Some(r) = primary_rect() {
    unsafe {
      let _ = SetWindowPos(hwnd, Some(HWND_BOTTOM), r.left, r.top, r.right - r.left, r.bottom - r.top, SWP_NOACTIVATE);
    }
  }
}

fn class_is(h: HWND, names: &[&str]) -> bool {
  let mut buf = [0u16; 64];
  let n = unsafe { GetClassNameW(h, &mut buf) } as usize;
  let class = String::from_utf16_lossy(&buf[..n]);
  names.iter().any(|c| *c == class)
}

/// Where the desktop must sit: directly above Explorer's own desktop windows if present,
/// so it covers them; else the very bottom. `None` means "already in the right place".
unsafe fn insert_after(me: HWND) -> Option<HWND> {
  let mut h = GetTopWindow(None).unwrap_or_default();
  while !h.is_invalid() {
    if h != me && IsWindowVisible(h).as_bool() && class_is(h, &["Progman", "WorkerW"]) {
      let above = GetWindow(h, GW_HWNDPREV).unwrap_or_default();
      if above == me {
        return None;
      }
      return Some(if above.is_invalid() { HWND_TOP } else { above });
    }
    h = GetWindow(h, GW_HWNDNEXT).unwrap_or_default();
  }
  Some(HWND_BOTTOM)
}

unsafe extern "system" fn proc(hwnd: HWND, msg: u32, wp: WPARAM, lp: LPARAM, _id: usize, _data: usize) -> LRESULT {
  match msg {
    // Every move or re-order is rewritten so the window can only ever land at the bottom.
    WM_WINDOWPOSCHANGING => {
      let wpos = &mut *(lp.0 as *mut WINDOWPOS);
      match insert_after(hwnd) {
        Some(after) => {
          wpos.hwndInsertAfter = after;
          wpos.flags &= !SWP_NOZORDER;
        }
        None => wpos.flags |= SWP_NOZORDER,
      }
    }
    // A monitor changed, the scale changed, or the work area moved. Let the window's own
    // handling run first (on a DPI change it resizes itself to Windows' suggested
    // rectangle, which would undo our fit if we went before it), then fit, then tell
    // every shell window exactly once.
    WM_DISPLAYCHANGE | WM_DPICHANGED_ => {
      let r = DefSubclassProc(hwnd, msg, wp, lp);
      refit(hwnd);
      super::keyboard::emit_hotkey("display-changed");
      super::displays::announce();
      super::doctor::heal_soon();
      return r;
    }
    WM_SETTINGCHANGE if wp.0 as u32 == SPI_SETWORKAREA.0 => {
      let r = DefSubclassProc(hwnd, msg, wp, lp);
      refit(hwnd);
      super::keyboard::emit_hotkey("display-changed");
      // The usable area of a monitor changed (a bar was reserved or released).
      super::displays::announce();
      return r;
    }
    m if m != 0 && m == TASKBAR_CREATED.load(Ordering::Relaxed) => {
      // Explorer restarted: it re-creates its desktop windows and its taskbar. Put the
      // desktop back above them and hide Explorer's taskbar again if we had hidden it.
      refit(hwnd);
      super::explorer::on_restarted();
      super::doctor::heal_soon();
    }
    _ => {}
  }
  DefSubclassProc(hwnd, msg, wp, lp)
}

/// Turns the window into the desktop layer. Call once, from setup, after the window exists.
pub fn install(window: &tauri::WebviewWindow) -> Result<(), String> {
  let hwnd = window.hwnd().map_err(|e| e.to_string())?;
  unsafe {
    TASKBAR_CREATED.store(RegisterWindowMessageW(w!("TaskbarCreated")), Ordering::Relaxed);
    // A tool window stays out of Alt+Tab and out of the taskbar, like the real desktop.
    let ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
    SetWindowLongPtrW(hwnd, GWL_EXSTYLE, (ex | WS_EX_TOOLWINDOW.0 as isize) & !(WS_EX_APPWINDOW.0 as isize));
    if !SetWindowSubclass(hwnd, Some(proc), SUBCLASS_ID, 0).as_bool() {
      return Err("SetWindowSubclass failed".into());
    }
    DESKTOP.store(hwnd.0 as isize, Ordering::Relaxed);
    refit(hwnd);
  }
  super::trace::line("desktop layer installed");
  Ok(())
}

/// Whether the desktop is where it must be: at the bottom of the stack and exactly covering the
/// primary monitor. With `heal`, puts it right if not.
pub fn check(heal: bool) -> (bool, String) {
  let h = DESKTOP.load(Ordering::Relaxed);
  if h == 0 {
    return (false, "the desktop layer is not installed".into());
  }
  let hwnd = HWND(h as *mut core::ffi::c_void);
  let Some(want) = primary_rect() else { return (false, "no primary monitor".into()) };
  unsafe {
    let mut cur = RECT::default();
    let _ = GetWindowRect(hwnd, &mut cur);
    let fitted = (cur.left, cur.top, cur.right, cur.bottom) == (want.left, want.top, want.right, want.bottom);
    let at_bottom = match insert_after(hwnd) {
      None => true,
      Some(after) => after == HWND_BOTTOM && GetWindow(hwnd, GW_HWNDNEXT).is_err(),
    };
    if fitted && at_bottom {
      return (true, "at the bottom, covering the primary monitor".into());
    }
    if heal {
      refit(hwnd);
      return (true, "was out of place; put back".into());
    }
    (false, format!("fitted: {fitted}, at bottom: {at_bottom}"))
  }
}

/// Pins the desktop window to the bottom of the z-order and spans it over
/// its whole monitor. Called once from setup.
pub fn install_as_shell_desktop(window: &tauri::WebviewWindow) -> Result<(), String> {
  let hwnd = window.hwnd().map_err(|e| e.to_string())?.0 as isize;
  install(window)?;
  if crate::shell::session::claim_shell(hwnd) {
    log::info!("[shell] Udaan is the session shell; starting startup programs");
    std::thread::spawn(crate::shell::session::run_startup_programs);
  }
  Ok(())
}

