use std::path::PathBuf;
use std::sync::Mutex;

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

use crate::db::configure_connection;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Book {
  pub id: String,
  pub title: String,
  /// Absolute path to the original PDF/docx file — content is never
  /// copied into the DB; only extracted text and its embeddings are.
  pub file_path: String,
  pub file_kind: String, // "pdf" | "docx"
  pub chunk_count: i64,
  pub uploaded_at: String,
  /// Set when extraction/indexing had trouble with this book (e.g. a
  /// scanned/image-only PDF with little to no extractable text) — surfaced
  /// to the user rather than silently returning irrelevant answers later.
  pub index_warning: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BookChunk {
  pub id: String,
  pub book_id: String,
  pub chunk_index: i64,
  pub text: String,
  /// 384-dim all-MiniLM-L6-v2 embedding, stored as raw little-endian f32
  /// bytes (rusqlite has no native vector type; SQLite has no vector
  /// extension installed here) — retrieval does a full linear scan
  /// computing cosine similarity in Rust. Fine at this scale: a textbook
  /// is a few hundred to ~1000 chunks, not millions of rows.
  #[serde(skip_serializing)]
  pub embedding: Vec<u8>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StudySession {
  pub id: String,
  pub title: String,
  /// Comma-joined book ids open when this session was created — which
  /// book(s) a conversation was about, for later browsing context.
  pub book_ids: String,
  pub created_at: String,
  pub updated_at: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum StudyRole {
  User,
  Assistant,
}

impl StudyRole {
  fn as_str(&self) -> &'static str {
    match self {
      StudyRole::User => "user",
      StudyRole::Assistant => "assistant",
    }
  }
  fn from_str(s: &str) -> Self {
    match s {
      "assistant" => StudyRole::Assistant,
      _ => StudyRole::User,
    }
  }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StudyMessage {
  pub id: String,
  pub session_id: String,
  pub role: StudyRole,
  pub content: String,
  pub created_at: String,
}

fn f32_vec_to_bytes(v: &[f32]) -> Vec<u8> {
  v.iter().flat_map(|f| f.to_le_bytes()).collect()
}

pub fn bytes_to_f32_vec(b: &[u8]) -> Vec<f32> {
  b.chunks_exact(4).map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]])).collect()
}

pub struct Store {
  conn: Mutex<Connection>,
}

impl Store {
  pub fn open(db_path: PathBuf) -> rusqlite::Result<Self> {
    let conn = Connection::open(db_path)?;
    configure_connection(&conn)?;
    conn.execute_batch(
      "PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS study_books (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        file_path TEXT NOT NULL,
        file_kind TEXT NOT NULL,
        chunk_count INTEGER NOT NULL DEFAULT 0,
        uploaded_at TEXT NOT NULL,
        index_warning TEXT
      );
      CREATE TABLE IF NOT EXISTS study_book_chunks (
        id TEXT PRIMARY KEY,
        book_id TEXT NOT NULL REFERENCES study_books(id) ON DELETE CASCADE,
        chunk_index INTEGER NOT NULL,
        text TEXT NOT NULL,
        embedding BLOB NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_study_chunks_book_id ON study_book_chunks(book_id, chunk_index);
      CREATE TABLE IF NOT EXISTS study_sessions (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        book_ids TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_study_sessions_updated_at ON study_sessions(updated_at);
      CREATE TABLE IF NOT EXISTS study_messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES study_sessions(id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_study_messages_session_id ON study_messages(session_id, created_at);",
    )?;
    Ok(Self { conn: Mutex::new(conn) })
  }

  pub fn create_book(&self, book: &Book) -> rusqlite::Result<()> {
    let conn = self.conn.lock().unwrap();
    conn.execute(
      "INSERT INTO study_books (id, title, file_path, file_kind, chunk_count, uploaded_at, index_warning)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
      params![book.id, book.title, book.file_path, book.file_kind, book.chunk_count, book.uploaded_at, book.index_warning],
    )?;
    Ok(())
  }

  pub fn list_books(&self) -> rusqlite::Result<Vec<Book>> {
    let conn = self.conn.lock().unwrap();
    let mut stmt = conn.prepare(
      "SELECT id, title, file_path, file_kind, chunk_count, uploaded_at, index_warning
       FROM study_books ORDER BY uploaded_at DESC",
    )?;
    let rows = stmt.query_map([], |row| {
      Ok(Book {
        id: row.get(0)?,
        title: row.get(1)?,
        file_path: row.get(2)?,
        file_kind: row.get(3)?,
        chunk_count: row.get(4)?,
        uploaded_at: row.get(5)?,
        index_warning: row.get(6)?,
      })
    })?;
    rows.collect()
  }

  pub fn delete_book(&self, id: &str) -> rusqlite::Result<()> {
    let conn = self.conn.lock().unwrap();
    conn.execute("DELETE FROM study_books WHERE id = ?1", params![id])?;
    Ok(())
  }

  pub fn insert_chunks(&self, book_id: &str, chunks: &[(i64, String, Vec<f32>)]) -> rusqlite::Result<()> {
    let mut conn = self.conn.lock().unwrap();
    let tx = conn.transaction()?;
    for (index, text, embedding) in chunks {
      tx.execute(
        "INSERT INTO study_book_chunks (id, book_id, chunk_index, text, embedding) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![uuid::Uuid::new_v4().to_string(), book_id, index, text, f32_vec_to_bytes(embedding)],
      )?;
    }
    tx.commit()?;
    Ok(())
  }

  /// All chunks for the given book ids, for the caller to score against a
  /// query embedding — a full scan is fine at textbook scale (see
  /// `BookChunk::embedding` doc comment).
  pub fn chunks_for_books(&self, book_ids: &[String]) -> rusqlite::Result<Vec<BookChunk>> {
    if book_ids.is_empty() {
      return Ok(Vec::new());
    }
    let conn = self.conn.lock().unwrap();
    let placeholders = book_ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let sql = format!(
      "SELECT id, book_id, chunk_index, text, embedding FROM study_book_chunks WHERE book_id IN ({placeholders})"
    );
    let mut stmt = conn.prepare(&sql)?;
    let params_dyn: Vec<&dyn rusqlite::ToSql> = book_ids.iter().map(|s| s as &dyn rusqlite::ToSql).collect();
    let rows = stmt.query_map(params_dyn.as_slice(), |row| {
      Ok(BookChunk {
        id: row.get(0)?,
        book_id: row.get(1)?,
        chunk_index: row.get(2)?,
        text: row.get(3)?,
        embedding: row.get(4)?,
      })
    })?;
    rows.collect()
  }

  pub fn create_session(&self, session: &StudySession) -> rusqlite::Result<()> {
    let conn = self.conn.lock().unwrap();
    conn.execute(
      "INSERT INTO study_sessions (id, title, book_ids, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
      params![session.id, session.title, session.book_ids, session.created_at, session.updated_at],
    )?;
    Ok(())
  }

  pub fn touch_session(&self, id: &str, updated_at: &str) -> rusqlite::Result<()> {
    let conn = self.conn.lock().unwrap();
    conn.execute("UPDATE study_sessions SET updated_at = ?1 WHERE id = ?2", params![updated_at, id])?;
    Ok(())
  }

  pub fn list_sessions(&self) -> rusqlite::Result<Vec<StudySession>> {
    let conn = self.conn.lock().unwrap();
    let mut stmt = conn.prepare(
      "SELECT id, title, book_ids, created_at, updated_at FROM study_sessions ORDER BY updated_at DESC",
    )?;
    let rows = stmt.query_map([], |row| {
      Ok(StudySession {
        id: row.get(0)?,
        title: row.get(1)?,
        book_ids: row.get(2)?,
        created_at: row.get(3)?,
        updated_at: row.get(4)?,
      })
    })?;
    rows.collect()
  }

  pub fn delete_session(&self, id: &str) -> rusqlite::Result<()> {
    let conn = self.conn.lock().unwrap();
    conn.execute("DELETE FROM study_sessions WHERE id = ?1", params![id])?;
    Ok(())
  }

  pub fn insert_message(&self, message: &StudyMessage) -> rusqlite::Result<()> {
    let conn = self.conn.lock().unwrap();
    conn.execute(
      "INSERT INTO study_messages (id, session_id, role, content, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
      params![message.id, message.session_id, message.role.as_str(), message.content, message.created_at],
    )?;
    Ok(())
  }

  pub fn list_messages(&self, session_id: &str) -> rusqlite::Result<Vec<StudyMessage>> {
    let conn = self.conn.lock().unwrap();
    let mut stmt = conn.prepare(
      "SELECT id, session_id, role, content, created_at FROM study_messages WHERE session_id = ?1 ORDER BY created_at ASC",
    )?;
    let rows = stmt.query_map(params![session_id], |row| {
      let role_str: String = row.get(2)?;
      Ok(StudyMessage {
        id: row.get(0)?,
        session_id: row.get(1)?,
        role: StudyRole::from_str(&role_str),
        content: row.get(3)?,
        created_at: row.get(4)?,
      })
    })?;
    rows.collect()
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn round_trips_book_and_chunks() {
    let store = Store::open(PathBuf::from(":memory:")).unwrap();
    let book = Book {
      id: "b1".into(),
      title: "Intro to Biology".into(),
      file_path: "/tmp/bio.pdf".into(),
      file_kind: "pdf".into(),
      chunk_count: 2,
      uploaded_at: "2026-01-01T00:00:00Z".into(),
      index_warning: None,
    };
    store.create_book(&book).unwrap();
    store
      .insert_chunks(
        "b1",
        &[
          (0, "Photosynthesis converts light to chemical energy.".into(), vec![0.1, 0.2, 0.3]),
          (1, "Mitosis is a form of cell division.".into(), vec![0.4, 0.5, 0.6]),
        ],
      )
      .unwrap();

    let books = store.list_books().unwrap();
    assert_eq!(books.len(), 1);

    let chunks = store.chunks_for_books(&["b1".to_string()]).unwrap();
    assert_eq!(chunks.len(), 2);
    let restored = bytes_to_f32_vec(&chunks[0].embedding);
    assert!((restored[0] - 0.1).abs() < 1e-6);
  }

  #[test]
  fn delete_book_cascades_to_chunks() {
    let store = Store::open(PathBuf::from(":memory:")).unwrap();
    store
      .create_book(&Book {
        id: "b1".into(),
        title: "T".into(),
        file_path: "/tmp/t.pdf".into(),
        file_kind: "pdf".into(),
        chunk_count: 1,
        uploaded_at: "2026-01-01T00:00:00Z".into(),
        index_warning: None,
      })
      .unwrap();
    store.insert_chunks("b1", &[(0, "text".into(), vec![0.1])]).unwrap();
    store.delete_book("b1").unwrap();
    assert_eq!(store.chunks_for_books(&["b1".to_string()]).unwrap().len(), 0, "cascade should remove chunks too");
  }

  #[test]
  fn round_trips_session_and_messages() {
    let store = Store::open(PathBuf::from(":memory:")).unwrap();
    let session = StudySession {
      id: "s1".into(),
      title: "Chapter 3 questions".into(),
      book_ids: "b1,b2".into(),
      created_at: "2026-01-01T00:00:00Z".into(),
      updated_at: "2026-01-01T00:00:00Z".into(),
    };
    store.create_session(&session).unwrap();
    store
      .insert_message(&StudyMessage {
        id: "m1".into(),
        session_id: "s1".into(),
        role: StudyRole::User,
        content: "What is mitosis?".into(),
        created_at: "2026-01-01T00:00:01Z".into(),
      })
      .unwrap();

    let sessions = store.list_sessions().unwrap();
    assert_eq!(sessions.len(), 1);
    assert_eq!(sessions[0].book_ids, "b1,b2");

    let messages = store.list_messages("s1").unwrap();
    assert_eq!(messages.len(), 1);
  }

  #[test]
  fn delete_session_cascades_to_messages() {
    let store = Store::open(PathBuf::from(":memory:")).unwrap();
    store
      .create_session(&StudySession {
        id: "s1".into(),
        title: "T".into(),
        book_ids: "b1".into(),
        created_at: "2026-01-01T00:00:00Z".into(),
        updated_at: "2026-01-01T00:00:00Z".into(),
      })
      .unwrap();
    store
      .insert_message(&StudyMessage {
        id: "m1".into(),
        session_id: "s1".into(),
        role: StudyRole::User,
        content: "Hi".into(),
        created_at: "2026-01-01T00:00:01Z".into(),
      })
      .unwrap();
    store.delete_session("s1").unwrap();
    assert_eq!(store.list_messages("s1").unwrap().len(), 0, "cascade should remove messages too");
  }
}
