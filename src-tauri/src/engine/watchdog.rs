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
  let original = exe.with_file_name("shell-watchdog.exe");
  if !original.is_file() {
    super::trace::line("external guard not found next to the executable; relying on in-process undo only");
    STARTED.store(false, Ordering::SeqCst);
    return;
  }
  // Run the guard from its OWN copy next to Udaan.exe. Never from `shell-watchdog.exe` itself: the
  // build (and Tauri's sidecar copy) overwrite that file, and a running program cannot be
  // overwritten, so a guard running from it made every rebuild fail while Udaan was open. Not in the
  // user's data folder either: antivirus removed a copy placed there. If copying fails because an
  // older guard still holds the copy, that copy is just used.
  let copy = original.with_file_name("udaan-guard.exe");
  let guard = if std::fs::copy(&original, &copy).is_ok() || copy.is_file() { copy } else { original };
  use std::os::windows::process::CommandExt;
  const CREATE_NO_WINDOW: u32 = 0x0800_0000;
  // The guard must NOT be a child of Udaan. Ending Udaan's process tree (Task Manager's
  // "End task" does exactly that) would take a child guard down with it, which is the one
  // case it exists for. So it is started through `cmd /c start`: cmd launches it and exits at
  // once, leaving the guard with no living parent, outside Udaan's tree.
  let command = format!("/c start \"\" /B \"{}\" --guard {}", guard.display(), std::process::id());
  match std::process::Command::new("cmd").raw_arg(command).creation_flags(CREATE_NO_WINDOW).spawn() {
    Ok(_) => super::trace::line("external guard started"),
    Err(e) => {
      super::trace::line(&format!("external guard failed to start: {e}"));
      STARTED.store(false, Ordering::SeqCst);
    }
  }
}

/// True while the guard process for this Udaan is alive (it holds a named mutex).
pub fn is_alive() -> bool {
  use windows::core::HSTRING;
  use windows::Win32::Foundation::CloseHandle;
  use windows::Win32::System::Threading::{OpenMutexW, SYNCHRONIZATION_ACCESS_RIGHTS};
  const SYNCHRONIZE: SYNCHRONIZATION_ACCESS_RIGHTS = SYNCHRONIZATION_ACCESS_RIGHTS(0x0010_0000);
  let name = HSTRING::from(format!("Local\\UdaanGuard.{}", std::process::id()));
  match unsafe { OpenMutexW(SYNCHRONIZE, false, &name) } {
    Ok(h) => {
      let _ = unsafe { CloseHandle(h) };
      true
    }
    Err(_) => false,
  }
}

/// Starts the guard again if it is not running (it may have been killed).
pub fn ensure_alive() {
  if !is_alive() {
    STARTED.store(false, Ordering::SeqCst);
    ensure_started();
  }
}
