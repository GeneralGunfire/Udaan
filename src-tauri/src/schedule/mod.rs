mod store;

use std::sync::Arc;

pub use store::ScheduleEvent;
use store::Store;
use tauri::{AppHandle, Manager, State};

pub struct ScheduleState {
  store: Arc<Store>,
}

pub fn init(app: &AppHandle) -> Result<ScheduleState, String> {
  let data_dir = app
    .path()
    .app_data_dir()
    .map_err(|e| format!("Failed to resolve app data dir: {e}"))?;
  std::fs::create_dir_all(&data_dir).map_err(|e| format!("Failed to create app data dir: {e}"))?;
  let db_path = data_dir.join("schedule.sqlite3");

  let store = Arc::new(Store::open(db_path).map_err(|e| format!("Failed to open schedule store: {e}"))?);
  Ok(ScheduleState { store })
}

#[tauri::command]
pub fn schedule_list_events(state: State<ScheduleState>) -> Result<Vec<ScheduleEvent>, String> {
  state.store.list_events().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn schedule_create_event(state: State<ScheduleState>, event: ScheduleEvent) -> Result<(), String> {
  state.store.create_event(&event).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn schedule_update_event(state: State<ScheduleState>, event: ScheduleEvent) -> Result<(), String> {
  state.store.update_event(&event).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn schedule_delete_event(state: State<ScheduleState>, id: String) -> Result<(), String> {
  state.store.delete_event(&id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn schedule_set_status(state: State<ScheduleState>, id: String, status: String) -> Result<(), String> {
  state.store.set_status(&id, &status).map_err(|e| e.to_string())
}
