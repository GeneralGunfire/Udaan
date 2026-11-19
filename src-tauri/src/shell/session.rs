//! Integration with the Windows session: starting at sign-in, and doing
//! the jobs Explorer normally does when Udaan is the real shell.

use std::path::PathBuf;

const RUN_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
/// The sign-in entry is named after the program file, so a second copy (a test build, `UdaanTest.exe`) never
/// overwrites the real install's entry. The shipped `Udaan.exe` keeps the name "Udaan".
fn run_value() -> String {
  std::env::current_exe().ok().and_then(|p| p.file_stem().map(|s| s.to_string_lossy().to_string())).filter(|s| !s.is_empty() && !s.eq_ignore_ascii_case("app")).unwrap_or_else(|| "Udaan".to_string())
}

/// What should run at sign-in. Release builds launch themselves; the dev
/// build can't run without its Vite server, so it launches the repo's own
/// hidden dev launcher instead.
fn autostart_command() -> Result<String, String> {
  if cfg!(debug_assertions) {
    let vbs: PathBuf = [env!("CARGO_MANIFEST_DIR"), "..", "run-dev-hidden.vbs"].iter().collect();
    let vbs = vbs.canonicalize().map_err(|e| format!("run-dev-hidden.vbs not found: {e}"))?;
    let vbs = vbs.to_string_lossy().trim_start_matches(r"\?\").to_string();
    Ok(format!("wscript.exe \"{vbs}\""))
  } else {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    Ok(format!("\"{}\"", exe.display()))
  }
}

#[cfg(target_os = "windows")]
mod imp {
  use super::*;
  use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, KEY_READ, KEY_SET_VALUE};
  use winreg::RegKey;

  pub fn autostart_enabled() -> bool {
    RegKey::predef(HKEY_CURRENT_USER)
      .open_subkey_with_flags(RUN_KEY, KEY_READ)
      .and_then(|k| k.get_value::<String, _>(run_value()))
      .is_ok()
  }

  pub fn set_autostart(enabled: bool) -> Result<(), String> {
    let (key, _) = RegKey::predef(HKEY_CURRENT_USER).create_subkey(RUN_KEY).map_err(|e| e.to_string())?;
    if enabled {
      key.set_value(run_value(), &autostart_command()?).map_err(|e| e.to_string())
    } else {
      match key.delete_value(run_value()) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
      }
    }
  }

  #[link(name = "user32")]
  extern "system" {
    fn GetShellWindow() -> isize;
    fn SetShellWindow(hwnd: isize) -> i32;
  }

  /// Registers the desktop as the session's shell window if no shell is
  /// running. Returns true when Udaan has become the shell, meaning
  /// Explorer isn't running as the desktop.
  pub fn claim_shell(desktop_hwnd: isize) -> bool {
    unsafe {
      if GetShellWindow() != 0 {
        return false;
      }
      SetShellWindow(desktop_hwnd) != 0
    }
  }

  fn run_command_line(cmd: &str) {
    use std::os::windows::process::CommandExt;
    // `start ""` detaches it and resolves paths/args exactly as the Run
    // key expects (the values are raw command lines).
    let _ = std::process::Command::new("cmd").raw_arg(format!("/c start \"\" {cmd}")).creation_flags(0x0800_0000).spawn();
  }

  /// Explorer runs these at sign-in; when Udaan is the shell nobody else
  /// will, so every startup program would silently stop starting.
  pub fn run_startup_programs() {
    for (hive, name) in [(HKEY_LOCAL_MACHINE, "HKLM"), (HKEY_CURRENT_USER, "HKCU")] {
      let root = RegKey::predef(hive);
      if let Ok(run) = root.open_subkey_with_flags(RUN_KEY, KEY_READ) {
        for (value, _) in run.enum_values().flatten() {
          if value.eq_ignore_ascii_case(&run_value()) {
            continue;
          }
          if let Ok(cmd) = run.get_value::<String, _>(&value) {
            log::info!("[session] {name} Run: {value}");
            run_command_line(&cmd);
          }
        }
      }
      // RunOnce entries run once and are then removed, as Explorer does.
      if let Ok(once) = root.open_subkey_with_flags(r"Software\Microsoft\Windows\CurrentVersion\RunOnce", KEY_READ | KEY_SET_VALUE) {
        let entries: Vec<(String, String)> = once
          .enum_values()
          .flatten()
          .filter_map(|(n, _)| once.get_value::<String, _>(&n).ok().map(|c| (n, c)))
          .collect();
        for (n, cmd) in entries {
          let _ = once.delete_value(&n);
          run_command_line(&cmd);
        }
      }
    }
    let folders = [dirs::data_dir().map(|d| d.join(r"Microsoft\Windows\Start Menu\Programs\Startup")), std::env::var("ProgramData").ok().map(|p| PathBuf::from(p).join(r"Microsoft\Windows\Start Menu\Programs\StartUp"))];
    for dir in folders.into_iter().flatten() {
      let Ok(entries) = std::fs::read_dir(&dir) else { continue };
      for entry in entries.flatten() {
        let path = entry.path();
        if path.file_name().is_some_and(|n| n.eq_ignore_ascii_case("desktop.ini")) {
          continue;
        }
        let _ = opener::open(&path);
      }
    }
  }
}

#[cfg(not(target_os = "windows"))]
mod imp {
  pub fn autostart_enabled() -> bool {
    false
  }
  pub fn set_autostart(_: bool) -> Result<(), String> {
    Err("Windows only".into())
  }
  pub fn claim_shell(_: isize) -> bool {
    false
  }
  pub fn run_startup_programs() {}
}

pub use imp::{claim_shell, run_startup_programs};

#[tauri::command]
pub fn shell_autostart_enabled() -> bool {
  imp::autostart_enabled()
}

#[tauri::command]
pub fn shell_set_autostart(enabled: bool) -> Result<(), String> {
  imp::set_autostart(enabled)
}

/// Makes sure an existing sign-in entry points at this build (e.g. after
/// moving the install), without turning it on if the user turned it off.
pub fn refresh_autostart_target() {
  if imp::autostart_enabled() {
    let _ = imp::set_autostart(true);
  }
}
