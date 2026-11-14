//! Crash-safe breadcrumb log. A release build has no console, so without this a panic
//! or a failed service leaves nothing to look at. Appends one line per event to
//! `%LOCALAPPDATA%\dev.udaan.workstation\engine.log` and truncates it when it grows
//! past 512 KB so it can never become a disk problem.

use std::io::Write;
use std::sync::OnceLock;

static PATH: OnceLock<Option<std::path::PathBuf>> = OnceLock::new();
const MAX_BYTES: u64 = 512 * 1024;

pub fn init() {
  PATH.get_or_init(|| {
    let dir = dirs::data_local_dir()?.join("dev.udaan.workstation");
    std::fs::create_dir_all(&dir).ok()?;
    let path = dir.join("engine.log");
    if std::fs::metadata(&path).map(|m| m.len() > MAX_BYTES).unwrap_or(false) {
      let _ = std::fs::remove_file(&path);
    }
    Some(path)
  });
}

pub fn line(msg: &str) {
  let Some(Some(path)) = PATH.get() else { return };
  let secs = std::time::SystemTime::now()
    .duration_since(std::time::UNIX_EPOCH)
    .map(|d| d.as_secs())
    .unwrap_or(0);
  if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
    let _ = writeln!(f, "{secs} {msg}");
  }
}
