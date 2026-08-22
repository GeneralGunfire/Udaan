mod transcribe;

pub use transcribe::WhisperServer;

use tauri::State;

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
