use std::path::PathBuf;
use std::sync::Mutex;

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Contact {
  pub id: String,
  pub name: String,
  pub company: String,
  pub email: String,
  pub phone: String,
  pub status: String,
  pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContactNote {
  pub id: String,
  pub contact_id: String,
  pub body: String,
  pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FollowUp {
  pub id: String,
  pub contact_id: String,
  pub note: String,
  /// ISO date string (YYYY-MM-DD). No calendar-integration hook yet —
  /// TODO: wire this into a real calendar/schedule reminder once that
  /// integration exists; standing rules keep calendar/schedule off-limits
  /// this session, so this is a plain due-date field only, checked on
  /// view-load, not a real notification/alarm.
  pub due_date: String,
  pub done: bool,
  pub created_at: String,
}

pub struct Store {
  conn: Mutex<Connection>,
}

impl Store {
  pub fn open(db_path: PathBuf) -> rusqlite::Result<Self> {
    let conn = Connection::open(db_path)?;
    conn.execute_batch(
      "CREATE TABLE IF NOT EXISTS contacts (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        company TEXT NOT NULL,
        email TEXT NOT NULL,
        phone TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS contact_notes (
        id TEXT PRIMARY KEY,
        contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
        body TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS follow_ups (
        id TEXT PRIMARY KEY,
        contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
        note TEXT NOT NULL,
        due_date TEXT NOT NULL,
        done INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );",
    )?;
    Ok(Self { conn: Mutex::new(conn) })
  }

  pub fn list_contacts(&self) -> rusqlite::Result<Vec<Contact>> {
    let conn = self.conn.lock().unwrap();
    let mut stmt = conn.prepare(
      "SELECT id, name, company, email, phone, status, created_at
       FROM contacts ORDER BY created_at DESC",
    )?;
    let rows = stmt.query_map([], |row| {
      Ok(Contact {
        id: row.get(0)?,
        name: row.get(1)?,
        company: row.get(2)?,
        email: row.get(3)?,
        phone: row.get(4)?,
        status: row.get(5)?,
        created_at: row.get(6)?,
      })
    })?;
    rows.collect()
  }

  pub fn upsert_contact(&self, contact: &Contact) -> rusqlite::Result<()> {
    let conn = self.conn.lock().unwrap();
    conn.execute(
      "INSERT INTO contacts (id, name, company, email, phone, status, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name, company = excluded.company, email = excluded.email,
         phone = excluded.phone, status = excluded.status",
      params![
        contact.id,
        contact.name,
        contact.company,
        contact.email,
        contact.phone,
        contact.status,
        contact.created_at,
      ],
    )?;
    Ok(())
  }

  pub fn delete_contact(&self, id: &str) -> rusqlite::Result<()> {
    let conn = self.conn.lock().unwrap();
    conn.execute("DELETE FROM contacts WHERE id = ?1", params![id])?;
    Ok(())
  }

  pub fn list_notes(&self, contact_id: &str) -> rusqlite::Result<Vec<ContactNote>> {
    let conn = self.conn.lock().unwrap();
    let mut stmt = conn.prepare(
      "SELECT id, contact_id, body, created_at FROM contact_notes
       WHERE contact_id = ?1 ORDER BY created_at DESC",
    )?;
    let rows = stmt.query_map(params![contact_id], |row| {
      Ok(ContactNote {
        id: row.get(0)?,
        contact_id: row.get(1)?,
        body: row.get(2)?,
        created_at: row.get(3)?,
      })
    })?;
    rows.collect()
  }

  pub fn add_note(&self, note: &ContactNote) -> rusqlite::Result<()> {
    let conn = self.conn.lock().unwrap();
    conn.execute(
      "INSERT INTO contact_notes (id, contact_id, body, created_at) VALUES (?1, ?2, ?3, ?4)",
      params![note.id, note.contact_id, note.body, note.created_at],
    )?;
    Ok(())
  }

  pub fn list_follow_ups(&self) -> rusqlite::Result<Vec<FollowUp>> {
    let conn = self.conn.lock().unwrap();
    let mut stmt = conn.prepare(
      "SELECT id, contact_id, note, due_date, done, created_at
       FROM follow_ups ORDER BY due_date ASC",
    )?;
    let rows = stmt.query_map([], |row| {
      let done_int: i64 = row.get(4)?;
      Ok(FollowUp {
        id: row.get(0)?,
        contact_id: row.get(1)?,
        note: row.get(2)?,
        due_date: row.get(3)?,
        done: done_int != 0,
        created_at: row.get(5)?,
      })
    })?;
    rows.collect()
  }

  pub fn add_follow_up(&self, follow_up: &FollowUp) -> rusqlite::Result<()> {
    let conn = self.conn.lock().unwrap();
    conn.execute(
      "INSERT INTO follow_ups (id, contact_id, note, due_date, done, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
      params![
        follow_up.id,
        follow_up.contact_id,
        follow_up.note,
        follow_up.due_date,
        follow_up.done as i64,
        follow_up.created_at,
      ],
    )?;
    Ok(())
  }

  pub fn set_follow_up_done(&self, id: &str, done: bool) -> rusqlite::Result<()> {
    let conn = self.conn.lock().unwrap();
    conn.execute(
      "UPDATE follow_ups SET done = ?1 WHERE id = ?2",
      params![done as i64, id],
    )?;
    Ok(())
  }
}
