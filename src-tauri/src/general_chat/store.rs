use std::path::PathBuf;
use std::sync::Mutex;

use rusqlite::Connection;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MessageRole {
  User,
  Assistant,
}

impl MessageRole {
  fn as_str(&self) -> &'static str {
    match self {
      MessageRole::User => "user",
      MessageRole::Assistant => "assistant",
    }
  }

  fn from_str(s: &str) -> Self {
    match s {
      "assistant" => MessageRole::Assistant,
      _ => MessageRole::User,
    }
  }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatSession {
  pub id: String,
  /// First user message, truncated — set once on creation, never edited.
  pub title: String,
  /// "local" | "claude" — which provider this session's messages belong
  /// to. Local and Claude conversations are separate threads, never
  /// merged, so this partitions `list_sessions`/`list_messages` by mode.
  pub provider: String,
  pub created_at: String,
  pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
  pub id: String,
  pub session_id: String,
  pub role: MessageRole,
  pub content: String,
  /// Mode the message was sent/answered under: "local" | "router" | "claude".
  pub mode: String,
  pub created_at: String,
}

pub struct Store {
  conn: Mutex<Connection>,
}

impl Store {
  pub fn open(db_path: PathBuf) -> rusqlite::Result<Self> {
    let conn = Connection::open(db_path)?;
    conn.execute_batch(
      "PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS chat_sessions (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS chat_messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        mode TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_chat_messages_session_id ON chat_messages(session_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_chat_sessions_updated_at ON chat_sessions(updated_at);",
    )?;

    // Retrofit `provider` onto a chat_sessions table created before this
    // column existed (real installs already have data — can't just drop
    // and recreate). Existing rows default to "local" since that's what
    // the single-thread era's sessions actually were in practice.
    let has_provider_col = conn
      .prepare("SELECT 1 FROM pragma_table_info('chat_sessions') WHERE name = 'provider'")?
      .exists([])?;
    if !has_provider_col {
      conn.execute_batch(
        "ALTER TABLE chat_sessions ADD COLUMN provider TEXT NOT NULL DEFAULT 'local';
         CREATE INDEX IF NOT EXISTS idx_chat_sessions_provider ON chat_sessions(provider, updated_at);",
      )?;
    }

    Ok(Self { conn: Mutex::new(conn) })
  }

  pub fn create_session(&self, session: &ChatSession) -> rusqlite::Result<()> {
    let conn = self.conn.lock().unwrap();
    conn.execute(
      "INSERT INTO chat_sessions (id, title, provider, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
      rusqlite::params![session.id, session.title, session.provider, session.created_at, session.updated_at],
    )?;
    Ok(())
  }

  pub fn touch_session(&self, id: &str, updated_at: &str) -> rusqlite::Result<()> {
    let conn = self.conn.lock().unwrap();
    conn.execute(
      "UPDATE chat_sessions SET updated_at = ?1 WHERE id = ?2",
      rusqlite::params![updated_at, id],
    )?;
    Ok(())
  }

  /// Lists sessions for one provider ("local" | "claude"), most recently
  /// updated first — Local and Claude chats are separate lists, never
  /// merged.
  pub fn list_sessions(&self, provider: &str) -> rusqlite::Result<Vec<ChatSession>> {
    let conn = self.conn.lock().unwrap();
    let mut stmt = conn.prepare(
      "SELECT id, title, provider, created_at, updated_at FROM chat_sessions
       WHERE provider = ?1 ORDER BY updated_at DESC",
    )?;
    let rows = stmt.query_map(rusqlite::params![provider], |row| {
      Ok(ChatSession {
        id: row.get(0)?,
        title: row.get(1)?,
        provider: row.get(2)?,
        created_at: row.get(3)?,
        updated_at: row.get(4)?,
      })
    })?;
    rows.collect()
  }

  /// Deletes a session and (via ON DELETE CASCADE) all its messages.
  pub fn delete_session(&self, id: &str) -> rusqlite::Result<()> {
    let conn = self.conn.lock().unwrap();
    conn.execute("DELETE FROM chat_sessions WHERE id = ?1", rusqlite::params![id])?;
    Ok(())
  }

  pub fn insert_message(&self, message: &ChatMessage) -> rusqlite::Result<()> {
    let conn = self.conn.lock().unwrap();
    conn.execute(
      "INSERT INTO chat_messages (id, session_id, role, content, mode, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
      rusqlite::params![
        message.id,
        message.session_id,
        message.role.as_str(),
        message.content,
        message.mode,
        message.created_at,
      ],
    )?;
    Ok(())
  }

  pub fn update_message_content(&self, id: &str, content: &str) -> rusqlite::Result<()> {
    let conn = self.conn.lock().unwrap();
    conn.execute(
      "UPDATE chat_messages SET content = ?1 WHERE id = ?2",
      rusqlite::params![content, id],
    )?;
    Ok(())
  }

  pub fn list_messages(&self, session_id: &str) -> rusqlite::Result<Vec<ChatMessage>> {
    let conn = self.conn.lock().unwrap();
    let mut stmt = conn.prepare(
      "SELECT id, session_id, role, content, mode, created_at
       FROM chat_messages WHERE session_id = ?1 ORDER BY created_at ASC",
    )?;
    let rows = stmt.query_map(rusqlite::params![session_id], |row| row_to_message(row))?;
    rows.collect()
  }
}

fn row_to_message(row: &rusqlite::Row) -> rusqlite::Result<ChatMessage> {
  let role_str: String = row.get(2)?;
  Ok(ChatMessage {
    id: row.get(0)?,
    session_id: row.get(1)?,
    role: MessageRole::from_str(&role_str),
    content: row.get(3)?,
    mode: row.get(4)?,
    created_at: row.get(5)?,
  })
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn round_trips_session_and_messages() {
    let store = Store::open(PathBuf::from(":memory:")).unwrap();
    let session = ChatSession {
      id: "s1".into(),
      title: "Hello".into(),
      provider: "local".into(),
      created_at: "2026-01-01T00:00:00Z".into(),
      updated_at: "2026-01-01T00:00:00Z".into(),
    };
    store.create_session(&session).unwrap();

    let msg = ChatMessage {
      id: "m1".into(),
      session_id: "s1".into(),
      role: MessageRole::User,
      content: "Hello".into(),
      mode: "local".into(),
      created_at: "2026-01-01T00:00:01Z".into(),
    };
    store.insert_message(&msg).unwrap();

    let sessions = store.list_sessions("local").unwrap();
    assert_eq!(sessions.len(), 1);
    assert_eq!(sessions[0].id, "s1");

    let claude_sessions = store.list_sessions("claude").unwrap();
    assert_eq!(claude_sessions.len(), 0, "sessions are partitioned by provider");

    let messages = store.list_messages("s1").unwrap();
    assert_eq!(messages.len(), 1);
    assert_eq!(messages[0].content, "Hello");
  }

  #[test]
  fn delete_session_cascades_to_messages() {
    let store = Store::open(PathBuf::from(":memory:")).unwrap();
    let session = ChatSession {
      id: "s1".into(),
      title: "Hello".into(),
      provider: "claude".into(),
      created_at: "2026-01-01T00:00:00Z".into(),
      updated_at: "2026-01-01T00:00:00Z".into(),
    };
    store.create_session(&session).unwrap();
    store
      .insert_message(&ChatMessage {
        id: "m1".into(),
        session_id: "s1".into(),
        role: MessageRole::User,
        content: "Hi".into(),
        mode: "claude".into(),
        created_at: "2026-01-01T00:00:01Z".into(),
      })
      .unwrap();

    store.delete_session("s1").unwrap();

    assert_eq!(store.list_sessions("claude").unwrap().len(), 0);
    assert_eq!(store.list_messages("s1").unwrap().len(), 0, "cascade should remove messages too");
  }

  /// A pre-existing DB (created before the `provider` column existed) must
  /// retrofit it via ALTER TABLE, defaulting existing rows to "local",
  /// without losing data — this is the real upgrade path for users who
  /// already have a general_chat.sqlite3 on disk.
  #[test]
  fn migrates_existing_db_without_provider_column() {
    let conn = Connection::open(PathBuf::from(":memory:")).unwrap();
    conn
      .execute_batch(
        "CREATE TABLE chat_sessions (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        INSERT INTO chat_sessions VALUES ('old-1', 'Old chat', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');",
      )
      .unwrap();

    // Re-derive Store::open's migration logic against this pre-existing
    // connection by writing it to a temp file and reopening through Store.
    let mut path = std::env::temp_dir();
    path.push(format!("udaan_chat_migration_test_{}.sqlite3", uuid::Uuid::new_v4()));
    conn.execute("VACUUM INTO ?1", rusqlite::params![path.to_string_lossy()]).unwrap();
    drop(conn);

    let store = Store::open(path.clone()).unwrap();
    let sessions = store.list_sessions("local").unwrap();
    assert_eq!(sessions.len(), 1, "pre-existing session should default to provider='local'");
    assert_eq!(sessions[0].id, "old-1");

    let _ = std::fs::remove_file(&path);
  }
}
