use std::path::PathBuf;
use std::process::Stdio;

use tokio::io::AsyncWriteExt;
use tokio::process::Command;

#[derive(serde::Serialize, Clone)]
pub struct TtsVoice {
  pub id: String,
  pub label: String,
  pub locale: String,
  pub gender: String,
}

pub fn available_voices() -> Vec<TtsVoice> {
  vec![
    TtsVoice {
      id: "en_US-lessac-medium".into(),
      label: "Lessac (US, neutral)".into(),
      locale: "en_US".into(),
      gender: "neutral".into(),
    },
    TtsVoice {
      id: "en_US-amy-medium".into(),
      label: "Amy (US, female)".into(),
      locale: "en_US".into(),
      gender: "female".into(),
    },
    TtsVoice {
      id: "en_GB-alan-medium".into(),
      label: "Alan (UK, male)".into(),
      locale: "en_GB".into(),
      gender: "male".into(),
    },
  ]
}

fn resources_dir() -> Result<PathBuf, String> {
  let exe_dir = std::env::current_exe()
    .map_err(|e| format!("Failed to resolve executable path: {e}"))?
    .parent()
    .ok_or("Executable has no parent directory")?
    .to_path_buf();

  // Debug builds run from target/debug — resources live alongside the source.
  let dev_path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("resources");
  if dev_path.exists() {
    return Ok(dev_path);
  }

  Ok(exe_dir.join("resources"))
}

fn piper_exe_path() -> Result<PathBuf, String> {
  let path = resources_dir()?.join("piper/piper/piper.exe");
  if !path.exists() {
    return Err(format!("Piper executable not found at {}", path.display()));
  }
  Ok(path)
}

fn voice_model_path(voice_id: &str) -> Result<(PathBuf, PathBuf), String> {
  if !voice_id.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-') {
    return Err(format!("Invalid voice id: {voice_id}"));
  }
  let dir = resources_dir()?.join("voices");
  let onnx = dir.join(format!("{voice_id}.onnx"));
  let json = dir.join(format!("{voice_id}.onnx.json"));
  if !onnx.exists() || !json.exists() {
    return Err(format!("Voice model \"{voice_id}\" is not installed."));
  }
  Ok((onnx, json))
}

/// Synthesizes one chunk of text (a sentence or paragraph) to WAV bytes using
/// Piper. Piper has no persistent multi-request server mode (each invocation
/// reads stdin to EOF, synthesizes, and exits), so unlike Ollama/Whisper this
/// spawns fresh per chunk rather than keeping one process alive — synthesis
/// itself runs faster than real-time (~0.4x RTF measured), so process-start
/// overhead (~1.5s for model load) is the dominant cost. Callers should keep
/// a short lookahead queue rather than synthesizing strictly one-at-a-time to
/// hide that latency.
pub async fn synthesize(text: &str, voice_id: &str, speed: f32) -> Result<Vec<u8>, String> {
  let piper = piper_exe_path()?;
  let (model, config) = voice_model_path(voice_id)?;
  let espeak_data = piper.parent().unwrap().join("espeak-ng-data");

  // Piper's --length_scale is inverse to playback speed: >1 slows speech
  // down, <1 speeds it up. Clamp to a sane range so a bad value can't hang
  // synthesis or produce garbled output.
  let length_scale = (1.0 / speed.clamp(0.5, 3.0)).clamp(0.33, 2.0);

  // Audio goes to a temp file, not stdout: piper's stdout on Windows is in
  // text mode and turns every 0x0A byte into 0x0D 0x0A, which corrupts the
  // WAV samples into crackle and static.
  let wav_path = std::env::temp_dir().join(format!("udaan-tts-{}-{}.wav", std::process::id(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0)));
  let mut child = crate::engine::process::hidden_async(&piper);
  child
    .arg("--model")
    .arg(&model)
    .arg("--config")
    .arg(&config)
    .arg("--espeak_data")
    .arg(&espeak_data)
    .arg("--length_scale")
    .arg(length_scale.to_string())
    .arg("--output_file")
    .arg(&wav_path)
    .arg("--quiet")
    .stdin(Stdio::piped())
    .stdout(Stdio::piped())
    .stderr(Stdio::piped())
    .kill_on_drop(true);
  #[cfg(windows)]
  child.creation_flags(0x0800_0000); // CREATE_NO_WINDOW: no console flash per sentence
  let mut child = child.spawn().map_err(|e| format!("Failed to spawn piper: {e}"))?;

  let mut stdin = child.stdin.take().expect("stdin piped");
  stdin
    .write_all(text.as_bytes())
    .await
    .map_err(|e| format!("Failed to write text to piper: {e}"))?;
  drop(stdin);

  // On a slow/low-memory machine, model load + inference can take far
  // longer than the ~1.5-2.5s measured on a normal machine, or the process
  // can hang outright under memory pressure. Without a timeout, a stuck
  // synthesis call leaves the frontend waiting on this promise forever —
  // it reads as "nothing happens when I hit play" with no error, rather
  // than a slow-but-working system. 30s is generous for one sentence even
  // on constrained hardware; a real hang should fail loudly well before
  // then rather than block the playback queue indefinitely.
  let wait_result = tokio::time::timeout(std::time::Duration::from_secs(30), child.wait_with_output()).await;

  let output = match wait_result {
    Ok(result) => result.map_err(|e| format!("Failed waiting for piper: {e}"))?,
    Err(_) => {
      return Err(
        "Speech synthesis timed out after 30s — this can happen on a slow or memory-constrained machine. Try closing other apps, or pick a shorter chunk of text.".into(),
      );
    }
  };

  let audio = std::fs::read(&wav_path);
  let _ = std::fs::remove_file(&wav_path);
  if !output.status.success() {
    let stderr = String::from_utf8_lossy(&output.stderr);
    return Err(format!("Piper synthesis failed: {stderr}"));
  }
  match audio {
    Ok(bytes) if bytes.len() > 44 => Ok(bytes),
    _ => Err("Piper produced no audio output".into()),
  }
}
