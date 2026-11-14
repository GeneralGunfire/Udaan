//! Starts the external guard process (`shell-watchdog.exe --guard <pid>`).
//!
//! The in-process undo registry ([`super::guard`]) covers a clean exit and a panic, but a
//! hard kill (a crash, a power cut, `taskkill /f`) runs no code of ours at all. The guard
//! is a separate tiny process that waits for Udaan's pid to end and then shows Explorer's
//! taskbar again, so hiding it can never strand the user without one.

use std::sync::atomic::{AtomicBool, Ordering};

static STARTED: AtomicBool = AtomicBool::new(false);

/// Starts the guard once. Call when Udaan first hides Explorer's chrome.
pub fn ensure_started() {
  if STARTED.swap(true, Ordering::SeqCst) {
    return;
  }
  let Ok(exe) = std::env::current_exe() else { return };
  let guard = exe.with_file_name("shell-watchdog.exe");
  if !guard.is_file() {
    super::trace::line("external guard not found next to the executable; relying on in-process undo only");
    STARTED.store(false, Ordering::SeqCst);
    return;
  }
  use std::os::windows::process::CommandExt;
  const CREATE_NO_WINDOW: u32 = 0x0800_0000;
  match std::process::Command::new(&guard).arg("--guard").arg(std::process::id().to_string()).creation_flags(CREATE_NO_WINDOW).spawn() {
    Ok(_) => super::trace::line("external guard started"),
    Err(e) => {
      super::trace::line(&format!("external guard failed to start: {e}"));
      STARTED.store(false, Ordering::SeqCst);
    }
  }
}
