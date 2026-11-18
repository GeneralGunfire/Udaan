//! CHAT store for the Chat app (src/features/chat).
//!
//! One JSON file per conversation under `<app data>/chat/threads/<id>.json`. The
//! frontend owns the thread format (a tree of messages, so edits and regenerations
//! branch instead of overwriting); this side reads only the few top-level fields it
//! needs for the list and for search. Projects are one small JSON file.

use serde::Serialize;
use serde_json::Value;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

fn root(app: &AppHandle) -> Result<PathBuf, String> {
  let d = app.path().app_data_dir().map_err(|e| e.to_string())?.join("chat");
  std::fs::create_dir_all(d.join("threads")).map_err(|e| e.to_string())?;
  Ok(d)
}

fn safe_id(id: &str) -> Result<&str, String> {
  if !id.is_empty() && id.len() < 80 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
    Ok(id)
  } else {
    Err("Bad conversation id.".into())
  }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadMeta {
  pub id: String,
  pub title: String,
  pub project_id: Option<String>,
  pub pinned: bool,
  pub created_ms: i64,
  pub updated_ms: i64,
  pub messages: usize,
}

fn meta_of(v: &Value) -> Option<ThreadMeta> {
  Some(ThreadMeta {
    id: v.get("id")?.as_str()?.to_string(),
    title: v.get("title").and_then(|t| t.as_str()).unwrap_or("Untitled").to_string(),
    project_id: v.get("projectId").and_then(|t| t.as_str()).map(String::from),
    pinned: v.get("pinned").and_then(|t| t.as_bool()).unwrap_or(false),
    created_ms: v.get("createdMs").and_then(|t| t.as_i64()).unwrap_or(0),
    updated_ms: v.get("updatedMs").and_then(|t| t.as_i64()).unwrap_or(0),
    messages: v.get("nodes").and_then(|n| n.as_object()).map(|o| o.len()).unwrap_or(0),
  })
}

fn read_json(p: &Path) -> Option<Value> {
  serde_json::from_slice(&std::fs::read(p).ok()?).ok()
}

/// Writes through a temp file so a crash mid-write never leaves a half conversation.
fn write_atomic(p: &Path, bytes: &[u8]) -> Result<(), String> {
  let tmp = p.with_extension("tmp");
  std::fs::write(&tmp, bytes).map_err(|e| e.to_string())?;
  std::fs::rename(&tmp, p).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn chat_list(app: AppHandle) -> Result<Vec<ThreadMeta>, String> {
  let dir = root(&app)?.join("threads");
  tauri::async_runtime::spawn_blocking(move || {
    let mut out: Vec<ThreadMeta> = std::fs::read_dir(&dir)
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
pub async fn chat_get(app: AppHandle, id: String) -> Result<Value, String> {
  let p = root(&app)?.join("threads").join(format!("{}.json", safe_id(&id)?));
  read_json(&p).ok_or_else(|| "That conversation could not be read.".into())
}

#[tauri::command]
pub async fn chat_save(app: AppHandle, thread: Value) -> Result<(), String> {
  let id = thread.get("id").and_then(|v| v.as_str()).ok_or("Conversation has no id.")?.to_string();
  let p = root(&app)?.join("threads").join(format!("{}.json", safe_id(&id)?));
  let bytes = serde_json::to_vec(&thread).map_err(|e| e.to_string())?;
  write_atomic(&p, &bytes)
}

#[tauri::command]
pub async fn chat_delete(app: AppHandle, id: String) -> Result<(), String> {
  let p = root(&app)?.join("threads").join(format!("{}.json", safe_id(&id)?));
  match std::fs::remove_file(p) {
    Ok(()) => Ok(()),
    Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
    Err(e) => Err(e.to_string()),
  }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
  pub id: String,
  pub title: String,
  pub snippet: String,
  pub updated_ms: i64,
}

/// Every conversation whose title or any message contains all the words.
#[tauri::command]
pub async fn chat_search(app: AppHandle, query: String) -> Result<Vec<SearchHit>, String> {
  let dir = root(&app)?.join("threads");
  tauri::async_runtime::spawn_blocking(move || {
    let words: Vec<String> = query.to_lowercase().split_whitespace().map(String::from).collect();
    if words.is_empty() {
      return Ok(vec![]);
    }
    let mut out = Vec::new();
    for e in std::fs::read_dir(&dir).map_err(|e| e.to_string())?.flatten() {
      let Some(v) = read_json(&e.path()) else { continue };
      let Some(m) = meta_of(&v) else { continue };
      let mut texts: Vec<String> = vec![m.title.clone()];
      if let Some(nodes) = v.get("nodes").and_then(|n| n.as_object()) {
        for n in nodes.values() {
          if let Some(c) = n.get("content").and_then(|c| c.as_str()) {
            texts.push(c.to_string());
          }
        }
      }
      let all = texts.join("\n").to_lowercase();
      if !words.iter().all(|w| all.contains(w.as_str())) {
        continue;
      }
      // A snippet around the first word, from the message that has it.
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
      out.push(SearchHit { id: m.id, title: m.title, snippet, updated_ms: m.updated_ms });
    }
    out.sort_by(|a, b| b.updated_ms.cmp(&a.updated_ms));
    Ok(out)
  })
  .await
  .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn chat_projects_get(app: AppHandle) -> Result<Value, String> {
  Ok(read_json(&root(&app)?.join("projects.json")).unwrap_or(Value::Array(vec![])))
}

#[tauri::command]
pub async fn chat_projects_set(app: AppHandle, projects: Value) -> Result<(), String> {
  write_atomic(&root(&app)?.join("projects.json"), &serde_json::to_vec(&projects).map_err(|e| e.to_string())?)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Attachment {
  pub name: String,
  pub path: String,
  /// "text" (contents in `text`), "image" (a data URL in `data_url`) or "binary" (name only).
  pub kind: String,
  pub text: Option<String>,
  pub data_url: Option<String>,
  pub size: u64,
}

const TEXT_EXTS: &[&str] = &[
  "txt", "md", "markdown", "csv", "tsv", "json", "jsonl", "xml", "html", "htm", "css", "js", "jsx", "ts", "tsx", "mjs", "py", "rs", "go", "java", "c", "h", "cpp", "hpp", "cs", "rb", "php", "sh", "ps1", "bat", "sql", "yaml", "yml", "toml", "ini", "cfg", "log", "srt", "vtt",
  "lua", "kt", "swift", "dart", "vue", "svelte", "env",
];

/// Reads a file the user attached: text up to 120 KB, images up to 6 MB as a data URL.
#[tauri::command]
pub async fn chat_read_attachment(path: String) -> Result<Attachment, String> {
  tauri::async_runtime::spawn_blocking(move || {
    let p = Path::new(&path);
    let md = std::fs::metadata(p).map_err(|e| e.to_string())?;
    if md.is_dir() {
      return Err("Folders can't be attached; attach the files inside.".into());
    }
    let name = p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let ext = p.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
    let size = md.len();
    let mime = match ext.as_str() {
      "png" => Some("image/png"),
      "jpg" | "jpeg" => Some("image/jpeg"),
      "gif" => Some("image/gif"),
      "webp" => Some("image/webp"),
      "bmp" => Some("image/bmp"),
      _ => None,
    };
    if let Some(mime) = mime {
      if size > 6 * 1024 * 1024 {
        return Err(format!("“{name}” is larger than 6 MB."));
      }
      use base64::Engine;
      let bytes = std::fs::read(p).map_err(|e| e.to_string())?;
      let data_url = format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes));
      return Ok(Attachment { name, path, kind: "image".into(), text: None, data_url: Some(data_url), size });
    }
    let looks_text = TEXT_EXTS.contains(&ext.as_str()) || ext.is_empty();
    if looks_text {
      let bytes = std::fs::read(p).map_err(|e| e.to_string())?;
      let cut = &bytes[..bytes.len().min(120_000)];
      // Refuse obvious binaries that only look like text by extension.
      if cut.iter().take(4000).filter(|b| **b == 0).count() > 2 {
        return Ok(Attachment { name, path, kind: "binary".into(), text: None, data_url: None, size });
      }
      let mut text = String::from_utf8_lossy(cut).into_owned();
      if bytes.len() > cut.len() {
        text.push_str("\n…[file truncated]");
      }
      return Ok(Attachment { name, path, kind: "text".into(), text: Some(text), data_url: None, size });
    }
    Ok(Attachment { name, path, kind: "binary".into(), text: None, data_url: None, size })
  })
  .await
  .map_err(|e| e.to_string())?
}

/// Writes an exported conversation where the user chose in the save dialog.
#[tauri::command]
pub async fn chat_write_text(path: String, text: String) -> Result<(), String> {
  std::fs::write(&path, text).map_err(|e| e.to_string())
}
