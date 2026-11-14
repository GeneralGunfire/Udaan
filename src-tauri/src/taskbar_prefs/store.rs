use std::path::PathBuf;
use std::sync::Mutex;

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::db::configure_connection;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PinnedApp {
  /// Stable identity for this pin. For `kind: "builtin"` this is the
  /// `AppDefinition.id` from `src/app/apps.ts` (e.g. "studio"); for
  /// `kind: "external"` it's the process name (e.g. "notepad.exe"), which
  /// doubles as the join key against a running `OpenWindow.processName`.
  pub id: String,
  /// "builtin" (a Udaan app, resolved via apps.ts) or "external" (a
  /// detected/OS app, launched via its executable path).
  pub kind: String,
  /// Display order — lower sorts first. Full-list replace on every
  /// reorder keeps this simple: the frontend always sends the complete
  /// list in its new order rather than a delta.
  pub sort_order: i64,
  /// For "builtin", unused (the id alone resolves via apps.ts). For
  /// "external", the executable path to launch when the pin isn't
  /// currently running.
  pub launch_ref: String,
  /// Display name, cached at pin-time so the taskbar can render a pinned
  /// entry before any window/detection data is available.
  pub name: String,
}

pub struct Store {
  conn: Mutex<Connection>,
}

impl Store {
  pub fn open(db_path: PathBuf) -> rusqlite::Result<Self> {
    let conn = Connection::open(db_path)?;
    configure_connection(&conn)?;
    conn.execute_batch(
      "CREATE TABLE IF NOT EXISTS pinned_apps (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        sort_order INTEGER NOT NULL,
        launch_ref TEXT NOT NULL,
        name TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS taskbar_prefs (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );",
    )?;
    Ok(Self { conn: Mutex::new(conn) })
  }

  pub fn list_pinned(&self) -> rusqlite::Result<Vec<PinnedApp>> {
    let conn = self.conn.lock().unwrap();
    let mut stmt = conn.prepare(
      "SELECT id, kind, sort_order, launch_ref, name FROM pinned_apps ORDER BY sort_order ASC",
    )?;
    let rows = stmt.query_map([], |row| {
      Ok(PinnedApp {
        id: row.get(0)?,
        kind: row.get(1)?,
        sort_order: row.get(2)?,
        launch_ref: row.get(3)?,
        name: row.get(4)?,
      })
    })?;
    rows.collect()
  }

  /// Full-list replace — simplest correct semantics for both a single
  /// pin/unpin (caller sends the whole updated list) and a drag-reorder
  /// (caller sends the same set in new order), without needing separate
  /// insert/delete/reorder commands to stay in sync with each other.
  pub fn set_pinned(&self, items: &[PinnedApp]) -> rusqlite::Result<()> {
    let mut conn = self.conn.lock().unwrap();
    let tx = conn.transaction()?;
    tx.execute("DELETE FROM pinned_apps", [])?;
    for item in items {
      tx.execute(
        "INSERT INTO pinned_apps (id, kind, sort_order, launch_ref, name) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![item.id, item.kind, item.sort_order, item.launch_ref, item.name],
      )?;
    }
    tx.commit()
  }

  pub fn get_pref(&self, key: &str) -> rusqlite::Result<Option<String>> {
    let conn = self.conn.lock().unwrap();
    conn.query_row("SELECT value FROM taskbar_prefs WHERE key = ?1", params![key], |row| row.get(0))
      .optional()
  }

  /// Every stored preference, so a window can load all of them in one call at startup
  /// instead of one round-trip per key.
  pub fn all_prefs(&self) -> rusqlite::Result<std::collections::HashMap<String, String>> {
    let conn = self.conn.lock().unwrap();
    let mut st = conn.prepare("SELECT key, value FROM taskbar_prefs")?;
    let rows = st.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?;
    rows.collect()
  }

  pub fn set_pref(&self, key: &str, value: &str) -> rusqlite::Result<()> {
    let conn = self.conn.lock().unwrap();
    conn.execute(
      "INSERT INTO taskbar_prefs (key, value) VALUES (?1, ?2)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      params![key, value],
    )?;
    Ok(())
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn pin_unpin_reorder_and_prefs_round_trip() {
    let mut db_path = std::env::temp_dir();
    db_path.push(format!("udaan_taskbar_prefs_test_{}.sqlite3", uuid::Uuid::new_v4()));
    let store = Store::open(db_path.clone()).expect("open store");

    let initial = vec![
      PinnedApp { id: "studio".into(), kind: "builtin".into(), sort_order: 0, launch_ref: String::new(), name: "Studio".into() },
      PinnedApp { id: "file-explorer".into(), kind: "builtin".into(), sort_order: 1, launch_ref: String::new(), name: "File Explorer".into() },
    ];
    store.set_pinned(&initial).expect("set pinned");
    let listed = store.list_pinned().expect("list pinned");
    assert_eq!(listed.len(), 2);
    assert_eq!(listed[0].id, "studio");
    assert_eq!(listed[1].id, "file-explorer");

    // Reorder: swap the two.
    let reordered = vec![
      PinnedApp { id: "file-explorer".into(), kind: "builtin".into(), sort_order: 0, launch_ref: String::new(), name: "File Explorer".into() },
      PinnedApp { id: "studio".into(), kind: "builtin".into(), sort_order: 1, launch_ref: String::new(), name: "Studio".into() },
    ];
    store.set_pinned(&reordered).expect("reorder");
    let after_reorder = store.list_pinned().expect("list after reorder");
    assert_eq!(after_reorder[0].id, "file-explorer");
    assert_eq!(after_reorder[1].id, "studio");

    // Unpin one.
    store.set_pinned(&[reordered[0].clone()]).expect("unpin");
    let after_unpin = store.list_pinned().expect("list after unpin");
    assert_eq!(after_unpin.len(), 1);
    assert_eq!(after_unpin[0].id, "file-explorer");

    // Prefs KV.
    assert_eq!(store.get_pref("auto_hide").expect("get missing pref"), None);
    store.set_pref("auto_hide", "true").expect("set pref");
    assert_eq!(store.get_pref("auto_hide").expect("get pref"), Some("true".to_string()));
    store.set_pref("auto_hide", "false").expect("update pref");
    assert_eq!(store.get_pref("auto_hide").expect("get updated pref"), Some("false".to_string()));

    // Reopen fresh — confirms real on-disk persistence.
    drop(store);
    let reopened = Store::open(db_path.clone()).expect("reopen store");
    let after_reopen = reopened.list_pinned().expect("list after reopen");
    assert_eq!(after_reopen.len(), 1);
    assert_eq!(reopened.get_pref("auto_hide").expect("pref after reopen"), Some("false".to_string()));

    drop(reopened);
    let _ = std::fs::remove_file(&db_path);
  }
}
