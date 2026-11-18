//! RESEARCH store for the OmniFind app (src/features/research).
//!
//! One JSON file per research session under `<app data>/research/sessions/<id>.json`. The
//! frontend owns the session format (a list of turns, each with its plan, sources, report and
//! claim checks); this side reads only the top-level fields it needs for the sidebar list and
//! for full-text search, and writes through a temp file so a crash never leaves half a session.

use serde::Serialize;
use serde_json::Value;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

fn dir(app: &AppHandle) -> Result<PathBuf, String> {
  let d = app.path().app_data_dir().map_err(|e| e.to_string())?.join("research").join("sessions");
  std::fs::create_dir_all(&d).map_err(|e| e.to_string())?;
  Ok(d)
}

fn safe_id(id: &str) -> Result<&str, String> {
  if !id.is_empty() && id.len() < 80 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
    Ok(id)
  } else {
    Err("Bad session id.".into())
  }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionMeta {
  pub id: String,
  pub title: String,
  pub pinned: bool,
  pub created_ms: i64,
  pub updated_ms: i64,
  pub turns: usize,
  pub sources: usize,
}

fn meta_of(v: &Value) -> Option<SessionMeta> {
  let turns = v.get("turns").and_then(|t| t.as_array());
  Some(SessionMeta {
    id: v.get("id")?.as_str()?.to_string(),
    title: v.get("title").and_then(|t| t.as_str()).unwrap_or("Untitled").to_string(),
    pinned: v.get("pinned").and_then(|t| t.as_bool()).unwrap_or(false),
    created_ms: v.get("createdMs").and_then(|t| t.as_i64()).unwrap_or(0),
    updated_ms: v.get("updatedMs").and_then(|t| t.as_i64()).unwrap_or(0),
    turns: turns.map(|t| t.len()).unwrap_or(0),
    sources: v.get("sources").and_then(|s| s.as_array()).map(|s| s.len()).unwrap_or(0),
  })
}

fn read_json(p: &Path) -> Option<Value> {
  serde_json::from_slice(&std::fs::read(p).ok()?).ok()
}

fn write_atomic(p: &Path, bytes: &[u8]) -> Result<(), String> {
  let tmp = p.with_extension("tmp");
  std::fs::write(&tmp, bytes).map_err(|e| e.to_string())?;
  std::fs::rename(&tmp, p).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn research_list(app: AppHandle) -> Result<Vec<SessionMeta>, String> {
  let d = dir(&app)?;
  tauri::async_runtime::spawn_blocking(move || {
    let mut out: Vec<SessionMeta> = std::fs::read_dir(&d)
      .map_err(|e| e.to_string())?
      .flatten()
      .filter(|e| e.path().extension().map(|x| x == "json").unwrap_or(false))
      .filter_map(|e| read_json(&e.path()).as_ref().and_then(meta_of))
      .collect();
    out.sort_by(|a, b| b.updated_ms.cmp(&a.updated_ms));
    Ok(out)
  })
  .await
  .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn research_get(app: AppHandle, id: String) -> Result<Value, String> {
  let p = dir(&app)?.join(format!("{}.json", safe_id(&id)?));
  read_json(&p).ok_or_else(|| "That research could not be read.".into())
}

#[tauri::command]
pub async fn research_save(app: AppHandle, session: Value) -> Result<(), String> {
  let id = session.get("id").and_then(|v| v.as_str()).ok_or("Session has no id.")?.to_string();
  let p = dir(&app)?.join(format!("{}.json", safe_id(&id)?));
  write_atomic(&p, &serde_json::to_vec(&session).map_err(|e| e.to_string())?)
}

#[tauri::command]
pub async fn research_delete(app: AppHandle, id: String) -> Result<(), String> {
  let p = dir(&app)?.join(format!("{}.json", safe_id(&id)?));
  match std::fs::remove_file(p) {
    Ok(()) => Ok(()),
    Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
    Err(e) => Err(e.to_string()),
  }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Hit {
  pub id: String,
  pub title: String,
  pub snippet: String,
  pub updated_ms: i64,
}

/// Sessions whose title, questions, reports or source titles contain every word.
#[tauri::command]
pub async fn research_search(app: AppHandle, query: String) -> Result<Vec<Hit>, String> {
  let d = dir(&app)?;
  tauri::async_runtime::spawn_blocking(move || {
    let words: Vec<String> = query.to_lowercase().split_whitespace().map(String::from).collect();
    if words.is_empty() {
      return Ok(vec![]);
    }
    let mut out = Vec::new();
    for e in std::fs::read_dir(&d).map_err(|e| e.to_string())?.flatten() {
      let Some(v) = read_json(&e.path()) else { continue };
      let Some(m) = meta_of(&v) else { continue };
      let mut texts: Vec<String> = vec![m.title.clone()];
      if let Some(turns) = v.get("turns").and_then(|t| t.as_array()) {
        for t in turns {
          for k in ["question", "report"] {
            if let Some(s) = t.get(k).and_then(|x| x.as_str()) {
              texts.push(s.to_string());
            }
          }
        }
      }
      if let Some(src) = v.get("sources").and_then(|s| s.as_array()) {
        for s in src {
          if let Some(t) = s.get("title").and_then(|x| x.as_str()) {
            texts.push(t.to_string());
          }
        }
      }
      let all = texts.join("\n").to_lowercase();
      if !words.iter().all(|w| all.contains(w.as_str())) {
        continue;
      }
      let first = &words[0];
      let snippet = texts
        .iter()
        .skip(1)
        .find_map(|t| {
          let lt = t.to_lowercase();
          lt.find(first.as_str()).map(|i| {
            let start = lt[..i].char_indices().rev().nth(40).map(|(k, _)| k).unwrap_or(0);
            let s: String = t[start..].chars().take(140).collect();
            format!("{}{}", if start > 0 { "…" } else { "" }, s.replace('\n', " "))
          })
        })
        .unwrap_or_default();
      out.push(Hit { id: m.id, title: m.title, snippet, updated_ms: m.updated_ms });
    }
    out.sort_by(|a, b| b.updated_ms.cmp(&a.updated_ms));
    Ok(out)
  })
  .await
  .map_err(|e| e.to_string())?
}
