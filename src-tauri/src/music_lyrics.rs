//! LYRICS for the music player. Lyrics come from, in order: ones you pasted in the app (kept in Udaan's own data,
//! never inside your music folder), then a .lrc, .txt or .lyrics file sitting next to the song with the same name.
//! Nothing is downloaded and your music folder is never written to.

use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Lyrics {
  pub text: String,
  /// "saved" (pasted in Udaan) or "file" (found next to the song).
  pub source: String,
  pub name: String,
}

fn fnv(s: &str) -> u64 {
  let mut h = 0xcbf29ce484222325u64;
  for b in s.to_lowercase().bytes() {
    h ^= b as u64;
    h = h.wrapping_mul(0x100000001b3);
  }
  h
}

fn saved_path(app: &AppHandle, track: &str) -> Result<PathBuf, String> {
  let d = app.path().app_data_dir().map_err(|e| e.to_string())?.join("lyrics");
  std::fs::create_dir_all(&d).map_err(|e| e.to_string())?;
  Ok(d.join(format!("{:016x}.txt", fnv(track))))
}

/// Text as the user would see it: UTF-8, a byte-order mark removed, and a sane size cap.
fn read_text(p: &Path) -> Option<String> {
  let bytes = std::fs::read(p).ok()?;
  let bytes = &bytes[..bytes.len().min(300_000)];
  let bytes = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(bytes);
  let t = String::from_utf8_lossy(bytes).into_owned();
  (!t.trim().is_empty()).then_some(t)
}

#[tauri::command]
pub async fn music_lyrics_get(app: AppHandle, path: String) -> Result<Option<Lyrics>, String> {
  let saved = saved_path(&app, &path)?;
  tauri::async_runtime::spawn_blocking(move || {
    if let Some(text) = read_text(&saved) {
      return Ok(Some(Lyrics { text, source: "saved".into(), name: "Your lyrics".into() }));
    }
    let p = Path::new(&path);
    let (Some(dir), Some(stem)) = (p.parent(), p.file_stem()) else { return Ok(None) };
    for ext in ["lrc", "txt", "lyrics"] {
      let side = dir.join(format!("{}.{ext}", stem.to_string_lossy()));
      if let Some(text) = read_text(&side) {
        return Ok(Some(Lyrics { text, source: "file".into(), name: side.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default() }));
      }
    }
    Ok(None)
  })
  .await
  .map_err(|e| e.to_string())?
}

/// Saves pasted lyrics for a track. Empty text removes them.
#[tauri::command]
pub async fn music_lyrics_save(app: AppHandle, path: String, text: String) -> Result<(), String> {
  let p = saved_path(&app, &path)?;
  if text.trim().is_empty() {
    return match std::fs::remove_file(&p) {
      Ok(()) => Ok(()),
      Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
      Err(e) => Err(e.to_string()),
    };
  }
  if text.len() > 300_000 {
    return Err("That is too long to be lyrics.".into());
  }
  std::fs::write(p, text).map_err(|e| e.to_string())
}
