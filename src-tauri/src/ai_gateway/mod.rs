//! The AI gateway: one place every AI request in Udaan goes through.
//!
//! Chat, OmniFind, the daily brief and the rest all ask `ai_chat`; they no longer know or care where the
//! answer comes from. The gateway tries providers in order and moves on when one fails:
//!
//!   1. OmniRoute, the local multi-provider router (started for you if it is installed but not running)
//!   2. Pollinations, a free service that needs no key
//!   3. any free-tier provider you added a key for (Groq, Cerebras, OpenRouter, Gemini, Mistral)
//!
//! A provider that fails is rested for a while (longer each time it fails again), so a dead one costs one
//! slow attempt, not one per question. Nothing here ever runs the Claude CLI: it spends your tokens.
//!
//! Keys are stored in `ai-gateway.json` in the app's data folder, on this PC only.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

/// OmniRoute's own local API key (see `~/.omniroute/.env`); it only opens a daemon bound to this PC.
const OMNIROUTE_KEY: &str = "sk-14107f74a8640555-65d45e-aab45f13";

struct Def {
  id: &'static str,
  name: &'static str,
  base: &'static str,
  /// The model asked for. Chosen for being free, fast and good at following instructions.
  model: &'static str,
  needs_key: bool,
  signup: &'static str,
}

const DEFS: &[Def] = &[
  Def { id: "omniroute", name: "OmniRoute (local)", base: "http://localhost:20128/v1/chat/completions", model: "auto/smart", needs_key: false, signup: "" },
  Def { id: "pollinations", name: "Pollinations (free, no key)", base: "https://text.pollinations.ai/openai", model: "openai", needs_key: false, signup: "" },
  Def { id: "groq", name: "Groq", base: "https://api.groq.com/openai/v1/chat/completions", model: "llama-3.3-70b-versatile", needs_key: true, signup: "https://console.groq.com/keys" },
  Def { id: "cerebras", name: "Cerebras", base: "https://api.cerebras.ai/v1/chat/completions", model: "llama-3.3-70b", needs_key: true, signup: "https://cloud.cerebras.ai" },
  Def { id: "openrouter", name: "OpenRouter (free models)", base: "https://openrouter.ai/api/v1/chat/completions", model: "meta-llama/llama-3.3-70b-instruct:free", needs_key: true, signup: "https://openrouter.ai/keys" },
  Def { id: "gemini", name: "Google Gemini", base: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", model: "gemini-2.0-flash", needs_key: true, signup: "https://aistudio.google.com/apikey" },
  Def { id: "mistral", name: "Mistral", base: "https://api.mistral.ai/v1/chat/completions", model: "mistral-small-latest", needs_key: true, signup: "https://console.mistral.ai/api-keys" },
];

#[derive(Default, Serialize, Deserialize, Clone)]
struct Config {
  #[serde(default)]
  keys: HashMap<String, String>,
  #[serde(default)]
  disabled: Vec<String>,
}

#[derive(Default)]
struct Health {
  fails: u32,
  rest_until: Option<Instant>,
  last_error: String,
  last_ok_ms: u64,
}

struct State {
  config: Mutex<Config>,
  health: Mutex<HashMap<&'static str, Health>>,
  file: Mutex<Option<std::path::PathBuf>>,
  last_provider: Mutex<String>,
}

fn state() -> &'static State {
  static S: OnceLock<State> = OnceLock::new();
  S.get_or_init(|| State { config: Mutex::new(Config::default()), health: Mutex::new(HashMap::new()), file: Mutex::new(None), last_provider: Mutex::new(String::new()) })
}

fn client() -> &'static reqwest::Client {
  static C: OnceLock<reqwest::Client> = OnceLock::new();
  C.get_or_init(|| reqwest::Client::builder().connect_timeout(Duration::from_secs(8)).build().unwrap_or_default())
}

/// Reads the saved keys. Called once at startup.
pub fn init(app: &AppHandle) {
  let Ok(dir) = app.path().app_data_dir() else { return };
  let _ = std::fs::create_dir_all(&dir);
  let file = dir.join("ai-gateway.json");
  if let Ok(text) = std::fs::read_to_string(&file) {
    if let Ok(cfg) = serde_json::from_str::<Config>(&text) {
      *state().config.lock().unwrap() = cfg;
    }
  }
  *state().file.lock().unwrap() = Some(file);
}

fn save() {
  let Some(file) = state().file.lock().unwrap().clone() else { return };
  let cfg = state().config.lock().unwrap().clone();
  if let Ok(json) = serde_json::to_string_pretty(&cfg) {
    let _ = std::fs::write(file, json);
  }
}

fn now_ms() -> u64 {
  std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

// ---------------------------------------------------------------------------------------------------
// OmniRoute: make sure it is running
// ---------------------------------------------------------------------------------------------------

async fn omniroute_up() -> bool {
  client()
    .get("http://localhost:20128/v1/models")
    .bearer_auth(OMNIROUTE_KEY)
    .timeout(Duration::from_secs(2))
    .send()
    .await
    .map(|r| r.status().is_success())
    .unwrap_or(false)
}

/// Starts OmniRoute if it is installed and not running. Safe to call any time.
async fn ensure_omniroute() -> bool {
  if omniroute_up().await {
    return true;
  }
  let cmd = if cfg!(windows) { "omniroute.cmd" } else { "omniroute" };
  let started = crate::engine::process::hidden_async(cmd.to_string())
    .args(["serve", "--daemon", "--no-open"])
    .stdout(std::process::Stdio::null())
    .stderr(std::process::Stdio::null())
    .status()
    .await
    .map(|s| s.success())
    .unwrap_or(false);
  if !started {
    return false;
  }
  for _ in 0..16 {
    tokio::time::sleep(Duration::from_millis(500)).await;
    if omniroute_up().await {
      return true;
    }
  }
  false
}

/// At startup: get OmniRoute ready in the background so the first question is not the one that waits for it.
pub async fn boot() {
  let _ = ensure_omniroute().await;
}

// ---------------------------------------------------------------------------------------------------
// The request
// ---------------------------------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatReq {
  pub messages: Vec<Value>,
  #[serde(default)]
  pub tools: Option<Value>,
  #[serde(default)]
  pub temperature: Option<f64>,
  #[serde(default)]
  pub max_tokens: Option<u32>,
  /// When set, text is announced as it arrives (`ai://delta`) under this id.
  #[serde(default)]
  pub stream_id: Option<String>,
  #[serde(default)]
  pub timeout_secs: Option<u64>,
  /// Only try this provider (used by the Settings "Test" button).
  #[serde(default)]
  pub only: Option<String>,
  /// Pictures to show the model (file paths), attached to the last user message.
  #[serde(default)]
  pub images: Option<Vec<String>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatOut {
  pub content: String,
  pub tool_calls: Option<Value>,
  pub provider: String,
  pub model: String,
}

fn rest_for(fails: u32) -> Duration {
  Duration::from_secs((30u64 << fails.min(5)).min(600))
}

fn mark_fail(id: &'static str, why: &str, retry_after: Option<u64>) {
  let mut h = state().health.lock().unwrap();
  let e = h.entry(id).or_default();
  e.fails += 1;
  e.last_error = why.chars().take(160).collect();
  e.rest_until = Some(Instant::now() + retry_after.map(Duration::from_secs).unwrap_or_else(|| rest_for(e.fails)));
}

fn mark_ok(id: &'static str) {
  let mut h = state().health.lock().unwrap();
  let e = h.entry(id).or_default();
  e.fails = 0;
  e.rest_until = None;
  e.last_error.clear();
  e.last_ok_ms = now_ms();
  *state().last_provider.lock().unwrap() = id.to_string();
}

fn resting(id: &'static str) -> bool {
  state().health.lock().unwrap().get(id).and_then(|h| h.rest_until).map(|t| Instant::now() < t).unwrap_or(false)
}

/// One attempt at one provider. `Err` carries (reason, optional retry-after seconds).
/// The messages as sent: with any pictures attached to the last user message as data URLs.
fn messages_with_images(req: &ChatReq) -> Vec<Value> {
  let mut msgs = req.messages.clone();
  let Some(paths) = req.images.as_ref().filter(|p| !p.is_empty()) else { return msgs };
  use base64::Engine;
  let parts: Vec<Value> = paths
    .iter()
    .filter_map(|p| {
      let bytes = std::fs::read(p).ok()?;
      let ext = std::path::Path::new(p).extension().and_then(|e| e.to_str()).unwrap_or("png").to_lowercase();
      let mime = match ext.as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        _ => "image/png",
      };
      Some(json!({ "type": "image_url", "image_url": { "url": format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes)) } }))
    })
    .collect();
  if let Some(last) = msgs.iter_mut().rev().find(|m| m["role"] == "user") {
    let text = last["content"].as_str().unwrap_or("").to_string();
    let mut content = vec![json!({ "type": "text", "text": text })];
    content.extend(parts);
    last["content"] = Value::Array(content);
  }
  msgs
}

async fn attempt(app: &AppHandle, d: &Def, key: Option<String>, req: &ChatReq) -> Result<ChatOut, (String, Option<u64>)> {
  let streaming = req.stream_id.is_some() && req.tools.is_none();
  let mut body = json!({ "model": d.model, "messages": messages_with_images(req), "stream": streaming });
  if let Some(t) = req.temperature {
    body["temperature"] = json!(t);
  }
  if let Some(m) = req.max_tokens {
    body["max_tokens"] = json!(m);
  }
  if let Some(tools) = &req.tools {
    body["tools"] = tools.clone();
  }
  let mut rb = client().post(d.base).timeout(Duration::from_secs(req.timeout_secs.unwrap_or(90).clamp(10, 600))).json(&body);
  match (d.id, key) {
    ("omniroute", _) => rb = rb.bearer_auth(OMNIROUTE_KEY),
    (_, Some(k)) => rb = rb.bearer_auth(k),
    _ => {}
  }
  let mut res = rb.send().await.map_err(|e| (format!("could not connect: {e}"), None))?;
  let status = res.status();
  if !status.is_success() {
    let retry = res.headers().get("retry-after").and_then(|v| v.to_str().ok()).and_then(|v| v.parse::<u64>().ok());
    let text = res.text().await.unwrap_or_default();
    return Err((format!("{status} {}", text.chars().take(140).collect::<String>()), retry));
  }

  if !streaming {
    let v: Value = res.json().await.map_err(|e| (format!("unreadable answer: {e}"), None))?;
    let msg = &v["choices"][0]["message"];
    let content = msg["content"].as_str().unwrap_or("").to_string();
    let calls = msg.get("tool_calls").filter(|c| c.as_array().map(|a| !a.is_empty()).unwrap_or(false)).cloned();
    if content.trim().is_empty() && calls.is_none() {
      return Err(("empty answer".into(), None));
    }
    return Ok(ChatOut { content, tool_calls: calls, provider: d.id.into(), model: d.model.into() });
  }

  // Server-sent events: lines of `data: {json}`; the text arrives in choices[0].delta.content.
  let id = req.stream_id.clone().unwrap_or_default();
  let mut content = String::new();
  let mut buf = String::new();
  loop {
    let chunk = res.chunk().await.map_err(|e| (format!("stream broke: {e}"), None))?;
    let Some(chunk) = chunk else { break };
    buf.push_str(&String::from_utf8_lossy(&chunk));
    while let Some(nl) = buf.find('\n') {
      let line = buf[..nl].trim().to_string();
      buf.drain(..=nl);
      let Some(data) = line.strip_prefix("data:") else { continue };
      let data = data.trim();
      if data == "[DONE]" {
        continue;
      }
      if let Ok(v) = serde_json::from_str::<Value>(data) {
        if let Some(t) = v["choices"][0]["delta"]["content"].as_str() {
          if !t.is_empty() {
            content.push_str(t);
            let _ = app.emit("ai://delta", json!({ "id": id, "text": t }));
          }
        }
      }
    }
  }
  if content.trim().is_empty() {
    return Err(("empty answer".into(), None));
  }
  Ok(ChatOut { content, tool_calls: None, provider: d.id.into(), model: d.model.into() })
}

#[tauri::command]
pub async fn ai_chat(app: AppHandle, req: ChatReq) -> Result<ChatOut, String> {
  let cfg = state().config.lock().unwrap().clone();
  let mut tried: Vec<String> = Vec::new();
  for d in DEFS {
    if let Some(only) = &req.only {
      if only != d.id {
        continue;
      }
    } else if cfg.disabled.iter().any(|x| x == d.id) || resting(d.id) {
      continue;
    }
    let key = cfg.keys.get(d.id).filter(|k| !k.trim().is_empty()).cloned();
    if d.needs_key && key.is_none() {
      continue;
    }
    if d.id == "omniroute" && !ensure_omniroute().await {
      mark_fail(d.id, "not running and could not be started", None);
      tried.push(format!("{}: not running", d.name));
      continue;
    }
    match attempt(&app, d, key, &req).await {
      Ok(out) => {
        mark_ok(d.id);
        return Ok(out);
      }
      Err((why, retry)) => {
        mark_fail(d.id, &why, retry);
        tried.push(format!("{}: {why}", d.name));
      }
    }
  }
  Err(if tried.is_empty() { "No AI provider is available. Add a free key in Settings > AI, or install OmniRoute.".to_string() } else { format!("Every AI provider failed. {}", tried.join(" | ")) })
}

// ---------------------------------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderInfo {
  id: &'static str,
  name: &'static str,
  model: &'static str,
  needs_key: bool,
  has_key: bool,
  enabled: bool,
  /// ok, resting, failing or idle
  state: &'static str,
  last_error: String,
  signup: &'static str,
  last_ok_ms: u64,
}

#[tauri::command]
pub fn ai_providers() -> Vec<ProviderInfo> {
  let cfg = state().config.lock().unwrap().clone();
  let health = state().health.lock().unwrap();
  DEFS
    .iter()
    .map(|d| {
      let h = health.get(d.id);
      let st = match h {
        Some(h) if h.rest_until.map(|t| Instant::now() < t).unwrap_or(false) => "resting",
        Some(h) if h.fails > 0 => "failing",
        Some(h) if h.last_ok_ms > 0 => "ok",
        _ => "idle",
      };
      ProviderInfo {
        id: d.id,
        name: d.name,
        model: d.model,
        needs_key: d.needs_key,
        has_key: cfg.keys.get(d.id).map(|k| !k.trim().is_empty()).unwrap_or(false),
        enabled: !cfg.disabled.iter().any(|x| x == d.id),
        state: st,
        last_error: h.map(|h| h.last_error.clone()).unwrap_or_default(),
        signup: d.signup,
        last_ok_ms: h.map(|h| h.last_ok_ms).unwrap_or(0),
      }
    })
    .collect()
}

#[tauri::command]
pub fn ai_provider_set(id: String, key: Option<String>, enabled: Option<bool>) {
  {
    let mut cfg = state().config.lock().unwrap();
    if let Some(k) = key {
      cfg.keys.insert(id.clone(), k.trim().to_string());
    }
    if let Some(on) = enabled {
      cfg.disabled.retain(|x| *x != id);
      if !on {
        cfg.disabled.push(id.clone());
      }
    }
  }
  // A changed key or a re-enable deserves a fresh try straight away.
  if let Some(d) = DEFS.iter().find(|d| d.id == id) {
    if let Some(h) = state().health.lock().unwrap().get_mut(d.id) {
      h.rest_until = None;
    }
  }
  save();
}

/// Sends a one-word question to a single provider and reports how long it took.
#[tauri::command]
pub async fn ai_provider_test(app: AppHandle, id: String) -> Result<u64, String> {
  let t = Instant::now();
  let req = ChatReq { messages: vec![json!({"role":"user","content":"Reply with the single word: ok"})], tools: None, temperature: Some(0.0), max_tokens: Some(8), stream_id: None, timeout_secs: Some(25), only: Some(id), images: None };
  ai_chat(app, req).await.map(|_| t.elapsed().as_millis() as u64)
}

/// Which provider answered last, for a small status chip in the apps.
#[tauri::command]
pub fn ai_last_provider() -> String {
  state().last_provider.lock().unwrap().clone()
}
