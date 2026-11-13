use std::path::PathBuf;
use std::sync::Mutex;

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

use crate::db::configure_connection;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Template {
  pub id: String,
  /// Which feature registered this template — "school" or "work" today,
  /// open-ended so other categories can register into the same table
  /// later without a schema change.
  pub owner: String,
  pub category: String,
  pub name: String,
  pub description: String,
  /// Raw template body with `{{placeholder}}` tokens for the consuming
  /// feature to fill in. This store doesn't interpret placeholders itself.
  pub body: String,
  pub created_at: String,
}

pub struct Store {
  conn: Mutex<Connection>,
}

impl Store {
  pub fn open(db_path: PathBuf) -> rusqlite::Result<Self> {
    let conn = Connection::open(db_path)?;
    configure_connection(&conn)?;
    conn.execute_batch(
      "CREATE TABLE IF NOT EXISTS templates (
        id TEXT PRIMARY KEY,
        owner TEXT NOT NULL,
        category TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        body TEXT NOT NULL,
        created_at TEXT NOT NULL
      );",
    )?;
    Ok(Self { conn: Mutex::new(conn) })
  }

  pub fn list_templates(&self, owner: Option<&str>) -> rusqlite::Result<Vec<Template>> {
    let conn = self.conn.lock().unwrap();
    let mut rows = Vec::new();
    if let Some(owner) = owner {
      let mut stmt = conn.prepare(
        "SELECT id, owner, category, name, description, body, created_at
         FROM templates WHERE owner = ?1 ORDER BY created_at ASC",
      )?;
      let mapped = stmt.query_map(params![owner], Self::map_row)?;
      for r in mapped {
        rows.push(r?);
      }
    } else {
      let mut stmt = conn.prepare(
        "SELECT id, owner, category, name, description, body, created_at
         FROM templates ORDER BY created_at ASC",
      )?;
      let mapped = stmt.query_map([], Self::map_row)?;
      for r in mapped {
        rows.push(r?);
      }
    }
    Ok(rows)
  }

  pub fn register_template(&self, template: &Template) -> rusqlite::Result<()> {
    let conn = self.conn.lock().unwrap();
    conn.execute(
      "INSERT INTO templates (id, owner, category, name, description, body, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
       ON CONFLICT(id) DO UPDATE SET
         owner = excluded.owner, category = excluded.category, name = excluded.name,
         description = excluded.description, body = excluded.body",
      params![
        template.id,
        template.owner,
        template.category,
        template.name,
        template.description,
        template.body,
        template.created_at,
      ],
    )?;
    Ok(())
  }

  fn map_row(row: &rusqlite::Row) -> rusqlite::Result<Template> {
    Ok(Template {
      id: row.get(0)?,
      owner: row.get(1)?,
      category: row.get(2)?,
      name: row.get(3)?,
      description: row.get(4)?,
      body: row.get(5)?,
      created_at: row.get(6)?,
    })
  }
}
