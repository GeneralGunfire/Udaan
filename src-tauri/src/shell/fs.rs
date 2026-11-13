//! Desktop-facing filesystem services: the real Windows Recycle Bin and
//! change notifications for watched folders (the desktop).

use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::path::PathBuf;
use std::sync::{mpsc, Mutex, OnceLock};
use std::time::Duration;
use tauri::{AppHandle, Emitter};

static WATCHER: OnceLock<Mutex<Option<(RecommendedWatcher, Vec<PathBuf>)>>> = OnceLock::new();

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct DirChanged {
  dir: String,
}

/// Runs `f` on a brand-new OS thread. The `trash` crate initialises COM
/// itself and panics if the thread already chose another apartment, which
/// pooled async threads may have; a fresh thread never has.
async fn on_fresh_thread<T: Send + 'static>(f: impl FnOnce() -> T + Send + 'static) -> Result<T, String> {
  let (tx, rx) = tokio::sync::oneshot::channel();
  std::thread::spawn(move || {
    let _ = tx.send(std::panic::catch_unwind(std::panic::AssertUnwindSafe(f)));
  });
  match rx.await {
    Ok(Ok(v)) => Ok(v),
    _ => Err("Recycle Bin operation failed".into()),
  }
}

/// Sends files and folders to the Windows Recycle Bin, so they can be
/// restored from Explorer's Recycle Bin as well as from Udaan.
#[tauri::command]
pub async fn shell_recycle(paths: Vec<String>) -> Result<(), String> {
  on_fresh_thread(move || trash::delete_all(&paths).map_err(|e| e.to_string()))
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecycleBinInfo {
  pub item_count: usize,
}

#[tauri::command]
pub async fn shell_recycle_bin_info() -> Result<RecycleBinInfo, String> {
  on_fresh_thread(|| {
    let items = trash::os_limited::list().map_err(|e| e.to_string())?;
    Ok(RecycleBinInfo { item_count: items.len() })
  })
  .await
  .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn shell_empty_recycle_bin() -> Result<(), String> {
  on_fresh_thread(|| {
    let items = trash::os_limited::list().map_err(|e| e.to_string())?;
    trash::os_limited::purge_all(items).map_err(|e| e.to_string())
  })
  .await
  .map_err(|e| e.to_string())?
}

/// Replaces the set of watched folders. Changes are debounced and
/// emitted to every window as `shell://dir-changed { dir }`.
#[tauri::command]
pub fn shell_watch_dirs(app: AppHandle, dirs: Vec<String>) -> Result<(), String> {
  let slot = WATCHER.get_or_init(|| Mutex::new(None));
  let mut guard = slot.lock().unwrap();
  let wanted: Vec<PathBuf> = dirs.iter().map(PathBuf::from).filter(|p| p.is_dir()).collect();
  if let Some((_, current)) = guard.as_ref() {
    if *current == wanted {
      return Ok(());
    }
  }
  *guard = None;

  let (tx, rx) = mpsc::channel::<PathBuf>();
  let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
    if let Ok(event) = res {
      for p in event.paths {
        if let Some(parent) = p.parent() {
          let _ = tx.send(parent.to_path_buf());
        }
      }
    }
  })
  .map_err(|e| e.to_string())?;
  for dir in &wanted {
    watcher.watch(dir, RecursiveMode::NonRecursive).map_err(|e| format!("{}: {e}", dir.display()))?;
  }

  let roots = wanted.clone();
  std::thread::spawn(move || {
    // A copy or unzip fires hundreds of events; emit once it settles.
    while let Ok(first) = rx.recv() {
      let mut changed = vec![first];
      while let Ok(p) = rx.recv_timeout(Duration::from_millis(150)) {
        changed.push(p);
      }
      for root in &roots {
        if changed.iter().any(|p| p == root) {
          let _ = app.emit("shell://dir-changed", DirChanged { dir: root.to_string_lossy().into_owned() });
        }
      }
    }
  });

  *guard = Some((watcher, wanted));
  Ok(())
}
