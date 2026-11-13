use rusqlite::Connection;

/// Applies the concurrency settings every local SQLite store should use.
///
/// Each store's DB file lives at a fixed path under `app_data_dir()`, keyed
/// only by the app's identifier — not per-process — so two windows of this
/// app running at once (e.g. across two monitors) open the *same* file.
/// Rusqlite's default journal mode takes an exclusive lock for the
/// duration of a write and fails immediately with `SQLITE_BUSY` if another
/// connection already holds it, rather than waiting; with two instances
/// both writing around the same moment, that showed up as a message or
/// event silently failing to save. WAL lets readers and a writer run
/// concurrently, and `busy_timeout` makes a genuine write/write collision
/// retry for a few seconds instead of failing outright.
///
/// WAL requires a real file (it manages `-wal`/`-shm` sidecar files
/// alongside it) — skip it for `:memory:` connections such as the ones
/// used in tests, where it would just error.
pub fn configure_connection(conn: &Connection) -> rusqlite::Result<()> {
  if conn.path() != Some(":memory:") {
    conn.pragma_update(None, "journal_mode", "WAL")?;
  }
  conn.pragma_update(None, "busy_timeout", 5000)?;
  Ok(())
}
