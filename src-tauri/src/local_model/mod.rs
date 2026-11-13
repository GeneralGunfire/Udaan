mod tts_process;

pub use tts_process::TtsVoice;

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
