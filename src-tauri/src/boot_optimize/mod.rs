//! Stage 2 of the boot splash sequence — safe, reversible, read-mostly
//! performance maintenance that runs once on every startup. Every action
//! here is deliberately conservative: nothing touches user files, nothing
//! disables anything silently, and every step's result is logged to a
//! plain-text file the user can review (`boot-optimize.log` in the app
//! data dir). See the review list this module implements:
//!   1. Clear stale files from TEMP folders (age-gated, skips locked files)
//!   2. Enumerate startup programs (read-only, just reported)
//!   3. Check disk free space (read-only)
//!   4. Check memory usage (read-only)
//!   5. Flush the DNS resolver cache (safe, self-repopulating)
//!
//! Progress is reported via the `boot:optimize-progress` Tauri event so the
//! splash screen can show granular sub-status text as each step runs.

use serde::Serialize;
use std::fs;
use std::path::PathBuf;
use std::time::{Duration, SystemTime};
use tauri::Emitter;

/// Files older than this are considered safe to delete from TEMP — recent
/// files may still be in use by a running process.
const TEMP_FILE_MIN_AGE: Duration = Duration::from_secs(24 * 60 * 60);

#[derive(Debug, Clone, Serialize)]
pub struct BootOptimizeStep {
  pub step: String,
  pub detail: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct StartupProgram {
  pub name: String,
  pub command: String,
  pub source: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct BootOptimizeReport {
  pub temp_files_deleted: u64,
  pub temp_bytes_freed: u64,
  pub startup_programs: Vec<StartupProgram>,
  pub disk_free_bytes: u64,
  pub disk_total_bytes: u64,
  pub memory_free_bytes: u64,
  pub memory_total_bytes: u64,
  pub dns_cache_flushed: bool,
  pub log_file_path: String,
}

fn log_path() -> Result<PathBuf, String> {
  let dir = dirs::data_dir()
    .ok_or("Could not resolve app data directory")?
    .join("Udaan");
  fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
  Ok(dir.join("boot-optimize.log"))
}

fn append_log(lines: &[String]) {
  let Ok(path) = log_path() else { return };
  let timestamp = chrono::Local::now().format("%Y-%m-%d %H:%M:%S");
  let mut body = format!("\n--- {timestamp} ---\n");
  for line in lines {
    body.push_str(line);
    body.push('\n');
  }
  let _ = fs::OpenOptions::new()
    .create(true)
    .append(true)
    .open(&path)
    .and_then(|mut f| {
      use std::io::Write;
      f.write_all(body.as_bytes())
    });
}

fn emit_progress(app: &tauri::AppHandle, step: &str, detail: &str) {
  let _ = app.emit(
    "boot:optimize-progress",
    BootOptimizeStep {
      step: step.to_string(),
      detail: detail.to_string(),
    },
  );
}

/// Deletes files under a TEMP directory older than `TEMP_FILE_MIN_AGE`,
/// skipping anything locked/in-use or that fails to delete for any reason
/// — never forces, never touches subdirectory structure beyond removing
/// now-empty directories it created the deletions in.
fn clean_temp_dir(dir: &PathBuf) -> (u64, u64) {
  let mut deleted = 0u64;
  let mut freed = 0u64;
  let now = SystemTime::now();

  let Ok(entries) = fs::read_dir(dir) else {
    return (0, 0);
  };

  for entry in entries.flatten() {
    let path = entry.path();
    let Ok(metadata) = entry.metadata() else { continue };

    let age_ok = metadata
      .modified()
      .ok()
      .and_then(|m| now.duration_since(m).ok())
      .map(|age| age >= TEMP_FILE_MIN_AGE)
      .unwrap_or(false);

    if !age_ok {
      continue;
    }

    if metadata.is_file() {
      let size = metadata.len();
      if fs::remove_file(&path).is_ok() {
        deleted += 1;
        freed += size;
      }
    }
    // Directories inside TEMP are left alone — recursing into arbitrary
    // subfolders risks catching something still in use by a running
    // process; only top-level loose files are cleared.
  }

  (deleted, freed)
}

fn clear_temp_files() -> (u64, u64) {
  let mut total_deleted = 0u64;
  let mut total_freed = 0u64;

  let mut dirs = Vec::new();
  if let Some(tmp) = std::env::var_os("TEMP") {
    dirs.push(PathBuf::from(tmp));
  }
  if let Some(tmp) = std::env::var_os("TMP") {
    dirs.push(PathBuf::from(tmp));
  }
  dirs.dedup();

  for dir in dirs {
    let (deleted, freed) = clean_temp_dir(&dir);
    total_deleted += deleted;
    total_freed += freed;
  }

  (total_deleted, total_freed)
}

#[cfg(target_os = "windows")]
mod win {
  use super::StartupProgram;
  use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, KEY_READ};
  use winreg::{RegKey, HKEY};

  /// Read-only enumeration of Run/RunOnce registry keys — reported for
  /// visibility only, nothing is ever disabled here.
  fn read_run_key(hive: HKEY, path: &str, source: &str) -> Vec<StartupProgram> {
    let key = RegKey::predef(hive);
    let Ok(run) = key.open_subkey_with_flags(path, KEY_READ) else {
      return Vec::new();
    };
    run
      .enum_values()
      .filter_map(|v| v.ok())
      .map(|(name, value)| StartupProgram {
        name,
        command: value.to_string(),
        source: source.to_string(),
      })
      .collect()
  }

  pub fn list_startup_programs() -> Vec<StartupProgram> {
    let mut programs = Vec::new();
    programs.extend(read_run_key(
      HKEY_CURRENT_USER,
      r"Software\Microsoft\Windows\CurrentVersion\Run",
      "HKCU\\Run",
    ));
    programs.extend(read_run_key(
      HKEY_LOCAL_MACHINE,
      r"Software\Microsoft\Windows\CurrentVersion\Run",
      "HKLM\\Run",
    ));
    programs
  }

  /// Flushes the DNS resolver cache — a standard, fully safe maintenance
  /// action; the cache simply repopulates on the next lookup.
  pub fn flush_dns_cache() -> bool {
    std::process::Command::new("ipconfig")
      .arg("/flushdns")
      .status()
      .map(|s| s.success())
      .unwrap_or(false)
  }
}

#[cfg(not(target_os = "windows"))]
mod win {
  use super::StartupProgram;
  pub fn list_startup_programs() -> Vec<StartupProgram> {
    Vec::new()
  }
  pub fn flush_dns_cache() -> bool {
    false
  }
}

/// Runs Stage 2 of the boot sequence: temp cleanup, startup-program audit,
/// disk/memory check, DNS flush. Emits `boot:optimize-progress` events as
/// each step starts so the splash screen can show granular status text.
/// Every step is independently fault-tolerant — a failure in one does not
/// abort the rest, since none of these are load-bearing for the app to run.
#[tauri::command]
pub fn boot_optimize_run(app: tauri::AppHandle) -> Result<BootOptimizeReport, String> {
  let mut log_lines = Vec::new();

  emit_progress(&app, "temp", "Clearing temporary files...");
  let (temp_files_deleted, temp_bytes_freed) = clear_temp_files();
  log_lines.push(format!(
    "Cleared {temp_files_deleted} temp file(s), freed {temp_bytes_freed} bytes"
  ));

  emit_progress(&app, "startup", "Checking startup programs...");
  let startup_programs = win::list_startup_programs();
  log_lines.push(format!(
    "Found {} startup program(s): {}",
    startup_programs.len(),
    startup_programs
      .iter()
      .map(|p| p.name.as_str())
      .collect::<Vec<_>>()
      .join(", ")
  ));

  emit_progress(&app, "disk", "Checking disk space...");
  let disks = sysinfo::Disks::new_with_refreshed_list();
  let (disk_free_bytes, disk_total_bytes) = disks
    .iter()
    .next()
    .map(|d| (d.available_space(), d.total_space()))
    .unwrap_or((0, 0));
  log_lines.push(format!(
    "Disk: {disk_free_bytes} bytes free of {disk_total_bytes} total"
  ));

  emit_progress(&app, "memory", "Checking memory...");
  let mut sys = sysinfo::System::new();
  sys.refresh_memory();
  let memory_total_bytes = sys.total_memory();
  let memory_free_bytes = memory_total_bytes.saturating_sub(sys.used_memory());
  log_lines.push(format!(
    "Memory: {memory_free_bytes} bytes free of {memory_total_bytes} total"
  ));

  emit_progress(&app, "dns", "Refreshing network cache...");
  let dns_cache_flushed = win::flush_dns_cache();
  log_lines.push(format!("DNS cache flushed: {dns_cache_flushed}"));

  append_log(&log_lines);

  Ok(BootOptimizeReport {
    temp_files_deleted,
    temp_bytes_freed,
    startup_programs,
    disk_free_bytes,
    disk_total_bytes,
    memory_free_bytes,
    memory_total_bytes,
    dns_cache_flushed,
    log_file_path: log_path().map(|p| p.to_string_lossy().into_owned()).unwrap_or_default(),
  })
}
