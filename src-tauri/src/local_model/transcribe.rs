use std::process::Stdio;

use tokio::process::Command;

#[derive(serde::Serialize, serde::Deserialize)]
pub struct TranscriptionResult {
  pub text: String,
  pub language: String,
  #[serde(rename = "languageProbability")]
  pub language_probability: f32,
}

/// Runs the bundled `transcribe.py` against `python3` on PATH.
///
/// faster-whisper is Python-only, so unlike the Ollama chat path (a plain
/// HTTP call from the frontend) this has to shell out — same shape as the
/// `claude_code` runner's process spawn, just synchronous and one-shot.
pub async fn run(path: String) -> Result<TranscriptionResult, String> {
  let script_path = script_path()?;

  let output = Command::new("python3")
    .arg(&script_path)
    .arg(&path)
    .stdin(Stdio::null())
    .stdout(Stdio::piped())
    .stderr(Stdio::piped())
    .output()
    .await
    .map_err(|e| format!("Failed to spawn python3: {e}"))?;

  if !output.status.success() {
    let stderr = String::from_utf8_lossy(&output.stderr);
    return Err(format!("transcribe.py failed: {stderr}"));
  }

  let stdout = String::from_utf8_lossy(&output.stdout);
  serde_json::from_str(&stdout).map_err(|e| format!("Failed to parse transcription output: {e} ({stdout})"))
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
