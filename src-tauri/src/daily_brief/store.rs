//! Persists the daily news brief — one row per calendar date, following
//! the same SQLite-per-feature pattern as schedule/calendar and
//! document_reader. "Today's report" is a plain lookup by date; history
//! browsing (the News Brief app's secondary view) is a simple
//! most-recent-first listing of past dates.

use std::path::PathBuf;
use std::sync::Mutex;

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

use crate::db::configure_connection;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DailyBrief {
  /// ISO date (YYYY-MM-DD) this brief covers — primary key.
  pub date: String,
  /// The final written report body (Markdown), or None if generation
  /// failed entirely and only raw headlines are available.
  pub report_markdown: Option<String>,
  /// Raw fetched RSS items as JSON, kept alongside the written report both
  /// as the fallback content when generation fails and as an audit trail
  /// of what the summarizer was actually given.
  pub raw_items_json: String,
  /// True once generation was attempted for this date, regardless of
  /// whether it succeeded — prevents re-fetching/re-summarizing every time
  /// the app opens on a day the model backends were simply down.
  pub generation_attempted: bool,
  /// True when the report was produced under degraded conditions (heavier
  /// source trimming than usual, or generation failed entirely and only
  /// raw headlines are available) — surfaced as a visible notice in the UI
  /// rather than being indistinguishable from a normal, full report. This
  /// travels with the stored row so a past degraded day still shows the
  /// notice correctly when revisited from history, not just on the day it
  /// was generated.
  #[serde(default)]
  pub degraded: bool,
  pub degraded_reason: Option<String>,
  pub generated_at: String,
}

/// One row in the history list — just enough to render a date list without
/// pulling every full report body into memory at once.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BriefHistoryEntry {
  pub date: String,
  pub has_report: bool,
  pub degraded: bool,
}

pub struct Store {
  conn: Mutex<Connection>,
}

impl Store {
  pub fn open(db_path: PathBuf) -> rusqlite::Result<Self> {
    let conn = Connection::open(db_path)?;
    configure_connection(&conn)?;
    conn.execute_batch(
      "CREATE TABLE IF NOT EXISTS daily_briefs (
        date TEXT PRIMARY KEY,
        report_markdown TEXT,
        raw_items_json TEXT NOT NULL,
        generation_attempted INTEGER NOT NULL DEFAULT 0,
        generated_at TEXT NOT NULL
      );",
    )?;
    // Additive migration: degraded/degraded_reason were added after the
    // initial schema — existing rows default to "not degraded" rather than
    // erroring or losing data.
    Self::add_column_if_missing(&conn, "daily_briefs", "degraded", "INTEGER NOT NULL DEFAULT 0")?;
    Self::add_column_if_missing(&conn, "daily_briefs", "degraded_reason", "TEXT")?;
    Ok(Self { conn: Mutex::new(conn) })
  }

  fn add_column_if_missing(conn: &Connection, table: &str, column: &str, ddl_type: &str) -> rusqlite::Result<()> {
    let exists: bool = conn.query_row(
      &format!("SELECT COUNT(*) FROM pragma_table_info('{table}') WHERE name = ?1"),
      params![column],
      |row| row.get::<_, i64>(0),
    )? > 0;
    if !exists {
      conn.execute_batch(&format!("ALTER TABLE {table} ADD COLUMN {column} {ddl_type};"))?;
    }
    Ok(())
  }

  pub fn get(&self, date: &str) -> rusqlite::Result<Option<DailyBrief>> {
    let conn = self.conn.lock().unwrap();
    conn
      .query_row(
        "SELECT date, report_markdown, raw_items_json, generation_attempted, degraded, degraded_reason, generated_at
         FROM daily_briefs WHERE date = ?1",
        params![date],
        Self::row_to_brief,
      )
      .map(Some)
      .or_else(|e| if e == rusqlite::Error::QueryReturnedNoRows { Ok(None) } else { Err(e) })
  }

  fn row_to_brief(row: &rusqlite::Row) -> rusqlite::Result<DailyBrief> {
    Ok(DailyBrief {
      date: row.get(0)?,
      report_markdown: row.get(1)?,
      raw_items_json: row.get(2)?,
      generation_attempted: row.get(3)?,
      degraded: row.get(4)?,
      degraded_reason: row.get(5)?,
      generated_at: row.get(6)?,
    })
  }

  pub fn upsert(&self, brief: &DailyBrief) -> rusqlite::Result<()> {
    let conn = self.conn.lock().unwrap();
    conn.execute(
      "INSERT INTO daily_briefs (date, report_markdown, raw_items_json, generation_attempted, degraded, degraded_reason, generated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
       ON CONFLICT(date) DO UPDATE SET
         report_markdown = excluded.report_markdown,
         raw_items_json = excluded.raw_items_json,
         generation_attempted = excluded.generation_attempted,
         degraded = excluded.degraded,
         degraded_reason = excluded.degraded_reason,
         generated_at = excluded.generated_at",
      params![
        brief.date,
        brief.report_markdown,
        brief.raw_items_json,
        brief.generation_attempted,
        brief.degraded,
        brief.degraded_reason,
        brief.generated_at,
      ],
    )?;
    Ok(())
  }

  /// Most-recent-first list of every date a brief has been attempted for —
  /// backs the News Brief app's history sidebar. Deliberately excludes
  /// `report_markdown`/`raw_items_json` (a full day's report body) since
  /// this is only ever used to render a list of dates to pick from.
  pub fn list_history(&self) -> rusqlite::Result<Vec<BriefHistoryEntry>> {
    let conn = self.conn.lock().unwrap();
    let mut stmt = conn.prepare(
      "SELECT date, report_markdown IS NOT NULL, degraded
       FROM daily_briefs
       WHERE generation_attempted = 1
       ORDER BY date DESC",
    )?;
    let rows = stmt.query_map([], |row| {
      Ok(BriefHistoryEntry { date: row.get(0)?, has_report: row.get(1)?, degraded: row.get(2)? })
    })?;
    rows.collect()
  }

  /// Deletes every stored brief — used when the user wants to wipe history
  /// and start fresh (e.g. testing a new generation from a clean slate).
  pub fn delete_all(&self) -> rusqlite::Result<()> {
    let conn = self.conn.lock().unwrap();
    conn.execute("DELETE FROM daily_briefs", [])?;
    Ok(())
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  fn sample(date: &str, degraded: bool) -> DailyBrief {
    DailyBrief {
      date: date.into(),
      report_markdown: Some(format!("# Brief for {date}")),
      raw_items_json: "[]".into(),
      generation_attempted: true,
      degraded,
      degraded_reason: if degraded { Some("test reason".into()) } else { None },
      generated_at: format!("{date}T05:00:00Z"),
    }
  }

  #[test]
  fn get_returns_none_when_no_row_for_date() {
    let mut db_path = std::env::temp_dir();
    db_path.push(format!("udaan_daily_brief_test_{}.sqlite3", uuid::Uuid::new_v4()));
    let store = Store::open(db_path.clone()).unwrap();
    assert!(store.get("2026-08-30").unwrap().is_none());
    drop(store);
    let _ = std::fs::remove_file(&db_path);
  }

  #[test]
  fn upsert_then_get_round_trips_and_updates_in_place() {
    let mut db_path = std::env::temp_dir();
    db_path.push(format!("udaan_daily_brief_test_{}.sqlite3", uuid::Uuid::new_v4()));
    let store = Store::open(db_path.clone()).unwrap();

    let brief = sample("2026-08-30", false);
    store.upsert(&brief).unwrap();
    let fetched = store.get("2026-08-30").unwrap().expect("row exists");
    assert_eq!(fetched.report_markdown.as_deref(), Some("# Brief for 2026-08-30"));
    assert!(!fetched.degraded);

    // Update in place (e.g. retry succeeds after an earlier failed attempt).
    let mut updated = brief.clone();
    updated.report_markdown = Some("# Updated".into());
    updated.degraded = true;
    updated.degraded_reason = Some("retried after failure".into());
    store.upsert(&updated).unwrap();
    let refetched = store.get("2026-08-30").unwrap().expect("row still exists");
    assert_eq!(refetched.report_markdown.as_deref(), Some("# Updated"));
    assert!(refetched.degraded);
    assert_eq!(refetched.degraded_reason.as_deref(), Some("retried after failure"));

    drop(store);
    let _ = std::fs::remove_file(&db_path);
  }

  #[test]
  fn list_history_returns_most_recent_first_and_carries_degraded_flag() {
    let mut db_path = std::env::temp_dir();
    db_path.push(format!("udaan_daily_brief_test_{}.sqlite3", uuid::Uuid::new_v4()));
    let store = Store::open(db_path.clone()).unwrap();

    store.upsert(&sample("2026-08-28", false)).unwrap();
    store.upsert(&sample("2026-08-30", true)).unwrap();
    store.upsert(&sample("2026-08-29", false)).unwrap();

    let history = store.list_history().unwrap();
    assert_eq!(history.len(), 3);
    assert_eq!(history[0].date, "2026-08-30", "most recent date must come first");
    assert!(history[0].degraded, "degraded flag must survive into the history listing");
    assert_eq!(history[1].date, "2026-08-29");
    assert_eq!(history[2].date, "2026-08-28");
    assert!(history.iter().all(|e| e.has_report));

    drop(store);
    let _ = std::fs::remove_file(&db_path);
  }

  /// A pre-existing db from before `degraded`/`degraded_reason` existed
  /// must open cleanly and old rows must read back as "not degraded"
  /// rather than erroring.
  #[test]
  fn opening_pre_migration_database_preserves_existing_row() {
    let mut db_path = std::env::temp_dir();
    db_path.push(format!("udaan_daily_brief_premigration_{}.sqlite3", uuid::Uuid::new_v4()));
    {
      let conn = Connection::open(&db_path).unwrap();
      conn
        .execute_batch(
          "CREATE TABLE daily_briefs (
            date TEXT PRIMARY KEY,
            report_markdown TEXT,
            raw_items_json TEXT NOT NULL,
            generation_attempted INTEGER NOT NULL DEFAULT 0,
            generated_at TEXT NOT NULL
          );
          INSERT INTO daily_briefs (date, report_markdown, raw_items_json, generation_attempted, generated_at)
          VALUES ('2026-08-20', '# Old report', '[]', 1, '2026-08-20T05:00:00Z');",
        )
        .unwrap();
    }
    let store = Store::open(db_path.clone()).unwrap();
    let fetched = store.get("2026-08-20").unwrap().expect("pre-migration row must survive");
    assert_eq!(fetched.report_markdown.as_deref(), Some("# Old report"));
    assert!(!fetched.degraded, "new column must default safely for old rows");
    drop(store);
    let _ = std::fs::remove_file(&db_path);
  }
}
