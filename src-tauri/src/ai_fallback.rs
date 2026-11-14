//! A last-resort AI backend: the signed-in Claude CLI, run headless. Used
//! when OmniRoute has no provider that answers, so chat, the news brief and
//! research still work (slower, but they work).

use std::process::Stdio;
use std::time::Duration;
use tokio::io::AsyncWriteExt;
use tokio::process::Command;

#[tauri::command]
pub async fn ai_claude_complete(
  system: Option<String>,
  prompt: String,
  model: Option<String>,
  images: Option<Vec<String>>,
  timeout_secs: Option<u64>,
) -> Result<String, String> {
  let images = images.unwrap_or_default();
  let mut cmd = crate::engine::process::hidden_async(crate::claude_code::exe::resolve("claude"));
  cmd
    .arg("-p")
    .args(["--model", model.as_deref().unwrap_or("haiku")])
    // No hooks, plugins, MCP servers, tools or saved session: a plain completion.
    .args(["--setting-sources", ""])
    .arg("--strict-mcp-config")
    .arg("--no-session-persistence")
    // Attached pictures are the one exception to "no tools": read-only
    // access to exactly those files so Claude can look at them.
    .args(if images.is_empty() { vec!["--tools", ""] } else { vec!["--tools", "Read", "--allowedTools", "Read"] })
    .args(["--output-format", "text"]);
  for dir in images.iter().filter_map(|p| std::path::Path::new(p).parent()) {
    cmd.arg("--add-dir").arg(dir);
  }
  let prompt = if images.is_empty() {
    prompt
  } else {
    format!("The user attached {} image(s). Look at each one with the Read tool before answering:
{}

{prompt}", images.len(), images.join("
"))
  };
  // Instructions travel with the prompt on stdin: `claude` is a .cmd shim,
  // and Windows refuses batch-file arguments containing quotes or line breaks.
  let prompt = match system.filter(|s| !s.trim().is_empty()) {
    Some(sys) => format!("<instructions>
{sys}
</instructions>

{prompt}"),
    None => prompt,
  };
  #[cfg(windows)]
  cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
  let mut child = cmd
    .stdin(Stdio::piped())
    .stdout(Stdio::piped())
    .stderr(Stdio::piped())
    .kill_on_drop(true)
    .spawn()
    .map_err(|e| format!("Couldn't start the Claude CLI: {e}"))?;
  if let Some(mut stdin) = child.stdin.take() {
    stdin.write_all(prompt.as_bytes()).await.map_err(|e| e.to_string())?;
  }
  // The news brief sends a much larger prompt than a chat turn and needs
  // longer than the interactive default.
  let limit = timeout_secs.unwrap_or(180).clamp(30, 900);
  let out = tokio::time::timeout(Duration::from_secs(limit), child.wait_with_output())
    .await
    .map_err(|_| "Claude took too long to answer.".to_string())?
    .map_err(|e| e.to_string())?;
  if !out.status.success() {
    let err = String::from_utf8_lossy(&out.stderr);
    return Err(format!("Claude CLI failed: {}", err.trim().lines().last().unwrap_or("unknown error")));
  }
  Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

/// Saves an image the user attached to a chat (pasted, dropped or picked)
/// under the app's data folder and returns its path.
#[tauri::command]
pub fn chat_save_image(app: tauri::AppHandle, bytes: Vec<u8>, extension: String) -> Result<String, String> {
  use tauri::Manager;
  let ext: String = extension.chars().filter(|c| c.is_ascii_alphanumeric()).take(5).collect::<String>().to_lowercase();
  let ext = if ["png", "jpg", "jpeg", "gif", "webp", "bmp"].contains(&ext.as_str()) { ext } else { "png".into() };
  let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("chat-images");
  std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
  let name = format!("{}.{ext}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0));
  let path = dir.join(name);
  std::fs::write(&path, bytes).map_err(|e| e.to_string())?;
  Ok(path.to_string_lossy().into_owned())
}

/// Downloads a generated image into the chat-images folder, so it stays in
/// the conversation even after the generator's link expires.
#[tauri::command]
pub async fn chat_download_image(app: tauri::AppHandle, url: String) -> Result<String, String> {
  if !url.starts_with("https://image.pollinations.ai/") {
    return Err("Only generated images can be saved this way".into());
  }
  let bytes = reqwest::Client::new()
    .get(&url)
    .timeout(std::time::Duration::from_secs(120))
    .send()
    .await
    .map_err(|e| format!("Image generation failed: {e}"))?
    .error_for_status()
    .map_err(|e| format!("Image generation failed: {e}"))?
    .bytes()
    .await
    .map_err(|e| e.to_string())?;
  chat_save_image(app, bytes.to_vec(), "jpg".into())
}
