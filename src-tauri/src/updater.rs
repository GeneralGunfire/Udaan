//! In-place updates. The app finds out there is a newer version (from the release file, in the front end),
//! then asks this module to apply it:
//!
//!   1. download the installer from the project's GitHub Releases (nothing else is accepted)
//!   2. check its SHA-256 against the value published in `latest.json`; a mismatch deletes it and stops
//!   3. run it silently over the top of the current install, then start Udaan again
//!
//! The installer replaces program files only. Everything the person made (PIN, Work password, notes,
//! settings, wallpapers they added) lives in the app data folder, which the installer never touches, so an
//! update cannot lose it. Starting again goes through the normal start-up, which applies any data migrations.

use serde::Serialize;
use sha2::{Digest, Sha256};
use std::io::Write;
use tauri::{AppHandle, Emitter};

/// Only installers published on this project's releases can be run.
const ALLOWED_PREFIX: &str = "https://github.com/GeneralGunfire/Udaan/releases/download/";

#[derive(Serialize, Clone)]
struct Progress {
  done: u64,
  total: u64,
}

/// True when `url` is a release asset of this project, over https, with a plain file name.
fn allowed(url: &str) -> bool {
  let Some(rest) = url.strip_prefix(ALLOWED_PREFIX) else { return false };
  !rest.contains("..") && !rest.contains('\\') && rest.ends_with("-setup.exe") && rest.matches('/').count() == 1
}

fn hex(bytes: &[u8]) -> String {
  bytes.iter().map(|b| format!("{b:02x}")).collect()
}

#[tauri::command]
pub async fn update_install(app: AppHandle, url: String, sha256: String) -> Result<(), String> {
  if !allowed(&url) {
    return Err("That address is not an Udaan release.".into());
  }
  let want = sha256.trim().to_ascii_lowercase();
  if want.len() != 64 || !want.chars().all(|c| c.is_ascii_hexdigit()) {
    return Err("The release has no valid checksum, so it was not installed.".into());
  }

  let dir = std::env::temp_dir().join("udaan-update");
  std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
  let file = dir.join("Udaan-setup.exe");

  let mut resp = reqwest::get(&url).await.map_err(|e| format!("Could not download the update: {e}"))?;
  if !resp.status().is_success() {
    return Err(format!("The download failed ({}).", resp.status()));
  }
  let total = resp.content_length().unwrap_or(0);
  let mut out = std::fs::File::create(&file).map_err(|e| e.to_string())?;
  let mut hasher = Sha256::new();
  let mut done = 0u64;
  let mut last = 0u64;
  while let Some(chunk) = resp.chunk().await.map_err(|e| format!("The download was interrupted: {e}"))? {
    hasher.update(&chunk);
    out.write_all(&chunk).map_err(|e| e.to_string())?;
    done += chunk.len() as u64;
    if done - last > 512 * 1024 {
      last = done;
      let _ = app.emit("update://progress", Progress { done, total });
    }
  }
  drop(out);

  if hex(&hasher.finalize()) != want {
    let _ = std::fs::remove_file(&file);
    return Err("The download did not match its checksum, so it was thrown away. Nothing was changed.".into());
  }

  launch_and_restart(&app, &file)
}

/// Runs the installer silently, then starts Udaan again, from a detached helper that outlives this process.
#[cfg(target_os = "windows")]
fn launch_and_restart(app: &AppHandle, installer: &std::path::Path) -> Result<(), String> {
  use std::os::windows::process::CommandExt;
  let exe = std::env::current_exe().map_err(|e| e.to_string())?;
  let line = format!("/c \"\"{}\" /S & start \"\" \"{}\"\"", installer.display(), exe.display());
  // DETACHED_PROCESS | CREATE_NO_WINDOW
  std::process::Command::new("cmd").raw_arg(line).creation_flags(0x0000_0008 | 0x0800_0000).spawn().map_err(|e| format!("Could not start the installer: {e}"))?;
  let h = app.clone();
  std::thread::spawn(move || {
    std::thread::sleep(std::time::Duration::from_millis(600));
    h.exit(0);
  });
  Ok(())
}

#[cfg(not(target_os = "windows"))]
fn launch_and_restart(_app: &AppHandle, _installer: &std::path::Path) -> Result<(), String> {
  Err("Updates are only supported on Windows.".into())
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn only_this_projects_release_installers_are_allowed() {
    assert!(allowed("https://github.com/GeneralGunfire/Udaan/releases/download/v0.2.0/Udaan_0.2.0_x64-setup.exe"));
    assert!(!allowed("https://evil.example/releases/download/v0.2.0/Udaan-setup.exe"));
    assert!(!allowed("http://github.com/GeneralGunfire/Udaan/releases/download/v0.2.0/Udaan-setup.exe"));
    assert!(!allowed("https://github.com/GeneralGunfire/Udaan/releases/download/../../x/a-setup.exe"));
    assert!(!allowed("https://github.com/GeneralGunfire/Udaan/releases/download/v0.2.0/virus.exe"));
    assert!(!allowed("https://github.com/GeneralGunfire/Udaan/releases/download/v0.2.0/a/b-setup.exe"));
  }

  #[test]
  fn hex_is_lowercase_and_padded() {
    assert_eq!(hex(&[0, 15, 255]), "000fff");
  }
}
