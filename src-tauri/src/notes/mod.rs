//! Notes: a first-class, Udaan-native overlay app (not an external process
//! launch). Each note's body is a plain `.txt` file under
//! `{app_data_dir}/notes/` (NOT `agent_workspace`'s sandbox — unrelated
//! feature); a small sqlite index (same `configure_connection` WAL setup as
//! every other store in this app — see `schedule::store`) tracks tab
//! metadata (title/order) and which tab was last active, so a relaunch
//! reopens exactly the same tabs in the same order.

mod store;

use std::sync::Arc;

pub use store::NoteMeta;
use store::Store;
use tauri::{AppHandle, Manager, State};

pub struct NotesState {
  store: Arc<Store>,
}

pub fn init(app: &AppHandle) -> Result<NotesState, String> {
  let data_dir = app
    .path()
    .app_data_dir()
    .map_err(|e| format!("Failed to resolve app data dir: {e}"))?;
  let notes_dir = data_dir.join("notes");
  std::fs::create_dir_all(&notes_dir).map_err(|e| format!("Failed to create notes dir: {e}"))?;
  let db_path = data_dir.join("notes.sqlite3");

  let store = Arc::new(Store::open(db_path, notes_dir).map_err(|e| format!("Failed to open notes store: {e}"))?);
  Ok(NotesState { store })
}

#[tauri::command(async)]
pub fn notes_list(state: State<NotesState>) -> Result<Vec<NoteMeta>, String> {
  state.store.list_notes().map_err(|e| e.to_string())
}

#[tauri::command(async)]
pub fn notes_read_body(state: State<NotesState>, id: String) -> Result<String, String> {
  state.store.read_body(&id).map_err(|e| e.to_string())
}

#[tauri::command(async)]
pub fn notes_create(state: State<NotesState>, note: NoteMeta) -> Result<(), String> {
  state.store.create_note(&note).map_err(|e| e.to_string())
}

#[tauri::command(async)]
pub fn notes_save_body(state: State<NotesState>, id: String, title: String, body: String) -> Result<(), String> {
  state.store.save_body(&id, &title, &body)
}

#[tauri::command(async)]
pub fn notes_delete(state: State<NotesState>, id: String) -> Result<(), String> {
  state.store.delete_note(&id)
}

#[tauri::command(async)]
pub fn notes_set_order(state: State<NotesState>, ordered_ids: Vec<String>) -> Result<(), String> {
  state.store.set_order(&ordered_ids).map_err(|e| e.to_string())
}

#[tauri::command(async)]
pub fn notes_get_active(state: State<NotesState>) -> Result<Option<String>, String> {
  state.store.get_active_note().map_err(|e| e.to_string())
}

#[tauri::command(async)]
pub fn notes_set_active(state: State<NotesState>, id: Option<String>) -> Result<(), String> {
  state.store.set_active_note(id.as_deref()).map_err(|e| e.to_string())
}
