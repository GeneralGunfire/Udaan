use std::path::PathBuf;
use std::sync::Mutex;

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::db::configure_connection;

/// Currently just remembers whether the taskbar quick-toggle should show a
/// hint the first time, reserved for future recorder preferences (e.g. a
/// user-adjustable silence threshold) without needing a schema change.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecorderSettings {
  #[serde(rename = "lastSavedPath")]
  pub last_saved_path: Option<String>,
}

impl Default for RecorderSettings {
  fn default() -> Self {
    Self { last_saved_path: None }
  }
}

pub struct Store {
  conn: Mutex<Connection>,
}

impl Store {
  pub fn open(db_path: PathBuf) -> rusqlite::Result<Self> {
    let conn = Connection::open(db_path)?;
    configure_connection(&conn)?;
    conn.execute_batch(
      "CREATE TABLE IF NOT EXISTS recorder_settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        last_saved_path TEXT
      );",
    )?;
    Ok(Self { conn: Mutex::new(conn) })
  }

  pub fn get_settings(&self) -> rusqlite::Result<RecorderSettings> {
    let conn = self.conn.lock().unwrap();
    let settings = conn
      .query_row("SELECT last_saved_path FROM recorder_settings WHERE id = 1", [], |row| {
        Ok(RecorderSettings { last_saved_path: row.get(0)? })
      })
      .optional()?;
    Ok(settings.unwrap_or_default())
  }

  pub fn save_settings(&self, settings: &RecorderSettings) -> rusqlite::Result<()> {
    let conn = self.conn.lock().unwrap();
    conn.execute(
      "INSERT INTO recorder_settings (id, last_saved_path) VALUES (1, ?1)
       ON CONFLICT(id) DO UPDATE SET last_saved_path = excluded.last_saved_path",
      params![settings.last_saved_path],
    )?;
    Ok(())
  }
}
