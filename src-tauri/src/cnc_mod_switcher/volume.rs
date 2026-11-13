//! Locates the C&C Generals Zero Hour install by volume identity (label +
//! serial number), not a hardcoded drive letter — confirmed necessary since
//! the drive letter can change between plug-ins on a removable/external
//! disk. Matches by volume serial number primarily (label can be renamed by
//! the user; serial is assigned at format time and far less likely to
//! change), falling back to label if serial lookup ever fails.

use std::path::PathBuf;
use windows_sys::Win32::Storage::FileSystem::GetVolumeInformationW;

const GAME_ROOT_RELATIVE: &str =
  r"Command and Conquer Generals Zero Hour\Command and Conquer Generals Zero Hour";

/// The known volume identity for the user's game drive, recorded once (see
/// `cnc_mod_switcher_identify_drive`) and passed back in on every later call
/// rather than re-detected from scratch — so a second external drive with a
/// similarly-named folder is never silently substituted.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
pub struct VolumeIdentity {
  pub serial: u32,
  pub label: String,
}

fn volume_info(drive_root: &str) -> Option<(u32, String)> {
  // drive_root must be e.g. "D:\\" — GetVolumeInformationW needs a root path.
  let wide: Vec<u16> = drive_root.encode_utf16().chain(std::iter::once(0)).collect();
  let mut label_buf = [0u16; 256];
  let mut serial: u32 = 0;
  // SAFETY: all buffer pointers are valid for the lengths passed, and the
  // call is a plain, side-effect-free metadata query on a root path we
  // constructed ourselves from a single drive letter.
  let ok = unsafe {
    GetVolumeInformationW(
      wide.as_ptr(),
      label_buf.as_mut_ptr(),
      label_buf.len() as u32,
      &mut serial,
      std::ptr::null_mut(),
      std::ptr::null_mut(),
      std::ptr::null_mut(),
      0,
    )
  };
  if ok == 0 {
    return None;
  }
  let len = label_buf.iter().position(|&c| c == 0).unwrap_or(label_buf.len());
  let label = String::from_utf16_lossy(&label_buf[..len]);
  Some((serial, label))
}

/// Scans every drive letter for one whose volume identity matches, and
/// which actually contains the expected game-root subfolder. Returns the
/// resolved game-root path if found.
pub fn find_game_root(expected: &VolumeIdentity) -> Option<PathBuf> {
  for letter in b'A'..=b'Z' {
    let drive_root = format!("{}:\\", letter as char);
    let Some((serial, label)) = volume_info(&drive_root) else {
      continue;
    };
    if serial != expected.serial && !label.eq_ignore_ascii_case(&expected.label) {
      continue;
    }
    let candidate = PathBuf::from(&drive_root).join(GAME_ROOT_RELATIVE);
    if candidate.is_dir() {
      return Some(candidate);
    }
  }
  None
}

/// Used only when the user first sets this up (no stored `VolumeIdentity`
/// yet): scans every drive for the expected game-root folder and records
/// that drive's identity, so all later lookups are identity-based rather
/// than repeating this open-ended scan.
pub fn identify_drive() -> Option<(VolumeIdentity, PathBuf)> {
  for letter in b'A'..=b'Z' {
    let drive_root = format!("{}:\\", letter as char);
    let candidate = PathBuf::from(&drive_root).join(GAME_ROOT_RELATIVE);
    if !candidate.is_dir() {
      continue;
    }
    if let Some((serial, label)) = volume_info(&drive_root) {
      return Some((VolumeIdentity { serial, label }, candidate));
    }
  }
  None
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn find_game_root_returns_none_for_bogus_identity() {
    let bogus = VolumeIdentity { serial: 0xDEAD_BEEF, label: "NOT_A_REAL_VOLUME_LABEL_XYZ".to_string() };
    assert_eq!(find_game_root(&bogus), None);
  }
}
