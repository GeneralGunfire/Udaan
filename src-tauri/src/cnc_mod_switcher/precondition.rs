//! Checks whether Windows symlink creation is actually possible right now.
//!
//! `std::os::windows::fs::symlink_file` requires either the current process
//! to be running elevated (Administrator), or Windows Developer Mode to be
//! enabled (which grants `SeCreateSymbolicLinkPrivilege` to unprivileged
//! processes too). Gen Launcher itself refuses to start at all if neither is
//! true — this mirrors that same hard precondition, checked fresh before
//! every switch attempt rather than cached, since the user can toggle
//! Developer Mode or run Udaan elevated between sessions.

use windows_sys::Win32::UI::Shell::IsUserAnAdmin;
use winreg::enums::HKEY_LOCAL_MACHINE;
use winreg::RegKey;

const DEV_MODE_KEY: &str = r"SOFTWARE\Microsoft\Windows\CurrentVersion\AppModelUnlock";
const DEV_MODE_VALUE: &str = "AllowDevelopmentWithoutDevLicense";

#[derive(Debug, Clone, serde::Serialize)]
pub struct SymlinkPrecondition {
  pub can_create_symlinks: bool,
  pub developer_mode_enabled: bool,
  pub is_admin: bool,
}

fn developer_mode_enabled() -> bool {
  let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
  let Ok(key) = hklm.open_subkey(DEV_MODE_KEY) else {
    return false;
  };
  key.get_value::<u32, _>(DEV_MODE_VALUE).map(|v| v != 0).unwrap_or(false)
}

fn is_admin() -> bool {
  // SAFETY: IsUserAnAdmin takes no arguments and only reads the current
  // process token; it cannot fail in a way that leaves anything in an
  // inconsistent state.
  unsafe { IsUserAnAdmin() != 0 }
}

/// Checked fresh every time — never cache this across a session, since
/// Developer Mode and elevation can both change without restarting Udaan.
pub fn check() -> SymlinkPrecondition {
  let developer_mode_enabled = developer_mode_enabled();
  let is_admin = is_admin();
  SymlinkPrecondition {
    can_create_symlinks: developer_mode_enabled || is_admin,
    developer_mode_enabled,
    is_admin,
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn check_runs_without_panicking_and_reports_consistent_flags() {
    let result = check();
    assert_eq!(result.can_create_symlinks, result.developer_mode_enabled || result.is_admin);
  }
}
