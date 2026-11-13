//! Read-only Claude Code token usage dashboard — parses the CLI's own local
//! session logs under `~/.claude/projects/<sanitized-cwd>/*.jsonl` (one JSON
//! object per line; only `type=="assistant"` lines carry a `usage` block).
//! NEVER writes to or modifies anything under `~/.claude/` — this module
//! only ever opens files for reading.
//!
//! Deliberately does NOT shell out to the `ccusage` CLI: the JSONL format
//! is simple and fully understood, so depending on an external tool being
//! installed would only add a fragile, unnecessary dependency. Also does
//! NOT attempt to reconstruct plan-level rolling-window/budget-remaining
//! stats — that information is enforced server-side and isn't present
//! anywhere in the local logs; this is a reporting dashboard over real,
//! derivable totals only (token counts, per-project breakdown, sessions).

use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct TokenTotals {
  pub input_tokens: u64,
  pub output_tokens: u64,
  pub cache_creation_tokens: u64,
  pub cache_read_tokens: u64,
}

impl TokenTotals {
  fn add(&mut self, other: &TokenTotals) {
    self.input_tokens += other.input_tokens;
    self.output_tokens += other.output_tokens;
    self.cache_creation_tokens += other.cache_creation_tokens;
    self.cache_read_tokens += other.cache_read_tokens;
  }

  fn total(&self) -> u64 {
    self.input_tokens + self.output_tokens + self.cache_creation_tokens + self.cache_read_tokens
  }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectUsage {
  /// Human-readable best-effort project name, derived from the sanitized
  /// folder name (`/` and `:` both become `-` in the real path, so this is
  /// a heuristic display name, not a guaranteed-exact reconstruction).
  pub name: String,
  pub totals: TokenTotals,
  pub session_count: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionUsage {
  pub session_id: String,
  pub project_name: String,
  pub started_at: String,
  pub ended_at: String,
  pub totals: TokenTotals,
  pub primary_model: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UsageReport {
  pub today: TokenTotals,
  pub this_week: TokenTotals,
  pub all_time: TokenTotals,
  pub projects: Vec<ProjectUsage>,
  pub recent_sessions: Vec<SessionUsage>,
  /// Unix millis this report was computed — lets the frontend show "as of" freshness without a second command round-trip.
  pub computed_at_ms: u64,
}

const CACHE_TTL_SECS: u64 = 60;
const MAX_RECENT_SESSIONS: usize = 50;

pub struct ClaudeUsageState {
  cache: Mutex<Option<(Instant, UsageReport)>>,
}

impl Default for ClaudeUsageState {
  fn default() -> Self {
    Self { cache: Mutex::new(None) }
  }
}

#[derive(Debug, Deserialize)]
struct RawUsage {
  input_tokens: Option<u64>,
  output_tokens: Option<u64>,
  cache_creation_input_tokens: Option<u64>,
  cache_read_input_tokens: Option<u64>,
}

#[derive(Debug, Deserialize)]
struct RawMessage {
  model: Option<String>,
  usage: Option<RawUsage>,
}

#[derive(Debug, Deserialize)]
struct RawLine {
  #[serde(rename = "type")]
  line_type: Option<String>,
  message: Option<RawMessage>,
  timestamp: Option<String>,
  #[serde(rename = "sessionId")]
  session_id: Option<String>,
}

/// Turns a sanitized project-folder name (e.g. `c--Udaan`) into a
/// best-effort readable display name (`C:\Udaan`) — the real sanitization
/// replaces both `/` and `:` with `-`, so this is a heuristic reversal
/// (assumes a Windows-style `<drive>--<rest>` prefix) rather than a
/// guaranteed-exact one; falling back to the raw folder name for anything
/// that doesn't match keeps this safe for non-Windows-shaped folder names.
fn readable_project_name(folder_name: &str) -> String {
  if let Some(rest) = folder_name.strip_prefix(|c: char| c.is_ascii_alphabetic()) {
    if let Some(stripped) = rest.strip_prefix("--") {
      let drive = folder_name.chars().next().unwrap().to_ascii_uppercase();
      return format!("{drive}:\\{}", stripped.replace('-', "\\"));
    }
  }
  folder_name.replace('-', "/")
}

struct ParsedLine {
  timestamp: DateTime<Utc>,
  session_id: String,
  model: String,
  usage: TokenTotals,
}

fn parse_jsonl_file(path: &PathBuf) -> Vec<ParsedLine> {
  let file = match std::fs::File::open(path) {
    Ok(f) => f,
    Err(_) => return Vec::new(),
  };
  let reader = BufReader::new(file);
  let mut out = Vec::new();

  for line in reader.lines() {
    // A malformed/partially-written line (Claude Code can be writing this
    // file live) is skipped rather than aborting the whole file — this is
    // best-effort telemetry reading, not a critical data path.
    let Ok(line) = line else { continue };
    if line.trim().is_empty() {
      continue;
    }
    let Ok(raw) = serde_json::from_str::<RawLine>(&line) else { continue };
    if raw.line_type.as_deref() != Some("assistant") {
      continue;
    }
    let Some(message) = raw.message else { continue };
    let Some(usage) = message.usage else { continue };
    let Some(timestamp_str) = raw.timestamp else { continue };
    let Ok(timestamp) = DateTime::parse_from_rfc3339(&timestamp_str) else { continue };
    let Some(session_id) = raw.session_id else { continue };

    out.push(ParsedLine {
      timestamp: timestamp.with_timezone(&Utc),
      session_id,
      model: message.model.unwrap_or_else(|| "unknown".to_string()),
      usage: TokenTotals {
        input_tokens: usage.input_tokens.unwrap_or(0),
        output_tokens: usage.output_tokens.unwrap_or(0),
        cache_creation_tokens: usage.cache_creation_input_tokens.unwrap_or(0),
        cache_read_tokens: usage.cache_read_input_tokens.unwrap_or(0),
      },
    });
  }
  out
}

fn compute_report(projects_dir: &PathBuf) -> UsageReport {
  let now = Utc::now();
  let today_start = now.date_naive().and_hms_opt(0, 0, 0).unwrap().and_utc();
  let week_start = now - Duration::days(7);

  let mut today = TokenTotals::default();
  let mut this_week = TokenTotals::default();
  let mut all_time = TokenTotals::default();
  let mut project_totals: HashMap<String, ProjectUsage> = HashMap::new();
  // sessionId -> (project name, first/last timestamp, totals, model counts)
  let mut sessions: HashMap<String, (String, DateTime<Utc>, DateTime<Utc>, TokenTotals, HashMap<String, u64>)> =
    HashMap::new();

  let Ok(project_dirs) = std::fs::read_dir(projects_dir) else {
    return UsageReport {
      today,
      this_week,
      all_time,
      projects: Vec::new(),
      recent_sessions: Vec::new(),
      computed_at_ms: SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as u64,
    };
  };

  for project_entry in project_dirs.filter_map(|e| e.ok()) {
    let project_path = project_entry.path();
    if !project_path.is_dir() {
      continue;
    }
    let folder_name = project_entry.file_name().to_string_lossy().into_owned();
    let display_name = readable_project_name(&folder_name);

    let mut project_seen_sessions: std::collections::HashSet<String> = std::collections::HashSet::new();

    let Ok(files) = std::fs::read_dir(&project_path) else { continue };
    for file_entry in files.filter_map(|e| e.ok()) {
      let file_path = file_entry.path();
      if file_path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
        continue;
      }

      for line in parse_jsonl_file(&file_path) {
        all_time.add(&line.usage);
        if line.timestamp >= today_start {
          today.add(&line.usage);
        }
        if line.timestamp >= week_start {
          this_week.add(&line.usage);
        }

        let project_entry = project_totals.entry(display_name.clone()).or_insert_with(|| ProjectUsage {
          name: display_name.clone(),
          totals: TokenTotals::default(),
          session_count: 0,
        });
        project_entry.totals.add(&line.usage);
        if project_seen_sessions.insert(line.session_id.clone()) {
          project_entry.session_count += 1;
        }

        let session_entry = sessions.entry(line.session_id.clone()).or_insert_with(|| {
          (display_name.clone(), line.timestamp, line.timestamp, TokenTotals::default(), HashMap::new())
        });
        session_entry.1 = session_entry.1.min(line.timestamp);
        session_entry.2 = session_entry.2.max(line.timestamp);
        session_entry.3.add(&line.usage);
        *session_entry.4.entry(line.model.clone()).or_insert(0) += 1;
      }
    }
  }

  let mut projects: Vec<ProjectUsage> = project_totals.into_values().collect();
  projects.sort_by(|a, b| b.totals.total().cmp(&a.totals.total()));

  let mut recent_sessions: Vec<SessionUsage> = sessions
    .into_iter()
    .map(|(session_id, (project_name, started, ended, totals, model_counts))| {
      let primary_model = model_counts
        .into_iter()
        .max_by_key(|(_, count)| *count)
        .map(|(model, _)| model)
        .unwrap_or_else(|| "unknown".to_string());
      SessionUsage {
        session_id,
        project_name,
        started_at: started.to_rfc3339(),
        ended_at: ended.to_rfc3339(),
        totals,
        primary_model,
      }
    })
    .collect();
  recent_sessions.sort_by(|a, b| b.ended_at.cmp(&a.ended_at));
  recent_sessions.truncate(MAX_RECENT_SESSIONS);

  UsageReport {
    today,
    this_week,
    all_time,
    projects,
    recent_sessions,
    computed_at_ms: SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as u64,
  }
}

fn claude_projects_dir() -> Result<PathBuf, String> {
  let home = dirs::home_dir().ok_or("Couldn't resolve the home directory")?;
  Ok(home.join(".claude").join("projects"))
}

/// Returns cached usage stats if computed within the last `CACHE_TTL_SECS`,
/// otherwise re-parses every session log under `~/.claude/projects/` and
/// caches the result. Pass `force_refresh: true` (the dashboard's manual
/// refresh button) to bypass the cache regardless of its age.
#[tauri::command]
pub fn claude_usage_get_report(state: tauri::State<ClaudeUsageState>, force_refresh: bool) -> Result<UsageReport, String> {
  {
    let cache = state.cache.lock().unwrap();
    if !force_refresh {
      if let Some((computed_at, report)) = cache.as_ref() {
        if computed_at.elapsed().as_secs() < CACHE_TTL_SECS {
          return Ok(report.clone());
        }
      }
    }
  }

  let projects_dir = claude_projects_dir()?;
  let report = compute_report(&projects_dir);

  let mut cache = state.cache.lock().unwrap();
  *cache = Some((Instant::now(), report.clone()));
  Ok(report)
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn readable_project_name_reverses_windows_style_sanitization() {
    assert_eq!(readable_project_name("c--Udaan"), "C:\\Udaan");
    assert_eq!(readable_project_name("c--CODING-InDevelopment-City"), "C:\\CODING\\InDevelopment\\City");
  }

  #[test]
  fn parse_jsonl_file_skips_non_assistant_and_malformed_lines() {
    let dir = std::env::temp_dir().join(format!("udaan_claude_usage_test_{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).unwrap();
    let file_path = dir.join("session.jsonl");
    std::fs::write(
      &file_path,
      concat!(
        r#"{"type":"bridge-session","sessionId":"s1"}"#, "\n",
        "not even json\n",
        r#"{"type":"assistant","sessionId":"s1","timestamp":"2026-08-29T12:00:00.000Z","message":{"model":"claude-sonnet-5","usage":{"input_tokens":10,"output_tokens":20,"cache_creation_input_tokens":5,"cache_read_input_tokens":100}}}"#, "\n",
        r#"{"type":"user","sessionId":"s1"}"#, "\n",
      ),
    )
    .unwrap();

    let parsed = parse_jsonl_file(&file_path);
    assert_eq!(parsed.len(), 1, "only the one well-formed assistant line should parse");
    assert_eq!(parsed[0].usage.input_tokens, 10);
    assert_eq!(parsed[0].usage.output_tokens, 20);
    assert_eq!(parsed[0].usage.cache_creation_tokens, 5);
    assert_eq!(parsed[0].usage.cache_read_tokens, 100);
    assert_eq!(parsed[0].model, "claude-sonnet-5");

    std::fs::remove_dir_all(&dir).ok();
  }

  #[test]
  fn compute_report_aggregates_across_projects_and_sessions() {
    let root = std::env::temp_dir().join(format!("udaan_claude_usage_report_{}", uuid::Uuid::new_v4()));
    let proj_a = root.join("c--ProjA");
    let proj_b = root.join("c--ProjB");
    std::fs::create_dir_all(&proj_a).unwrap();
    std::fs::create_dir_all(&proj_b).unwrap();

    let now = Utc::now().to_rfc3339();
    std::fs::write(
      proj_a.join("s1.jsonl"),
      format!(
        r#"{{"type":"assistant","sessionId":"s1","timestamp":"{now}","message":{{"model":"claude-sonnet-5","usage":{{"input_tokens":1,"output_tokens":2,"cache_creation_input_tokens":0,"cache_read_input_tokens":0}}}}}}"#
      ),
    )
    .unwrap();
    std::fs::write(
      proj_b.join("s2.jsonl"),
      format!(
        r#"{{"type":"assistant","sessionId":"s2","timestamp":"{now}","message":{{"model":"claude-opus-5","usage":{{"input_tokens":10,"output_tokens":20,"cache_creation_input_tokens":0,"cache_read_input_tokens":0}}}}}}"#
      ),
    )
    .unwrap();

    let report = compute_report(&root);
    assert_eq!(report.all_time.total(), 3 + 30);
    assert_eq!(report.today.total(), 33, "both sessions are 'now', both count toward today");
    assert_eq!(report.projects.len(), 2);
    assert_eq!(report.recent_sessions.len(), 2);
    // Highest-usage project sorted first.
    assert_eq!(report.projects[0].name, "C:\\ProjB");

    std::fs::remove_dir_all(&root).ok();
  }

  /// One-off manual verification against this machine's REAL
  /// ~/.claude/projects/ history — not a real assertion-based test (there's
  /// nothing to assert against, since the numbers depend on real usage),
  /// just prints a sanity-check summary. Run with:
  /// `cargo test claude_usage::tests::print_real_report -- --ignored --nocapture`
  #[test]
  #[ignore]
  fn print_real_report() {
    let home = dirs::home_dir().expect("home dir");
    let projects_dir = home.join(".claude").join("projects");
    let report = compute_report(&projects_dir);
    println!("today: {:?} (total {})", report.today, report.today.total());
    println!("this_week: {:?} (total {})", report.this_week, report.this_week.total());
    println!("all_time: {:?} (total {})", report.all_time, report.all_time.total());
    println!("projects: {}", report.projects.len());
    for p in report.projects.iter().take(8) {
      println!("  {} -> {} tokens, {} sessions", p.name, p.totals.total(), p.session_count);
    }
    println!("recent_sessions: {}", report.recent_sessions.len());
    for s in report.recent_sessions.iter().take(5) {
      println!("  {} [{}] {} tokens ({})", s.session_id, s.project_name, s.totals.total(), s.primary_model);
    }
  }
}
