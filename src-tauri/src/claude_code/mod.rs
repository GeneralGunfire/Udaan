pub mod exe;
mod runner;
mod store;
mod vscode;

use std::sync::Arc;

use store::{Store, Task};
use tauri::{AppHandle, Manager, State};

pub struct ClaudeCodeState {
  store: Arc<Store>,
  queue: Arc<runner::Queue>,
}

pub fn init(app: &AppHandle) -> Result<ClaudeCodeState, String> {
  let data_dir = app
    .path()
    .app_data_dir()
    .map_err(|e| format!("Failed to resolve app data dir: {e}"))?;
  std::fs::create_dir_all(&data_dir).map_err(|e| format!("Failed to create app data dir: {e}"))?;
  let db_path = data_dir.join("claude_code_tasks.sqlite3");

  let store = Arc::new(Store::open(db_path).map_err(|e| format!("Failed to open task store: {e}"))?);
  let queue = runner::Queue::new(Arc::clone(&store), app.clone());

  Ok(ClaudeCodeState { store, queue })
}

#[tauri::command(async)]
pub fn claude_code_submit_task(
  state: State<ClaudeCodeState>,
  prompt: String,
  cwd: String,
) -> Result<Task, String> {
  if prompt.trim().is_empty() {
    return Err("Prompt must not be empty".into());
  }
  state.queue.submit(prompt, cwd).map_err(|e| e.to_string())
}

#[tauri::command(async)]
pub fn claude_code_list_tasks(state: State<ClaudeCodeState>) -> Result<Vec<Task>, String> {
  state.store.list_tasks().map_err(|e| e.to_string())
}

#[tauri::command(async)]
pub fn claude_code_get_task(state: State<ClaudeCodeState>, id: String) -> Result<Option<Task>, String> {
  state.store.get_task(&id).map_err(|e| e.to_string())
}

#[tauri::command(async)]
pub fn claude_code_open_in_vscode(dir: String) -> Result<(), String> {
  vscode::open_in_vscode(&dir)
}

#[derive(serde::Serialize)]
pub struct CliCheckResult {
  pub ok: bool,
  pub version: Option<String>,
  pub error: Option<String>,
}

/// Runs `claude --version` with a short timeout to confirm the CLI is
/// actually installed and resolvable on PATH, not just that this app's
/// process-spawning code exists. Uses the same cross-platform `.cmd`
/// resolution as the task queue's own spawn path.
#[tauri::command]
pub async fn claude_code_check_cli() -> CliCheckResult {
  let exe_name = exe::resolve("claude");

  let result = tokio::time::timeout(
    std::time::Duration::from_secs(5),
    crate::engine::process::hidden_async(&exe_name).arg("--version").output(),
  )
  .await;

  match result {
    Ok(Ok(output)) if output.status.success() => CliCheckResult {
      ok: true,
      version: Some(String::from_utf8_lossy(&output.stdout).trim().to_string()),
      error: None,
    },
    Ok(Ok(output)) => CliCheckResult {
      ok: false,
      version: None,
      error: Some(format!(
        "claude --version exited with {}: {}",
        output.status,
        String::from_utf8_lossy(&output.stderr).trim()
      )),
    },
    Ok(Err(e)) => CliCheckResult {
      ok: false,
      version: None,
      error: Some(format!("Failed to launch '{exe_name}': {e}")),
    },
    Err(_) => CliCheckResult {
      ok: false,
      version: None,
      error: Some("Timed out waiting for 'claude --version'".into()),
    },
  }
}
