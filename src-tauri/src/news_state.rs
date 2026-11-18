//! NEWS state (src/features/news): the user's own sources, followed topics, saved stories and read marks.
//! One JSON file the frontend owns; this side only reads and writes it safely.

use serde_json::Value;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

fn path(app: &AppHandle) -> Result<PathBuf, String> {
  let d = app.path().app_data_dir().map_err(|e| e.to_string())?.join("news");
  std::fs::create_dir_all(&d).map_err(|e| e.to_string())?;
  Ok(d.join("state.json"))
}

/// The saved state as JSON text, or empty when nothing was saved yet.
#[tauri::command]
pub async fn news_state_get(app: AppHandle) -> Result<String, String> {
  match std::fs::read_to_string(path(&app)?) {
    Ok(t) => Ok(t),
    Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
    Err(e) => Err(e.to_string()),
  }
}

/// Saves through a temp file, so a crash can't leave half a list.
#[tauri::command]
pub async fn news_state_set(app: AppHandle, json: String) -> Result<(), String> {
  serde_json::from_str::<Value>(&json).map_err(|e| format!("State isn't valid JSON: {e}"))?;
  let p = path(&app)?;
  let tmp = p.with_extension("tmp");
  std::fs::write(&tmp, json).map_err(|e| e.to_string())?;
  std::fs::rename(&tmp, &p).map_err(|e| e.to_string())
}
