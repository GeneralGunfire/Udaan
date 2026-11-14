//! Compatibility layer for the notification engine (`engine::notify`).
//!
//! The notification store, policy and banner timing now live in the engine. This module keeps
//! the old command names and the `push_notification` function working, unchanged, so the
//! current toast and notification panel keep running until their own rebuild moves them onto
//! the engine's commands. It owns no state and no storage.

pub mod windows_mirror;

use crate::engine::notify::{self, Incoming, Notification, Urgency};
use tauri::AppHandle;

/// Callable from Rust modules without going through the command layer.
pub fn push_notification(
  app: &AppHandle,
  kind: &str,
  title: &str,
  body: &str,
  source_app: &str,
  action_label: Option<&str>,
  action_payload: Option<&str>,
) -> Result<Notification, String> {
  notify::submit(
    app,
    Incoming {
      kind: kind.to_string(),
      title: title.to_string(),
      body: body.to_string(),
      source_app: source_app.to_string(),
      action_label: action_label.map(str::to_string),
      action_payload: action_payload.map(str::to_string),
      urgency: Urgency::Normal,
    },
  )
}

#[tauri::command(async)]
pub fn notifications_list(unread_only: bool, limit: i64) -> Result<Vec<Notification>, String> {
  notify::notify_list(unread_only, limit)
}

#[tauri::command(async)]
pub fn notifications_unread_count() -> Result<i64, String> {
  notify::notify_unread_count()
}

#[tauri::command(async)]
pub fn notifications_mark_read(app: AppHandle, id: String) -> Result<(), String> {
  notify::notify_mark_read(app, id)
}

#[tauri::command(async)]
pub fn notifications_mark_all_read(app: AppHandle) -> Result<(), String> {
  notify::notify_mark_all_read(app)
}

#[tauri::command(async)]
pub fn notifications_dismiss(app: AppHandle, id: String) -> Result<(), String> {
  notify::notify_dismiss(app, id)
}

#[tauri::command(async)]
pub fn notifications_push(
  app: AppHandle,
  kind: String,
  title: String,
  body: String,
  source_app: String,
  action_label: Option<String>,
  action_payload: Option<String>,
) -> Result<Notification, String> {
  notify::submit(&app, Incoming { kind, title, body, source_app, action_label, action_payload, urgency: Urgency::Normal })
}
