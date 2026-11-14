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
  ICoreWebView2, ICoreWebView2Controller, ICoreWebView2_19, COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW,
  COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL, COREWEBVIEW2_PROCESS_FAILED_KIND, COREWEBVIEW2_PROCESS_FAILED_KIND_BROWSER_PROCESS_EXITED,
  COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_EXITED, COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_UNRESPONSIVE,
};
use webview2_com::ProcessFailedEventHandler;
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
  // When each window's page was last reloaded after a crash, to stop a crash loop.
  static RELOADS: RefCell<HashMap<String, Vec<std::time::Instant>>> = RefCell::new(HashMap::new());
}

static APP: std::sync::OnceLock<AppHandle> = std::sync::OnceLock::new();

/// A window's renderer crashed or stopped responding: reload that page. A page that keeps
/// crashing is left alone after three reloads in a minute rather than looped on forever. If
/// the whole browser process died, every window is dead, so Udaan restarts itself.
fn on_process_failed(label: &str, kind: COREWEBVIEW2_PROCESS_FAILED_KIND, sender: Option<ICoreWebView2>) {
  if kind == COREWEBVIEW2_PROCESS_FAILED_KIND_BROWSER_PROCESS_EXITED {
    super::trace::line(&format!("'{label}': the browser process exited; restarting Udaan"));
    if let Some(app) = APP.get() {
      app.restart();
    }
    return;
  }
  if kind != COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_EXITED && kind != COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_UNRESPONSIVE {
    super::trace::line(&format!("'{label}': a helper process failed (kind {})", kind.0));
    return;
  }
  let now = std::time::Instant::now();
  let allowed = RELOADS.with(|r| {
    let mut r = r.borrow_mut();
    let v = r.entry(label.to_string()).or_default();
    v.retain(|t| now.duration_since(*t) < std::time::Duration::from_secs(60));
    if v.len() >= 3 {
      return false;
    }
    v.push(now);
    true
  });
  if !allowed {
    super::trace::line(&format!("'{label}': renderer keeps failing; leaving it alone"));
    return;
  }
  super::trace::line(&format!("'{label}': renderer failed (kind {}); reloading its page", kind.0));
  if let Some(core) = sender {
    let _ = unsafe { core.Reload() };
  }
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
    // Measures its content before showing, and that content grows through animations,
    // which do not run in a webview that has been told it is invisible: it measured a
    // collapsed card and sized its window wrong (popups took ~1 s to settle instead of
    // ~250 ms). It is also a tiny window, so quieting it saves almost nothing.
    "taskbar-popup" => Policy::Never,
    // The desktop is never hidden: a hidden webview repaints blank when shown again, which made the
    // wallpaper vanish whenever a window moved over it. It is a static picture and costs nothing idle.
    "main" => Policy::Never,
    "launcher" | "edgelight" => Policy::FromStart,
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
    if let Ok(core) = wv.controller().CoreWebView2() {
      let name = label.clone();
      let handler = ProcessFailedEventHandler::create(Box::new(move |sender, args| {
        if let Some(args) = args {
          let mut kind = COREWEBVIEW2_PROCESS_FAILED_KIND::default();
          args.ProcessFailedKind(&mut kind)?;
          on_process_failed(&name, kind, sender);
        }
        Ok(())
      }));
      let mut token = 0i64;
      let _ = core.add_ProcessFailed(&handler, &mut token);
    }
    super::trace::line(&format!("governor: attached to '{label}' (visible now: {visible_now})"));
  });
}

/// Attaches to every window that exists now. Windows created later call [`attach`].
pub fn attach_all(app: &AppHandle) {
  let _ = APP.set(app.clone());
  for (_, w) in app.webview_windows() {
    attach(&w);
  }
}

fn monitor_of(h: isize) -> isize {
  unsafe { MonitorFromWindow(HWND(h as *mut core::ffi::c_void), MONITOR_DEFAULTTONEAREST).0 as isize }
}

/// Called with every shell snapshot. Marks the desktop as covered while a maximised or
/// full-screen window sits on its monitor, so its wallpaper, widgets and timers stop.
pub fn reconcile(app: &AppHandle, snap: &super::tracker::ShellSnapshot) {
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
