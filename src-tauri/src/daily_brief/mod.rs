//! Backend for the automatic daily news brief: persistence + "is today's
//! report ready yet" scheduling checks, and raw RSS-feed fetching.
//!
//! RSS fetching specifically has to happen here, not via the frontend's
//! own `fetch()` (the original design) — RSS feeds are meant to be
//! consumed by servers/readers, not browsers, so almost none of them send
//! `Access-Control-Allow-Origin`, and a plain browser `fetch()` from
//! inside the webview is silently blocked by CORS regardless of Tauri's
//! own CSP config (confirmed directly: curl outside the webview succeeded
//! against every feed, while the exact same URLs failed with "TypeError:
//! Failed to fetch" from inside the app). Rust's HTTP client is not a
//! browser and isn't subject to CORS at all, so fetching the raw feed XML
//! here and handing the text back to the frontend sidesteps the problem
//! entirely. XML parsing itself stays in TypeScript (`DOMParser`, already
//! working correctly) rather than pulling in an XML crate here — only the
//! actual network fetch needed to move.
//!
//! OmniRoute summarization stays in the frontend (`chat()` in
//! `src/integrations/omniroute`) since that already talks to a local
//! `localhost` daemon, which has no CORS restriction to begin with.

mod store;

use std::sync::Arc;
use std::time::Duration;

use chrono::Local;
pub use store::{BriefHistoryEntry, DailyBrief};
use store::Store;
use tauri::{AppHandle, Manager, State};

const FEED_FETCH_TIMEOUT_SECS: u64 = 20;

pub struct DailyBriefState {
  store: Arc<Store>,
}

pub fn init(app: &AppHandle) -> Result<DailyBriefState, String> {
  let data_dir = app
    .path()
    .app_data_dir()
    .map_err(|e| format!("Failed to resolve app data dir: {e}"))?;
  std::fs::create_dir_all(&data_dir).map_err(|e| format!("Failed to create app data dir: {e}"))?;
  let db_path = data_dir.join("daily_brief.sqlite3");

  let store = Arc::new(Store::open(db_path).map_err(|e| format!("Failed to open daily_brief store: {e}"))?);
  Ok(DailyBriefState { store })
}

fn today() -> String {
  Local::now().format("%Y-%m-%d").to_string()
}

/// Fetches today's brief, if one has already been generated (or attempted)
/// today. `None` means "nothing for today yet — the frontend should run
/// the generation pipeline now," which covers both the 5am-scheduled case
/// and the "Udaan wasn't running at 5am, generate on next launch instead"
/// case identically: there's no separate "missed schedule" state to
/// track, just "does today have a row."
#[tauri::command]
pub fn daily_brief_get_today(state: State<DailyBriefState>) -> Result<Option<DailyBrief>, String> {
  state.store.get(&today()).map_err(|e| e.to_string())
}

/// Fetches a specific past date's brief, for the News Brief app's history
/// view. Returns the full stored row (including the degraded flag) so a
/// past degraded day still shows its notice correctly when revisited.
#[tauri::command]
pub fn daily_brief_get_by_date(state: State<DailyBriefState>, date: String) -> Result<Option<DailyBrief>, String> {
  state.store.get(&date).map_err(|e| e.to_string())
}

/// Most-recent-first list of every date a brief exists for — backs the
/// News Brief app's history sidebar.
#[tauri::command]
pub fn daily_brief_list_history(state: State<DailyBriefState>) -> Result<Vec<BriefHistoryEntry>, String> {
  state.store.list_history().map_err(|e| e.to_string())
}

/// Persists a generated (or attempted-but-failed) brief for today. Called
/// by the frontend after running the fetch+summarize pipeline, whether it
/// fully succeeded, degraded to raw headlines, or failed outright —
/// `generation_attempted: true` is what prevents retrying every single
/// time the app opens on a day every backend was genuinely down.
#[tauri::command]
pub fn daily_brief_save(
  state: State<DailyBriefState>,
  report_markdown: Option<String>,
  raw_items_json: String,
  degraded: bool,
  degraded_reason: Option<String>,
) -> Result<(), String> {
  let brief = DailyBrief {
    date: today(),
    report_markdown,
    raw_items_json,
    generation_attempted: true,
    degraded,
    degraded_reason,
    generated_at: chrono::Utc::now().to_rfc3339(),
  };
  state.store.upsert(&brief).map_err(|e| e.to_string())
}

/// Wipes every stored brief — used when the user wants to clear history
/// and regenerate from scratch.
#[tauri::command]
pub fn daily_brief_delete_all(state: State<DailyBriefState>) -> Result<(), String> {
  state.store.delete_all().map_err(|e| e.to_string())
}

/// Fetches one RSS/Atom feed's raw XML text, bypassing the browser CORS
/// restriction the frontend's own `fetch()` hits against almost every real
/// feed (see the module doc comment above). Returns the raw body text on
/// success; the frontend still owns all parsing (`DOMParser`) and the
/// per-item 36h/72h window filtering. Errors are returned as `Err` rather
/// than swallowed here — the frontend's own per-feed try/catch already
/// treats one failed feed as "contributes nothing," matching the existing
/// resilience design without duplicating it here.
#[tauri::command]
pub async fn daily_brief_fetch_feed(url: String) -> Result<String, String> {
  let client = reqwest::Client::builder()
    .timeout(Duration::from_secs(FEED_FETCH_TIMEOUT_SECS))
    .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Udaan/1.0 (RSS reader)")
    .build()
    .map_err(|e| format!("Failed to build HTTP client: {e}"))?;

  let response = client.get(&url).send().await.map_err(|e| {
    // reqwest::Error's own Display hides the actual underlying cause
    // (DNS failure, TLS error, connection refused, etc.) behind a generic
    // "error sending request for url" — walking the source chain surfaces
    // what's actually wrong instead of that useless summary.
    let mut detail = e.to_string();
    let mut source = std::error::Error::source(&e);
    while let Some(err) = source {
      detail.push_str(&format!(" -> {err}"));
      source = err.source();
    }
    format!("Request failed: {detail}")
  })?;
  if !response.status().is_success() {
    return Err(format!("HTTP {}", response.status()));
  }
  response.text().await.map_err(|e| format!("Failed to read response body: {e}"))
}
