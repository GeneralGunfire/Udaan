mod ollama_process;
mod transcribe;

pub use ollama_process::OllamaProcess;
pub use transcribe::WhisperServer;

use tauri::State;
use tokio::process::Command;

#[tauri::command]
pub async fn local_model_transcribe(
  state: State<'_, WhisperServer>,
  path: String,
) -> Result<transcribe::TranscriptionResult, String> {
  state.transcribe(path).await
}

/// Writes `audio` (a WAV/webm/etc. blob's raw bytes, as produced by the
/// browser `MediaRecorder`) to a temp file and transcribes it. Lets the mic
/// button hand off bytes directly without going through a filesystem plugin
/// on the frontend.
#[tauri::command]
pub async fn local_model_transcribe_bytes(
  state: State<'_, WhisperServer>,
  audio: Vec<u8>,
) -> Result<transcribe::TranscriptionResult, String> {
  let path = std::env::temp_dir().join(format!("udaan-mic-{}.wav", uuid::Uuid::new_v4()));
  tokio::fs::write(&path, &audio)
    .await
    .map_err(|e| format!("Failed to write temp audio file: {e}"))?;

  let result = state.transcribe(path.to_string_lossy().into_owned()).await;
  let _ = tokio::fs::remove_file(&path).await;
  result
}

#[tauri::command]
pub async fn local_model_start_ollama(state: State<'_, OllamaProcess>) -> Result<(), String> {
  {
    let guard = state.0.lock().unwrap();
    if guard.is_some() {
      return Ok(()); // already running one we started
    }
  }

  let child = Command::new("ollama")
    .arg("serve")
    .stdout(std::process::Stdio::null())
    .stderr(std::process::Stdio::null())
    .spawn()
    .map_err(|e| format!("Could not start \"ollama serve\": {e}. Is Ollama installed and on PATH?"))?;

  *state.0.lock().unwrap() = Some(child);
  Ok(())
}

#[tauri::command]
pub async fn local_model_stop_ollama(state: State<'_, OllamaProcess>) -> Result<(), String> {
  let mut child = {
    let mut guard = state.0.lock().unwrap();
    guard.take()
  };
  if let Some(child) = child.as_mut() {
    child
      .kill()
      .await
      .map_err(|e| format!("Failed to stop Ollama: {e}"))?;
  }
  Ok(())
}

/// True only if *this app* started the currently-tracked process — not a
/// general "is Ollama running" check (that's `isReachable()` on the
/// frontend, via the HTTP API, which also covers an externally-started
/// instance).
#[tauri::command]
pub async fn local_model_started_ollama(state: State<'_, OllamaProcess>) -> Result<bool, String> {
  Ok(state.0.lock().unwrap().is_some())
}
