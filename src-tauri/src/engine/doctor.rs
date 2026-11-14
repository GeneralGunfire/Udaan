//! The engine's self-check: it verifies its own invariants and repairs what it can.
//!
//! Everything else in the engine puts something in the right place once and then trusts that
//! nothing disturbs it. The things that disturb an OS shell are known and rare (a monitor
//! being plugged in, Explorer restarting, a helper process being killed), so the doctor runs
//! after exactly those events, and on demand, checks that each invariant still holds, repairs
//! the ones it can, and reports the rest.

use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

#[derive(Debug, Clone, Serialize)]
pub struct Check {
  pub name: &'static str,
  pub ok: bool,
  pub detail: String,
}

fn check(name: &'static str, ok: bool, detail: impl Into<String>) -> Check {
  Check { name, ok, detail: detail.into() }
}

/// Runs every check. With `heal`, repairs what can be repaired as it goes.
pub fn run(heal: bool) -> Vec<Check> {
  let mut out = Vec::new();

  let (ok, detail) = super::desktop::check(heal);
  out.push(check("desktop layer", ok, detail));

  let (bars, off) = super::edges::check(heal);
  out.push(check(
    "bars on their edge",
    off == 0 || heal,
    if off == 0 { format!("{bars} bar(s) in place") } else { format!("{off} of {bars} bar(s) were off{}", if heal { "; put back" } else { "" }) },
  ));

  // The guard only matters while Explorer's taskbar is hidden, but it is cheap to keep alive.
  let alive = super::watchdog::is_alive();
  if !alive && heal {
    super::watchdog::ensure_alive();
  }
  out.push(check("external guard", alive || heal, if alive { "running" } else if heal { "was not running; restarted" } else { "not running" }));

  let failed: Vec<String> = super::supervisor::health().into_iter().filter(|h| h.state == "failed").map(|h| h.name).collect();
  out.push(check("background services", failed.is_empty(), if failed.is_empty() { "all running".to_string() } else { format!("failed: {}", failed.join(", ")) }));

  let bad: Vec<_> = out.iter().filter(|c| !c.ok).map(|c| c.name).collect();
  if !bad.is_empty() {
    super::trace::line(&format!("doctor: problems remain: {}", bad.join(", ")));
  }
  out
}

static PENDING: AtomicBool = AtomicBool::new(false);

/// Schedules a repair pass shortly after something that disturbs the shell (a display change,
/// Explorer restarting). Bursts of such events collapse into one pass, and it runs off the UI
/// thread after the system has had a moment to settle.
pub fn heal_soon() {
  if PENDING.swap(true, Ordering::SeqCst) {
    return;
  }
  let _ = std::thread::Builder::new().name("udaan-doctor".into()).spawn(|| {
    std::thread::sleep(Duration::from_millis(1500));
    PENDING.store(false, Ordering::SeqCst);
    let _ = run(true);
  });
}

/// The engine's health report, for diagnostics.
#[tauri::command]
pub fn engine_doctor(heal: Option<bool>) -> Vec<Check> {
  run(heal.unwrap_or(false))
}
