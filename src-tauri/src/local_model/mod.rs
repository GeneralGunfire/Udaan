mod ollama_process;
mod transcribe;
mod tts_process;

pub use ollama_process::OllamaProcess;
pub use transcribe::WhisperServer;
pub use tts_process::TtsVoice;

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

  let mut child = Command::new("ollama")
    .arg("serve")
    .stdout(std::process::Stdio::null())
    .stderr(std::process::Stdio::null())
    .spawn()
    .map_err(|e| format!("Could not start \"ollama serve\": {e}. Is Ollama installed and on PATH?"))?;

  // A common false-positive: if Ollama is already running as a Windows
  // background service (the default with the official installer), this
  // spawn still succeeds but the new process immediately exits because
  // port 11434 is taken — leaving Udaan thinking it "owns" a process that
  // no longer exists, which then makes Stop silently do nothing later.
  // Give it a moment and check.
  tokio::time::sleep(std::time::Duration::from_millis(400)).await;
  if let Ok(Some(status)) = child.try_wait() {
    return Err(format!(
      "\"ollama serve\" exited immediately (status: {status}) — Ollama is likely already running as a background service outside Udaan. Use the app as-is; there's nothing to start."
    ));
  }

  *state.0.lock().unwrap() = Some(child);
  Ok(())
}

#[tauri::command]
pub async fn local_model_stop_ollama(state: State<'_, OllamaProcess>) -> Result<(), String> {
  let mut child = {
    let mut guard = state.0.lock().unwrap();
    guard.take()
  };
  let Some(child) = child.as_mut() else {
    return Err(
      "Ollama isn't a process Udaan started, so it can't be stopped from here.".into(),
    );
  };
  child
    .kill()
    .await
    .map_err(|e| format!("Failed to stop Ollama: {e}"))?;
  // `kill()` only guarantees the signal was sent; wait for the process to
  // actually exit so a caller re-checking reachability right after doesn't
  // read the still-shutting-down daemon as still running.
  let _ = child.wait().await;
  Ok(())
}

/// Stops an Ollama instance Udaan did *not* start itself — e.g. the
/// background service/tray app the official installer sets up to
/// auto-launch on login. Requires explicit user confirmation on the
/// frontend before calling this, since it reaches outside processes this
/// app doesn't own and can affect other tools relying on that instance.
///
/// Kills every process whose name matches Ollama's known executables
/// (case-insensitive, extension-agnostic) rather than targeting a PID by
/// port, since a reliable "which process owns this port" lookup isn't
/// available cross-platform without extra OS-specific plumbing.
#[tauri::command]
pub async fn local_model_stop_external_ollama() -> Result<(), String> {
  use sysinfo::System;

  let mut sys = System::new_all();
  sys.refresh_all();

  let matches_ollama = |name: &str| {
    let name = name.to_ascii_lowercase();
    name == "ollama" || name == "ollama.exe" || name.starts_with("ollama app")
  };

  let mut killed_any = false;
  for process in sys.processes().values() {
    let name = process.name().to_string_lossy();
    if matches_ollama(&name) {
      process.kill();
      killed_any = true;
    }
  }

  if !killed_any {
    return Err("No running Ollama process was found to stop.".into());
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

#[tauri::command]
pub async fn tts_list_voices() -> Result<Vec<TtsVoice>, String> {
  Ok(tts_process::available_voices())
}

/// Synthesizes one chunk of text to WAV bytes. Returns the raw bytes for the
/// frontend to decode/play via Web Audio — no file is written to disk, so
/// there's nothing to clean up per chunk.
#[tauri::command]
pub async fn tts_synthesize(text: String, voice: String, speed: f32) -> Result<Vec<u8>, String> {
  tts_process::synthesize(&text, &voice, speed).await
}
