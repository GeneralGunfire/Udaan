//! Webview governor: only windows someone can actually see get to render.
//!
//! Every Udaan window is a WebView2 instance, and WebView2 keeps compositing a webview
//! until the host tells it otherwise. A hidden launcher, a minimised app, or a desktop
//! sitting fully behind a maximised window would all go on drawing, so the GPU process
//! and the browser process burnt CPU for pixels nobody saw. The governor sets each
//! webview's visibility from the real window state, and asks WebView2 to trim memory for
//! the ones that are out of sight.
//!
//! Two rules keep it from breaking things:
//! - A window is governed only after it has been shown once. Windows such as the desktop
//!   wait for a painted frame before showing themselves, and a webview that was never
//!   visible would never paint, so a never-shown window is left alone.
//! - It never suspends a webview. A suspended page cannot receive events, and several
//!   hidden windows (Start, flyouts) are woken by an event from Rust.
//!
//! Show and hide are caught synchronously through a window subclass on the UI thread
//! (`WM_SHOWWINDOW` arrives before the window is painted), so the webview is already
//! rendering when its window appears. Occlusion by a maximised window is decided from
//! the shell snapshot, off the UI thread.

use std::cell::RefCell;
use std::collections::HashMap;
use tauri::{AppHandle, Manager};
use webview2_com::Microsoft::Web::WebView2::Win32::{
  ICoreWebView2Controller, ICoreWebView2_19, COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW,
  COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL,
};
use windows::core::Interface;
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
use windows::Win32::Graphics::Gdi::{MonitorFromWindow, MONITOR_DEFAULTTONEAREST};
use windows::Win32::UI::Shell::{DefSubclassProc, RemoveWindowSubclass, SetWindowSubclass};
use windows::Win32::UI::WindowsAndMessaging::{IsWindowVisible, WM_NCDESTROY, WM_SHOWWINDOW, WM_SIZE};

const SUBCLASS_ID: usize = 0x55_44_47; // "UDG"
const SIZE_MINIMIZED: usize = 1;

struct Entry {
  controller: ICoreWebView2Controller,
  /// Shown at least once; from then on the governor owns this webview's visibility.
  armed: bool,
  /// The window itself is on screen (not hidden, not minimised).
  shown: bool,
  /// Fully covered by a maximised or full-screen window.
  covered: bool,
  /// What WebView2 has actually been told.
  applied: Option<bool>,
}

thread_local! {
  // Touched only on the UI thread: the subclass proc and `with_webview` closures run there.
  static ENTRIES: RefCell<HashMap<isize, Entry>> = RefCell::new(HashMap::new());
}

/// Brings WebView2 in line with the entry's state. Runs on the UI thread.
fn apply(e: &mut Entry) {
  if !e.armed {
    return;
  }
  let visible = e.shown && !e.covered;
  if e.applied == Some(visible) {
    return;
  }
  e.applied = Some(visible);
  unsafe {
    let _ = e.controller.SetIsVisible(visible);
    if let Ok(core) = e.controller.CoreWebView2() {
      if let Ok(core19) = core.cast::<ICoreWebView2_19>() {
        let level = if visible {
          COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL
        } else {
          COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW
        };
        let _ = core19.SetMemoryUsageTargetLevel(level);
      }
    }
  }
}

fn on_shown(hwnd: isize, shown: bool) {
  ENTRIES.with(|m| {
    if let Some(e) = m.borrow_mut().get_mut(&hwnd) {
      e.shown = shown;
      if shown {
        e.armed = true;
      }
      apply(e);
    }
  });
}

unsafe extern "system" fn subclass_proc(hwnd: HWND, msg: u32, wp: WPARAM, lp: LPARAM, _id: usize, _data: usize) -> LRESULT {
  let h = hwnd.0 as isize;
  match msg {
    WM_SHOWWINDOW => on_shown(h, wp.0 != 0),
    WM_SIZE => {
      if wp.0 == SIZE_MINIMIZED {
        on_shown(h, false);
      } else if IsWindowVisible(hwnd).as_bool() {
        on_shown(h, true);
      }
    }
    WM_NCDESTROY => {
      ENTRIES.with(|m| m.borrow_mut().remove(&h));
      let _ = RemoveWindowSubclass(hwnd, Some(subclass_proc), SUBCLASS_ID);
    }
    _ => {}
  }
  DefSubclassProc(hwnd, msg, wp, lp)
}

/// When the governor may start controlling a window's visibility.
#[derive(Clone, Copy, PartialEq)]
enum Policy {
  /// Leave it alone: its page reveals itself through a painted frame every time, so a
  /// webview told it is invisible would never paint and the window would never appear.
  Never,
  /// Quiet from the moment it exists: it is only ever shown by a direct `show()`.
  FromStart,
  /// Governed once it has been shown for the first time (windows that show themselves
  /// after their first paint, such as the desktop, dock, menu bar and new app windows).
  AfterFirstShow,
}

fn policy_for(label: &str) -> Policy {
  match label {
    // Reveals itself with `requestAnimationFrame(...show())` on every banner.
    "toast" => Policy::Never,
    "launcher" | "taskbar-popup" | "edgelight" => Policy::FromStart,
    _ => Policy::AfterFirstShow,
  }
}

/// Puts one window under the governor. Safe to call more than once per window.
pub fn attach(window: &tauri::WebviewWindow) {
  attach_with(window, policy_for(window.label()));
}

/// For app windows created hidden on purpose (pre-warmed): they are revealed only by an
/// explicit `show()` from the shell, so they can be quiet from the start.
pub fn attach_prewarmed(window: &tauri::WebviewWindow) {
  attach_with(window, Policy::FromStart);
}

fn attach_with(window: &tauri::WebviewWindow, policy: Policy) {
  if policy == Policy::Never {
    return;
  }
  let Ok(hwnd) = window.hwnd() else { return };
  let h = hwnd.0 as isize;
  let label = window.label().to_string();
  let _ = window.with_webview(move |wv| unsafe {
    let hwnd = HWND(h as *mut core::ffi::c_void);
    let already = ENTRIES.with(|m| m.borrow().contains_key(&h));
    if already {
      return;
    }
    let visible_now = IsWindowVisible(hwnd).as_bool();
    ENTRIES.with(|m| {
      let mut m = m.borrow_mut();
      let entry = m.entry(h).or_insert(Entry {
        controller: wv.controller(),
        armed: visible_now || policy == Policy::FromStart,
        shown: visible_now,
        covered: false,
        applied: None,
      });
      apply(entry);
    });
    let _ = SetWindowSubclass(hwnd, Some(subclass_proc), SUBCLASS_ID, 0);
    super::trace::line(&format!("governor: attached to '{label}' (visible now: {visible_now})"));
  });
}

/// Attaches to every window that exists now. Windows created later call [`attach`].
pub fn attach_all(app: &AppHandle) {
  for (_, w) in app.webview_windows() {
    attach(&w);
  }
}

fn monitor_of(h: isize) -> isize {
  unsafe { MonitorFromWindow(HWND(h as *mut core::ffi::c_void), MONITOR_DEFAULTTONEAREST).0 as isize }
}

/// Called with every shell snapshot. Marks the desktop as covered while a maximised or
/// full-screen window sits on its monitor, so its wallpaper, widgets and timers stop.
pub fn reconcile(app: &AppHandle, snap: &crate::shell::ShellSnapshot) {
  let Some(desktop) = app.get_webview_window("main") else { return };
  let Ok(dh) = desktop.hwnd() else { return };
  let dh = dh.0 as isize;
  let desk_mon = monitor_of(dh);
  let covered = snap.fullscreen
    || snap.windows.iter().any(|w| w.is_maximized && !w.is_minimized && monitor_of(w.handle) == desk_mon);
  let _ = desktop.with_webview(move |_| {
    ENTRIES.with(|m| {
      if let Some(e) = m.borrow_mut().get_mut(&dh) {
        if e.covered != covered {
          e.covered = covered;
          apply(e);
        }
      }
    });
  });
}
