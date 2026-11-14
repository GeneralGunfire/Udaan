//! System health checks — disk space and RAM usage, exposed to the frontend
//! via a single Tauri command. Single-file module, following the same
//! pattern as `local_model/mod.rs`.

use serde::Serialize;
use sysinfo::Disks;

#[derive(Debug, Clone, Serialize)]
pub struct MemoryStats {
  pub total_bytes: u64,
  pub used_bytes: u64,
  pub free_bytes: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct DiskStats {
  pub name: String,
  pub mount_point: String,
  pub total_bytes: u64,
  pub used_bytes: u64,
  pub free_bytes: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct SystemStats {
  pub memory: MemoryStats,
  /// All mounted physical disks, not just the one the app data dir lives on —
  /// on a personal desktop machine, "is my C: drive full" and "is my D:
  /// drive full" are both worth surfacing, and there's usually only 1-3
  /// disks so showing all of them costs little.
  pub disks: Vec<DiskStats>,
}

#[tauri::command(async)]
pub fn system_health_stats() -> Result<SystemStats, String> {
  let mut sys = sysinfo::System::new();
  sys.refresh_memory();

  let memory = MemoryStats {
    total_bytes: sys.total_memory(),
    used_bytes: sys.used_memory(),
    free_bytes: sys.total_memory().saturating_sub(sys.used_memory()),
  };

  let disks_list = Disks::new_with_refreshed_list();
  let disks = disks_list
    .iter()
    .map(|d| {
      let total = d.total_space();
      let free = d.available_space();
      DiskStats {
        name: d.name().to_string_lossy().into_owned(),
        mount_point: d.mount_point().to_string_lossy().into_owned(),
        total_bytes: total,
        used_bytes: total.saturating_sub(free),
        free_bytes: free,
      }
    })
    .collect();

  Ok(SystemStats { memory, disks })
}
