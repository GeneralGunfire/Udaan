use std::sync::Mutex;
use tokio::process::Child;

/// Tracks an `ollama serve` process this app itself launched, so Stop only
/// ever kills a process we started — never an instance the user already had
/// running before opening Udaan (there's no reliable way to tell "someone
/// else's ollama serve" from ours by PID alone, so we simply don't touch
/// anything we didn't spawn).
#[derive(Default)]
pub struct OllamaProcess(pub(super) Mutex<Option<Child>>);

impl OllamaProcess {
  /// Synchronous best-effort kill for the app's `on_window_event` handler,
  /// which isn't async. `start_kill()` just sends the kill signal without
  /// waiting for exit — acceptable here since the app is closing anyway.
  pub fn kill_blocking(&self) {
    if let Some(mut child) = self.0.lock().unwrap().take() {
      let _ = child.start_kill();
    }
  }
}
