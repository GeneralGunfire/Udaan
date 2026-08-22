use std::path::PathBuf;
use std::sync::Mutex;

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScheduleEvent {
  pub id: String,
  pub title: String,
  /// ISO date (YYYY-MM-DD).
  pub date: String,
  /// 24h "HH:mm", absent for all-day / undated items.
  pub start_time: Option<String>,
  pub end_time: Option<String>,
  pub description: Option<String>,
  /// One of: school | work | creativity | general.
  pub category: String,
  /// One of: unplanned | planned | done. A todo-style item with no fixed
  /// date/time is "unplanned"; anything with a date/time is "planned";
  /// completion flips it to "done" regardless of scheduling.
  pub status: String,
  pub created_at: String,
}

pub struct Store {
  conn: Mutex<Connection>,
}

impl Store {
  pub fn open(db_path: PathBuf) -> rusqlite::Result<Self> {
    let conn = Connection::open(db_path)?;
    conn.execute_batch(
      "CREATE TABLE IF NOT EXISTS schedule_events (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        date TEXT NOT NULL,
        start_time TEXT,
        end_time TEXT,
        description TEXT,
        category TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'planned',
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_schedule_events_date ON schedule_events(date);",
    )?;
    Ok(Self { conn: Mutex::new(conn) })
  }

  pub fn list_events(&self) -> rusqlite::Result<Vec<ScheduleEvent>> {
    let conn = self.conn.lock().unwrap();
    let mut stmt = conn.prepare(
      "SELECT id, title, date, start_time, end_time, description, category, status, created_at
       FROM schedule_events ORDER BY date ASC, start_time ASC",
    )?;
    let rows = stmt.query_map([], |row| {
      Ok(ScheduleEvent {
        id: row.get(0)?,
        title: row.get(1)?,
        date: row.get(2)?,
        start_time: row.get(3)?,
        end_time: row.get(4)?,
        description: row.get(5)?,
        category: row.get(6)?,
        status: row.get(7)?,
        created_at: row.get(8)?,
      })
    })?;
    rows.collect()
  }

  pub fn create_event(&self, event: &ScheduleEvent) -> rusqlite::Result<()> {
    let conn = self.conn.lock().unwrap();
    conn.execute(
      "INSERT INTO schedule_events
        (id, title, date, start_time, end_time, description, category, status, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
      params![
        event.id,
        event.title,
        event.date,
        event.start_time,
        event.end_time,
        event.description,
        event.category,
        event.status,
        event.created_at,
      ],
    )?;
    Ok(())
  }

  pub fn update_event(&self, event: &ScheduleEvent) -> rusqlite::Result<()> {
    let conn = self.conn.lock().unwrap();
    conn.execute(
      "UPDATE schedule_events SET
        title = ?2, date = ?3, start_time = ?4, end_time = ?5,
        description = ?6, category = ?7, status = ?8
       WHERE id = ?1",
      params![
        event.id,
        event.title,
        event.date,
        event.start_time,
        event.end_time,
        event.description,
        event.category,
        event.status,
      ],
    )?;
    Ok(())
  }

  pub fn delete_event(&self, id: &str) -> rusqlite::Result<()> {
    let conn = self.conn.lock().unwrap();
    conn.execute("DELETE FROM schedule_events WHERE id = ?1", params![id])?;
    Ok(())
  }

  pub fn set_status(&self, id: &str, status: &str) -> rusqlite::Result<()> {
    let conn = self.conn.lock().unwrap();
    conn.execute(
      "UPDATE schedule_events SET status = ?1 WHERE id = ?2",
      params![status, id],
    )?;
    Ok(())
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  /// Exercises the exact store code path (create/list/update/set_status/
  /// delete) against a real SQLite file, so a genuine "does this persist"
  /// check exists independent of driving the GUI. Uses a throwaway temp
  /// file — not the live app's schedule.sqlite3 — so running this test
  /// never touches or clobbers real user data.
  #[test]
  fn full_crud_round_trip_persists_correctly() {
    let mut db_path = std::env::temp_dir();
    db_path.push(format!("udaan_schedule_test_{}.sqlite3", uuid::Uuid::new_v4()));
    let store = Store::open(db_path.clone()).expect("open store");

    // Create two real events and one unplanned todo.
    let today = "2026-08-21".to_string();
    let event1 = ScheduleEvent {
      id: "test-evt-1".into(),
      title: "Dentist appointment".into(),
      date: today.clone(),
      start_time: Some("09:00".into()),
      end_time: Some("09:30".into()),
      description: None,
      category: "general".into(),
      status: "planned".into(),
      created_at: "2026-08-21T00:00:00Z".into(),
    };
    let event2 = ScheduleEvent {
      id: "test-evt-2".into(),
      title: "Finish quarterly report".into(),
      date: today.clone(),
      start_time: None,
      end_time: None,
      description: Some("Due end of day".into()),
      category: "work".into(),
      status: "planned".into(),
      created_at: "2026-08-21T00:00:01Z".into(),
    };
    let todo = ScheduleEvent {
      id: "test-todo-1".into(),
      title: "Buy groceries".into(),
      date: "".into(),
      start_time: None,
      end_time: None,
      description: None,
      category: "general".into(),
      status: "unplanned".into(),
      created_at: "2026-08-21T00:00:02Z".into(),
    };

    store.create_event(&event1).expect("create event1");
    store.create_event(&event2).expect("create event2");
    store.create_event(&todo).expect("create todo");

    let listed = store.list_events().expect("list after create");
    assert_eq!(listed.len(), 3, "all three rows should persist");
    assert!(listed.iter().any(|e| e.id == "test-evt-1" && e.title == "Dentist appointment"));
    assert!(listed.iter().any(|e| e.id == "test-todo-1" && e.status == "unplanned"));

    // Update: reschedule event2 to a different time.
    let mut updated_event2 = event2.clone();
    updated_event2.start_time = Some("17:00".into());
    updated_event2.title = "Finish quarterly report (rescheduled)".into();
    store.update_event(&updated_event2).expect("update event2");

    let after_update = store.list_events().expect("list after update");
    let found = after_update.iter().find(|e| e.id == "test-evt-2").expect("event2 present");
    assert_eq!(found.start_time.as_deref(), Some("17:00"));
    assert_eq!(found.title, "Finish quarterly report (rescheduled)");

    // Mark the todo done.
    store.set_status("test-todo-1", "done").expect("set status done");
    let after_status = store.list_events().expect("list after status change");
    let todo_after = after_status.iter().find(|e| e.id == "test-todo-1").expect("todo present");
    assert_eq!(todo_after.status, "done");

    // Delete event1.
    store.delete_event("test-evt-1").expect("delete event1");
    let after_delete = store.list_events().expect("list after delete");
    assert_eq!(after_delete.len(), 2, "one row should remain after delete");
    assert!(!after_delete.iter().any(|e| e.id == "test-evt-1"));

    // Reopen the same file fresh — proves data survived a connection
    // close/reopen, i.e. it's real on-disk persistence, not in-memory only.
    drop(store);
    let reopened = Store::open(db_path.clone()).expect("reopen store");
    let after_reopen = reopened.list_events().expect("list after reopen");
    assert_eq!(after_reopen.len(), 2, "data must survive reopening the db file");

    // Clean up the temp file.
    drop(reopened);
    let _ = std::fs::remove_file(&db_path);
  }
}
