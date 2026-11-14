//! What the machine can spare right now: one policy that every feature follows.
//!
//! Features that trade memory for speed (keeping windows pre-warmed, keeping closed apps
//! around, caching) used to each look at free memory on their own, with their own thresholds, so
//! they disagreed. Now there is one answer, a [`Tier`]:
//!
//! - **Tight**: little headroom. Do the minimum: no pre-warming, close hidden apps quickly.
//! - **Normal**: some headroom. Keep things modestly.
//! - **Roomy**: plenty. Trade memory for speed freely.
//!
//! The tier comes from free memory as a share of the PC's total (a fixed number would call an 8 GB
//! PC and a 32 GB PC the same), and drops a level when running on a low battery. It is announced
//! to every window when it changes, so the UI can scale its own effects down too.

use serde::Serialize;
use std::sync::atomic::{AtomicU8, Ordering};
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use windows::Win32::System::Power::{GetSystemPowerStatus, SYSTEM_POWER_STATUS};
use windows::Win32::System::SystemInformation::{GlobalMemoryStatusEx, MEMORYSTATUSEX};

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Tier {
  Tight,
  Normal,
  Roomy,
}

impl Tier {
  fn down(self) -> Tier {
    match self {
      Tier::Roomy => Tier::Normal,
      _ => Tier::Tight,
    }
  }
  fn code(self) -> u8 {
    self as u8
  }
  fn from_code(c: u8) -> Tier {
    match c {
      0 => Tier::Tight,
      1 => Tier::Normal,
      _ => Tier::Roomy,
    }
  }
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
  pub total_mb: u64,
  pub avail_mb: u64,
  pub on_battery: bool,
  /// Battery charge, 0-100, if there is a battery.
  pub battery_percent: Option<u8>,
}

pub fn snapshot() -> Snapshot {
  let (total, avail) = unsafe {
    let mut s = MEMORYSTATUSEX { dwLength: std::mem::size_of::<MEMORYSTATUSEX>() as u32, ..Default::default() };
    match GlobalMemoryStatusEx(&mut s) {
      Ok(()) => (s.ullTotalPhys / (1024 * 1024), s.ullAvailPhys / (1024 * 1024)),
      // if the query fails, assume plenty so a failure never switches a feature off by accident
      Err(_) => (u64::MAX / 2, u64::MAX / 2),
    }
  };
  let mut p = SYSTEM_POWER_STATUS::default();
  let have_power = unsafe { GetSystemPowerStatus(&mut p) }.is_ok();
  Snapshot {
    total_mb: total,
    avail_mb: avail,
    on_battery: have_power && p.ACLineStatus == 0,
    battery_percent: (have_power && p.BatteryLifePercent <= 100).then_some(p.BatteryLifePercent),
  }
}

/// The policy, as a pure function of a measurement.
pub fn classify(s: &Snapshot) -> Tier {
  let frac = s.avail_mb as f64 / s.total_mb.max(1) as f64;
  let base = if frac < 0.30 || s.avail_mb < 2_200 {
    Tier::Tight
  } else if frac < 0.50 || s.avail_mb < 3_500 {
    Tier::Normal
  } else {
    Tier::Roomy
  };
  // a low battery is a reason to do less, whatever the memory
  if s.on_battery && s.battery_percent.map(|p| p < 30).unwrap_or(false) {
    base.down()
  } else {
    base
  }
}

static CURRENT: AtomicU8 = AtomicU8::new(2);

/// The current tier (as of the last check).
pub fn tier() -> Tier {
  Tier::from_code(CURRENT.load(Ordering::Relaxed))
}

/// Re-measures now, so a decision made right at startup uses a fresh answer.
pub fn refresh() -> Tier {
  let t = classify(&snapshot());
  CURRENT.store(t.code(), Ordering::Relaxed);
  t
}

/// Keeps the tier current and announces `engine://tier` when it changes. A check every 20 seconds
/// is two cheap system calls; there is no event for "memory got tighter" worth waiting on.
pub fn start(app: AppHandle) {
  refresh();
  let _ = super::supervisor::spawn("resource-tier", super::supervisor::Restart::OnPanic, move || {
    let mut last = tier();
    loop {
      std::thread::sleep(Duration::from_secs(20));
      let t = refresh();
      if t != last {
        super::trace::line(&format!("resource tier: {last:?} -> {t:?}"));
        last = t;
        let _ = app.emit("engine://tier", t);
      }
    }
  });
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TierReport {
  pub tier: Tier,
  #[serde(flatten)]
  pub snapshot: Snapshot,
}

/// The current tier and the numbers behind it.
#[tauri::command(async)]
pub fn engine_tier() -> TierReport {
  let snapshot = snapshot();
  let tier = classify(&snapshot);
  CURRENT.store(tier.code(), Ordering::Relaxed);
  TierReport { tier, snapshot }
}

#[cfg(test)]
mod tests {
  use super::*;

  fn snap(total: u64, avail: u64) -> Snapshot {
    Snapshot { total_mb: total, avail_mb: avail, on_battery: false, battery_percent: None }
  }

  #[test]
  fn the_tier_follows_free_memory_as_a_share_of_the_total() {
    // this PC: 8 GB total, about 2 GB free: tight
    assert_eq!(classify(&snap(8192, 2000)), Tier::Tight);
    assert_eq!(classify(&snap(8192, 3000)), Tier::Normal);
    assert_eq!(classify(&snap(8192, 5200)), Tier::Roomy);
    // a 32 GB PC with the same 3 GB free is just as tight: share of total, not a fixed number
    assert_eq!(classify(&snap(32768, 3000)), Tier::Tight);
    assert_eq!(classify(&snap(32768, 20000)), Tier::Roomy);
  }

  #[test]
  fn a_low_battery_drops_one_level() {
    let plenty = snap(16384, 12000);
    assert_eq!(classify(&plenty), Tier::Roomy);
    let low = Snapshot { on_battery: true, battery_percent: Some(20), ..plenty };
    assert_eq!(classify(&low), Tier::Normal);
    // plugged in, or a healthy battery, changes nothing
    assert_eq!(classify(&Snapshot { on_battery: true, battery_percent: Some(80), ..plenty }), Tier::Roomy);
    assert_eq!(classify(&Snapshot { on_battery: false, battery_percent: Some(10), ..plenty }), Tier::Roomy);
    // and it cannot drop below tight
    assert_eq!(classify(&Snapshot { on_battery: true, battery_percent: Some(10), ..snap(8192, 1500) }), Tier::Tight);
  }

  #[test]
  fn tiers_are_ordered() {
    assert!(Tier::Tight < Tier::Normal && Tier::Normal < Tier::Roomy);
  }
}
