mod store;

use std::sync::Arc;

use chrono::Utc;
pub use store::{ChatMessage, ChatSession, MemoryFact, MessageRole};
use tauri::{AppHandle, Manager, State};

pub struct GeneralChatState {
  store: Arc<store::Store>,
}

pub fn init(app: &AppHandle) -> Result<GeneralChatState, String> {
  let data_dir = app
    .path()
    .app_data_dir()
    .map_err(|e| format!("Failed to resolve app data dir: {e}"))?;
  std::fs::create_dir_all(&data_dir).map_err(|e| format!("Failed to create app data dir: {e}"))?;
  let db_path = data_dir.join("general_chat.sqlite3");

  let store = Arc::new(store::Store::open(db_path).map_err(|e| format!("Failed to open chat store: {e}"))?);
  Ok(GeneralChatState { store })
}

fn truncate_title(text: &str) -> String {
  const MAX_LEN: usize = 60;
  let trimmed = text.trim();
  if trimmed.chars().count() <= MAX_LEN {
    trimmed.to_string()
  } else {
    let truncated: String = trimmed.chars().take(MAX_LEN).collect();
    format!("{truncated}…")
  }
}

#[tauri::command(async)]
pub fn general_chat_create_session(
  state: State<GeneralChatState>,
  first_message: String,
  provider: String,
) -> Result<ChatSession, String> {
  let now = Utc::now().to_rfc3339();
  let session = ChatSession {
    id: uuid::Uuid::new_v4().to_string(),
    title: truncate_title(&first_message),
    provider,
    created_at: now.clone(),
    updated_at: now,
  };
  state.store.create_session(&session).map_err(|e| e.to_string())?;
  Ok(session)
}

/// Lists sessions for one provider ("local" | "omniroute") — Local and
/// OmniRoute chats are separate lists, never merged into one thread.
#[tauri::command(async)]
pub fn general_chat_list_sessions(state: State<GeneralChatState>, provider: String) -> Result<Vec<ChatSession>, String> {
  state.store.list_sessions(&provider).map_err(|e| e.to_string())
}

#[tauri::command(async)]
pub fn general_chat_delete_session(state: State<GeneralChatState>, id: String) -> Result<(), String> {
  state.store.delete_session(&id).map_err(|e| e.to_string())
}

#[tauri::command(async)]
pub fn general_chat_list_messages(state: State<GeneralChatState>, session_id: String) -> Result<Vec<ChatMessage>, String> {
  state.store.list_messages(&session_id).map_err(|e| e.to_string())
}

#[tauri::command(async)]
pub fn general_chat_add_message(
  state: State<GeneralChatState>,
  session_id: String,
  role: MessageRole,
  content: String,
  mode: String,
) -> Result<ChatMessage, String> {
  let now = Utc::now().to_rfc3339();
  let message = ChatMessage {
    id: uuid::Uuid::new_v4().to_string(),
    session_id: session_id.clone(),
    role,
    content,
    mode,
    created_at: now.clone(),
  };
  state.store.insert_message(&message).map_err(|e| e.to_string())?;
  state.store.touch_session(&session_id, &now).map_err(|e| e.to_string())?;
  Ok(message)
}

/// Called as an assistant reply streams/completes, to persist its final text
/// without creating a new row for every intermediate update.
#[tauri::command(async)]
pub fn general_chat_update_message(state: State<GeneralChatState>, id: String, content: String) -> Result<(), String> {
  state.store.update_message_content(&id, &content).map_err(|e| e.to_string())
}

/// Sets/overwrites one cross-session key fact (e.g. "name", "timezone",
/// "current_project"). This is a flat fact store, not a transcript — the
/// model reads all facts back as short bullet lines prepended to its
/// system prompt on every new chat.
#[tauri::command(async)]
pub fn general_chat_set_memory_fact(state: State<GeneralChatState>, key: String, value: String) -> Result<(), String> {
  let now = Utc::now().to_rfc3339();
  state.store.set_memory_fact(&key, &value, &now).map_err(|e| e.to_string())
}

#[tauri::command(async)]
pub fn general_chat_delete_memory_fact(state: State<GeneralChatState>, key: String) -> Result<(), String> {
  state.store.delete_memory_fact(&key).map_err(|e| e.to_string())
}

#[tauri::command(async)]
pub fn general_chat_list_memory_facts(state: State<GeneralChatState>) -> Result<Vec<MemoryFact>, String> {
  state.store.list_memory_facts().map_err(|e| e.to_string())
}
