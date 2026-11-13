use std::path::PathBuf;
use std::sync::Mutex;

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

use crate::db::configure_connection;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NoteMeta {
  pub id: String,
  pub title: String,
  /// Tab order, ascending.
  pub position: i64,
  pub created_at: String,
}

pub struct Store {
  conn: Mutex<Connection>,
  notes_dir: PathBuf,
}

impl Store {
  /// `notes_dir` holds each note's body as a plain `.txt` file named by id
  /// — the sqlite db here only tracks tab metadata (title/order), so a
  /// note's actual content stays a simple, directly-readable text file per
  /// the "plain text is probably right for simple notes" requirement.
  pub fn open(db_path: PathBuf, notes_dir: PathBuf) -> rusqlite::Result<Self> {
    let conn = Connection::open(db_path)?;
    configure_connection(&conn)?;
    conn.execute_batch(
      "CREATE TABLE IF NOT EXISTS notes (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        position INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS notes_active (
        id INTEGER PRIMARY KEY CHECK (id = 0),
        active_note_id TEXT
      );",
    )?;
    Ok(Self { conn: Mutex::new(conn), notes_dir })
  }

  fn note_path(&self, id: &str) -> PathBuf {
    self.notes_dir.join(format!("{id}.txt"))
  }

  pub fn list_notes(&self) -> rusqlite::Result<Vec<NoteMeta>> {
    let conn = self.conn.lock().unwrap();
    let mut stmt = conn.prepare(
      "SELECT id, title, position, created_at FROM notes ORDER BY position ASC",
    )?;
    let rows = stmt.query_map([], |row| {
      Ok(NoteMeta {
        id: row.get(0)?,
        title: row.get(1)?,
        position: row.get(2)?,
        created_at: row.get(3)?,
      })
    })?;
    rows.collect()
  }

  pub fn read_body(&self, id: &str) -> std::io::Result<String> {
    match std::fs::read_to_string(self.note_path(id)) {
      Ok(body) => Ok(body),
      Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
      Err(e) => Err(e),
    }
  }

  pub fn create_note(&self, meta: &NoteMeta) -> rusqlite::Result<()> {
    let conn = self.conn.lock().unwrap();
    conn.execute(
      "INSERT INTO notes (id, title, position, created_at) VALUES (?1, ?2, ?3, ?4)",
      params![meta.id, meta.title, meta.position, meta.created_at],
    )?;
    Ok(())
  }

  /// Writes a note's body to disk and updates its title in the index in one
  /// call — the two always change together on autosave (title is derived
  /// from the body's first line), so there's no scenario needing them split.
  pub fn save_body(&self, id: &str, title: &str, body: &str) -> Result<(), String> {
    std::fs::write(self.note_path(id), body).map_err(|e| format!("Failed to write note file: {e}"))?;
    let conn = self.conn.lock().unwrap();
    conn
      .execute("UPDATE notes SET title = ?2 WHERE id = ?1", params![id, title])
      .map_err(|e| e.to_string())?;
    Ok(())
  }

  pub fn delete_note(&self, id: &str) -> Result<(), String> {
    let conn = self.conn.lock().unwrap();
    conn
      .execute("DELETE FROM notes WHERE id = ?1", params![id])
      .map_err(|e| e.to_string())?;
    drop(conn);
    match std::fs::remove_file(self.note_path(id)) {
      Ok(()) => Ok(()),
      Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
      Err(e) => Err(format!("Failed to delete note file: {e}")),
    }
  }

  pub fn set_order(&self, ordered_ids: &[String]) -> rusqlite::Result<()> {
    let mut conn = self.conn.lock().unwrap();
    let tx = conn.transaction()?;
    for (position, id) in ordered_ids.iter().enumerate() {
      tx.execute(
        "UPDATE notes SET position = ?2 WHERE id = ?1",
        params![id, position as i64],
      )?;
    }
    tx.commit()
  }

  pub fn get_active_note(&self) -> rusqlite::Result<Option<String>> {
    let conn = self.conn.lock().unwrap();
    conn
      .query_row(
        "SELECT active_note_id FROM notes_active WHERE id = 0",
        [],
        |row| row.get::<_, Option<String>>(0),
      )
      .or_else(|e| if e == rusqlite::Error::QueryReturnedNoRows { Ok(None) } else { Err(e) })
  }

  pub fn set_active_note(&self, id: Option<&str>) -> rusqlite::Result<()> {
    let conn = self.conn.lock().unwrap();
    conn.execute(
      "INSERT INTO notes_active (id, active_note_id) VALUES (0, ?1)
       ON CONFLICT(id) DO UPDATE SET active_note_id = excluded.active_note_id",
      params![id],
    )?;
    Ok(())
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  fn temp_store() -> (Store, PathBuf, PathBuf) {
    let unique = uuid::Uuid::new_v4();
    let mut db_path = std::env::temp_dir();
    db_path.push(format!("udaan_notes_test_{unique}.sqlite3"));
    let mut notes_dir = std::env::temp_dir();
    notes_dir.push(format!("udaan_notes_test_{unique}"));
    std::fs::create_dir_all(&notes_dir).unwrap();
    let store = Store::open(db_path.clone(), notes_dir.clone()).expect("open store");
    (store, db_path, notes_dir)
  }

  fn cleanup(db_path: PathBuf, notes_dir: PathBuf) {
    let _ = std::fs::remove_file(&db_path);
    let _ = std::fs::remove_dir_all(&notes_dir);
  }

  /// Notes must survive a full store close/reopen — the real proxy for
  /// surviving a Udaan restart, since the store is reopened fresh from disk
  /// exactly like `notes::init` does on every app launch.
  #[test]
  fn notes_and_order_persist_across_reopen() {
    let (store, db_path, notes_dir) = temp_store();

    let note1 = NoteMeta { id: "n1".into(), title: "Untitled".into(), position: 0, created_at: "2026-08-29T00:00:00Z".into() };
    let note2 = NoteMeta { id: "n2".into(), title: "Untitled".into(), position: 1, created_at: "2026-08-29T00:00:01Z".into() };
    store.create_note(&note1).unwrap();
    store.create_note(&note2).unwrap();
    store.save_body("n1", "Shopping list", "Shopping list\nEggs\nMilk").unwrap();
    store.save_body("n2", "Ideas", "Ideas\n- thing one").unwrap();
    store.set_order(&["n2".to_string(), "n1".to_string()]).unwrap();
    store.set_active_note(Some("n2")).unwrap();

    drop(store);
    let reopened = Store::open(db_path.clone(), notes_dir.clone()).expect("reopen store");

    let listed = reopened.list_notes().expect("list after reopen");
    assert_eq!(listed.len(), 2);
    assert_eq!(listed[0].id, "n2", "order must survive reopen");
    assert_eq!(listed[0].title, "Ideas");
    assert_eq!(listed[1].id, "n1");

    assert_eq!(reopened.read_body("n1").unwrap(), "Shopping list\nEggs\nMilk");
    assert_eq!(reopened.read_body("n2").unwrap(), "Ideas\n- thing one");
    assert_eq!(reopened.get_active_note().unwrap(), Some("n2".to_string()));

    cleanup(db_path, notes_dir);
  }

  #[test]
  fn delete_note_removes_row_and_file() {
    let (store, db_path, notes_dir) = temp_store();
    let note = NoteMeta { id: "n1".into(), title: "Untitled".into(), position: 0, created_at: "2026-08-29T00:00:00Z".into() };
    store.create_note(&note).unwrap();
    store.save_body("n1", "Untitled", "hello").unwrap();

    store.delete_note("n1").unwrap();

    assert!(store.list_notes().unwrap().is_empty());
    assert_eq!(store.read_body("n1").unwrap(), "", "deleted note's body reads back empty, not an error");

    cleanup(db_path, notes_dir);
  }
}
