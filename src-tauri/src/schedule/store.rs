use std::path::PathBuf;
use std::sync::Mutex;

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

use crate::db::configure_connection;

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
  /// One of: school | work | creativity | general | personal.
  pub category: String,
  /// One of: unplanned | planned | done. A todo-style item with no fixed
  /// date/time is "unplanned"; anything with a date/time is "planned";
  /// completion flips it to "done" regardless of scheduling.
  pub status: String,
  pub created_at: String,
  /// True for a Calendar all-day event. Absent/false for Schedule items.
  #[serde(default)]
  pub all_day: bool,
  /// Calendar event duration in minutes, when known.
  pub duration_minutes: Option<i64>,
}

pub struct Store {
  conn: Mutex<Connection>,
}

impl Store {
  pub fn open(db_path: PathBuf) -> rusqlite::Result<Self> {
    let conn = Connection::open(db_path)?;
    configure_connection(&conn)?;
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

    // Additive migration: Calendar's all-day/duration fields, added when the
    // Calendar feature moved onto this store. Existing schedule-assistant
    // rows are untouched (columns default to NULL/0).
    Self::add_column_if_missing(&conn, "schedule_events", "all_day", "INTEGER NOT NULL DEFAULT 0")?;
    Self::add_column_if_missing(&conn, "schedule_events", "duration_minutes", "INTEGER")?;

    Ok(Self { conn: Mutex::new(conn) })
  }

  /// Adds `column` to `table` if it isn't already there. SQLite has no
  /// `ADD COLUMN IF NOT EXISTS`, so this checks `pragma_table_info` first —
  /// safe to call every time the store opens.
  fn add_column_if_missing(
    conn: &Connection,
    table: &str,
    column: &str,
    ddl_type: &str,
  ) -> rusqlite::Result<()> {
    let exists: bool = conn.query_row(
      &format!(
        "SELECT COUNT(*) FROM pragma_table_info('{table}') WHERE name = ?1"
      ),
      params![column],
      |row| row.get::<_, i64>(0),
    )? > 0;
    if !exists {
      conn.execute_batch(&format!("ALTER TABLE {table} ADD COLUMN {column} {ddl_type};"))?;
    }
    Ok(())
  }

  pub fn list_events(&self) -> rusqlite::Result<Vec<ScheduleEvent>> {
    let conn = self.conn.lock().unwrap();
    let mut stmt = conn.prepare(
      "SELECT id, title, date, start_time, end_time, description, category, status, created_at, all_day, duration_minutes
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
        all_day: row.get(9)?,
        duration_minutes: row.get(10)?,
      })
    })?;
    rows.collect()
  }

  pub fn create_event(&self, event: &ScheduleEvent) -> rusqlite::Result<()> {
    let conn = self.conn.lock().unwrap();
    conn.execute(
      "INSERT INTO schedule_events
        (id, title, date, start_time, end_time, description, category, status, created_at, all_day, duration_minutes)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
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
        event.all_day,
        event.duration_minutes,
      ],
    )?;
    Ok(())
  }

  pub fn update_event(&self, event: &ScheduleEvent) -> rusqlite::Result<()> {
    let conn = self.conn.lock().unwrap();
    conn.execute(
      "UPDATE schedule_events SET
        title = ?2, date = ?3, start_time = ?4, end_time = ?5,
        description = ?6, category = ?7, status = ?8, all_day = ?9, duration_minutes = ?10
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
        event.all_day,
        event.duration_minutes,
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
      all_day: false,
      duration_minutes: Some(30),
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
      all_day: false,
      duration_minutes: None,
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
      all_day: false,
      duration_minutes: None,
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

  /// Simulates a pre-existing schedule.sqlite3 created before the
  /// all_day/duration_minutes columns existed (the shape every real user's
  /// db is in today, since the schedule assistant predates the Calendar
  /// migration). Opening it through `Store::open` must add the new columns
  /// in place, without touching or losing the row that was already there.
  #[test]
  fn opening_pre_migration_database_preserves_existing_row_and_adds_columns() {
    let mut db_path = std::env::temp_dir();
    db_path.push(format!("udaan_schedule_premigration_{}.sqlite3", uuid::Uuid::new_v4()));

    {
      let conn = Connection::open(&db_path).expect("create raw pre-migration db");
      conn
        .execute_batch(
          "CREATE TABLE schedule_events (
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
          INSERT INTO schedule_events (id, title, date, start_time, end_time, description, category, status, created_at)
          VALUES ('pre-1', 'Existing schedule item', '2026-08-20', '10:00', NULL, NULL, 'work', 'planned', '2026-08-20T00:00:00Z');",
        )
        .expect("seed pre-migration schema and row");
    }

    let store = Store::open(db_path.clone()).expect("open pre-migration store");
    let events = store.list_events().expect("list after opening pre-migration db");
    assert_eq!(events.len(), 1, "the pre-existing row must survive the migration");
    let existing = &events[0];
    assert_eq!(existing.id, "pre-1");
    assert_eq!(existing.title, "Existing schedule item");
    assert_eq!(existing.all_day, false, "new column should default safely for old rows");
    assert_eq!(existing.duration_minutes, None, "new column should default safely for old rows");

    // New writes with the new fields must work post-migration.
    let new_event = ScheduleEvent {
      id: "post-1".into(),
      title: "Calendar all-day event".into(),
      date: "2026-08-21".into(),
      start_time: None,
      end_time: None,
      description: Some("notes".into()),
      category: "personal".into(),
      status: "planned".into(),
      created_at: "2026-08-21T00:00:00Z".into(),
      all_day: true,
      duration_minutes: Some(1440),
    };
    store.create_event(&new_event).expect("create post-migration event");
    let after_create = store.list_events().expect("list after create");
    assert_eq!(after_create.len(), 2);
    let created = after_create.iter().find(|e| e.id == "post-1").expect("new event present");
    assert_eq!(created.all_day, true);
    assert_eq!(created.duration_minutes, Some(1440));

    // Idempotency: reopening an already-migrated db must not error or duplicate columns.
    drop(store);
    let reopened = Store::open(db_path.clone()).expect("reopen already-migrated store");
    let after_reopen = reopened.list_events().expect("list after reopen");
    assert_eq!(after_reopen.len(), 2, "reopening must not lose or duplicate rows");

    drop(reopened);
    let _ = std::fs::remove_file(&db_path);
  }
}
