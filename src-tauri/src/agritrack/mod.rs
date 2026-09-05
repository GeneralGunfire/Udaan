//! AgriTrack: South African agricultural/weather/economic data collection.
//! This module owns only the SQLite schema + read path; the actual daily
//! data collection (Open-Meteo, NASA POWER, FAO water-stress/GDD math) is
//! a separate Python process under `agritrack-collector/`, invoked here
//! as a sidecar via `tauri-plugin-shell` so it can also run completely
//! standalone from Windows Task Scheduler with no Tauri involved.

mod store;

use std::sync::Arc;

use serde_json::Value;
use store::{Store, KNOWN_TABLES};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_shell::ShellExt;

pub struct AgriTrackState {
  store: Arc<Store>,
}

pub fn init(app: &AppHandle) -> Result<AgriTrackState, String> {
  let data_dir = app
    .path()
    .app_data_dir()
    .map_err(|e| format!("Failed to resolve app data dir: {e}"))?;
  std::fs::create_dir_all(&data_dir).map_err(|e| format!("Failed to create app data dir: {e}"))?;
  let db_path = data_dir.join("agritrack.sqlite3");

  let store = Arc::new(Store::open(db_path).map_err(|e| format!("Failed to open AgriTrack store: {e}"))?);
  Ok(AgriTrackState { store })
}

#[tauri::command]
pub fn agritrack_list_tables() -> Vec<&'static str> {
  KNOWN_TABLES.to_vec()
}

#[tauri::command]
pub fn agritrack_query_table(
  state: State<AgriTrackState>,
  table: String,
  date_from: Option<String>,
  date_to: Option<String>,
  province: Option<String>,
  crop_name: Option<String>,
  limit: Option<i64>,
) -> Result<Vec<Value>, String> {
  if !KNOWN_TABLES.contains(&table.as_str()) {
    return Err(format!("Unknown table: {table}"));
  }
  state
    .store
    .query_table(
      &table,
      date_from.as_deref(),
      date_to.as_deref(),
      province.as_deref(),
      crop_name.as_deref(),
      limit.unwrap_or(500),
    )
    .map_err(|e| e.to_string())
}

/// Every date with weather data, ascending — the map time slider's domain.
#[tauri::command]
pub fn agritrack_available_dates(state: State<AgriTrackState>) -> Result<Vec<String>, String> {
  state.store.available_dates().map_err(|e| e.to_string())
}

/// Nine province rows for one date, crop telemetry pre-aggregated.
#[tauri::command]
pub fn agritrack_province_snapshot(
  state: State<AgriTrackState>,
  date: String,
) -> Result<Vec<Value>, String> {
  state.store.province_snapshot(&date).map_err(|e| e.to_string())
}

/// Per-crop rows for one province on one date — the detail panel.
#[tauri::command]
pub fn agritrack_crop_detail(
  state: State<AgriTrackState>,
  province: String,
  date: String,
) -> Result<Vec<Value>, String> {
  state
    .store
    .crop_detail(&province, &date)
    .map_err(|e| e.to_string())
}

/// Runs the Python collector once, synchronously, for "today" — the
/// "Collect Now" button in the table-view frontend. The collector lives
/// alongside the Tauri source tree at `src-tauri/agritrack-collector/`
/// (a plain venv script, not bundled as a compiled sidecar binary, since
/// it also needs to run standalone under Windows Task Scheduler using
/// the same `python collector.py` invocation).
#[tauri::command]
pub async fn agritrack_run_collector_now(app: AppHandle, state: State<'_, AgriTrackState>) -> Result<Value, String> {
  let script_dir = app
    .path()
    .resource_dir()
    .ok()
    .map(|r| r.join("agritrack-collector"))
    .filter(|p| p.join("collector.py").exists())
    .unwrap_or_else(|| {
      // Dev mode: resource_dir isn't populated from a running `tauri dev`
      // session, so fall back to the source tree location relative to
      // the compiled exe's known dev cwd (src-tauri/).
      std::env::current_dir()
        .unwrap_or_default()
        .join("agritrack-collector")
    });

  let script_path = script_dir.join("collector.py");
  let output = app
    .shell()
    .command("python")
    .args([script_path.to_string_lossy().to_string()])
    .current_dir(script_dir)
    .output()
    .await
    .map_err(|e| format!("Failed to launch collector: {e}"))?;

  if !output.status.success() {
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    return Err(format!("Collector exited with error: {stderr}"));
  }

  state
    .store
    .latest_collection_log()
    .map_err(|e| e.to_string())?
    .ok_or_else(|| "Collector ran but wrote no collection_log row".to_string())
}
