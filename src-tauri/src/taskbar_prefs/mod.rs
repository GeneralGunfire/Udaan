//! Persisted taskbar/workspace preferences — pinned apps and simple KV
//! toggles (auto-hide, auto-maximize-new-windows, etc.), backed by SQLite
//! via the same `db::configure_connection` convention every other
//! feature's store uses (see schedule/store.rs for the reference shape).

mod store;

use std::sync::Arc;

pub use store::PinnedApp;
use store::Store;
use tauri::{AppHandle, Emitter, Manager, State};

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

/// Saves a preference and announces the change to every window. The store itself makes the
/// announcement, so every window hears about every change no matter which one (or which
/// part of the engine) made it, instead of depending on the writer remembering to emit.
#[tauri::command]
pub fn taskbar_prefs_set(app: AppHandle, state: State<TaskbarPrefsState>, key: String, value: String) -> Result<(), String> {
  state.store.set_pref(&key, &value).map_err(|e| e.to_string())?;
  let parsed = serde_json::from_str::<serde_json::Value>(&value).unwrap_or_else(|_| serde_json::Value::String(value.clone()));
  let _ = app.emit("shell://pref-changed", serde_json::json!({ "key": key, "value": parsed }));
  Ok(())
}

/// Every preference at once (key -> raw JSON string), for loading a window's settings in
/// a single call.
#[tauri::command]
pub fn taskbar_prefs_all(state: State<TaskbarPrefsState>) -> Result<std::collections::HashMap<String, String>, String> {
  state.store.all_prefs().map_err(|e| e.to_string())
}
