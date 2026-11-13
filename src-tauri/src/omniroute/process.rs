use std::sync::Mutex;

/// Tracks the PID of the real, detached `omniroute serve --daemon` process
/// this app itself started, so Stop only ever kills a daemon we started —
/// never an instance the user already had running before opening Udaan.
///
/// NOT a `tokio::process::Child` (as an earlier version tried) — `--daemon`
/// mode makes the CLI wrapper we `spawn()` fork the real server into its
/// own detached background process and then exit itself almost
/// immediately (verified directly: `omniroute serve --daemon --no-open`
/// prints "started in background (PID: N)" and returns exit code 0 well
/// under a second later, while the real server, a separate node.exe
/// process, keeps running). A `Child` handle to the wrapper is therefore
/// already a dead/exited process within moments of starting — nothing to
/// track or kill through it, and treating that expected exit as a startup
/// failure was the actual bug behind "click Start, it goes off." The real
/// daemon's PID is instead read from its own pidfile
/// (`~/.omniroute/server/.pid`, confirmed to exist by inspection), which
/// is what Stop actually signals.
#[derive(Default)]
pub struct OmniRouteProcess(pub(super) Mutex<Option<u32>>);

impl OmniRouteProcess {
  /// Synchronous best-effort kill for the app's `on_window_event` handler,
  /// which isn't async.
  pub fn kill_blocking(&self) {
    if let Some(pid) = self.0.lock().unwrap().take() {
      super::kill_pid(pid);
    }
  }
}
