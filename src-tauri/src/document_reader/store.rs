use std::path::PathBuf;
use std::sync::Mutex;

use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;

use crate::db::configure_connection;

#[derive(Debug, Clone, Serialize)]
pub struct ReadingPosition {
  #[serde(rename = "paragraphIndex")]
  pub paragraph_index: i64,
  #[serde(rename = "sentenceIndex")]
  pub sentence_index: i64,
  #[serde(rename = "scrollPosition")]
  pub scroll_position: f64,
}

pub struct Store {
  conn: Mutex<Connection>,
}

impl Store {
  pub fn open(db_path: PathBuf) -> rusqlite::Result<Self> {
    let conn = Connection::open(db_path)?;
    configure_connection(&conn)?;
    conn.execute_batch(
      "CREATE TABLE IF NOT EXISTS reading_positions (
        document_key TEXT PRIMARY KEY,
        paragraph_index INTEGER NOT NULL,
        sentence_index INTEGER NOT NULL,
        scroll_position REAL NOT NULL,
        updated_at INTEGER NOT NULL
      );",
    )?;
    Ok(Self { conn: Mutex::new(conn) })
  }

  pub fn get_position(&self, document_key: &str) -> rusqlite::Result<Option<ReadingPosition>> {
    let conn = self.conn.lock().unwrap();
    conn
      .query_row(
        "SELECT paragraph_index, sentence_index, scroll_position FROM reading_positions WHERE document_key = ?1",
        params![document_key],
        |row| {
          Ok(ReadingPosition {
            paragraph_index: row.get(0)?,
            sentence_index: row.get(1)?,
            scroll_position: row.get(2)?,
          })
        },
      )
      .optional()
  }

  pub fn save_position(
    &self,
    document_key: &str,
    paragraph_index: i64,
    sentence_index: i64,
    scroll_position: f64,
  ) -> rusqlite::Result<()> {
    let conn = self.conn.lock().unwrap();
    let now = std::time::SystemTime::now()
      .duration_since(std::time::UNIX_EPOCH)
      .map(|d| d.as_secs() as i64)
      .unwrap_or(0);
    conn.execute(
      "INSERT INTO reading_positions (document_key, paragraph_index, sentence_index, scroll_position, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT(document_key) DO UPDATE SET
         paragraph_index = excluded.paragraph_index,
         sentence_index = excluded.sentence_index,
         scroll_position = excluded.scroll_position,
         updated_at = excluded.updated_at",
      params![document_key, paragraph_index, sentence_index, scroll_position, now],
    )?;
    Ok(())
  }
}
