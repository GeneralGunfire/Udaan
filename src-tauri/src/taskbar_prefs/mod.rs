//! Persisted taskbar/workspace preferences — pinned apps and simple KV
//! toggles (auto-hide, auto-maximize-new-windows, etc.), backed by SQLite
//! via the same `db::configure_connection` convention every other
//! feature's store uses (see schedule/store.rs for the reference shape).

mod store;

use std::sync::Arc;

pub use store::PinnedApp;
use store::Store;
use tauri::{AppHandle, Manager, State};

pub struct TaskbarPrefsState {
  store: Arc<Store>,
}

pub fn init(app: &AppHandle) -> Result<TaskbarPrefsState, String> {
  let data_dir = app
    .path()
    .app_data_dir()
    .map_err(|e| format!("Failed to resolve app data dir: {e}"))?;
  std::fs::create_dir_all(&data_dir).map_err(|e| format!("Failed to create app data dir: {e}"))?;
  let db_path = data_dir.join("taskbar_prefs.sqlite3");

  let store = Arc::new(Store::open(db_path).map_err(|e| format!("Failed to open taskbar_prefs store: {e}"))?);
  Ok(TaskbarPrefsState { store })
}

#[tauri::command]
pub fn taskbar_prefs_list_pinned(state: State<TaskbarPrefsState>) -> Result<Vec<PinnedApp>, String> {
  state.store.list_pinned().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn taskbar_prefs_set_pinned(state: State<TaskbarPrefsState>, items: Vec<PinnedApp>) -> Result<(), String> {
  state.store.set_pinned(&items).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn taskbar_prefs_get(state: State<TaskbarPrefsState>, key: String) -> Result<Option<String>, String> {
  state.store.get_pref(&key).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn taskbar_prefs_set(state: State<TaskbarPrefsState>, key: String, value: String) -> Result<(), String> {
  state.store.set_pref(&key, &value).map_err(|e| e.to_string())
}
