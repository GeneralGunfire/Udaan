//! Real notification store backing the taskbar's notification panel —
//! replaces what was previously a hardcoded empty state with no backend
//! at all. Same store pattern as every other feature (see
//! taskbar_prefs/store.rs for the reference shape): SQLite via
//! `db::configure_connection`, one `Store` behind a `Mutex<Connection>`.
//!
//! Any Rust module can push a notification via `push_notification` (see
//! below) — the first real producers are daily_brief (report ready) and
//! the frontend's TTS error path (via the `notifications_push` command,
//! since that failure surfaces in JS, not Rust).

mod store;
pub mod windows_mirror;

use std::sync::Arc;

pub use store::Notification;
use store::Store;
use tauri::{AppHandle, Emitter, Manager, State};

pub struct NotificationsState {
  store: Arc<Store>,
}

pub fn init(app: &AppHandle) -> Result<NotificationsState, String> {
  let data_dir = app
    .path()
    .app_data_dir()
    .map_err(|e| format!("Failed to resolve app data dir: {e}"))?;
  std::fs::create_dir_all(&data_dir).map_err(|e| format!("Failed to create app data dir: {e}"))?;
  let db_path = data_dir.join("notifications.sqlite3");

  let store = Arc::new(Store::open(db_path).map_err(|e| format!("Failed to open notifications store: {e}"))?);
  Ok(NotificationsState { store })
}

/// Callable from other Rust modules (daily_brief, ...) without
/// going through the Tauri command/IPC layer — those run in Rust already
/// and have direct access to `AppHandle`. Emits `notifications:changed` so
/// every open window's taskbar panel updates without polling, the same
/// broadcast-on-mutation pattern `taskbar:auto-hide-changed` already uses
/// elsewhere in this app.
pub fn push_notification(
  app: &AppHandle,
  kind: &str,
  title: &str,
  body: &str,
  source_app: &str,
  action_label: Option<&str>,
  action_payload: Option<&str>,
) -> Result<Notification, String> {
  let state = app.state::<NotificationsState>();
  let notification = state
    .store
    .push(kind, title, body, source_app, action_label, action_payload)
    .map_err(|e| e.to_string())?;
  let _ = app.emit("notifications:changed", ());
  Ok(notification)
}

#[tauri::command]
pub fn notifications_list(
  state: State<NotificationsState>,
  unread_only: bool,
  limit: i64,
) -> Result<Vec<Notification>, String> {
  state.store.list(unread_only, limit).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn notifications_unread_count(state: State<NotificationsState>) -> Result<i64, String> {
  state.store.unread_count().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn notifications_mark_read(app: AppHandle, state: State<NotificationsState>, id: String) -> Result<(), String> {
  state.store.mark_read(&id).map_err(|e| e.to_string())?;
  let _ = app.emit("notifications:changed", ());
  Ok(())
}

#[tauri::command]
pub fn notifications_mark_all_read(app: AppHandle, state: State<NotificationsState>) -> Result<(), String> {
  state.store.mark_all_read().map_err(|e| e.to_string())?;
  let _ = app.emit("notifications:changed", ());
  Ok(())
}

#[tauri::command]
pub fn notifications_dismiss(app: AppHandle, state: State<NotificationsState>, id: String) -> Result<(), String> {
  state.store.dismiss(&id).map_err(|e| e.to_string())?;
  let _ = app.emit("notifications:changed", ());
  Ok(())
}

/// Frontend-facing push — used for producers that only exist in
/// TypeScript (the TTS error path in Phase 8, since a Piper synthesis
/// failure surfaces inside the document-reader/news-brief playback
/// engine, not in Rust).
#[tauri::command]
pub fn notifications_push(
  app: AppHandle,
  state: State<NotificationsState>,
  kind: String,
  title: String,
  body: String,
  source_app: String,
  action_label: Option<String>,
  action_payload: Option<String>,
) -> Result<Notification, String> {
  let notification = state
    .store
    .push(
      &kind,
      &title,
      &body,
      &source_app,
      action_label.as_deref(),
      action_payload.as_deref(),
    )
    .map_err(|e| e.to_string())?;
  let _ = app.emit("notifications:changed", ());
  Ok(notification)
}
