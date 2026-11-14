//! What the machine can spare right now. Features that trade memory for speed (keeping
//! windows pre-warmed, caching) ask here first, so on a low-RAM PC they stand down instead
//! of pushing the system into paging, which costs far more responsiveness than they buy.

use windows::Win32::System::SystemInformation::{GlobalMemoryStatusEx, MEMORYSTATUSEX};

/// Physical memory currently available, in MB. Reports plenty if the query fails, so a
/// failure never disables a feature by accident.
pub fn available_mb() -> u64 {
  unsafe {
    let mut s = MEMORYSTATUSEX { dwLength: std::mem::size_of::<MEMORYSTATUSEX>() as u32, ..Default::default() };
    match GlobalMemoryStatusEx(&mut s) {
      Ok(()) => s.ullAvailPhys / (1024 * 1024),
      Err(_) => u64::MAX,
    }
  }
}

/// Whether there is comfortable headroom for something that costs `cost_mb`: that much,
/// plus a 2 GB reserve for the rest of the system.
pub fn can_spare(cost_mb: u64) -> bool {
  available_mb() > cost_mb + 2048
}
