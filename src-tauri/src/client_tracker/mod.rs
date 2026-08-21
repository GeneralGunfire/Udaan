mod store;

use std::sync::Arc;

pub use store::{Contact, ContactNote, FollowUp};
use store::Store;
use tauri::{AppHandle, Manager, State};

pub struct ClientTrackerState {
  store: Arc<Store>,
}

pub fn init(app: &AppHandle) -> Result<ClientTrackerState, String> {
  let data_dir = app
    .path()
    .app_data_dir()
    .map_err(|e| format!("Failed to resolve app data dir: {e}"))?;
  std::fs::create_dir_all(&data_dir).map_err(|e| format!("Failed to create app data dir: {e}"))?;
  let db_path = data_dir.join("client_tracker.sqlite3");

  let store = Arc::new(Store::open(db_path).map_err(|e| format!("Failed to open client tracker store: {e}"))?);
  Ok(ClientTrackerState { store })
}

#[tauri::command]
pub fn client_tracker_list_contacts(state: State<ClientTrackerState>) -> Result<Vec<Contact>, String> {
  state.store.list_contacts().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn client_tracker_upsert_contact(state: State<ClientTrackerState>, contact: Contact) -> Result<(), String> {
  state.store.upsert_contact(&contact).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn client_tracker_delete_contact(state: State<ClientTrackerState>, id: String) -> Result<(), String> {
  state.store.delete_contact(&id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn client_tracker_list_notes(
  state: State<ClientTrackerState>,
  contact_id: String,
) -> Result<Vec<ContactNote>, String> {
  state.store.list_notes(&contact_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn client_tracker_add_note(state: State<ClientTrackerState>, note: ContactNote) -> Result<(), String> {
  state.store.add_note(&note).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn client_tracker_list_follow_ups(state: State<ClientTrackerState>) -> Result<Vec<FollowUp>, String> {
  state.store.list_follow_ups().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn client_tracker_add_follow_up(state: State<ClientTrackerState>, follow_up: FollowUp) -> Result<(), String> {
  state.store.add_follow_up(&follow_up).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn client_tracker_set_follow_up_done(
  state: State<ClientTrackerState>,
  id: String,
  done: bool,
) -> Result<(), String> {
  state.store.set_follow_up_done(&id, done).map_err(|e| e.to_string())
}
