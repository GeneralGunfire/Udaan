use std::path::PathBuf;
use std::sync::Mutex;

use rusqlite::Connection;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClipboardEntry {
  pub id: String,
  pub kind: String, // "text" | "image"
  /// Text content, or for images a data: URL (small enough to inline — see cap in mod.rs).
  pub content: String,
  pub preview: String,
  pub created_at: String,
}

pub struct Store {
  conn: Mutex<Connection>,
}

impl Store {
  pub fn open(db_path: PathBuf) -> rusqlite::Result<Self> {
    let conn = Connection::open(db_path)?;
    conn.execute_batch(
      "CREATE TABLE IF NOT EXISTS clipboard_history (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        content TEXT NOT NULL,
        preview TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_clipboard_created_at ON clipboard_history(created_at);",
    )?;
    Ok(Self { conn: Mutex::new(conn) })
  }

  pub fn insert(&self, entry: &ClipboardEntry) -> rusqlite::Result<()> {
    let conn = self.conn.lock().unwrap();
    conn.execute(
      "INSERT INTO clipboard_history (id, kind, content, preview, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
      rusqlite::params![entry.id, entry.kind, entry.content, entry.preview, entry.created_at],
    )?;
    Ok(())
  }

  /// Most recent entry's content, used to detect whether the clipboard actually changed
  /// since the last poll (avoids re-recording the same item every poll tick).
  pub fn last_content(&self) -> rusqlite::Result<Option<String>> {
    let conn = self.conn.lock().unwrap();
    conn.query_row(
      "SELECT content FROM clipboard_history ORDER BY created_at DESC LIMIT 1",
      [],
      |row| row.get(0),
    )
    .or_else(|e| if e == rusqlite::Error::QueryReturnedNoRows { Ok(None) } else { Err(e) })
  }

  pub fn list(&self) -> rusqlite::Result<Vec<ClipboardEntry>> {
    let conn = self.conn.lock().unwrap();
    let mut stmt = conn.prepare(
      "SELECT id, kind, content, preview, created_at FROM clipboard_history ORDER BY created_at DESC",
    )?;
    let rows = stmt.query_map([], |row| {
      Ok(ClipboardEntry {
        id: row.get(0)?,
        kind: row.get(1)?,
        content: row.get(2)?,
        preview: row.get(3)?,
        created_at: row.get(4)?,
      })
    })?;
    rows.collect()
  }

  pub fn delete(&self, id: &str) -> rusqlite::Result<()> {
    let conn = self.conn.lock().unwrap();
    conn.execute("DELETE FROM clipboard_history WHERE id = ?1", rusqlite::params![id])?;
    Ok(())
  }

  pub fn clear(&self) -> rusqlite::Result<()> {
    let conn = self.conn.lock().unwrap();
    conn.execute("DELETE FROM clipboard_history", [])?;
    Ok(())
  }

  /// Enforces both a row-count cap and an age cap so history doesn't grow unbounded.
  pub fn prune(&self, max_rows: i64, max_age_days: i64) -> rusqlite::Result<()> {
    let conn = self.conn.lock().unwrap();
    conn.execute(
      "DELETE FROM clipboard_history WHERE created_at < datetime('now', ?1)",
      rusqlite::params![format!("-{max_age_days} days")],
    )?;
    conn.execute(
      "DELETE FROM clipboard_history WHERE id NOT IN (
        SELECT id FROM clipboard_history ORDER BY created_at DESC LIMIT ?1
      )",
      rusqlite::params![max_rows],
    )?;
    Ok(())
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  fn entry(id: &str, created_at: &str) -> ClipboardEntry {
    ClipboardEntry {
      id: id.to_string(),
      kind: "text".to_string(),
      content: format!("content-{id}"),
      preview: format!("preview-{id}"),
      created_at: created_at.to_string(),
    }
  }

  #[test]
  fn insert_and_list_round_trips_real_rows() {
    let store = Store::open(PathBuf::from(":memory:")).unwrap();
    store.insert(&entry("a", "2026-01-01T00:00:00Z")).unwrap();
    store.insert(&entry("b", "2026-01-02T00:00:00Z")).unwrap();

    let listed = store.list().unwrap();
    assert_eq!(listed.len(), 2);
    // Most recent first.
    assert_eq!(listed[0].id, "b");
    assert_eq!(listed[1].id, "a");
  }

  #[test]
  fn last_content_reflects_most_recent_insert() {
    let store = Store::open(PathBuf::from(":memory:")).unwrap();
    assert_eq!(store.last_content().unwrap(), None);
    store.insert(&entry("a", "2026-01-01T00:00:00Z")).unwrap();
    assert_eq!(store.last_content().unwrap(), Some("content-a".to_string()));
    store.insert(&entry("b", "2026-01-02T00:00:00Z")).unwrap();
    assert_eq!(store.last_content().unwrap(), Some("content-b".to_string()));
  }

  #[test]
  fn delete_removes_only_the_targeted_row() {
    let store = Store::open(PathBuf::from(":memory:")).unwrap();
    store.insert(&entry("a", "2026-01-01T00:00:00Z")).unwrap();
    store.insert(&entry("b", "2026-01-02T00:00:00Z")).unwrap();
    store.delete("a").unwrap();
    let listed = store.list().unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].id, "b");
  }

  #[test]
  fn clear_empties_the_table() {
    let store = Store::open(PathBuf::from(":memory:")).unwrap();
    store.insert(&entry("a", "2026-01-01T00:00:00Z")).unwrap();
    store.clear().unwrap();
    assert!(store.list().unwrap().is_empty());
  }

  #[test]
  fn prune_enforces_row_count_cap() {
    let store = Store::open(PathBuf::from(":memory:")).unwrap();
    for i in 0..10 {
      store.insert(&entry(&format!("row{i}"), &format!("2026-01-{:02}T00:00:00Z", i + 1))).unwrap();
    }
    store.prune(3, 3650).unwrap();
    let listed = store.list().unwrap();
    assert_eq!(listed.len(), 3);
    // The three most recently created rows survive.
    assert_eq!(listed[0].id, "row9");
    assert_eq!(listed[1].id, "row8");
    assert_eq!(listed[2].id, "row7");
  }

  #[test]
  fn prune_enforces_age_cap() {
    let store = Store::open(PathBuf::from(":memory:")).unwrap();
    store.insert(&entry("old", "2000-01-01T00:00:00Z")).unwrap();
    store.insert(&entry("new", &chrono::Utc::now().to_rfc3339())).unwrap();
    store.prune(500, 30).unwrap();
    let listed = store.list().unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].id, "new");
  }
}
