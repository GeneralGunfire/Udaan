use std::path::Path;
use std::process::Stdio;
use std::sync::Arc;

use chrono::Utc;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::sync::Mutex as AsyncMutex;

use super::store::{Store, Task, TaskStatus};

/// Event emitted to the frontend for a running/completed task.
/// One event per stdout line (already valid JSON emitted by `claude --output-format stream-json`),
/// plus synthetic "status" events for lifecycle transitions and a "stderr" event for error text.
#[derive(Clone, serde::Serialize)]
#[serde(tag = "kind")]
enum TaskEvent<'a> {
  #[serde(rename = "status")]
  Status { task_id: &'a str, status: &'static str },
  #[serde(rename = "line")]
  Line { task_id: &'a str, line: &'a str },
  #[serde(rename = "stderr")]
  Stderr { task_id: &'a str, line: &'a str },
}

fn emit(app: &AppHandle, event: &TaskEvent) {
  let _ = app.emit("claude-code://task-event", event);
}

pub struct Queue {
  store: Arc<Store>,
  app: AppHandle,
  /// Serializes execution so only one `claude` process runs at a time.
  lock: AsyncMutex<()>,
}

impl Queue {
  pub fn new(store: Arc<Store>, app: AppHandle) -> Arc<Self> {
    Arc::new(Self { store, app, lock: AsyncMutex::new(()) })
  }

  /// Enqueues a task record and spawns the worker if idle.
  pub fn submit(self: &Arc<Self>, prompt: String, cwd: String) -> rusqlite::Result<Task> {
    let task = Task {
      id: uuid::Uuid::new_v4().to_string(),
      prompt,
      cwd,
      status: TaskStatus::Queued,
      created_at: Utc::now().to_rfc3339(),
      started_at: None,
      finished_at: None,
      output: String::new(),
      error: None,
      session_id: None,
    };
    self.store.insert_task(&task)?;

    let this = Arc::clone(self);
    let task_id = task.id.clone();
    tauri::async_runtime::spawn(async move {
      this.run_task(task_id).await;
    });

    Ok(task)
  }

  async fn run_task(self: Arc<Self>, task_id: String) {
    // Serial queue: only one child process runs at a time. Later submissions
    // simply wait here for the lock before their process is spawned.
    let _permit = self.lock.lock().await;

    let task = match self.store.get_task(&task_id) {
      Ok(Some(t)) => t,
      _ => return,
    };

    let cwd_path = Path::new(&task.cwd);
    if !cwd_path.is_dir() {
      let _ = self.store.set_error(&task_id, "Working directory does not exist");
      let _ = self.store.set_status(&task_id, TaskStatus::Failed, Some("finished_at"), Some(&Utc::now().to_rfc3339()));
      emit(&self.app, &TaskEvent::Status { task_id: &task_id, status: "failed" });
      return;
    }

    let _ = self.store.set_status(&task_id, TaskStatus::Running, Some("started_at"), Some(&Utc::now().to_rfc3339()));
    emit(&self.app, &TaskEvent::Status { task_id: &task_id, status: "running" });

    let mut child = match Command::new(super::exe::resolve("claude"))
      .arg("-p")
      .arg(&task.prompt)
      .arg("--output-format")
      .arg("stream-json")
      .arg("--verbose")
      .arg("--include-partial-messages")
      .arg("--no-session-persistence")
      .current_dir(cwd_path)
      // The Tauri process (and this dev-mode child) can inherit an
      // ANTHROPIC_API_KEY from whatever shell/IDE launched it (e.g. a VS
      // Code extension). The Claude CLI prefers that key over a stored
      // `claude login` OAuth session even when the key is stale/invalid
      // for this use, which surfaces as an opaque "Anthropic key" auth
      // error despite the user being logged in with a Pro/Max plan. Strip
      // it so the CLI falls through to the OAuth session, matching what
      // happens when the user runs `claude` from a clean terminal.
      .env_remove("ANTHROPIC_API_KEY")
      .stdin(Stdio::null())
      .stdout(Stdio::piped())
      .stderr(Stdio::piped())
      .kill_on_drop(true)
      .spawn()
    {
      Ok(c) => c,
      Err(e) => {
        let msg = format!("Failed to spawn claude: {e}");
        let _ = self.store.set_error(&task_id, &msg);
        let _ = self.store.set_status(&task_id, TaskStatus::Failed, Some("finished_at"), Some(&Utc::now().to_rfc3339()));
        emit(&self.app, &TaskEvent::Stderr { task_id: &task_id, line: &msg });
        emit(&self.app, &TaskEvent::Status { task_id: &task_id, status: "failed" });
        return;
      }
    };

    let stdout = child.stdout.take().expect("stdout piped");
    let stderr = child.stderr.take().expect("stderr piped");

    let store_out = Arc::clone(&self.store);
    let app_out = self.app.clone();
    let task_id_out = task_id.clone();
    let stdout_task = tokio::spawn(async move {
      let mut lines = BufReader::new(stdout).lines();
      while let Ok(Some(line)) = lines.next_line().await {
        let _ = store_out.append_output(&task_id_out, &line);
        emit(&app_out, &TaskEvent::Line { task_id: &task_id_out, line: &line });
      }
    });

    let store_err = Arc::clone(&self.store);
    let app_err = self.app.clone();
    let task_id_err = task_id.clone();
    let stderr_task = tokio::spawn(async move {
      let mut lines = BufReader::new(stderr).lines();
      while let Ok(Some(line)) = lines.next_line().await {
        let _ = store_err.set_error(&task_id_err, &line);
        emit(&app_err, &TaskEvent::Stderr { task_id: &task_id_err, line: &line });
      }
    });

    let wait_result = child.wait().await;
    let _ = stdout_task.await;
    let _ = stderr_task.await;

    let finished_at = Utc::now().to_rfc3339();
    match wait_result {
      Ok(status) if status.success() => {
        let _ = self.store.set_status(&task_id, TaskStatus::Done, Some("finished_at"), Some(&finished_at));
        emit(&self.app, &TaskEvent::Status { task_id: &task_id, status: "done" });
      }
      Ok(status) => {
        let msg = format!("claude exited with status {status}");
        let _ = self.store.set_error(&task_id, &msg);
        let _ = self.store.set_status(&task_id, TaskStatus::Failed, Some("finished_at"), Some(&finished_at));
        emit(&self.app, &TaskEvent::Status { task_id: &task_id, status: "failed" });
      }
      Err(e) => {
        let msg = format!("Failed to wait on claude process: {e}");
        let _ = self.store.set_error(&task_id, &msg);
        let _ = self.store.set_status(&task_id, TaskStatus::Failed, Some("finished_at"), Some(&finished_at));
        emit(&self.app, &TaskEvent::Status { task_id: &task_id, status: "failed" });
      }
    }
  }
}
