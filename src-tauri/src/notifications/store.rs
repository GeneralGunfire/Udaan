use std::path::PathBuf;
use std::sync::Mutex;

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::db::configure_connection;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Notification {
  pub id: String,
  /// Free-form category the frontend uses to pick an icon/tint — e.g.
  /// "daily-brief", "tts-error". Not an enum on the Rust
  /// side: new producers (a future feature pushing its own notifications)
  /// shouldn't need a Rust-side schema change to introduce a new kind.
  pub kind: String,
  pub title: String,
  pub body: String,
  /// Which app/feature produced this — shown as a small source label in
  /// the panel, and lets a future "clear all from X" action filter by it.
  pub source_app: String,
  pub created_at: String,
  pub read_at: Option<String>,
  /// Optional single action button (e.g. "View report", "Retry"). Both
  /// present or both absent — enforced at the call site, not the schema.
  pub action_label: Option<String>,
  /// Opaque string the frontend interprets per `kind` when the action
  /// button is clicked (e.g. a report date, a document path) — Rust never
  /// reads this, just stores and returns it.
  pub action_payload: Option<String>,
}

pub struct Store {
  conn: Mutex<Connection>,
}

impl Store {
  pub fn open(db_path: PathBuf) -> rusqlite::Result<Self> {
    let conn = Connection::open(db_path)?;
    configure_connection(&conn)?;
    conn.execute_batch(
      "CREATE TABLE IF NOT EXISTS notifications (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        source_app TEXT NOT NULL,
        created_at TEXT NOT NULL,
        read_at TEXT,
        action_label TEXT,
        action_payload TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at DESC);",
    )?;
    Ok(Self { conn: Mutex::new(conn) })
  }

  pub fn push(
    &self,
    kind: &str,
    title: &str,
    body: &str,
    source_app: &str,
    action_label: Option<&str>,
    action_payload: Option<&str>,
  ) -> rusqlite::Result<Notification> {
    let conn = self.conn.lock().unwrap();
    let id = Uuid::new_v4().to_string();
    let created_at = chrono::Utc::now().to_rfc3339();
    conn.execute(
      "INSERT INTO notifications (id, kind, title, body, source_app, created_at, read_at, action_label, action_payload)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL, ?7, ?8)",
      params![id, kind, title, body, source_app, created_at, action_label, action_payload],
    )?;
    Ok(Notification {
      id,
      kind: kind.to_string(),
      title: title.to_string(),
      body: body.to_string(),
      source_app: source_app.to_string(),
      created_at,
      read_at: None,
      action_label: action_label.map(str::to_string),
      action_payload: action_payload.map(str::to_string),
    })
  }

  pub fn list(&self, unread_only: bool, limit: i64) -> rusqlite::Result<Vec<Notification>> {
    let conn = self.conn.lock().unwrap();
    let sql = if unread_only {
      "SELECT id, kind, title, body, source_app, created_at, read_at, action_label, action_payload
       FROM notifications WHERE read_at IS NULL ORDER BY created_at DESC LIMIT ?1"
    } else {
      "SELECT id, kind, title, body, source_app, created_at, read_at, action_label, action_payload
       FROM notifications ORDER BY created_at DESC LIMIT ?1"
    };
    let mut stmt = conn.prepare(sql)?;
    let rows = stmt.query_map(params![limit], |row| {
      Ok(Notification {
        id: row.get(0)?,
        kind: row.get(1)?,
        title: row.get(2)?,
        body: row.get(3)?,
        source_app: row.get(4)?,
        created_at: row.get(5)?,
        read_at: row.get(6)?,
        action_label: row.get(7)?,
        action_payload: row.get(8)?,
      })
    })?;
    rows.collect()
  }

  pub fn unread_count(&self) -> rusqlite::Result<i64> {
    let conn = self.conn.lock().unwrap();
    conn.query_row(
      "SELECT COUNT(*) FROM notifications WHERE read_at IS NULL",
      [],
      |row| row.get(0),
    )
  }

  pub fn mark_read(&self, id: &str) -> rusqlite::Result<()> {
    let conn = self.conn.lock().unwrap();
    conn.execute(
      "UPDATE notifications SET read_at = ?1 WHERE id = ?2 AND read_at IS NULL",
      params![chrono::Utc::now().to_rfc3339(), id],
    )?;
    Ok(())
  }

  pub fn mark_all_read(&self) -> rusqlite::Result<()> {
    let conn = self.conn.lock().unwrap();
    conn.execute(
      "UPDATE notifications SET read_at = ?1 WHERE read_at IS NULL",
      params![chrono::Utc::now().to_rfc3339()],
    )?;
    Ok(())
  }

  pub fn dismiss(&self, id: &str) -> rusqlite::Result<()> {
    let conn = self.conn.lock().unwrap();
    conn.execute("DELETE FROM notifications WHERE id = ?1", params![id])?;
    Ok(())
  }

  #[allow(dead_code)]
  pub fn get(&self, id: &str) -> rusqlite::Result<Option<Notification>> {
    let conn = self.conn.lock().unwrap();
    conn
      .query_row(
        "SELECT id, kind, title, body, source_app, created_at, read_at, action_label, action_payload
         FROM notifications WHERE id = ?1",
        params![id],
        |row| {
          Ok(Notification {
            id: row.get(0)?,
            kind: row.get(1)?,
            title: row.get(2)?,
            body: row.get(3)?,
            source_app: row.get(4)?,
            created_at: row.get(5)?,
            read_at: row.get(6)?,
            action_label: row.get(7)?,
            action_payload: row.get(8)?,
          })
        },
      )
      .optional()
  }
}
