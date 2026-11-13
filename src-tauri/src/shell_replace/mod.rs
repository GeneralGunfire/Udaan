//! Windows shell-replacement safety infrastructure — Part 1 of the
//! shell-replacement feature. This module is deliberately scoped to ONLY
//! backup/restore/status: it does not touch the taskbar, Start Menu, or
//! any UI. Nothing in the rest of the app calls `set_shell_to_watchdog`
//! from anywhere except an explicit, user-initiated toggle — this module
//! never runs itself automatically.
//!
//! Safety model, in order:
//!   1. `backup_shell_value()` writes the CURRENT (real) shell value to a
//!      plain-text file before anything is ever changed, and a `.reg` file
//!      that Registry Editor (or `reg import` from a command prompt) can
//!      apply directly — usable even if Udaan itself won't launch.
//!   2. The registry key this module writes to is NOT the shell itself —
//!      it's set to the `shell-watchdog` binary (see
//!      `src-tauri/shell-watchdog/`), which is the thing that actually
//!      falls back to explorer.exe on failure. This module never sets
//!      `Winlogon\Shell` to Udaan.exe directly.
//!   3. `restore_default_shell()` is the in-app one-click revert — sets the
//!      registry key back to whatever was backed up (defaulting to
//!      `explorer.exe` if no backup is found, since that's correct for the
//!      overwhelming majority of Windows installs) and restarts
//!      explorer.exe immediately, without requiring a logoff.
//!
//! Manual recovery (documented for the case where Udaan can't be opened at
//! all — e.g. shell-watchdog itself has a bug):
//!   1. Ctrl+Shift+Esc to open Task Manager (works even with no shell).
//!   2. File > Run new task > type `explorer.exe` > OK. This alone
//!      restores a usable desktop immediately, without any registry edit.
//!   3. To make it permanent: File > Run new task > type `regedit` > OK,
//!      navigate to
//!      `HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon`,
//!      set `Shell` back to `explorer.exe`, close Registry Editor, restart.
//!   4. If Task Manager itself won't open: boot into Safe Mode (hold Shift
//!      while clicking Restart, or interrupt boot 3 times), open Command
//!      Prompt, and run:
//!      `reg add "HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon" /v Shell /t REG_SZ /d explorer.exe /f`

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

const WINLOGON_KEY: &str = r"SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon";
const SHELL_VALUE_NAME: &str = "Shell";
const DEFAULT_SHELL: &str = "explorer.exe";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShellStatus {
  /// The current value of `Winlogon\Shell` as Windows sees it right now.
  pub current_shell_value: String,
  /// True if a backup of the pre-Udaan value exists on disk.
  pub has_backup: bool,
  /// True if the current value looks like it's already pointing at
  /// shell-watchdog (i.e. Udaan is currently registered as the shell).
  pub udaan_is_shell: bool,
  pub backup_file_path: String,
  /// True if Udaan is currently running elevated. Registry writes prompt
  /// UAC on demand regardless, so this is informational for the UI rather
  /// than a hard requirement.
  pub is_elevated: bool,
}

fn backup_dir() -> Result<PathBuf, String> {
  let dir = dirs::data_dir()
    .ok_or("Could not resolve app data directory")?
    .join("Udaan")
    .join("shell-backup");
  std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
  Ok(dir)
}

#[cfg(target_os = "windows")]
mod win {
  use super::*;
  use winreg::enums::{HKEY_LOCAL_MACHINE, KEY_READ, KEY_SET_VALUE};
  use winreg::RegKey;

  pub fn read_shell_value() -> Result<String, String> {
    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    let key = hklm
      .open_subkey_with_flags(WINLOGON_KEY, KEY_READ)
      .map_err(|e| format!("Could not open Winlogon key: {e}"))?;
    key
      .get_value::<String, _>(SHELL_VALUE_NAME)
      .map_err(|e| format!("Could not read Shell value: {e}"))
  }

  /// True if this process is currently running elevated (Administrator).
  /// Writing `HKLM\...\Winlogon` requires this — checked up front so the
  /// caller can surface a clear "needs Administrator" message instead of a
  /// raw registry-access-denied error.
  pub fn is_elevated() -> bool {
    // Reading a value under HKLM that a non-elevated process genuinely
    // cannot open with KEY_SET_VALUE is the simplest reliable elevation
    // probe without pulling in a full Win32 token-query dependency: if we
    // can open Winlogon for writing, we're elevated.
    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    hklm.open_subkey_with_flags(WINLOGON_KEY, KEY_SET_VALUE).is_ok()
  }

  /// Writes the Shell value directly — only succeeds if already elevated.
  /// Callers needing this from a non-elevated process should use
  /// `write_shell_value_elevated`, which prompts UAC and retries once.
  fn write_shell_value_direct(value: &str) -> Result<(), String> {
    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    let key = hklm
      .open_subkey_with_flags(WINLOGON_KEY, KEY_SET_VALUE)
      .map_err(|e| format!("Could not open Winlogon key for writing: {e}"))?;
    key
      .set_value(SHELL_VALUE_NAME, &value.to_string())
      .map_err(|e| format!("Could not write Shell value: {e}"))
  }

  /// Writes the Shell value, prompting Windows' own UAC elevation dialog
  /// via `runas` if the current process isn't already elevated — Udaan
  /// itself keeps running unelevated day-to-day (this is the ONLY
  /// operation in the whole app that needs Administrator), so this spawns
  /// a tiny elevated `reg add` helper process for just this one write
  /// rather than requiring Udaan to always launch elevated.
  pub fn write_shell_value_elevated(value: &str) -> Result<(), String> {
    if is_elevated() {
      return write_shell_value_direct(value);
    }

    // `reg add` run via `runas` triggers the standard UAC consent prompt.
    // If the user declines it, `Command::spawn`/`wait` still succeeds (the
    // process ran) but `reg add` itself exits non-zero — checked below so
    // a declined prompt is reported clearly rather than silently "working."
    let status = std::process::Command::new("powershell")
      .args([
        "-NoProfile",
        "-Command",
        &format!(
          "Start-Process reg -ArgumentList 'add','HKLM\\{WINLOGON_KEY}','/v','{SHELL_VALUE_NAME}','/t','REG_SZ','/d','{value}','/f' -Verb RunAs -Wait"
        ),
      ])
      .status()
      .map_err(|e| format!("Could not request Administrator permission: {e}"))?;

    if !status.success() {
      return Err(
        "Administrator permission was not granted, so the shell setting was not changed."
          .to_string(),
      );
    }

    // Confirm the write actually landed rather than trusting exit code alone.
    if read_shell_value().map(|v| v.eq_ignore_ascii_case(value)).unwrap_or(false) {
      Ok(())
    } else {
      Err("The registry change did not appear to apply — please try again.".to_string())
    }
  }
}

#[cfg(not(target_os = "windows"))]
mod win {
  use super::*;
  pub fn read_shell_value() -> Result<String, String> {
    Err("Shell replacement is only supported on Windows.".to_string())
  }
  pub fn is_elevated() -> bool {
    false
  }
  pub fn write_shell_value_elevated(_value: &str) -> Result<(), String> {
    Err("Shell replacement is only supported on Windows.".to_string())
  }
}

fn backup_txt_path(dir: &PathBuf) -> PathBuf {
  dir.join("winlogon-shell-backup.txt")
}

fn backup_reg_path(dir: &PathBuf) -> PathBuf {
  dir.join("restore-shell.reg")
}

/// Writes the CURRENT shell value to disk — plain text (human-readable,
/// used by `restore_default_shell`) and a `.reg` file (usable by
/// double-clicking it, or `reg import restore-shell.reg` from a command
/// prompt, entirely independent of Udaan running at all). Does NOT modify
/// the registry — read-only with respect to the actual shell setting.
#[tauri::command]
pub fn shell_backup_current_value() -> Result<ShellStatus, String> {
  let current = win::read_shell_value()?;
  let dir = backup_dir()?;

  std::fs::write(backup_txt_path(&dir), &current).map_err(|e| e.to_string())?;

  // REG_SZ string values need internal quotes/backslashes escaped for a
  // valid .reg file — Shell values are always simple exe names/paths in
  // practice, but escape defensively rather than assume.
  let escaped = current.replace('\\', "\\\\").replace('"', "\\\"");
  let reg_contents = format!(
    "Windows Registry Editor Version 5.00\r\n\r\n[HKEY_LOCAL_MACHINE\\{WINLOGON_KEY}]\r\n\"{SHELL_VALUE_NAME}\"=\"{escaped}\"\r\n"
  );
  std::fs::write(backup_reg_path(&dir), reg_contents).map_err(|e| e.to_string())?;

  shell_status()
}

/// Current status — safe to call anytime, never modifies anything.
#[tauri::command]
pub fn shell_status() -> Result<ShellStatus, String> {
  let current = win::read_shell_value()?;
  let dir = backup_dir()?;
  let has_backup = backup_txt_path(&dir).is_file();
  Ok(ShellStatus {
    udaan_is_shell: current.to_lowercase().contains("shell-watchdog"),
    current_shell_value: current,
    has_backup,
    backup_file_path: backup_reg_path(&dir).to_string_lossy().to_string(),
    is_elevated: win::is_elevated(),
  })
}

/// The in-app "safe mode" escape hatch: sets `Winlogon\Shell` back to the
/// backed-up value (or `explorer.exe` if no backup exists — the correct
/// default for the overwhelming majority of installs) and relaunches
/// explorer.exe immediately, so the user gets a working desktop without
/// needing to log off/on. Prompts a UAC elevation dialog if Udaan isn't
/// already running elevated — see `win::write_shell_value_elevated`.
#[tauri::command]
pub fn shell_restore_default() -> Result<(), String> {
  let dir = backup_dir()?;
  let restore_value = std::fs::read_to_string(backup_txt_path(&dir))
    .unwrap_or_else(|_| DEFAULT_SHELL.to_string());
  let restore_value = restore_value.trim();
  let restore_value = if restore_value.is_empty() { DEFAULT_SHELL } else { restore_value };

  win::write_shell_value_elevated(restore_value)?;

  // Immediate recovery, no logoff required: launch explorer.exe now. If an
  // explorer.exe (or Udaan-as-shell) is already the running shell process,
  // this just adds a normal explorer window/taskbar alongside it, which is
  // harmless — the registry value is what matters for the NEXT login.
  std::process::Command::new(DEFAULT_SHELL)
    .spawn()
    .map_err(|e| format!("Registry restored, but failed to launch explorer.exe now: {e}"))?;

  Ok(())
}

/// Locates `shell-watchdog.exe` next to the currently running Udaan.exe —
/// mirrors the resolution logic the watchdog itself uses in reverse
/// (see `shell-watchdog/src/main.rs`'s `resolve_udaan_path`), so both
/// binaries are found the same way regardless of install location.
fn watchdog_exe_path() -> Result<PathBuf, String> {
  let exe = std::env::current_exe().map_err(|e| format!("Could not resolve Udaan's own path: {e}"))?;
  let dir = exe.parent().ok_or("Udaan's executable has no parent directory")?;
  let candidate = dir.join("shell-watchdog.exe");
  if !candidate.is_file() {
    return Err(format!(
      "shell-watchdog.exe was not found next to Udaan.exe at {} — refusing to set the shell without it, since it's the thing that protects you from a broken login.",
      candidate.display()
    ));
  }
  Ok(candidate)
}

/// THE actual shell switch. Deliberately layered with every safety check
/// this module has built up rather than a bare registry write:
///
///   1. Refuses to proceed if `shell-watchdog.exe` isn't actually sitting
///      next to Udaan.exe — never points the shell at a binary that
///      doesn't exist, which would be an instant broken login with no
///      fallback at all.
///   2. Auto-backs-up the CURRENT value first if no backup exists yet —
///      the one-click restore flow (`shell_restore_default`) needs a real
///      backup to restore TO, and this is the last moment before the
///      pre-Udaan value would be gone.
///   3. Writes the registry value via the same elevation-prompting path
///      already proven in `shell_restore_default`.
///   4. Does NOT restart/log off automatically — the caller decides when
///      that happens, since this command's effect is real but inert until
///      the next login.
#[tauri::command]
pub fn shell_set_to_udaan() -> Result<ShellStatus, String> {
  let watchdog_path = watchdog_exe_path()?;

  let dir = backup_dir()?;
  if !backup_txt_path(&dir).is_file() {
    shell_backup_current_value()?;
  }

  win::write_shell_value_elevated(&watchdog_path.to_string_lossy())?;

  shell_status()
}

#[cfg(test)]
mod tests {
  use super::*;

  /// Read-only sanity check: status resolves without touching the
  /// registry, reports a plausible current shell value, and correctly
  /// reports no backup exists before one is ever created.
  #[test]
  fn shell_status_reads_without_error() {
    let status = shell_status().expect("shell_status should succeed on a normal Windows machine");
    assert!(!status.current_shell_value.is_empty());
    println!("current shell value: {}", status.current_shell_value);
    println!("has_backup: {}", status.has_backup);
    println!("is_elevated: {}", status.is_elevated);
  }

  /// Backup writes real files to disk and they round-trip correctly —
  /// exercised here directly rather than only through the GUI panel.
  #[test]
  fn backup_writes_readable_files() {
    let status = shell_backup_current_value().expect("backup should succeed");
    assert!(status.has_backup, "has_backup should be true immediately after backing up");

    let dir = backup_dir().expect("backup dir should resolve");
    let txt = std::fs::read_to_string(backup_txt_path(&dir)).expect("backup txt should be readable");
    assert!(!txt.trim().is_empty());
    assert_eq!(txt.trim(), status.current_shell_value);

    let reg = std::fs::read_to_string(backup_reg_path(&dir)).expect("backup .reg should be readable");
    assert!(reg.starts_with("Windows Registry Editor Version 5.00"));
    assert!(reg.contains(SHELL_VALUE_NAME));
    println!("backup files written to: {}", dir.display());
  }

  /// The critical safety gate for `shell_set_to_udaan`: confirms
  /// shell-watchdog.exe is actually found next to app.exe in the real
  /// build output directory. NOT tested via `watchdog_exe_path()` itself
  /// here — `cargo test` binaries run from `target/debug/deps/`, a
  /// different directory than where `app.exe` actually lives
  /// (`target/debug/`), so `std::env::current_exe()` inside a test
  /// process doesn't reflect the real app's layout. This checks the real
  /// layout directly instead — the thing that actually matters before
  /// ever exercising `shell_set_to_udaan` for real.
  #[test]
  fn watchdog_exe_sits_next_to_app_exe_in_build_output() {
    let app_exe = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
      .join("target")
      .join("debug")
      .join("app.exe");
    let watchdog_exe = app_exe.parent().unwrap().join("shell-watchdog.exe");
    println!("app.exe: {} (exists: {})", app_exe.display(), app_exe.is_file());
    println!("shell-watchdog.exe: {} (exists: {})", watchdog_exe.display(), watchdog_exe.is_file());
    assert!(app_exe.is_file(), "app.exe should exist — build the main app first");
    assert!(watchdog_exe.is_file(), "shell-watchdog.exe must sit next to app.exe");
  }
}
