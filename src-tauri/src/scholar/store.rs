use std::sync::Mutex;

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::db::configure_connection;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Subject {
  pub id: String,
  pub name: String,
  /// Hex colour used to tint blocks for this subject in the calendar grid.
  pub color: String,
  pub created_at: String,
  /// False only for EGD, which is exempt from lesson generation (see
  /// `seed_subjects`) - the UI hides "Add Chapter" and offers notes only.
  pub lessons_enabled: bool,
  /// Fixed display order for the ten seeded streams, so the subject list
  /// reads in curriculum order rather than by insertion time.
  pub position: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StudyBlock {
  pub id: String,
  pub subject_id: String,
  pub date: String,
  /// HH:MM
  pub start_time: String,
  /// HH:MM
  pub end_time: String,
  pub topic: String,
  pub chapter: String,
  pub notes: String,
  pub completed: bool,
  pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DailyReflection {
  pub date: String,
  pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubjectStreak {
  pub subject_id: String,
  pub current_streak: i64,
  pub longest_streak: i64,
  pub last_studied: Option<String>,
}

/// A named unit of a subject's course (e.g. "Chapter 1 - The Cold War"),
/// created when the user adds a batch of photographed textbook pages. The
/// source image paths are kept so a chapter can be re-ingested later
/// without rephotographing, and `status` tracks the ingestion pipeline
/// (pending -> generating -> ready | failed) so a chapter whose OmniRoute
/// call died mid-flight is visibly retryable rather than silently empty.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Chapter {
  pub id: String,
  pub subject_id: String,
  /// CAPS term 1-4. Chapters are the library's topics, filed under the
  /// term they belong to, mirroring how the school year is actually
  /// organised rather than a flat list per subject.
  pub term: i64,
  pub name: String,
  /// JSON array of absolute image paths the chapter was ingested from.
  pub source_paths: String,
  /// 'pending' | 'generating' | 'ready' | 'failed'
  pub status: String,
  /// Failure detail when `status` is 'failed' - surfaced in the UI so the
  /// user knows whether to retry or rephotograph.
  pub error: Option<String>,
  pub completed: bool,
  pub created_at: String,
}

/// One generated teaching unit within a chapter. A chapter typically yields
/// several of these, one per topic the model identified in the pages.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Lesson {
  pub id: String,
  pub chapter_id: String,
  pub subject_id: String,
  pub topic: String,
  /// The full step-by-step lesson body, as Markdown. Kept alongside
  /// `content` so a lesson generated before the structured format
  /// existed still renders as readable prose.
  pub body: String,
  /// The structured lesson (objectives, worked examples, misconceptions,
  /// practice, quiz, remediation) as JSON, or empty when this lesson
  /// predates structured generation or its generation failed.
  pub content: String,
  /// 'not_started' | 'needs_practice' | 'mastered'
  pub mastery: String,
  /// Best quiz score so far, as "correct/total"; empty until attempted.
  pub last_score: String,
  /// Ordering within the chapter, as the model presented the topics.
  pub position: i64,
  pub created_at: String,
}

/// A user-written note, scoped to a subject and optionally to a chapter.
/// This is EGD's primary surface, since it is exempt from lesson
/// generation, but every subject has one.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Note {
  pub id: String,
  pub subject_id: String,
  pub chapter_id: Option<String>,
  pub title: String,
  pub body: String,
  pub created_at: String,
  pub updated_at: String,
}

/// A generated test and, once taken, its result. Stored as one row so a
/// test's questions and the score they produced never drift apart.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Test {
  pub id: String,
  pub subject_id: String,
  /// JSON array of the chapter ids this test draws on - more than one when
  /// the user asked for a cross-chapter test.
  pub chapter_ids: String,
  pub title: String,
  /// The generated paper, as Markdown.
  pub body: String,
  /// The memorandum, kept separate so the UI can withhold it until the
  /// user has actually attempted the paper.
  pub memo: String,
  pub score: Option<i64>,
  pub total: Option<i64>,
  pub taken_at: Option<String>,
  pub created_at: String,
}

/// An imported past paper (PDF or images), linked to a subject and
/// optionally to the chapters it covers. Scholar stores only the path -
/// the file stays wherever the user keeps it.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PastPaper {
  pub id: String,
  pub subject_id: String,
  pub title: String,
  /// JSON array of absolute file paths (one PDF, or several images).
  pub source_paths: String,
  /// JSON array of related chapter ids; empty array when unlinked.
  pub chapter_ids: String,
  pub year: Option<i64>,
  pub created_at: String,
}

/// A reference file kept against a subject: a demonstration video, a
/// worked drawing, a diagram, a PDF handout.
///
/// This is how EGD carries its content, since it generates no lessons —
/// construction technique is taught by watching it done, not by reading a
/// description of it — but any subject can hold resources. Only the path
/// is stored; the file stays where the user keeps it.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Resource {
  pub id: String,
  pub subject_id: String,
  pub chapter_id: Option<String>,
  pub title: String,
  pub path: String,
  /// 'video' | 'image' | 'document' — decided from the extension when the
  /// resource is added, so the UI can pick an icon without re-parsing.
  pub kind: String,
  pub created_at: String,
}

pub struct Store {
  conn: Mutex<Connection>,
}

impl Store {
  pub fn open(db_path: std::path::PathBuf) -> rusqlite::Result<Self> {
    let conn = Connection::open(db_path)?;
    configure_connection(&conn)?;
    conn.execute_batch(
      "CREATE TABLE IF NOT EXISTS scholar_subjects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        color TEXT NOT NULL DEFAULT '#3b82f6',
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS scholar_blocks (
        id TEXT PRIMARY KEY,
        subject_id TEXT NOT NULL,
        date TEXT NOT NULL,
        start_time TEXT NOT NULL,
        end_time TEXT NOT NULL,
        topic TEXT NOT NULL DEFAULT '',
        chapter TEXT NOT NULL DEFAULT '',
        notes TEXT NOT NULL DEFAULT '',
        completed INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        FOREIGN KEY (subject_id) REFERENCES scholar_subjects(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS scholar_blocks_date ON scholar_blocks(date);
      CREATE TABLE IF NOT EXISTS scholar_reflections (
        date TEXT PRIMARY KEY,
        text TEXT NOT NULL DEFAULT ''
      );
      CREATE TABLE IF NOT EXISTS scholar_streaks (
        subject_id TEXT PRIMARY KEY,
        current_streak INTEGER NOT NULL DEFAULT 0,
        longest_streak INTEGER NOT NULL DEFAULT 0,
        last_studied TEXT
      );
      CREATE TABLE IF NOT EXISTS scholar_chapters (
        id TEXT PRIMARY KEY,
        subject_id TEXT NOT NULL,
        name TEXT NOT NULL,
        source_paths TEXT NOT NULL DEFAULT '[]',
        term INTEGER NOT NULL DEFAULT 1,
        status TEXT NOT NULL DEFAULT 'pending',
        error TEXT,
        completed INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        FOREIGN KEY (subject_id) REFERENCES scholar_subjects(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS scholar_chapters_subject ON scholar_chapters(subject_id);
      CREATE TABLE IF NOT EXISTS scholar_lessons (
        id TEXT PRIMARY KEY,
        chapter_id TEXT NOT NULL,
        subject_id TEXT NOT NULL,
        topic TEXT NOT NULL,
        body TEXT NOT NULL DEFAULT '',
        content TEXT NOT NULL DEFAULT '',
        mastery TEXT NOT NULL DEFAULT 'not_started',
        last_score TEXT NOT NULL DEFAULT '',
        position INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        FOREIGN KEY (chapter_id) REFERENCES scholar_chapters(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS scholar_lessons_chapter ON scholar_lessons(chapter_id);
      CREATE INDEX IF NOT EXISTS scholar_lessons_subject ON scholar_lessons(subject_id);
      CREATE TABLE IF NOT EXISTS scholar_notes (
        id TEXT PRIMARY KEY,
        subject_id TEXT NOT NULL,
        chapter_id TEXT,
        title TEXT NOT NULL DEFAULT '',
        body TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (subject_id) REFERENCES scholar_subjects(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS scholar_notes_subject ON scholar_notes(subject_id);
      CREATE TABLE IF NOT EXISTS scholar_tests (
        id TEXT PRIMARY KEY,
        subject_id TEXT NOT NULL,
        chapter_ids TEXT NOT NULL DEFAULT '[]',
        title TEXT NOT NULL,
        body TEXT NOT NULL DEFAULT '',
        memo TEXT NOT NULL DEFAULT '',
        score INTEGER,
        total INTEGER,
        taken_at TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (subject_id) REFERENCES scholar_subjects(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS scholar_tests_subject ON scholar_tests(subject_id);
      CREATE TABLE IF NOT EXISTS scholar_past_papers (
        id TEXT PRIMARY KEY,
        subject_id TEXT NOT NULL,
        title TEXT NOT NULL,
        source_paths TEXT NOT NULL DEFAULT '[]',
        chapter_ids TEXT NOT NULL DEFAULT '[]',
        year INTEGER,
        created_at TEXT NOT NULL,
        FOREIGN KEY (subject_id) REFERENCES scholar_subjects(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS scholar_past_papers_subject ON scholar_past_papers(subject_id);
      CREATE TABLE IF NOT EXISTS scholar_resources (
        id TEXT PRIMARY KEY,
        subject_id TEXT NOT NULL,
        chapter_id TEXT,
        title TEXT NOT NULL,
        path TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'document',
        created_at TEXT NOT NULL,
        FOREIGN KEY (subject_id) REFERENCES scholar_subjects(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS scholar_resources_subject ON scholar_resources(subject_id);
      CREATE TABLE IF NOT EXISTS scholar_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );",
    )?;
    // `lessons_enabled` and `position` were added to `scholar_subjects`
    // after the table already shipped, so they arrive as ALTERs rather
    // than as part of the CREATE above - an existing install has rows to
    // preserve. SQLite has no `ADD COLUMN IF NOT EXISTS`, and an error
    // here means the column is already there, which is the normal case on
    // every launch after the first, so the result is deliberately
    // discarded rather than propagated.
    let _ = conn.execute(
      "ALTER TABLE scholar_subjects ADD COLUMN lessons_enabled INTEGER NOT NULL DEFAULT 1",
      [],
    );
    let _ = conn.execute(
      "ALTER TABLE scholar_subjects ADD COLUMN position INTEGER NOT NULL DEFAULT 0",
      [],
    );
    // Term/topic structure and structured lesson content arrived after
    // these tables shipped, so they are ALTERs too. Term defaults to 1 so
    // chapters created before terms existed land somewhere real rather
    // than in a phantom "term 0".
    let _ = conn.execute(
      "ALTER TABLE scholar_chapters ADD COLUMN term INTEGER NOT NULL DEFAULT 1",
      [],
    );
    let _ = conn.execute(
      "ALTER TABLE scholar_lessons ADD COLUMN content TEXT NOT NULL DEFAULT ''",
      [],
    );
    let _ = conn.execute(
      "ALTER TABLE scholar_lessons ADD COLUMN mastery TEXT NOT NULL DEFAULT 'not_started'",
      [],
    );
    let _ = conn.execute(
      "ALTER TABLE scholar_lessons ADD COLUMN last_score TEXT NOT NULL DEFAULT ''",
      [],
    );
    let store = Self { conn: Mutex::new(conn) };
    store.seed_subjects()?;
    Ok(store)
  }

  /// Inserts the ten fixed Grade 10 CAPS streams Scholar is built around,
  /// once, on a database that doesn't already have them.
  ///
  /// These are seeded rather than hardcoded in the UI so the calendar's
  /// existing subject-keyed blocks, streaks and colour tinting keep
  /// working unchanged, and so a stream can be renamed or recoloured
  /// without a rebuild. The `WHERE NOT EXISTS` guard matches on `name`
  /// rather than a fixed id, so a user who already created e.g. "History"
  /// by hand doesn't end up with a duplicate row.
  ///
  /// EGD is the one stream with `lessons_enabled = 0`: it's a drawing
  /// subject whose content is diagrams and construction technique, which
  /// a text lesson generated from photographed pages would misrepresent,
  /// so it gets the notes/video surface only.
  fn seed_subjects(&self) -> rusqlite::Result<()> {
    const SEED: [(&str, &str, bool); 10] = [
      ("History", "#e5484d", true),
      ("English", "#f07a70", true),
      ("Afrikaans", "#a82c32", true),
      ("Pure Math: Algebra", "#e5484d", true),
      ("Pure Math: Geometry", "#f07a70", true),
      ("AP Math", "#a82c32", true),
      ("EGD", "#8b939e", false),
      ("Business Studies", "#c9ccd2", true),
      ("Life Orientation", "#8b939e", true),
      ("Religion Studies", "#5a616b", true),
    ];
    let conn = self.conn.lock().unwrap();
    let now = chrono::Utc::now().to_rfc3339();
    for (i, (name, color, lessons)) in SEED.iter().enumerate() {
      conn.execute(
        "INSERT INTO scholar_subjects (id, name, color, created_at, lessons_enabled, position)
         SELECT ?1, ?2, ?3, ?4, ?5, ?6
         WHERE NOT EXISTS (SELECT 1 FROM scholar_subjects WHERE name = ?2)",
        params![
          uuid::Uuid::new_v4().to_string(),
          name,
          color,
          now,
          *lessons as i64,
          i as i64
        ],
      )?;
    }
    Ok(())
  }

  // --- Subjects ---

  pub fn list_subjects(&self) -> rusqlite::Result<Vec<Subject>> {
    let conn = self.conn.lock().unwrap();
    let mut stmt = conn.prepare(
      "SELECT id, name, color, created_at, lessons_enabled, position FROM scholar_subjects
       ORDER BY position ASC, created_at ASC",
    )?;
    let rows = stmt.query_map([], |row| {
      Ok(Subject {
        id: row.get(0)?,
        name: row.get(1)?,
        color: row.get(2)?,
        created_at: row.get(3)?,
        lessons_enabled: row.get::<_, i64>(4)? != 0,
        position: row.get(5)?,
      })
    })?;
    rows.collect()
  }

  pub fn create_subject(&self, subject: &Subject) -> rusqlite::Result<()> {
    let conn = self.conn.lock().unwrap();
    conn.execute(
      "INSERT INTO scholar_subjects (id, name, color, created_at, lessons_enabled, position)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
      params![
        subject.id,
        subject.name,
        subject.color,
        subject.created_at,
        subject.lessons_enabled as i64,
        subject.position
      ],
    )?;
    Ok(())
  }

  pub fn update_subject(&self, subject: &Subject) -> rusqlite::Result<()> {
    let conn = self.conn.lock().unwrap();
    conn.execute(
      "UPDATE scholar_subjects SET name = ?2, color = ?3, lessons_enabled = ?4 WHERE id = ?1",
      params![subject.id, subject.name, subject.color, subject.lessons_enabled as i64],
    )?;
    Ok(())
  }

  pub fn delete_subject(&self, id: &str) -> rusqlite::Result<()> {
    let conn = self.conn.lock().unwrap();
    conn.execute("DELETE FROM scholar_subjects WHERE id = ?1", params![id])?;
    Ok(())
  }

  // --- Blocks ---

  pub fn list_blocks_for_week(&self, week_start: &str, week_end: &str) -> rusqlite::Result<Vec<StudyBlock>> {
    let conn = self.conn.lock().unwrap();
    let mut stmt = conn.prepare(
      "SELECT id, subject_id, date, start_time, end_time, topic, chapter, notes, completed, created_at
       FROM scholar_blocks WHERE date >= ?1 AND date <= ?2 ORDER BY date ASC, start_time ASC",
    )?;
    let rows = stmt.query_map(params![week_start, week_end], |row| {
      Ok(StudyBlock {
        id: row.get(0)?,
        subject_id: row.get(1)?,
        date: row.get(2)?,
        start_time: row.get(3)?,
        end_time: row.get(4)?,
        topic: row.get(5)?,
        chapter: row.get(6)?,
        notes: row.get(7)?,
        completed: row.get::<_, i64>(8)? != 0,
        created_at: row.get(9)?,
      })
    })?;
    rows.collect()
  }

  pub fn list_blocks_for_date(&self, date: &str) -> rusqlite::Result<Vec<StudyBlock>> {
    let conn = self.conn.lock().unwrap();
    let mut stmt = conn.prepare(
      "SELECT id, subject_id, date, start_time, end_time, topic, chapter, notes, completed, created_at
       FROM scholar_blocks WHERE date = ?1 ORDER BY start_time ASC",
    )?;
    let rows = stmt.query_map(params![date], |row| {
      Ok(StudyBlock {
        id: row.get(0)?,
        subject_id: row.get(1)?,
        date: row.get(2)?,
        start_time: row.get(3)?,
        end_time: row.get(4)?,
        topic: row.get(5)?,
        chapter: row.get(6)?,
        notes: row.get(7)?,
        completed: row.get::<_, i64>(8)? != 0,
        created_at: row.get(9)?,
      })
    })?;
    rows.collect()
  }

  pub fn create_block(&self, block: &StudyBlock) -> rusqlite::Result<()> {
    let conn = self.conn.lock().unwrap();
    conn.execute(
      "INSERT INTO scholar_blocks (id, subject_id, date, start_time, end_time, topic, chapter, notes, completed, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
      params![
        block.id, block.subject_id, block.date, block.start_time, block.end_time,
        block.topic, block.chapter, block.notes, block.completed as i64, block.created_at
      ],
    )?;
    Ok(())
  }

  pub fn update_block(&self, block: &StudyBlock) -> rusqlite::Result<()> {
    let conn = self.conn.lock().unwrap();
    conn.execute(
      "UPDATE scholar_blocks SET subject_id=?2, date=?3, start_time=?4, end_time=?5,
       topic=?6, chapter=?7, notes=?8, completed=?9 WHERE id=?1",
      params![
        block.id, block.subject_id, block.date, block.start_time, block.end_time,
        block.topic, block.chapter, block.notes, block.completed as i64
      ],
    )?;
    Ok(())
  }

  pub fn set_block_completed(&self, id: &str, completed: bool) -> rusqlite::Result<()> {
    let conn = self.conn.lock().unwrap();
    conn.execute(
      "UPDATE scholar_blocks SET completed = ?2 WHERE id = ?1",
      params![id, completed as i64],
    )?;
    Ok(())
  }

  pub fn delete_block(&self, id: &str) -> rusqlite::Result<()> {
    let conn = self.conn.lock().unwrap();
    conn.execute("DELETE FROM scholar_blocks WHERE id = ?1", params![id])?;
    Ok(())
  }

  // --- Reflections ---

  pub fn get_reflection(&self, date: &str) -> rusqlite::Result<Option<DailyReflection>> {
    let conn = self.conn.lock().unwrap();
    conn
      .query_row(
        "SELECT date, text FROM scholar_reflections WHERE date = ?1",
        params![date],
        |row| Ok(DailyReflection { date: row.get(0)?, text: row.get(1)? }),
      )
      .optional()
  }

  pub fn set_reflection(&self, reflection: &DailyReflection) -> rusqlite::Result<()> {
    let conn = self.conn.lock().unwrap();
    conn.execute(
      "INSERT INTO scholar_reflections (date, text) VALUES (?1, ?2)
       ON CONFLICT(date) DO UPDATE SET text = excluded.text",
      params![reflection.date, reflection.text],
    )?;
    Ok(())
  }

  // --- Streaks ---

  pub fn list_streaks(&self) -> rusqlite::Result<Vec<SubjectStreak>> {
    let conn = self.conn.lock().unwrap();
    let mut stmt = conn.prepare(
      "SELECT subject_id, current_streak, longest_streak, last_studied FROM scholar_streaks",
    )?;
    let rows = stmt.query_map([], |row| {
      Ok(SubjectStreak {
        subject_id: row.get(0)?,
        current_streak: row.get(1)?,
        longest_streak: row.get(2)?,
        last_studied: row.get(3)?,
      })
    })?;
    rows.collect()
  }

  pub fn update_streak(&self, streak: &SubjectStreak) -> rusqlite::Result<()> {
    let conn = self.conn.lock().unwrap();
    conn.execute(
      "INSERT INTO scholar_streaks (subject_id, current_streak, longest_streak, last_studied)
       VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT(subject_id) DO UPDATE SET
         current_streak = excluded.current_streak,
         longest_streak = excluded.longest_streak,
         last_studied = excluded.last_studied",
      params![streak.subject_id, streak.current_streak, streak.longest_streak, streak.last_studied],
    )?;
    Ok(())
  }
  // --- Resources ---

  pub fn list_resources(&self, subject_id: &str) -> rusqlite::Result<Vec<Resource>> {
    let conn = self.conn.lock().unwrap();
    let mut stmt = conn.prepare(
      "SELECT id, subject_id, chapter_id, title, path, kind, created_at
       FROM scholar_resources WHERE subject_id = ?1 ORDER BY created_at DESC",
    )?;
    let rows = stmt.query_map(params![subject_id], |row| {
      Ok(Resource {
        id: row.get(0)?,
        subject_id: row.get(1)?,
        chapter_id: row.get(2)?,
        title: row.get(3)?,
        path: row.get(4)?,
        kind: row.get(5)?,
        created_at: row.get(6)?,
      })
    })?;
    rows.collect()
  }

  pub fn create_resource(&self, r: &Resource) -> rusqlite::Result<()> {
    let conn = self.conn.lock().unwrap();
    conn.execute(
      "INSERT INTO scholar_resources (id, subject_id, chapter_id, title, path, kind, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
      params![r.id, r.subject_id, r.chapter_id, r.title, r.path, r.kind, r.created_at],
    )?;
    Ok(())
  }

  pub fn delete_resource(&self, id: &str) -> rusqlite::Result<()> {
    let conn = self.conn.lock().unwrap();
    conn.execute("DELETE FROM scholar_resources WHERE id = ?1", params![id])?;
    Ok(())
  }

  // --- Settings ---

  /// A small key/value store for Scholar's own preferences (currently the
  /// study planner's rotation). Kept here rather than in the taskbar's
  /// prefs store because this is Scholar's data, and it travels with the
  /// rest of the Scholar database on backup or reset.
  ///
  /// Values are opaque strings — the caller decides the encoding (JSON,
  /// in practice) — so adding a new setting never needs a migration.
  pub fn get_setting(&self, key: &str) -> rusqlite::Result<Option<String>> {
    let conn = self.conn.lock().unwrap();
    conn
      .query_row(
        "SELECT value FROM scholar_settings WHERE key = ?1",
        params![key],
        |row| row.get(0),
      )
      .optional()
  }

  pub fn set_setting(&self, key: &str, value: &str) -> rusqlite::Result<()> {
    let conn = self.conn.lock().unwrap();
    conn.execute(
      "INSERT INTO scholar_settings (key, value) VALUES (?1, ?2)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      params![key, value],
    )?;
    Ok(())
  }

  // --- Chapters ---

  pub fn list_chapters(&self, subject_id: &str) -> rusqlite::Result<Vec<Chapter>> {
    let conn = self.conn.lock().unwrap();
    let mut stmt = conn.prepare(
      "SELECT id, subject_id, term, name, source_paths, status, error, completed, created_at
       FROM scholar_chapters WHERE subject_id = ?1 ORDER BY term ASC, created_at ASC",
    )?;
    let rows = stmt.query_map(params![subject_id], |row| {
      Ok(Chapter {
        id: row.get(0)?,
        subject_id: row.get(1)?,
        term: row.get(2)?,
        name: row.get(3)?,
        source_paths: row.get(4)?,
        status: row.get(5)?,
        error: row.get(6)?,
        completed: row.get::<_, i64>(7)? != 0,
        created_at: row.get(8)?,
      })
    })?;
    rows.collect()
  }

  pub fn create_chapter(&self, chapter: &Chapter) -> rusqlite::Result<()> {
    let conn = self.conn.lock().unwrap();
    conn.execute(
      "INSERT INTO scholar_chapters (id, subject_id, term, name, source_paths, status, error, completed, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
      params![
        chapter.id, chapter.subject_id, chapter.term, chapter.name, chapter.source_paths,
        chapter.status, chapter.error, chapter.completed as i64, chapter.created_at
      ],
    )?;
    Ok(())
  }

  /// Moves a chapter through the ingestion pipeline. `error` is always
  /// written (not merged), so a successful retry clears the message left
  /// by a previous failure instead of leaving a stale one on a ready row.
  pub fn set_chapter_status(
    &self,
    id: &str,
    status: &str,
    error: Option<&str>,
  ) -> rusqlite::Result<()> {
    let conn = self.conn.lock().unwrap();
    conn.execute(
      "UPDATE scholar_chapters SET status = ?2, error = ?3 WHERE id = ?1",
      params![id, status, error],
    )?;
    Ok(())
  }

  pub fn set_chapter_completed(&self, id: &str, completed: bool) -> rusqlite::Result<()> {
    let conn = self.conn.lock().unwrap();
    conn.execute(
      "UPDATE scholar_chapters SET completed = ?2 WHERE id = ?1",
      params![id, completed as i64],
    )?;
    Ok(())
  }

  pub fn rename_chapter(&self, id: &str, name: &str) -> rusqlite::Result<()> {
    let conn = self.conn.lock().unwrap();
    conn.execute(
      "UPDATE scholar_chapters SET name = ?2 WHERE id = ?1",
      params![id, name],
    )?;
    Ok(())
  }

  pub fn delete_chapter(&self, id: &str) -> rusqlite::Result<()> {
    let conn = self.conn.lock().unwrap();
    conn.execute("DELETE FROM scholar_chapters WHERE id = ?1", params![id])?;
    Ok(())
  }

  // --- Lessons ---

  pub fn list_lessons(&self, chapter_id: &str) -> rusqlite::Result<Vec<Lesson>> {
    let conn = self.conn.lock().unwrap();
    let mut stmt = conn.prepare(
      "SELECT id, chapter_id, subject_id, topic, body, content, mastery, last_score, position, created_at
       FROM scholar_lessons WHERE chapter_id = ?1 ORDER BY position ASC",
    )?;
    let rows = stmt.query_map(params![chapter_id], |row| {
      Ok(Lesson {
        id: row.get(0)?,
        chapter_id: row.get(1)?,
        subject_id: row.get(2)?,
        topic: row.get(3)?,
        body: row.get(4)?,
        content: row.get(5)?,
        mastery: row.get(6)?,
        last_score: row.get(7)?,
        position: row.get(8)?,
        created_at: row.get(9)?,
      })
    })?;
    rows.collect()
  }

  /// Every lesson for a subject, across all its chapters - the corpus the
  /// tutor chat is grounded in (see `scholar_subject_context`).
  pub fn list_lessons_for_subject(&self, subject_id: &str) -> rusqlite::Result<Vec<Lesson>> {
    let conn = self.conn.lock().unwrap();
    let mut stmt = conn.prepare(
      "SELECT l.id, l.chapter_id, l.subject_id, l.topic, l.body, l.content, l.mastery, l.last_score, l.position, l.created_at
       FROM scholar_lessons l
       JOIN scholar_chapters c ON c.id = l.chapter_id
       WHERE l.subject_id = ?1
       ORDER BY c.created_at ASC, l.position ASC",
    )?;
    let rows = stmt.query_map(params![subject_id], |row| {
      Ok(Lesson {
        id: row.get(0)?,
        chapter_id: row.get(1)?,
        subject_id: row.get(2)?,
        topic: row.get(3)?,
        body: row.get(4)?,
        content: row.get(5)?,
        mastery: row.get(6)?,
        last_score: row.get(7)?,
        position: row.get(8)?,
        created_at: row.get(9)?,
      })
    })?;
    rows.collect()
  }

  /// Replaces a chapter's lessons with a freshly generated set, in one
  /// transaction. Re-ingesting a chapter must not leave the topics from
  /// the previous run sitting alongside the new ones, and a failure
  /// halfway through must not leave the chapter with some of each - so
  /// the delete and the inserts commit together or not at all.
  pub fn replace_lessons(&self, chapter_id: &str, lessons: &[Lesson]) -> rusqlite::Result<()> {
    let mut conn = self.conn.lock().unwrap();
    let tx = conn.transaction()?;
    tx.execute("DELETE FROM scholar_lessons WHERE chapter_id = ?1", params![chapter_id])?;
    for lesson in lessons {
      tx.execute(
        "INSERT INTO scholar_lessons (id, chapter_id, subject_id, topic, body, content, mastery, last_score, position, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![
          lesson.id, lesson.chapter_id, lesson.subject_id,
          lesson.topic, lesson.body, lesson.content, lesson.mastery,
          lesson.last_score, lesson.position, lesson.created_at
        ],
      )?;
    }
    tx.commit()
  }

  /// Records a quiz attempt against a lesson.
  ///
  /// Mastery only ever improves: a student who has mastered a topic and
  /// later re-takes the quiz for revision shouldn't be demoted to
  /// "needs practice" by a casual second attempt, so a lower result
  /// updates the score but leaves an earned `mastered` standing.
  pub fn set_lesson_mastery(
    &self,
    id: &str,
    mastery: &str,
    last_score: &str,
  ) -> rusqlite::Result<()> {
    let conn = self.conn.lock().unwrap();
    conn.execute(
      "UPDATE scholar_lessons
       SET mastery = CASE WHEN mastery = 'mastered' THEN 'mastered' ELSE ?2 END,
           last_score = ?3
       WHERE id = ?1",
      params![id, mastery, last_score],
    )?;
    Ok(())
  }

  // --- Notes ---

  pub fn list_notes(&self, subject_id: &str) -> rusqlite::Result<Vec<Note>> {
    let conn = self.conn.lock().unwrap();
    let mut stmt = conn.prepare(
      "SELECT id, subject_id, chapter_id, title, body, created_at, updated_at
       FROM scholar_notes WHERE subject_id = ?1 ORDER BY updated_at DESC",
    )?;
    let rows = stmt.query_map(params![subject_id], |row| {
      Ok(Note {
        id: row.get(0)?,
        subject_id: row.get(1)?,
        chapter_id: row.get(2)?,
        title: row.get(3)?,
        body: row.get(4)?,
        created_at: row.get(5)?,
        updated_at: row.get(6)?,
      })
    })?;
    rows.collect()
  }

  pub fn upsert_note(&self, note: &Note) -> rusqlite::Result<()> {
    let conn = self.conn.lock().unwrap();
    conn.execute(
      "INSERT INTO scholar_notes (id, subject_id, chapter_id, title, body, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
       ON CONFLICT(id) DO UPDATE SET
         chapter_id = excluded.chapter_id,
         title = excluded.title,
         body = excluded.body,
         updated_at = excluded.updated_at",
      params![
        note.id, note.subject_id, note.chapter_id,
        note.title, note.body, note.created_at, note.updated_at
      ],
    )?;
    Ok(())
  }

  pub fn delete_note(&self, id: &str) -> rusqlite::Result<()> {
    let conn = self.conn.lock().unwrap();
    conn.execute("DELETE FROM scholar_notes WHERE id = ?1", params![id])?;
    Ok(())
  }

  // --- Tests ---

  pub fn list_tests(&self, subject_id: &str) -> rusqlite::Result<Vec<Test>> {
    let conn = self.conn.lock().unwrap();
    let mut stmt = conn.prepare(
      "SELECT id, subject_id, chapter_ids, title, body, memo, score, total, taken_at, created_at
       FROM scholar_tests WHERE subject_id = ?1 ORDER BY created_at DESC",
    )?;
    let rows = stmt.query_map(params![subject_id], |row| {
      Ok(Test {
        id: row.get(0)?,
        subject_id: row.get(1)?,
        chapter_ids: row.get(2)?,
        title: row.get(3)?,
        body: row.get(4)?,
        memo: row.get(5)?,
        score: row.get(6)?,
        total: row.get(7)?,
        taken_at: row.get(8)?,
        created_at: row.get(9)?,
      })
    })?;
    rows.collect()
  }

  /// Every test that has actually been attempted, across all subjects,
  /// newest first — what the Progress view plots.
  ///
  /// Unattempted tests are excluded here rather than filtered in the UI:
  /// a generated-but-never-sat paper is not a result, and including it
  /// would drag an average down with a score that was never earned.
  pub fn list_results(&self) -> rusqlite::Result<Vec<Test>> {
    let conn = self.conn.lock().unwrap();
    let mut stmt = conn.prepare(
      "SELECT id, subject_id, chapter_ids, title, body, memo, score, total, taken_at, created_at
       FROM scholar_tests WHERE taken_at IS NOT NULL AND score IS NOT NULL
       ORDER BY taken_at DESC",
    )?;
    let rows = stmt.query_map([], |row| {
      Ok(Test {
        id: row.get(0)?,
        subject_id: row.get(1)?,
        chapter_ids: row.get(2)?,
        title: row.get(3)?,
        body: row.get(4)?,
        memo: row.get(5)?,
        score: row.get(6)?,
        total: row.get(7)?,
        taken_at: row.get(8)?,
        created_at: row.get(9)?,
      })
    })?;
    rows.collect()
  }

  pub fn create_test(&self, test: &Test) -> rusqlite::Result<()> {
    let conn = self.conn.lock().unwrap();
    conn.execute(
      "INSERT INTO scholar_tests (id, subject_id, chapter_ids, title, body, memo, score, total, taken_at, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
      params![
        test.id, test.subject_id, test.chapter_ids, test.title, test.body,
        test.memo, test.score, test.total, test.taken_at, test.created_at
      ],
    )?;
    Ok(())
  }

  /// Records an attempt. `taken_at` is set here rather than taken from the
  /// caller so a result can never be stored without the moment it was
  /// achieved, which the progress tracking reads.
  pub fn record_test_result(
    &self,
    id: &str,
    score: i64,
    total: i64,
    taken_at: &str,
  ) -> rusqlite::Result<()> {
    let conn = self.conn.lock().unwrap();
    conn.execute(
      "UPDATE scholar_tests SET score = ?2, total = ?3, taken_at = ?4 WHERE id = ?1",
      params![id, score, total, taken_at],
    )?;
    Ok(())
  }

  pub fn delete_test(&self, id: &str) -> rusqlite::Result<()> {
    let conn = self.conn.lock().unwrap();
    conn.execute("DELETE FROM scholar_tests WHERE id = ?1", params![id])?;
    Ok(())
  }

  // --- Past papers ---

  pub fn list_past_papers(&self, subject_id: &str) -> rusqlite::Result<Vec<PastPaper>> {
    let conn = self.conn.lock().unwrap();
    let mut stmt = conn.prepare(
      "SELECT id, subject_id, title, source_paths, chapter_ids, year, created_at
       FROM scholar_past_papers WHERE subject_id = ?1
       ORDER BY year DESC, created_at DESC",
    )?;
    let rows = stmt.query_map(params![subject_id], |row| {
      Ok(PastPaper {
        id: row.get(0)?,
        subject_id: row.get(1)?,
        title: row.get(2)?,
        source_paths: row.get(3)?,
        chapter_ids: row.get(4)?,
        year: row.get(5)?,
        created_at: row.get(6)?,
      })
    })?;
    rows.collect()
  }

  pub fn create_past_paper(&self, paper: &PastPaper) -> rusqlite::Result<()> {
    let conn = self.conn.lock().unwrap();
    conn.execute(
      "INSERT INTO scholar_past_papers (id, subject_id, title, source_paths, chapter_ids, year, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
      params![
        paper.id, paper.subject_id, paper.title,
        paper.source_paths, paper.chapter_ids, paper.year, paper.created_at
      ],
    )?;
    Ok(())
  }

  pub fn set_past_paper_chapters(&self, id: &str, chapter_ids: &str) -> rusqlite::Result<()> {
    let conn = self.conn.lock().unwrap();
    conn.execute(
      "UPDATE scholar_past_papers SET chapter_ids = ?2 WHERE id = ?1",
      params![id, chapter_ids],
    )?;
    Ok(())
  }

  pub fn delete_past_paper(&self, id: &str) -> rusqlite::Result<()> {
    let conn = self.conn.lock().unwrap();
    conn.execute("DELETE FROM scholar_past_papers WHERE id = ?1", params![id])?;
    Ok(())
  }
}
