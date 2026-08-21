use std::path::PathBuf;
use std::sync::Mutex;

use rusqlite::Connection;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TaskStatus {
  Queued,
  Running,
  Done,
  Failed,
}

impl TaskStatus {
  fn as_str(&self) -> &'static str {
    match self {
      TaskStatus::Queued => "queued",
      TaskStatus::Running => "running",
      TaskStatus::Done => "done",
      TaskStatus::Failed => "failed",
    }
  }

  fn from_str(s: &str) -> Self {
    match s {
      "running" => TaskStatus::Running,
      "done" => TaskStatus::Done,
      "failed" => TaskStatus::Failed,
      _ => TaskStatus::Queued,
    }
  }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Task {
  pub id: String,
  pub prompt: String,
  pub cwd: String,
  pub status: TaskStatus,
  pub created_at: String,
  pub started_at: Option<String>,
  pub finished_at: Option<String>,
  /// Full stdout event log, one JSON-line-derived string per row, newline joined.
  pub output: String,
  pub error: Option<String>,
  pub session_id: Option<String>,
}

pub struct Store {
  conn: Mutex<Connection>,
}

impl Store {
  pub fn open(db_path: PathBuf) -> rusqlite::Result<Self> {
    let conn = Connection::open(db_path)?;
    conn.execute_batch(
      "CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        prompt TEXT NOT NULL,
        cwd TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        started_at TEXT,
        finished_at TEXT,
        output TEXT NOT NULL DEFAULT '',
        error TEXT,
        session_id TEXT
      );",
    )?;
    Ok(Self { conn: Mutex::new(conn) })
  }

  pub fn insert_task(&self, task: &Task) -> rusqlite::Result<()> {
    let conn = self.conn.lock().unwrap();
    conn.execute(
      "INSERT INTO tasks (id, prompt, cwd, status, created_at, started_at, finished_at, output, error, session_id)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
      rusqlite::params![
        task.id,
        task.prompt,
        task.cwd,
        task.status.as_str(),
        task.created_at,
        task.started_at,
        task.finished_at,
        task.output,
        task.error,
        task.session_id,
      ],
    )?;
    Ok(())
  }

  pub fn set_status(&self, id: &str, status: TaskStatus, timestamp_col: Option<&str>, timestamp: Option<&str>) -> rusqlite::Result<()> {
    let conn = self.conn.lock().unwrap();
    match timestamp_col {
      Some("started_at") => {
        conn.execute(
          "UPDATE tasks SET status = ?1, started_at = ?2 WHERE id = ?3",
          rusqlite::params![status.as_str(), timestamp, id],
        )?;
      }
      Some("finished_at") => {
        conn.execute(
          "UPDATE tasks SET status = ?1, finished_at = ?2 WHERE id = ?3",
          rusqlite::params![status.as_str(), timestamp, id],
        )?;
      }
      _ => {
        conn.execute(
          "UPDATE tasks SET status = ?1 WHERE id = ?2",
          rusqlite::params![status.as_str(), id],
        )?;
      }
    }
    Ok(())
  }

  pub fn append_output(&self, id: &str, line: &str) -> rusqlite::Result<()> {
    let conn = self.conn.lock().unwrap();
    conn.execute(
      "UPDATE tasks SET output = output || ?1 || char(10) WHERE id = ?2",
      rusqlite::params![line, id],
    )?;
    Ok(())
  }

  pub fn set_error(&self, id: &str, error: &str) -> rusqlite::Result<()> {
    let conn = self.conn.lock().unwrap();
    conn.execute("UPDATE tasks SET error = ?1 WHERE id = ?2", rusqlite::params![error, id])?;
    Ok(())
  }

  pub fn set_session_id(&self, id: &str, session_id: &str) -> rusqlite::Result<()> {
    let conn = self.conn.lock().unwrap();
    conn.execute(
      "UPDATE tasks SET session_id = ?1 WHERE id = ?2",
      rusqlite::params![session_id, id],
    )?;
    Ok(())
  }

  pub fn get_task(&self, id: &str) -> rusqlite::Result<Option<Task>> {
    let conn = self.conn.lock().unwrap();
    let mut stmt = conn.prepare(
      "SELECT id, prompt, cwd, status, created_at, started_at, finished_at, output, error, session_id FROM tasks WHERE id = ?1",
    )?;
    let mut rows = stmt.query(rusqlite::params![id])?;
    if let Some(row) = rows.next()? {
      Ok(Some(row_to_task(row)?))
    } else {
      Ok(None)
    }
  }

  pub fn list_tasks(&self) -> rusqlite::Result<Vec<Task>> {
    let conn = self.conn.lock().unwrap();
    let mut stmt = conn.prepare(
      "SELECT id, prompt, cwd, status, created_at, started_at, finished_at, output, error, session_id
       FROM tasks ORDER BY created_at DESC",
    )?;
    let rows = stmt.query_map([], |row| row_to_task(row))?;
    rows.collect()
  }
}

fn row_to_task(row: &rusqlite::Row) -> rusqlite::Result<Task> {
  let status_str: String = row.get(3)?;
  Ok(Task {
    id: row.get(0)?,
    prompt: row.get(1)?,
    cwd: row.get(2)?,
    status: TaskStatus::from_str(&status_str),
    created_at: row.get(4)?,
    started_at: row.get(5)?,
    finished_at: row.get(6)?,
    output: row.get(7)?,
    error: row.get(8)?,
    session_id: row.get(9)?,
  })
}
