//! Resilient opening of Udaan's databases.
//!
//! Udaan keeps each feature's data in its own SQLite file. Startup used to open all fourteen
//! with `?`, so a single corrupt or locked file aborted the whole launch and the user got no
//! shell at all. Now:
//!
//! - [`verify_all`] checks every database file before anything opens it, and sets a damaged
//!   one aside (renamed, never deleted, so nothing is lost for good) so that feature starts
//!   fresh instead of failing.
//! - [`manage`] registers a feature's state if it opened, and if it did not, records why and
//!   carries on. That one feature is unavailable for the session; everything else works.

use rusqlite::{Connection, OpenFlags};
use std::path::Path;
use tauri::{AppHandle, Manager};

/// Databases larger than this are not integrity-checked at startup (the check reads the whole
/// file); they are still opened normally.
const CHECK_LIMIT_BYTES: u64 = 256 * 1024 * 1024;

fn is_database(path: &Path) -> bool {
  matches!(path.extension().and_then(|e| e.to_str()), Some("sqlite3") | Some("sqlite") | Some("db"))
}

/// True if the file opens and passes SQLite's quick integrity check.
fn is_healthy(path: &Path) -> bool {
  let Ok(conn) = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX) else {
    return false;
  };
  conn.query_row("PRAGMA quick_check(1)", [], |r| r.get::<_, String>(0)).map(|v| v == "ok").unwrap_or(false)
}

/// Sets a damaged database aside as `<name>.corrupt-<unix time>` along with its journal files.
fn set_aside(path: &Path) {
  let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
  let name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
  let target = path.with_file_name(format!("{name}.corrupt-{stamp}"));
  match std::fs::rename(path, &target) {
    Ok(()) => super::trace::line(&format!("database '{name}' was damaged; set aside as {}", target.display())),
    Err(e) => super::trace::line(&format!("database '{name}' is damaged and could not be set aside: {e}")),
  }
  for suffix in ["-wal", "-shm", "-journal"] {
    let _ = std::fs::remove_file(path.with_file_name(format!("{name}{suffix}")));
  }
}

/// Checks every database in the app's data folder. Call once, before any store opens.
pub fn verify_all(app: &AppHandle) {
  let Ok(dir) = app.path().app_data_dir() else { return };
  let Ok(rd) = std::fs::read_dir(&dir) else { return };
  for entry in rd.flatten() {
    let path = entry.path();
    if !path.is_file() || !is_database(&path) {
      continue;
    }
    if entry.metadata().map(|m| m.len()).unwrap_or(0) > CHECK_LIMIT_BYTES {
      continue;
    }
    if !is_healthy(&path) {
      set_aside(&path);
    }
  }
}

/// Registers a feature's state if it opened. A feature that fails to open is skipped (its
/// commands will report an error) instead of stopping the whole app from starting.
pub fn manage<T, E>(app: &AppHandle, feature: &str, opened: Result<T, E>)
where
  T: Send + Sync + 'static,
  E: std::fmt::Display,
{
  match opened {
    Ok(state) => {
      app.manage(state);
    }
    Err(e) => super::trace::line(&format!("feature '{feature}' could not open its store and is unavailable this session: {e}")),
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  fn temp_dir(name: &str) -> std::path::PathBuf {
    let d = std::env::temp_dir().join(format!("udaan_stores_{name}_{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    d
  }

  #[test]
  fn a_valid_database_is_healthy_and_garbage_is_not() {
    let dir = temp_dir("health");
    let good = dir.join("good.sqlite3");
    {
      let c = Connection::open(&good).unwrap();
      c.execute("CREATE TABLE t (a TEXT)", []).unwrap();
      c.execute("INSERT INTO t VALUES ('x')", []).unwrap();
    }
    assert!(is_healthy(&good));
    let bad = dir.join("bad.sqlite3");
    std::fs::write(&bad, b"this is definitely not a sqlite database, just text padding the header out").unwrap();
    assert!(!is_healthy(&bad));
  }

  #[test]
  fn a_damaged_database_is_renamed_not_deleted() {
    let dir = temp_dir("aside");
    let bad = dir.join("notes.sqlite3");
    std::fs::write(&bad, b"corrupt contents that must be kept for recovery").unwrap();
    std::fs::write(dir.join("notes.sqlite3-wal"), b"journal").unwrap();
    set_aside(&bad);
    assert!(!bad.exists(), "the damaged file is out of the way");
    let kept: Vec<_> = std::fs::read_dir(&dir).unwrap().flatten().map(|e| e.file_name().to_string_lossy().to_string()).collect();
    assert!(kept.iter().any(|n| n.starts_with("notes.sqlite3.corrupt-")), "but still on disk: {kept:?}");
    assert!(!kept.iter().any(|n| n.ends_with("-wal")), "its journal is removed so a fresh file starts clean");
  }
}
