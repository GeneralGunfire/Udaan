use std::path::PathBuf;
use std::sync::Mutex;

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::db::configure_connection;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlayerSettings {
  #[serde(rename = "musicFolder")]
  pub music_folder: Option<String>,
  #[serde(rename = "lastTrackPath")]
  pub last_track_path: Option<String>,
  #[serde(rename = "lastPositionSeconds")]
  pub last_position_seconds: f64,
  pub volume: f64,
  pub shuffle: bool,
  pub repeat: bool,
}

impl Default for PlayerSettings {
  fn default() -> Self {
    Self {
      music_folder: None,
      last_track_path: None,
      last_position_seconds: 0.0,
      volume: 0.8,
      shuffle: false,
      repeat: false,
    }
  }
}

/// The DJ effects settings shape is owned entirely by the frontend
/// (lib/djEffects.ts) — stored here as an opaque JSON blob (`serde_json::Value`)
/// so adding a new knob to the effects rack never requires a matching Rust
/// struct change, migration, or column addition.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DjPreset {
  pub id: String,
  pub name: String,
  pub settings: serde_json::Value,
  #[serde(rename = "createdAt")]
  pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredPlaylist {
  pub id: String,
  pub name: String,
  #[serde(rename = "trackPaths")]
  pub track_paths: Vec<String>,
  #[serde(rename = "createdAt")]
  pub created_at: i64,
}

pub struct Store {
  conn: Mutex<Connection>,
}

impl Store {
  pub fn open(db_path: PathBuf) -> rusqlite::Result<Self> {
    let conn = Connection::open(db_path)?;
    configure_connection(&conn)?;
    conn.execute_batch(
      "CREATE TABLE IF NOT EXISTS player_settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        music_folder TEXT,
        last_track_path TEXT,
        last_position_seconds REAL NOT NULL DEFAULT 0,
        volume REAL NOT NULL DEFAULT 0.8,
        shuffle INTEGER NOT NULL DEFAULT 0,
        repeat INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS playlists (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        track_paths TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS favorites (
        track_path TEXT PRIMARY KEY,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS dj_presets (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        settings TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      -- Cached musical analysis, keyed by track path like `favorites`.
      -- Stored as an opaque JSON blob for the same reason dj_presets is:
      -- the analysis shape is owned by analysis.rs, so adding a field
      -- there needs no migration here.
      CREATE TABLE IF NOT EXISTS track_analysis (
        track_path TEXT PRIMARY KEY,
        analysis TEXT NOT NULL,
        analyzed_at INTEGER NOT NULL
      );",
    )?;
    Ok(Self { conn: Mutex::new(conn) })
  }

  pub fn get_settings(&self) -> rusqlite::Result<PlayerSettings> {
    let conn = self.conn.lock().unwrap();
    let settings = conn
      .query_row(
        "SELECT music_folder, last_track_path, last_position_seconds, volume, shuffle, repeat
         FROM player_settings WHERE id = 1",
        [],
        |row| {
          Ok(PlayerSettings {
            music_folder: row.get(0)?,
            last_track_path: row.get(1)?,
            last_position_seconds: row.get(2)?,
            volume: row.get(3)?,
            shuffle: row.get::<_, i64>(4)? != 0,
            repeat: row.get::<_, i64>(5)? != 0,
          })
        },
      )
      .optional()?;
    Ok(settings.unwrap_or_default())
  }

  pub fn save_settings(&self, settings: &PlayerSettings) -> rusqlite::Result<()> {
    let conn = self.conn.lock().unwrap();
    conn.execute(
      "INSERT INTO player_settings (id, music_folder, last_track_path, last_position_seconds, volume, shuffle, repeat)
       VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6)
       ON CONFLICT(id) DO UPDATE SET
         music_folder = excluded.music_folder,
         last_track_path = excluded.last_track_path,
         last_position_seconds = excluded.last_position_seconds,
         volume = excluded.volume,
         shuffle = excluded.shuffle,
         repeat = excluded.repeat",
      params![
        settings.music_folder,
        settings.last_track_path,
        settings.last_position_seconds,
        settings.volume,
        settings.shuffle as i64,
        settings.repeat as i64,
      ],
    )?;
    Ok(())
  }

  pub fn list_playlists(&self) -> rusqlite::Result<Vec<StoredPlaylist>> {
    let conn = self.conn.lock().unwrap();
    let mut stmt = conn.prepare(
      "SELECT id, name, track_paths, created_at FROM playlists ORDER BY created_at ASC",
    )?;
    let rows = stmt.query_map([], Self::map_playlist)?;
    rows.collect()
  }

  pub fn upsert_playlist(&self, playlist: &StoredPlaylist) -> rusqlite::Result<()> {
    let conn = self.conn.lock().unwrap();
    let track_paths_json = serde_json::to_string(&playlist.track_paths).unwrap_or_else(|_| "[]".into());
    conn.execute(
      "INSERT INTO playlists (id, name, track_paths, created_at)
       VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         track_paths = excluded.track_paths",
      params![playlist.id, playlist.name, track_paths_json, playlist.created_at],
    )?;
    Ok(())
  }

  pub fn delete_playlist(&self, id: &str) -> rusqlite::Result<()> {
    let conn = self.conn.lock().unwrap();
    conn.execute("DELETE FROM playlists WHERE id = ?1", params![id])?;
    Ok(())
  }

  pub fn list_favorites(&self) -> rusqlite::Result<Vec<String>> {
    let conn = self.conn.lock().unwrap();
    let mut stmt = conn.prepare("SELECT track_path FROM favorites ORDER BY created_at ASC")?;
    let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
    rows.collect()
  }

  pub fn set_favorite(&self, track_path: &str, favorite: bool) -> rusqlite::Result<()> {
    let conn = self.conn.lock().unwrap();
    if favorite {
      let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
      conn.execute(
        "INSERT INTO favorites (track_path, created_at) VALUES (?1, ?2)
         ON CONFLICT(track_path) DO NOTHING",
        params![track_path, now],
      )?;
    } else {
      conn.execute("DELETE FROM favorites WHERE track_path = ?1", params![track_path])?;
    }
    Ok(())
  }

  pub fn list_dj_presets(&self) -> rusqlite::Result<Vec<DjPreset>> {
    let conn = self.conn.lock().unwrap();
    let mut stmt = conn.prepare("SELECT id, name, settings, created_at FROM dj_presets ORDER BY created_at ASC")?;
    let rows = stmt.query_map([], Self::map_dj_preset)?;
    rows.collect()
  }

  pub fn save_dj_preset(&self, preset: &DjPreset) -> rusqlite::Result<()> {
    let conn = self.conn.lock().unwrap();
    let settings_json = serde_json::to_string(&preset.settings).unwrap_or_else(|_| "{}".into());
    conn.execute(
      "INSERT INTO dj_presets (id, name, settings, created_at)
       VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         settings = excluded.settings",
      params![preset.id, preset.name, settings_json, preset.created_at],
    )?;
    Ok(())
  }

  pub fn delete_dj_preset(&self, id: &str) -> rusqlite::Result<()> {
    let conn = self.conn.lock().unwrap();
    conn.execute("DELETE FROM dj_presets WHERE id = ?1", params![id])?;
    Ok(())
  }

  fn map_dj_preset(row: &rusqlite::Row) -> rusqlite::Result<DjPreset> {
    let settings_json: String = row.get(2)?;
    let settings: serde_json::Value = serde_json::from_str(&settings_json).unwrap_or_default();
    Ok(DjPreset { id: row.get(0)?, name: row.get(1)?, settings, created_at: row.get(3)? })
  }

  fn map_playlist(row: &rusqlite::Row) -> rusqlite::Result<StoredPlaylist> {
    let track_paths_json: String = row.get(2)?;
    let track_paths: Vec<String> = serde_json::from_str(&track_paths_json).unwrap_or_default();
    Ok(StoredPlaylist {
      id: row.get(0)?,
      name: row.get(1)?,
      track_paths,
      created_at: row.get(3)?,
    })
  }
}

impl Store {
  /// Cached analysis for one track, or `None` if it has never been
  /// analysed. Callers treat a miss as "run analysis", so a corrupt or
  /// unparseable row is reported as a miss rather than an error — a bad
  /// cache entry should cause a recompute, not a failure.
  pub fn get_analysis(&self, track_path: &str) -> rusqlite::Result<Option<serde_json::Value>> {
    let conn = self.conn.lock().unwrap();
    let raw: Option<String> = conn
      .query_row(
        "SELECT analysis FROM track_analysis WHERE track_path = ?1",
        rusqlite::params![track_path],
        |row| row.get(0),
      )
      .optional()?;
    Ok(raw.and_then(|s| serde_json::from_str(&s).ok()))
  }

  pub fn save_analysis(&self, track_path: &str, analysis: &serde_json::Value) -> rusqlite::Result<()> {
    let conn = self.conn.lock().unwrap();
    conn.execute(
      "INSERT INTO track_analysis (track_path, analysis, analyzed_at) VALUES (?1, ?2, ?3)
       ON CONFLICT(track_path) DO UPDATE SET analysis = excluded.analysis, analyzed_at = excluded.analyzed_at",
      rusqlite::params![track_path, analysis.to_string(), chrono::Utc::now().timestamp()],
    )?;
    Ok(())
  }

  /// Every analysed path, so the frontend can show which of a large
  /// library still needs a pass without querying row by row.
  pub fn list_analyzed_paths(&self) -> rusqlite::Result<Vec<String>> {
    let conn = self.conn.lock().unwrap();
    let mut stmt = conn.prepare("SELECT track_path FROM track_analysis")?;
    let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
    rows.collect()
  }
}
