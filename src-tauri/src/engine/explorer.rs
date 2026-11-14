//! Explorer's taskbar: hiding it while Udaan is the shell, and giving it back no matter what.
//!
//! Udaan runs beside Explorer and hides Explorer's own taskbar so there is only one. That is a
//! change to the user's system, so it is never made without its undo: the undo goes into the engine's
//! guard (runs on exit and on a main-thread panic) and a separate guard process is started that
//! restores it even if Udaan is killed outright. Explorer also re-shows its taskbar by itself after
//! it restarts, so while it is hidden the tracker wakes now and then to hide it again.

use std::sync::atomic::{AtomicBool, Ordering};
use windows::core::HSTRING;
use windows::Win32::Foundation::HWND;
use windows::Win32::UI::WindowsAndMessaging::{FindWindowExW, IsWindowVisible, ShowWindow, SW_HIDE, SW_SHOW};

/// Whether we are currently hiding Explorer's taskbar.
static HIDDEN: AtomicBool = AtomicBool::new(false);

const CLASSES: [&str; 2] = ["Shell_TrayWnd", "Shell_SecondaryTrayWnd"];

fn all_windows(class: &str) -> Vec<HWND> {
  let class = HSTRING::from(class);
  let mut out = Vec::new();
  let mut after: Option<HWND> = None;
  unsafe {
    while let Ok(h) = FindWindowExW(None, after, &class, None) {
      out.push(h);
      after = Some(h);
    }
  }
  out
}

/// Shows or hides every Explorer taskbar (the main one and the one on each other monitor).
pub fn set_visible(visible: bool) {
  for class in CLASSES {
    for h in all_windows(class) {
      unsafe {
        if IsWindowVisible(h).as_bool() != visible {
          let _ = ShowWindow(h, if visible { SW_SHOW } else { SW_HIDE });
        }
      }
    }
  }
}

/// If we are hiding Explorer's taskbar, hide it again (Explorer brings it back when it restarts or
/// when displays change).
pub fn keep_hidden() {
  if HIDDEN.load(Ordering::Relaxed) {
    set_visible(false);
  }
}

/// Explorer restarted: its taskbar is a new window.
pub fn on_restarted() {
  keep_hidden();
}

/// Hides (or restores) Explorer's taskbar. Whenever it is hidden, its undo is registered with the
/// guard, and the external guard process is running.
#[tauri::command]
pub fn shell_set_explorer_chrome_hidden(hidden: bool) {
  HIDDEN.store(hidden, Ordering::Relaxed);
  set_visible(!hidden);
  super::tracker::set_chrome_watch(hidden);
  if hidden {
    super::guard::register("explorer-chrome", || set_visible(true));
    // The undo above cannot run if we are killed outright; the guard process can.
    super::watchdog::ensure_started();
  } else {
    super::guard::cancel("explorer-chrome");
  }
}

/// On exit: give the taskbar back if we hid it.
pub fn restore_on_exit() {
  if HIDDEN.swap(false, Ordering::Relaxed) {
    set_visible(true);
  }
}
