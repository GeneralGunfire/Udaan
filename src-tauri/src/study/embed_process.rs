use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::{oneshot, Mutex};

/// Long-lived Python subprocess wrapping sentence-transformers
/// (all-MiniLM-L6-v2) — one process for the app's lifetime rather than one
/// per request, since model load (~24s on this hardware) would otherwise
/// dominate every single embedding call. See resources/embed/embed.py for
/// the actual model/protocol; this is purely the Rust-side process
/// lifecycle + request/response correlation.
pub struct EmbedProcess {
  child: Mutex<Option<Child>>,
  stdin: Mutex<Option<ChildStdin>>,
  pending: Arc<Mutex<std::collections::HashMap<String, oneshot::Sender<EmbedResponse>>>>,
}

#[derive(Debug, Serialize)]
struct EmbedRequest {
  id: String,
  texts: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
struct EmbedResponse {
  #[serde(default)]
  embeddings: Option<Vec<Vec<f32>>>,
  #[serde(default)]
  error: Option<String>,
}

#[derive(Debug, Deserialize)]
struct RawLine {
  id: Option<String>,
  #[serde(default)]
  ready: bool,
  #[serde(default)]
  embeddings: Option<Vec<Vec<f32>>>,
  #[serde(default)]
  error: Option<String>,
}

fn resources_dir() -> Result<PathBuf, String> {
  let exe_dir = std::env::current_exe()
    .map_err(|e| format!("Failed to resolve executable path: {e}"))?
    .parent()
    .ok_or("Executable has no parent directory")?
    .to_path_buf();

  let dev_path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("resources");
  if dev_path.exists() {
    return Ok(dev_path);
  }

  Ok(exe_dir.join("resources"))
}

fn embed_script_path() -> Result<PathBuf, String> {
  let path = resources_dir()?.join("embed/embed.py");
  if !path.exists() {
    return Err(format!("Embedding script not found at {}", path.display()));
  }
  Ok(path)
}

/// Resolves a Python 3 interpreter, preferring `python3` then falling back
/// to `python` (Windows commonly only has the latter on PATH). Both
/// possibilities already appear on this machine per the environment check
/// done before choosing this approach.
fn python_command() -> &'static str {
  if which_exists("python3") {
    "python3"
  } else {
    "python"
  }
}

fn which_exists(name: &str) -> bool {
  std::process::Command::new(name)
    .arg("--version")
    .stdout(Stdio::null())
    .stderr(Stdio::null())
    .status()
    .map(|s| s.success())
    .unwrap_or(false)
}

impl EmbedProcess {
  pub fn new() -> Self {
    Self {
      child: Mutex::new(None),
      stdin: Mutex::new(None),
      pending: Arc::new(Mutex::new(std::collections::HashMap::new())),
    }
  }

  /// Spawns the Python process if not already running, and waits for its
  /// `{"ready": true}` readiness line (i.e. the model has finished
  /// loading) before returning — callers get an honest "still starting up"
  /// error instead of a request silently queuing behind a ~24s cold start
  /// with no feedback.
  async fn ensure_started(&self) -> Result<(), String> {
    {
      let child_guard = self.child.lock().await;
      if child_guard.is_some() {
        return Ok(());
      }
    }

    let script = embed_script_path()?;
    let mut child = Command::new(python_command())
      .arg(&script)
      .stdin(Stdio::piped())
      .stdout(Stdio::piped())
      .stderr(Stdio::piped())
      .spawn()
      .map_err(|e| format!("Failed to start embedding process: {e}"))?;

    let stdin = child.stdin.take().ok_or("Embedding process has no stdin")?;
    let stdout = child.stdout.take().ok_or("Embedding process has no stdout")?;
    let stderr = child.stderr.take();

    // Surface Python-side crashes/tracebacks to the Rust log instead of
    // them vanishing silently — stderr isn't part of the request/response
    // protocol, stdout is.
    if let Some(stderr) = stderr {
      tokio::spawn(async move {
        let mut reader = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = reader.next_line().await {
          eprintln!("[study embed] {line}");
        }
      });
    }

    let pending = self.pending.clone();
    let mut reader = BufReader::new(stdout).lines();
    let (ready_tx, ready_rx) = oneshot::channel::<Result<(), String>>();
    let mut ready_tx = Some(ready_tx);

    tokio::spawn(async move {
      loop {
        match reader.next_line().await {
          Ok(Some(line)) => {
            let parsed: Result<RawLine, _> = serde_json::from_str(&line);
            match parsed {
              Ok(raw) if raw.ready => {
                if let Some(tx) = ready_tx.take() {
                  let _ = tx.send(Ok(()));
                }
              }
              Ok(raw) => {
                if let Some(id) = raw.id {
                  let mut pending = pending.lock().await;
                  if let Some(sender) = pending.remove(&id) {
                    let _ = sender.send(EmbedResponse { embeddings: raw.embeddings, error: raw.error });
                  }
                }
              }
              Err(e) => eprintln!("[study embed] Failed to parse response line: {e} — raw: {line}"),
            }
          }
          Ok(None) => break, // stdout closed — process exited
          Err(e) => {
            eprintln!("[study embed] stdout read error: {e}");
            break;
          }
        }
      }
    });

    *self.stdin.lock().await = Some(stdin);
    *self.child.lock().await = Some(child);

    // Bound the wait — a genuinely broken environment (missing
    // sentence-transformers, no internet for first-time model download)
    // should fail cleanly rather than hang a caller forever.
    match tokio::time::timeout(std::time::Duration::from_secs(120), ready_rx).await {
      Ok(Ok(Ok(()))) => Ok(()),
      Ok(Ok(Err(e))) => Err(e),
      Ok(Err(_)) => Err("Embedding process closed before signaling ready".into()),
      Err(_) => Err(
        "Embedding model took too long to load (over 120s) — check that sentence-transformers is installed and, on first run, that the model can download.".into(),
      ),
    }
  }

  /// Embeds a batch of text chunks, returning one 384-dim vector per input
  /// string in the same order. Starts the process on first call.
  pub async fn embed(&self, texts: Vec<String>) -> Result<Vec<Vec<f32>>, String> {
    self.ensure_started().await?;

    let id = uuid::Uuid::new_v4().to_string();
    let (tx, rx) = oneshot::channel();
    self.pending.lock().await.insert(id.clone(), tx);

    let request = EmbedRequest { id: id.clone(), texts };
    let payload = serde_json::to_string(&request).map_err(|e| format!("Failed to serialize embed request: {e}"))?;

    {
      let mut stdin_guard = self.stdin.lock().await;
      let stdin = stdin_guard.as_mut().ok_or("Embedding process stdin unavailable")?;
      stdin
        .write_all(format!("{payload}\n").as_bytes())
        .await
        .map_err(|e| format!("Failed to send embed request: {e}"))?;
      stdin.flush().await.map_err(|e| format!("Failed to flush embed request: {e}"))?;
    }

    let response = tokio::time::timeout(std::time::Duration::from_secs(30), rx)
      .await
      .map_err(|_| "Embedding request timed out after 30s".to_string())?
      .map_err(|_| "Embedding process closed while awaiting a response".to_string())?;

    if let Some(error) = response.error {
      return Err(format!("Embedding failed: {error}"));
    }
    response.embeddings.ok_or_else(|| "Embedding process returned no vectors and no error".to_string())
  }
}

impl Drop for EmbedProcess {
  fn drop(&mut self) {
    // Best-effort: tokio::process::Child kills the child on drop by
    // default when its handle is dropped (kill_on_drop is not set here,
    // so this relies on the OS reaping an orphaned python.exe on app
    // exit — acceptable for a short-lived per-session helper process,
    // consistent with how tts_process.rs's Piper invocation is also a
    // fire-and-forget child).
  }
}
