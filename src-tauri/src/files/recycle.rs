//! The real Windows Recycle Bin: send to it, list it, restore from it, empty it.
//! Delete in Files is always recoverable, from here or from Explorer.

use serde::Serialize;
use std::path::Path;

/// The `trash` crate initialises COM itself and panics if the thread already
/// picked another apartment, which pooled async threads may have. A brand-new
/// thread never has.
async fn on_fresh_thread<T: Send + 'static>(f: impl FnOnce() -> Result<T, String> + Send + 'static) -> Result<T, String> {
  let (tx, rx) = tokio::sync::oneshot::channel();
  std::thread::spawn(move || {
    let _ = tx.send(std::panic::catch_unwind(std::panic::AssertUnwindSafe(f)));
  });
  match rx.await {
    Ok(Ok(v)) => v,
    _ => Err("The Recycle Bin did not respond.".into()),
  }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BinItem {
  pub id: String,
  pub name: String,
  pub original_path: String,
  pub deleted_ms: i64,
  /// Bytes for a file; None for a folder.
  pub size: Option<u64>,
  pub is_dir: bool,
}

fn now_secs() -> i64 {
  std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0)
}

/// Sends items to the Recycle Bin. Returns the time (seconds) just before the
/// delete, which `files_bin_restore_paths` uses to find exactly these items again.
#[tauri::command]
pub async fn files_recycle(paths: Vec<String>) -> Result<i64, String> {
  let since = now_secs() - 1;
  on_fresh_thread(move || trash::delete_all(&paths).map_err(|e| e.to_string())).await?;
  Ok(since)
}

#[tauri::command]
pub async fn files_bin_list() -> Result<Vec<BinItem>, String> {
  on_fresh_thread(|| {
    let items = trash::os_limited::list().map_err(|e| e.to_string())?;
    let mut out: Vec<BinItem> = items
      .iter()
      .map(|it| {
        let meta = trash::os_limited::metadata(it).ok();
        let (size, is_dir) = match meta.map(|m| m.size) {
          Some(trash::TrashItemSize::Bytes(b)) => (Some(b), false),
          Some(trash::TrashItemSize::Entries(_)) => (None, true),
          None => (None, false),
        };
        BinItem {
          id: it.id.to_string_lossy().into_owned(),
          name: it.name.to_string_lossy().into_owned(),
          original_path: it.original_path().to_string_lossy().into_owned(),
          deleted_ms: it.time_deleted * 1000,
          size,
          is_dir,
        }
      })
      .collect();
    out.sort_by(|a, b| b.deleted_ms.cmp(&a.deleted_ms));
    Ok(out)
  })
  .await
}

fn pick(ids: &[String]) -> Result<Vec<trash::TrashItem>, String> {
  let all = trash::os_limited::list().map_err(|e| e.to_string())?;
  Ok(all.into_iter().filter(|it| ids.iter().any(|id| it.id.to_string_lossy() == id.as_str())).collect())
}

#[tauri::command]
pub async fn files_bin_restore(ids: Vec<String>) -> Result<(), String> {
  on_fresh_thread(move || {
    let items = pick(&ids)?;
    for it in &items {
      if it.original_path().exists() {
        return Err(format!("\"{}\" already exists where it came from. Move or rename that first.", it.name.to_string_lossy()));
      }
    }
    trash::os_limited::restore_all(items).map_err(|e| e.to_string())
  })
  .await
}

#[tauri::command]
pub async fn files_bin_purge(ids: Vec<String>) -> Result<(), String> {
  on_fresh_thread(move || {
    let items = if ids.is_empty() { trash::os_limited::list().map_err(|e| e.to_string())? } else { pick(&ids)? };
    trash::os_limited::purge_all(items).map_err(|e| e.to_string())
  })
  .await
}

/// Undo of a delete: restores the newest bin item for each original path that
/// was deleted at or after `since`.
#[tauri::command]
pub async fn files_bin_restore_paths(paths: Vec<String>, since: i64) -> Result<(), String> {
  on_fresh_thread(move || {
    let all = trash::os_limited::list().map_err(|e| e.to_string())?;
    let mut chosen = Vec::new();
    for p in &paths {
      let want = Path::new(p);
      let best = all
        .iter()
        .filter(|it| it.time_deleted >= since && it.original_path().as_path().to_string_lossy().eq_ignore_ascii_case(&want.to_string_lossy()))
        .max_by_key(|it| it.time_deleted);
      match best {
        Some(it) => chosen.push(it.clone()),
        None => return Err(format!("\"{}\" is no longer in the Recycle Bin.", want.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default())),
      }
    }
    trash::os_limited::restore_all(chosen).map_err(|e| e.to_string())
  })
  .await
}
