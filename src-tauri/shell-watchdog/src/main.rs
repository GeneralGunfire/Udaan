//! Shell watchdog — the process Windows actually launches at login when
//! Udaan is set as the shell (see `shell_replace` module in the main app
//! for how that registry value gets set/restored). This binary's only job:
//!
//!   1. Launch Udaan.
//!   2. If Udaan exits within the startup grace period (looks like a crash
//!      or failure to start, not a normal user-initiated close), launch
//!      explorer.exe as a fallback so the user is never left with no UI.
//!   3. If Udaan exits normally after running for a while (the user chose
//!      to log out, or explicitly reverted to explorer.exe via Udaan's own
//!      in-app toggle, which also flips the registry key back), just exit —
//!      Windows will re-invoke whatever the (possibly now-reverted) shell
//!      value points to on the next login.
//!
//! Deliberately minimal: this is the one piece of the whole shell-
//! replacement feature that MUST keep working even if every line of
//! Udaan's own code is broken, so it avoids depending on Udaan's crates,
//! keeps its dependency surface tiny (just `winreg` + raw Win32 via
//! `windows-sys`), and never panics — every failure path falls through to
//! "launch explorer.exe and exit," never a silent hang or crash of its own.

use std::io::Write;
use std::path::PathBuf;
use std::process::{Child, Command};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

/// Below this runtime, an exit is treated as "failed to start" rather than
/// a normal user session ending — long enough for a real app to finish
/// initializing, short enough that a hang doesn't block fallback for long.
const STARTUP_GRACE: Duration = Duration::from_secs(15);

/// Hard cap on relaunch attempts in one watchdog run, so a persistently
/// broken Udaan build can't loop-spawn processes forever.
const MAX_RETRIES: u32 = 2;

// --- Guard mode ---------------------------------------------------------
//
// `shell-watchdog.exe --guard <pid>`: Udaan, running BESIDE Explorer, hides Explorer's
// taskbar. If Udaan dies without cleaning up (a crash, a power cut, `taskkill /f`) nothing
// inside Udaan can undo that, so this tiny separate process waits for Udaan's pid to end
// and then shows Explorer's taskbar again. Raw Win32 only, no dependencies, same reasons
// as the rest of this binary.

#[link(name = "user32")]
extern "system" {
  fn FindWindowExW(parent: isize, after: isize, class: *const u16, title: *const u16) -> isize;
  fn ShowWindow(hwnd: isize, cmd: i32) -> i32;
}
#[link(name = "kernel32")]
extern "system" {
  fn CreateMutexW(attrs: *const core::ffi::c_void, initial_owner: i32, name: *const u16) -> isize;
  fn OpenProcess(access: u32, inherit: i32, pid: u32) -> isize;
  fn WaitForSingleObject(handle: isize, millis: u32) -> u32;
  fn CloseHandle(handle: isize) -> i32;
}

fn wide(s: &str) -> Vec<u16> {
  s.encode_utf16().chain(std::iter::once(0)).collect()
}

/// Shows every Explorer taskbar window (primary and per-monitor secondary).
fn show_explorer_taskbars() {
  const SW_SHOWNA: i32 = 8;
  for class in ["Shell_TrayWnd", "Shell_SecondaryTrayWnd"] {
    let class = wide(class);
    let mut after = 0isize;
    loop {
      let h = unsafe { FindWindowExW(0, after, class.as_ptr(), std::ptr::null()) };
      if h == 0 {
        break;
      }
      unsafe { ShowWindow(h, SW_SHOWNA) };
      after = h;
    }
  }
}

fn guard(pid: u32) {
  const SYNCHRONIZE: u32 = 0x0010_0000;
  const INFINITE: u32 = 0xFFFF_FFFF;
  log_line(&format!("guard: watching Udaan pid {pid}"));
  // A named mutex held for as long as this guard lives, so Udaan can check we are alive.
  let name = wide(&format!("Local\\UdaanGuard.{pid}"));
  let _alive = unsafe { CreateMutexW(std::ptr::null(), 0, name.as_ptr()) };
  let handle = unsafe { OpenProcess(SYNCHRONIZE, 0, pid) };
  if handle != 0 {
    unsafe {
      WaitForSingleObject(handle, INFINITE);
      CloseHandle(handle);
    }
  }
  // Give a normal shutdown a moment to finish its own cleanup first; showing is idempotent.
  std::thread::sleep(Duration::from_millis(300));
  show_explorer_taskbars();
  log_line("guard: Udaan ended, Explorer's taskbar shown");
}

fn main() {
  let mut args = std::env::args().skip(1);
  if args.next().as_deref() == Some("--guard") {
    if let Some(pid) = args.next().and_then(|v| v.parse::<u32>().ok()) {
      guard(pid);
    }
    return;
  }
  log_line("shell-watchdog started");

  let udaan_path = match resolve_udaan_path() {
    Some(p) => p,
    None => {
      log_line("Could not resolve Udaan.exe path next to shell-watchdog.exe — falling back to explorer.exe immediately.");
      fall_back_to_explorer();
      return;
    }
  };

  let mut attempts = 0;
  loop {
    attempts += 1;
    log_line(&format!("Launching Udaan (attempt {attempts}): {}", udaan_path.display()));

    let launch_time = Instant::now();
    match Command::new(&udaan_path).spawn() {
      Ok(mut child) => {
        let exited_fast = wait_or_grace(&mut child, launch_time);
        if !exited_fast {
          // Udaan ran past the grace period and then exited (or the
          // process itself is still alive and we're just not watching
          // it further) — treat this as a normal end of session.
          log_line("Udaan exited after running normally — watchdog exiting without fallback.");
          return;
        }
        log_line("Udaan exited during its startup grace period — treating as a failed start.");
      }
      Err(e) => {
        log_line(&format!("Failed to spawn Udaan: {e}"));
      }
    }

    if attempts > MAX_RETRIES {
      log_line("Exceeded max retries — falling back to explorer.exe.");
      break;
    }
  }

  fall_back_to_explorer();
}

/// Waits for the child to exit. Returns `true` if it exited before the
/// startup grace period elapsed (a likely crash/failed-start), `false` if
/// it either outlived the grace period (then we stop watching it — a
/// long-running Udaan is a successful shell session) or the wait itself
/// errored (treated as "not a fast failure," so we don't fallback-loop on
/// a wait() error alone).
fn wait_or_grace(child: &mut Child, launch_time: Instant) -> bool {
  loop {
    match child.try_wait() {
      Ok(Some(_status)) => {
        return launch_time.elapsed() < STARTUP_GRACE;
      }
      Ok(None) => {
        if launch_time.elapsed() >= STARTUP_GRACE {
          // Survived the grace window — this is a real, running session.
          // Detach: we no longer need to supervise it for fallback
          // purposes (a later crash mid-session intentionally does NOT
          // relaunch explorer.exe out from under an otherwise-fine
          // desktop session — the user can use the in-app toggle, or the
          // documented manual recovery, if Udaan becomes unresponsive
          // later in the session).
          return false;
        }
        std::thread::sleep(Duration::from_millis(200));
      }
      Err(_) => return false,
    }
  }
}

fn fall_back_to_explorer() {
  log_line("Launching explorer.exe as fallback shell.");
  match Command::new("explorer.exe").spawn() {
    Ok(_) => log_line("explorer.exe launched successfully."),
    Err(e) => log_line(&format!("CRITICAL: failed to launch explorer.exe fallback: {e}")),
  }
}

/// Udaan.exe is expected to sit next to shell-watchdog.exe (same install
/// directory) — resolved from the watchdog's own path rather than any
/// hardcoded install location, so this keeps working if the app is
/// installed somewhere other than the default path.
fn resolve_udaan_path() -> Option<PathBuf> {
  let exe = std::env::current_exe().ok()?;
  let dir = exe.parent()?;
  // Installed builds are Udaan.exe; a dev build (cargo's own output) is app.exe.
  ["Udaan.exe", "app.exe"].iter().map(|n| dir.join(n)).find(|p| p.is_file())
}

/// Best-effort plain-text log next to the watchdog binary — deliberately
/// not using any logging crate (fewer dependencies, fewer ways for the
/// logger itself to fail) and every write is best-effort: a failure to log
/// must never stop the fallback logic from running.
fn log_line(message: &str) {
  let Some(exe) = std::env::current_exe().ok() else { return };
  let Some(dir) = exe.parent() else { return };
  let log_path = dir.join("shell-watchdog.log");
  let timestamp = SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .map(|d| d.as_secs())
    .unwrap_or(0);
  if let Ok(mut file) = std::fs::OpenOptions::new().create(true).append(true).open(log_path) {
    let _ = writeln!(file, "[{timestamp}] {message}");
  }
}
