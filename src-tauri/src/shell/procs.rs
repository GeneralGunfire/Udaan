//! Process list and system load for Activity Monitor.

use serde::Serialize;
use std::sync::{Mutex, OnceLock};
use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, RefreshKind, System, CpuRefreshKind, MemoryRefreshKind};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcInfo {
  pub pid: u32,
  pub name: String,
  pub exe: Option<String>,
  /// Percent of the whole machine (0–100), not of one core.
  pub cpu: f32,
  pub memory: u64,
  pub parent: Option<u32>,
  pub run_time: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemLoad {
  pub cpu: f32,
  pub per_core: Vec<f32>,
  pub memory_used: u64,
  pub memory_total: u64,
  pub swap_used: u64,
  pub swap_total: u64,
  pub process_count: usize,
  pub uptime: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
  pub load: SystemLoad,
  pub processes: Vec<ProcInfo>,
}

// CPU usage is a delta between two refreshes, so one System lives for the
// app's lifetime and every call measures since the previous one.
static SYS: OnceLock<Mutex<System>> = OnceLock::new();

fn sys() -> &'static Mutex<System> {
  SYS.get_or_init(|| {
    Mutex::new(System::new_with_specifics(
      RefreshKind::nothing().with_cpu(CpuRefreshKind::everything()).with_memory(MemoryRefreshKind::everything()),
    ))
  })
}

pub fn snapshot() -> Snapshot {
  let mut s = sys().lock().unwrap_or_else(|e| e.into_inner());
  s.refresh_cpu_all();
  s.refresh_memory();
  s.refresh_processes_specifics(ProcessesToUpdate::All, true, ProcessRefreshKind::everything().without_environ().without_disk_usage());
  let cores = s.cpus().len().max(1) as f32;
  let processes: Vec<ProcInfo> = s
    .processes()
    .values()
    .map(|p| ProcInfo {
      pid: p.pid().as_u32(),
      name: p.name().to_string_lossy().into_owned(),
      exe: p.exe().map(|e| e.to_string_lossy().into_owned()),
      cpu: p.cpu_usage() / cores,
      memory: p.memory(),
      parent: p.parent().map(|x| x.as_u32()),
      run_time: p.run_time(),
    })
    .collect();
  Snapshot {
    load: SystemLoad {
      cpu: s.global_cpu_usage(),
      per_core: s.cpus().iter().map(|c| c.cpu_usage()).collect(),
      memory_used: s.used_memory(),
      memory_total: s.total_memory(),
      swap_used: s.used_swap(),
      swap_total: s.total_swap(),
      process_count: processes.len(),
      uptime: System::uptime(),
    },
    processes,
  }
}

#[tauri::command]
pub async fn shell_processes() -> Snapshot {
  tauri::async_runtime::spawn_blocking(snapshot).await.unwrap_or_else(|_| Snapshot {
    load: SystemLoad { cpu: 0.0, per_core: vec![], memory_used: 0, memory_total: 0, swap_used: 0, swap_total: 0, process_count: 0, uptime: 0 },
    processes: vec![],
  })
}

/// CPU and memory only, for widgets: no process walk, so it's cheap to poll.
#[tauri::command]
pub async fn shell_system_load() -> SystemLoad {
  tauri::async_runtime::spawn_blocking(|| {
    let mut s = sys().lock().unwrap_or_else(|e| e.into_inner());
    s.refresh_cpu_all();
    s.refresh_memory();
    SystemLoad {
      cpu: s.global_cpu_usage(),
      per_core: vec![],
      memory_used: s.used_memory(),
      memory_total: s.total_memory(),
      swap_used: s.used_swap(),
      swap_total: s.total_swap(),
      process_count: 0,
      uptime: System::uptime(),
    }
  })
  .await
  .unwrap_or(SystemLoad { cpu: 0.0, per_core: vec![], memory_used: 0, memory_total: 0, swap_used: 0, swap_total: 0, process_count: 0, uptime: 0 })
}

/// Ends a process. Refuses Udaan itself and the core Windows processes
/// whose termination would log the user out or crash the session.
#[tauri::command(async)]
pub fn shell_end_process(pid: u32) -> Result<(), String> {
  if pid == std::process::id() {
    return Err("Udaan can't end itself from here.".into());
  }
  let mut s = sys().lock().unwrap_or_else(|e| e.into_inner());
  s.refresh_processes(ProcessesToUpdate::Some(&[Pid::from_u32(pid)]), true);
  let p = s.process(Pid::from_u32(pid)).ok_or("That process has already exited.")?;
  let name = p.name().to_string_lossy().to_lowercase();
  const PROTECTED: &[&str] = &["csrss.exe", "wininit.exe", "winlogon.exe", "smss.exe", "services.exe", "lsass.exe", "system", "registry", "dwm.exe"];
  if PROTECTED.contains(&name.as_str()) {
    return Err(format!("{name} is a core Windows process; ending it would crash your session."));
  }
  if p.kill() {
    Ok(())
  } else {
    Err(format!("Windows refused to end {name} (it may need administrator rights)."))
  }
}

#[cfg(test)]
mod tests {
  #[test]
  fn snapshot_has_real_processes_and_load() {
    let _ = super::snapshot();
    std::thread::sleep(std::time::Duration::from_millis(300));
    let s = super::snapshot();
    println!("{} processes, cpu {:.1}%, mem {}/{} MB", s.load.process_count, s.load.cpu, s.load.memory_used >> 20, s.load.memory_total >> 20);
    assert!(s.load.process_count > 20);
    assert!(s.load.memory_total > 0);
    assert!(s.processes.iter().any(|p| p.pid == std::process::id()));
  }
}
