use std::process::Stdio;
use std::sync::Arc;

use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};
use tokio::sync::Mutex;

#[derive(serde::Serialize, serde::Deserialize)]
pub struct TranscriptionResult {
  pub text: String,
  pub language: String,
  #[serde(rename = "languageProbability")]
  pub language_probability: f32,
}

struct WhisperProcess {
  child: Child,
  stdin: ChildStdin,
  stdout: BufReader<ChildStdout>,
}

/// Keeps one long-lived `transcribe.py` process alive so the whisper model
/// (~7-8s to load) is only paid once, not on every mic click. Requests are
/// serialized through the mutex since whisper doesn't handle concurrent
/// calls on a single model instance.
#[derive(Clone)]
pub struct WhisperServer {
  process: Arc<Mutex<Option<WhisperProcess>>>,
}

impl WhisperServer {
  pub fn new() -> Self {
    Self { process: Arc::new(Mutex::new(None)) }
  }

  pub async fn transcribe(&self, path: String) -> Result<TranscriptionResult, String> {
    let mut guard = self.process.lock().await;

    if guard.is_none() {
      *guard = Some(spawn().await?);
    }

    match transcribe_with(guard.as_mut().unwrap(), &path).await {
      Ok(result) => Ok(result),
      Err(e) => {
        // The process may have died (e.g. crashed on bad audio) — drop it so
        // the next call respawns instead of repeating the same failure.
        *guard = None;
        Err(e)
      }
    }
  }
}

async fn spawn() -> Result<WhisperProcess, String> {
  let script_path = script_path()?;

  let mut child = Command::new("python3")
    .arg(&script_path)
    .stdin(Stdio::piped())
    .stdout(Stdio::piped())
    .stderr(Stdio::piped())
    .kill_on_drop(true)
    .spawn()
    .map_err(|e| format!("Failed to spawn python3: {e}"))?;

  let stdin = child.stdin.take().expect("stdin piped");
  let mut stdout = BufReader::new(child.stdout.take().expect("stdout piped"));

  // Block until the model finishes loading and the server signals readiness.
  let mut ready_line = String::new();
  stdout
    .read_line(&mut ready_line)
    .await
    .map_err(|e| format!("Failed to read whisper server readiness: {e}"))?;
  if !ready_line.contains("\"ready\"") {
    return Err(format!("Unexpected whisper server startup output: {ready_line}"));
  }

  Ok(WhisperProcess { child, stdin, stdout })
}

async fn transcribe_with(process: &mut WhisperProcess, path: &str) -> Result<TranscriptionResult, String> {
  let request = serde_json::json!({ "audio_path": path });
  let line = format!("{}\n", request);

  process
    .stdin
    .write_all(line.as_bytes())
    .await
    .map_err(|e| format!("Failed to write to whisper server: {e}"))?;
  process
    .stdin
    .flush()
    .await
    .map_err(|e| format!("Failed to flush whisper server stdin: {e}"))?;

  let mut response_line = String::new();
  let bytes_read = process
    .stdout
    .read_line(&mut response_line)
    .await
    .map_err(|e| format!("Failed to read whisper server response: {e}"))?;

  if bytes_read == 0 {
    let status = process.child.try_wait().ok().flatten();
    return Err(format!("Whisper server process exited unexpectedly (status: {status:?})"));
  }

  #[derive(serde::Deserialize)]
  #[serde(untagged)]
  enum Response {
    Ok(TranscriptionResult),
    Err { error: String },
  }

  match serde_json::from_str(&response_line) {
    Ok(Response::Ok(result)) => Ok(result),
    Ok(Response::Err { error }) => Err(format!("Transcription failed: {error}")),
    Err(e) => Err(format!("Failed to parse whisper server response: {e} ({response_line})")),
  }
}

fn script_path() -> Result<std::path::PathBuf, String> {
  let exe_dir = std::env::current_exe()
    .map_err(|e| format!("Failed to resolve executable path: {e}"))?
    .parent()
    .ok_or("Executable has no parent directory")?
    .to_path_buf();

  // Debug builds run from target/debug — the script lives alongside the source.
  let dev_path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src/local_model/transcribe.py");
  if dev_path.exists() {
    return Ok(dev_path);
  }

  Ok(exe_dir.join("transcribe.py"))
}
