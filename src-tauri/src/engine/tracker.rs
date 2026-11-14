//! The window tracker: a live picture of what is open, driven by real window events.
//!
//! One thread listens for Windows' own notifications (a window appeared, moved, was minimised,
//! took the foreground, was renamed, closed). A worker thread, under the supervisor, coalesces a
//! burst of those (a window opening fires create, show, rename and foreground within milliseconds)
//! and publishes the result: a full snapshot to the shell windows when the list of windows changed,
//! or just the foreground and full-screen state when only that changed.
//!
//! Nothing polls. While nothing is happening the worker is asleep. It also runs the other things that
//! must happen after window events: the webview governor (who may render) and the edge bars (are
//! they still on their edge), so every reaction to "the desktop changed" happens in one place.

use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};
use windows::Win32::Foundation::HWND;
use windows::Win32::UI::Accessibility::{SetWinEventHook, HWINEVENTHOOK};
use windows::Win32::UI::WindowsAndMessaging::{
  DispatchMessageW, GetAncestor, GetMessageW, TranslateMessage, CHILDID_SELF, EVENT_OBJECT_CLOAKED, EVENT_OBJECT_CREATE, EVENT_OBJECT_DESTROY,
  EVENT_OBJECT_HIDE, EVENT_OBJECT_LOCATIONCHANGE, EVENT_OBJECT_NAMECHANGE, EVENT_OBJECT_UNCLOAKED, EVENT_SYSTEM_FOREGROUND,
  EVENT_SYSTEM_MINIMIZEEND, EVENT_SYSTEM_MINIMIZESTART, EVENT_SYSTEM_MOVESIZEEND, GA_ROOT, MSG, OBJID_WINDOW, WINEVENT_OUTOFCONTEXT,
};

const APP_LABEL_PREFIX: &str = "app-";
/// The windows that are told about every change to the window list (the rest only hear about the
/// foreground; sending the full list to every app window on every focus change was measurable lag).
const LISTENERS: &[&str] = &["main", "taskbar", "launcher", "menubar"];

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ShellWindow {
  pub handle: isize,
  pub title: String,
  pub process_name: String,
  pub exe_path: Option<String>,
  pub is_minimized: bool,
  pub is_maximized: bool,
  pub app_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct ShellSnapshot {
  pub windows: Vec<ShellWindow>,
  pub foreground: isize,
  /// True while the foreground window covers its whole monitor (a game, a video, a full-screen
  /// browser): the bars hide themselves, as Explorer's does.
  pub fullscreen: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Foreground {
  foreground: isize,
  fullscreen: bool,
}

/// What to tell the windows after a change.
#[derive(Debug, PartialEq, Eq)]
pub enum Publish {
  Nothing,
  /// Only the foreground window or full-screen state changed.
  Foreground,
  /// The list of windows (or one of them) changed.
  Full,
}

/// Compares two snapshots and decides what is worth announcing.
pub fn classify(prev: &ShellSnapshot, next: &ShellSnapshot) -> Publish {
  if prev == next {
    Publish::Nothing
  } else if prev.windows != next.windows {
    Publish::Full
  } else {
    Publish::Foreground
  }
}

/// Which window events matter. `known` is whether the window is one the tracker already lists,
/// `top_level` whether it is a top-level window. Moves and renames of windows we do not list are
/// noise; the foreground changing always matters.
pub fn is_relevant(event: u32, known: bool, top_level: bool) -> bool {
  match event {
    EVENT_OBJECT_DESTROY | EVENT_OBJECT_HIDE | EVENT_OBJECT_CLOAKED => known,
    EVENT_SYSTEM_FOREGROUND => true,
    EVENT_OBJECT_LOCATIONCHANGE => known,
    _ => known || top_level,
  }
}

// ---------------------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------------------

enum Msg {
  Changed { slow: bool },
}

static SENDER: OnceLock<Mutex<mpsc::Sender<Msg>>> = OnceLock::new();
static LAST: OnceLock<Mutex<ShellSnapshot>> = OnceLock::new();
static KNOWN: OnceLock<Mutex<HashSet<isize>>> = OnceLock::new();
/// Whether the worker should also wake every few seconds (only needed while we hide Explorer's
/// taskbar, which Explorer re-shows after it restarts).
static KEEP_CHROME_HIDDEN: AtomicBool = AtomicBool::new(false);

fn last() -> &'static Mutex<ShellSnapshot> {
  LAST.get_or_init(|| Mutex::new(ShellSnapshot::default()))
}

fn known() -> &'static Mutex<HashSet<isize>> {
  KNOWN.get_or_init(|| Mutex::new(HashSet::new()))
}

fn is_known(h: isize) -> bool {
  known().lock().map(|k| k.contains(&h)).unwrap_or(false)
}

/// The shell windows' worker should also wake on a timer while Explorer's chrome is hidden.
pub fn set_chrome_watch(on: bool) {
  KEEP_CHROME_HIDDEN.store(on, Ordering::Relaxed);
}

/// Whether the foreground window covers its whole monitor, as of the last published snapshot.
pub fn last_is_fullscreen() -> bool {
  last().lock().map(|s| s.fullscreen).unwrap_or(false)
}

fn send(msg: Msg) {
  if let Some(tx) = SENDER.get() {
    let _ = tx.lock().map(|tx| tx.send(msg));
  }
}

// ---------------------------------------------------------------------------------------
// Building a snapshot
// ---------------------------------------------------------------------------------------

fn build(app: &AppHandle) -> ShellSnapshot {
  let own_pid = std::process::id();
  let own_labels: HashMap<isize, String> =
    app.webview_windows().into_iter().filter_map(|(label, w)| w.hwnd().ok().map(|h| (h.0 as isize, label))).collect();

  let windows = crate::taskbar::win::list_windows()
    .into_iter()
    .filter_map(|w| {
      let app_id = if w.pid == own_pid {
        // Only Udaan's app windows are "apps"; the desktop, dock and popups are shell chrome and
        // never appear in their own dock.
        let label = own_labels.get(&w.handle)?;
        Some(label.strip_prefix(APP_LABEL_PREFIX)?.to_string())
      } else {
        None
      };
      Some(ShellWindow {
        handle: w.handle,
        title: w.title,
        process_name: w.process_name,
        exe_path: w.exe_path,
        is_minimized: w.is_minimized,
        is_maximized: w.is_maximized,
        app_id,
      })
    })
    .collect();

  let foreground = super::window_actions::foreground();
  let fullscreen = foreground != 0 && !own_labels.contains_key(&foreground) && super::window_actions::covers_monitor(foreground);
  ShellSnapshot { windows, foreground, fullscreen }
}

/// The current snapshot (also remembered as the latest).
pub fn snapshot(app: &AppHandle) -> ShellSnapshot {
  let snap = build(app);
  if let Ok(mut l) = last().lock() {
    *l = snap.clone();
  }
  snap
}

#[tauri::command]
pub fn shell_snapshot(app: AppHandle) -> ShellSnapshot {
  snapshot(&app)
}

// ---------------------------------------------------------------------------------------
// The event listener and the worker
// ---------------------------------------------------------------------------------------

unsafe extern "system" fn on_event(_hook: HWINEVENTHOOK, event: u32, hwnd: HWND, id_object: i32, id_child: i32, _thread: u32, _time: u32) {
  if event != EVENT_SYSTEM_FOREGROUND && (id_object != OBJID_WINDOW.0 || id_child != CHILDID_SELF as i32) {
    return;
  }
  let h = hwnd.0 as isize;
  let top_level = !hwnd.is_invalid() && GetAncestor(hwnd, GA_ROOT) == hwnd;
  if !is_relevant(event, is_known(h), top_level) {
    return;
  }
  send(Msg::Changed { slow: event == EVENT_OBJECT_LOCATIONCHANGE });
}

/// Starts the tracker: the event listener thread and the supervised worker.
pub fn start(app: AppHandle) {
  let (tx, rx) = mpsc::channel::<Msg>();
  if SENDER.set(Mutex::new(tx)).is_err() {
    return;
  }

  let _ = std::thread::Builder::new().name("udaan-window-events".into()).spawn(|| unsafe {
    let ranges: [(u32, u32); 6] = [
      (EVENT_SYSTEM_FOREGROUND, EVENT_SYSTEM_FOREGROUND),
      (EVENT_SYSTEM_MINIMIZESTART, EVENT_SYSTEM_MINIMIZEEND),
      (EVENT_OBJECT_CREATE, EVENT_OBJECT_HIDE),
      (EVENT_OBJECT_LOCATIONCHANGE, EVENT_OBJECT_NAMECHANGE),
      (EVENT_OBJECT_CLOAKED, EVENT_OBJECT_UNCLOAKED),
      (EVENT_SYSTEM_MOVESIZEEND, EVENT_SYSTEM_MOVESIZEEND),
    ];
    for (min, max) in ranges {
      SetWinEventHook(min, max, None, Some(on_event), 0, 0, WINEVENT_OUTOFCONTEXT);
    }
    // The hook callbacks are delivered through this thread's message loop.
    let mut msg = MSG::default();
    while GetMessageW(&mut msg, None, 0, 0).0 > 0 {
      let _ = TranslateMessage(&msg);
      DispatchMessageW(&msg);
    }
  });

  // Supervised: this worker feeds the dock and every window list. A panic here used to kill window
  // tracking for the rest of the session; now it is recorded and restarted (the receiver lives in
  // the closure, so queued messages survive the restart).
  let _ = super::supervisor::spawn("window-tracker", super::supervisor::Restart::OnPanic, move || worker(&app, &rx));
}

fn worker(app: &AppHandle, rx: &mpsc::Receiver<Msg>) {
  publish(app);
  loop {
    // Sleep until a real window event. The periodic wake exists only to keep Explorer's taskbar
    // hidden after Explorer restarts, so it is needed only while we hide it.
    let first = if KEEP_CHROME_HIDDEN.load(Ordering::Relaxed) {
      rx.recv_timeout(Duration::from_secs(3))
    } else {
      rx.recv().map_err(|_| mpsc::RecvTimeoutError::Disconnected)
    };
    let mut slow_only = true;
    match first {
      Ok(Msg::Changed { slow }) => slow_only &= slow,
      Err(mpsc::RecvTimeoutError::Timeout) => super::explorer::keep_hidden(),
      Err(mpsc::RecvTimeoutError::Disconnected) => return,
    }
    // Coalesce bursts: a window opening fires CREATE, SHOW, NAMECHANGE and FOREGROUND within a few
    // ms. Moves and resizes only need to settle.
    let window = if slow_only { Duration::from_millis(250) } else { Duration::from_millis(16) };
    let deadline = Instant::now() + window;
    while let Some(left) = deadline.checked_duration_since(Instant::now()) {
      match rx.recv_timeout(left) {
        Ok(Msg::Changed { .. }) => {}
        Err(_) => break,
      }
    }
    publish(app);
  }
}

fn publish(app: &AppHandle) {
  let snap = build(app);
  // Everything that must react to the desktop changing, in one place and in order.
  super::governor::reconcile(app, &snap);
  super::edges::reassert(snap.fullscreen);
  let action = {
    let mut prev = last().lock().unwrap_or_else(|e| e.into_inner());
    let a = classify(&prev, &snap);
    if a != Publish::Nothing {
      *prev = snap.clone();
    }
    a
  };
  if action == Publish::Nothing {
    return;
  }
  let to_shell = |t: &tauri::EventTarget| matches!(t, tauri::EventTarget::WebviewWindow { label } if LISTENERS.contains(&label.as_str()));
  match action {
    Publish::Full => {
      if let Ok(mut k) = known().lock() {
        *k = snap.windows.iter().map(|w| w.handle).collect();
      }
      let _ = app.emit_filter("shell://snapshot", &snap, to_shell);
    }
    _ => {
      let _ = app.emit_filter("shell://foreground", Foreground { foreground: snap.foreground, fullscreen: snap.fullscreen }, to_shell);
    }
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  fn win(h: isize, minimised: bool) -> ShellWindow {
    ShellWindow { handle: h, title: format!("w{h}"), process_name: "p.exe".into(), exe_path: None, is_minimized: minimised, is_maximized: false, app_id: None }
  }
  fn snap(windows: Vec<ShellWindow>, fg: isize, full: bool) -> ShellSnapshot {
    ShellSnapshot { windows, foreground: fg, fullscreen: full }
  }

  #[test]
  fn what_is_announced_depends_on_what_changed() {
    let a = snap(vec![win(1, false), win(2, false)], 1, false);
    assert_eq!(classify(&a, &a.clone()), Publish::Nothing);
    // only the foreground moved: a small message, not the whole list
    assert_eq!(classify(&a, &snap(a.windows.clone(), 2, false)), Publish::Foreground);
    assert_eq!(classify(&a, &snap(a.windows.clone(), 1, true)), Publish::Foreground, "full-screen started");
    // a window opened, closed, or was minimised: the list changed
    assert_eq!(classify(&a, &snap(vec![win(1, false)], 1, false)), Publish::Full);
    assert_eq!(classify(&a, &snap(vec![win(1, false), win(2, true)], 1, false)), Publish::Full);
  }

  #[test]
  fn only_relevant_window_events_wake_the_worker() {
    // the foreground changing always matters
    assert!(is_relevant(EVENT_SYSTEM_FOREGROUND, false, false));
    // a window we do not list moving about is noise
    assert!(!is_relevant(EVENT_OBJECT_LOCATIONCHANGE, false, true));
    assert!(is_relevant(EVENT_OBJECT_LOCATIONCHANGE, true, true));
    // a new top-level window matters even though we have not listed it yet; a child control does not
    assert!(is_relevant(EVENT_OBJECT_CREATE, false, true));
    assert!(!is_relevant(EVENT_OBJECT_CREATE, false, false));
    // closing or hiding only matters for windows we list
    assert!(!is_relevant(EVENT_OBJECT_DESTROY, false, true));
    assert!(is_relevant(EVENT_OBJECT_DESTROY, true, true));
  }
}
