//! System-wide "always maximize new windows" — a background WinEvent hook
//! that watches for any top-level window becoming newly visible anywhere
//! on the desktop (not just Udaan's own windows) and maximizes it
//! automatically, so every app the user opens fills the screen without
//! them needing to click Maximize by hand every time. Purely a
//! `ShowWindow(hwnd, SW_MAXIMIZE)` call on windows that already exist and
//! chose to show themselves — this never creates, hides, closes, or
//! otherwise interferes with any window beyond that one call, and is
//! fully reversible by toggling the watcher off (see
//! `window_watcher_set_enabled`).
//!
//! Distinct from `taskbar::win::force_topmost` and friends: this hook
//! runs continuously in its own dedicated OS thread with its own message
//! pump, since `SetWinEventHook` callbacks are only delivered to the
//! thread that registered the hook while that thread is pumping messages
//! — a plain Tauri async command can't host this, it needs a real
//! blocking `GetMessage` loop for as long as the watcher is enabled.

use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct WindowWatcherStatus {
  pub enabled: bool,
}

#[cfg(target_os = "windows")]
mod win {
  use super::*;
  use std::thread::JoinHandle;
  use windows_sys::Win32::Foundation::{HWND, RECT};
  use windows_sys::Win32::UI::Accessibility::{SetWinEventHook, UnhookWinEvent, HWINEVENTHOOK};
  use windows_sys::Win32::UI::WindowsAndMessaging::{
    DispatchMessageW, GetMessageW, GetWindowLongW, GetWindowRect, IsIconic, IsWindowVisible,
    IsZoomed, PostThreadMessageW, ShowWindow, TranslateMessage, EVENT_OBJECT_SHOW,
    EVENT_SYSTEM_FOREGROUND, GWL_EXSTYLE, GWL_STYLE, MSG, OBJID_WINDOW, SW_MAXIMIZE,
    WINEVENT_OUTOFCONTEXT, WINEVENT_SKIPOWNPROCESS, WM_QUIT, WS_CAPTION, WS_CHILD, WS_EX_TOOLWINDOW,
    WS_POPUP,
  };

  struct WatcherThread {
    handle: JoinHandle<()>,
    thread_id: u32,
  }

  static WATCHER: Mutex<Option<WatcherThread>> = Mutex::new(None);
  static ENABLED: AtomicBool = AtomicBool::new(false);

  /// Own window titles that must never be auto-maximized regardless of
  /// the watcher being on — Udaan's floating taskbar dock is a small
  /// pinned-size overlay by design (see TaskbarWindow.tsx), and maximizing
  /// it would break the entire feature it belongs to.
  const EXEMPT_TITLES: &[&str] = &["Udaan Dock"];

  unsafe extern "system" fn win_event_proc(
    _hook: HWINEVENTHOOK,
    event: u32,
    hwnd: HWND,
    id_object: i32,
    _id_child: i32,
    _event_thread: u32,
    _event_time: u32,
  ) {
    if !ENABLED.load(Ordering::Relaxed) {
      return;
    }
    // OBJID_WINDOW filters to the window itself, not its child controls —
    // EVENT_OBJECT_SHOW fires for all sorts of child UI elements
    // (buttons, list items) becoming visible, which would otherwise
    // trigger this on every minor UI change inside an already-open app.
    if id_object != OBJID_WINDOW {
      return;
    }
    if hwnd.is_null() {
      return;
    }
    if event != EVENT_OBJECT_SHOW && event != EVENT_SYSTEM_FOREGROUND {
      return;
    }
    maybe_maximize(hwnd);
  }

  unsafe fn maybe_maximize(hwnd: HWND) {
    if IsWindowVisible(hwnd) == 0 {
      return;
    }
    if IsIconic(hwnd) != 0 || IsZoomed(hwnd) != 0 {
      // Already minimized (leave it alone — the user just minimized it,
      // don't fight that) or already maximized (nothing to do).
      return;
    }

    let ex_style = GetWindowLongW(hwnd, GWL_EXSTYLE) as u32;
    let style = GetWindowLongW(hwnd, GWL_STYLE) as u32;

    // Tool windows (utility palettes, most tray-icon host windows) and
    // child windows are never "an app the user opened" in the sense this
    // feature means — same exclusion taskbar::mod.rs's own window
    // enumeration already applies for the same reason.
    if ex_style & WS_EX_TOOLWINDOW != 0 {
      return;
    }
    if style & WS_CHILD != 0 {
      return;
    }
    // A real top-level app window has either WS_CAPTION (a title bar) or
    // WS_POPUP (a borderless-but-standalone window, which covers apps
    // like Udaan itself). Neither present usually means a genuinely
    // internal/helper window not meant to be shown as its own maximizable
    // surface — skip those rather than risk maximizing something that was
    // never meant to be resized at all.
    if style & WS_CAPTION == 0 && style & WS_POPUP == 0 {
      return;
    }

    let mut rect: RECT = std::mem::zeroed();
    if GetWindowRect(hwnd, &mut rect) == 0 {
      return;
    }
    // Skip anything already very small on its shorter axis — this is a
    // heuristic for "probably a deliberately-fixed-size dialog/toast/
    // tooltip-like window" rather than a real app window, since those
    // still pass the WS_CAPTION/WS_POPUP check above but were never meant
    // to fill the screen. 200px is comfortably below any real app's
    // normal window size but above typical small dialogs/notifications.
    let width = rect.right - rect.left;
    let height = rect.bottom - rect.top;
    if width < 200 || height < 150 {
      return;
    }

    if is_exempt_title(hwnd) {
      return;
    }

    ShowWindow(hwnd, SW_MAXIMIZE);
  }

  unsafe fn is_exempt_title(hwnd: HWND) -> bool {
    use windows_sys::Win32::UI::WindowsAndMessaging::{GetWindowTextLengthW, GetWindowTextW};
    let len = GetWindowTextLengthW(hwnd);
    if len == 0 {
      return false;
    }
    let mut buf = vec![0u16; len as usize + 1];
    let copied = GetWindowTextW(hwnd, buf.as_mut_ptr(), buf.len() as i32);
    if copied == 0 {
      return false;
    }
    buf.truncate(copied as usize);
    let title = String::from_utf16_lossy(&buf);
    EXEMPT_TITLES.iter().any(|t| *t == title)
  }

  pub fn start() {
    let mut guard = WATCHER.lock().unwrap();
    if guard.is_some() {
      ENABLED.store(true, Ordering::Relaxed);
      return;
    }

    let (tx, rx) = std::sync::mpsc::channel::<u32>();
    let handle = std::thread::spawn(move || {
      unsafe {
        // WINEVENT_OUTOFCONTEXT: the callback runs on THIS thread rather
        // than injected into every target process, which is both simpler
        // and safer (no DLL injection needed). WINEVENT_SKIPOWNPROCESS:
        // never fires for Udaan's own windows — the main window and the
        // taskbar dock manage their own sizing already (see App.tsx /
        // udaanTaskbarMode.ts), this hook is strictly for OTHER apps.
        let hook = SetWinEventHook(
          EVENT_OBJECT_SHOW,
          EVENT_SYSTEM_FOREGROUND,
          std::ptr::null_mut(),
          Some(win_event_proc),
          0,
          0,
          WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS,
        );

        let thread_id = windows_sys::Win32::System::Threading::GetCurrentThreadId();
        let _ = tx.send(thread_id);

        let mut msg: MSG = std::mem::zeroed();
        while GetMessageW(&mut msg, std::ptr::null_mut(), 0, 0) > 0 {
          if msg.message == WM_QUIT {
            break;
          }
          TranslateMessage(&msg);
          DispatchMessageW(&msg);
        }

        if !hook.is_null() {
          UnhookWinEvent(hook);
        }
      }
    });

    let thread_id = rx.recv().unwrap_or(0);
    ENABLED.store(true, Ordering::Relaxed);
    *guard = Some(WatcherThread { handle, thread_id });
  }

  pub fn stop() {
    ENABLED.store(false, Ordering::Relaxed);
    let mut guard = WATCHER.lock().unwrap();
    if let Some(watcher) = guard.take() {
      unsafe {
        PostThreadMessageW(watcher.thread_id, WM_QUIT, 0, 0);
      }
      let _ = watcher.handle.join();
    }
  }

  pub fn is_enabled() -> bool {
    ENABLED.load(Ordering::Relaxed)
  }
}

#[cfg(not(target_os = "windows"))]
mod win {
  use super::*;
  pub fn start() {}
  pub fn stop() {}
  pub fn is_enabled() -> bool {
    false
  }
}

/// Starts (or confirms already-started) the background auto-maximize
/// watcher. Safe to call multiple times.
#[tauri::command]
pub fn window_watcher_set_enabled(enabled: bool) -> WindowWatcherStatus {
  if enabled {
    win::start();
  } else {
    win::stop();
  }
  WindowWatcherStatus { enabled: win::is_enabled() }
}

#[tauri::command]
pub fn window_watcher_status() -> WindowWatcherStatus {
  WindowWatcherStatus { enabled: win::is_enabled() }
}
