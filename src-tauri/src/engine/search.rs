//! Start search: one in-memory index of everything you might want to open.
//!
//! The old Start searched by asking each source on every keystroke. This keeps one index of
//! apps, settings, actions and files, built once and updated in the background, so a query is
//! a scan of memory, answered in a few milliseconds however many files you have.
//!
//! - **Sources** register entries under a name ([`search_register`]): the app list, the
//!   Settings pages, actions such as "Lock", the files in your folders. Registering a source
//!   again replaces just that source.
//! - **Ranking** ([`score`]) wants every word of the query to match. A title that equals the
//!   query beats one that starts with it, which beats a word-start, a substring, a fuzzy
//!   match, and finally a match only in the subtitle or keywords. Apps outrank settings
//!   outrank files at equal quality.
//! - **Frecency** remembers what you launch ([`search_record_launch`]), so what you actually use
//!   rises, and fades if you stop. An empty query returns that list: your likely next opens.
//! - **Files** are crawled in the background at low priority, skipping build and system
//!   folders, with a hard cap, and re-crawled shortly after the folders change.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock, RwLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
  App,
  Setting,
  Action,
  Folder,
  File,
}

impl Kind {
  /// A small head start for kinds people reach for more often, so at equal quality an app beats a
  /// settings page beats a file.
  fn boost(self) -> f64 {
    match self {
      Kind::App => 20.0,
      Kind::Action => 15.0,
      Kind::Setting => 10.0,
      Kind::Folder => 5.0,
      Kind::File => 0.0,
    }
  }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
  pub id: String,
  pub kind: Kind,
  pub title: String,
  #[serde(default)]
  pub subtitle: String,
  /// Extra words that should find this entry but are not shown ("wifi" for the network page).
  #[serde(default)]
  pub keywords: String,
  /// What opening it does: an app id, a file path, an action id.
  pub target: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Hit {
  #[serde(flatten)]
  pub entry: Entry,
  pub score: f64,
}

struct Indexed {
  entry: Entry,
  title_lc: String,
  words: Vec<String>,
  hay_lc: String,
}

impl Indexed {
  fn new(entry: Entry) -> Self {
    let title_lc = entry.title.to_lowercase();
    let words = title_lc.split(|c: char| !c.is_alphanumeric()).filter(|w| !w.is_empty()).map(str::to_string).collect();
    let hay_lc = format!("{} {}", entry.subtitle, entry.keywords).to_lowercase();
    Indexed { entry, title_lc, words, hay_lc }
  }
}

/// True if the characters of `needle` appear in `hay` in order (a fuzzy match).
fn is_subsequence(needle: &str, hay: &str) -> bool {
  let mut chars = hay.chars();
  needle.chars().all(|n| chars.any(|h| h == n))
}

/// How well one query word matches an item, or `None` if it does not match at all.
fn token_score(t: &str, item: &Indexed) -> Option<f64> {
  if item.title_lc == t {
    return Some(100.0);
  }
  if item.title_lc.starts_with(t) {
    return Some(80.0);
  }
  if let Some(pos) = item.words.iter().position(|w| w.starts_with(t)) {
    // a match in the first word is worth a little more than one deep in the title
    return Some(60.0 + if pos == 0 { 10.0 } else { 0.0 });
  }
  if item.title_lc.contains(t) {
    return Some(40.0);
  }
  if t.chars().count() >= 3 && is_subsequence(t, &item.title_lc) {
    return Some(20.0);
  }
  if item.hay_lc.contains(t) {
    return Some(15.0);
  }
  None
}

/// Match quality of an item for the query words, before frecency. Every word must match.
fn score(tokens: &[String], item: &Indexed) -> Option<f64> {
  let mut total = 0.0;
  for t in tokens {
    total += token_score(t, item)?;
  }
  let base = total / tokens.len() as f64;
  // shorter titles are better matches for the same words
  Some(base - item.title_lc.chars().count() as f64 * 0.05 + item.entry.kind.boost())
}

// ---------------------------------------------------------------------------------------
// Usage (frecency)
// ---------------------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize)]
struct Usage {
  count: u32,
  last: u64,
}

fn now_secs() -> u64 {
  SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

/// How much a history of use adds to a score: grows with how often it was opened, scaled down the
/// longer ago the last open was.
fn frecency(u: Usage, now: u64) -> f64 {
  if u.count == 0 {
    return 0.0;
  }
  let days = now.saturating_sub(u.last) as f64 / 86_400.0;
  let decay = if days < 1.0 {
    1.0
  } else if days < 7.0 {
    0.7
  } else if days < 30.0 {
    0.4
  } else {
    0.2
  };
  (1.0 + u.count as f64).ln() * 8.0 * decay
}

// ---------------------------------------------------------------------------------------
// The index
// ---------------------------------------------------------------------------------------

#[derive(Default)]
struct Index {
  sources: HashMap<String, Vec<Indexed>>,
  usage: HashMap<String, Usage>,
}

impl Index {
  fn replace(&mut self, source: &str, entries: Vec<Entry>) {
    self.sources.insert(source.to_string(), entries.into_iter().map(Indexed::new).collect());
  }

  fn query(&self, query: &str, limit: usize, now: u64) -> Vec<Hit> {
    let tokens: Vec<String> = query.to_lowercase().split_whitespace().map(str::to_string).collect();
    let mut hits: Vec<Hit> = if tokens.is_empty() {
      // No query: what you open most, most recently.
      self
        .sources
        .values()
        .flatten()
        .filter_map(|i| {
          let u = self.usage.get(&i.entry.id).copied().unwrap_or_default();
          (u.count > 0).then(|| Hit { entry: i.entry.clone(), score: frecency(u, now) })
        })
        .collect()
    } else {
      self
        .sources
        .values()
        .flatten()
        .filter_map(|i| {
          let s = score(&tokens, i)?;
          let f = self.usage.get(&i.entry.id).copied().map(|u| frecency(u, now)).unwrap_or(0.0);
          Some(Hit { entry: i.entry.clone(), score: s + f })
        })
        .collect()
    };
    hits.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal).then_with(|| a.entry.title.cmp(&b.entry.title)));
    hits.truncate(limit);
    hits
  }
}

static INDEX: OnceLock<RwLock<Index>> = OnceLock::new();
static USAGE_FILE: Mutex<Option<PathBuf>> = Mutex::new(None);

fn index() -> &'static RwLock<Index> {
  INDEX.get_or_init(|| RwLock::new(Index::default()))
}

fn save_usage() {
  let Some(path) = USAGE_FILE.lock().ok().and_then(|g| g.clone()) else { return };
  let json = index().read().ok().and_then(|i| serde_json::to_string(&i.usage).ok());
  if let Some(json) = json {
    let _ = std::fs::write(path, json);
  }
}

// ---------------------------------------------------------------------------------------
// Files: a bounded, polite crawl
// ---------------------------------------------------------------------------------------

/// Folder names never worth descending into: build output, dependencies, system and hidden stuff.
const SKIP_DIRS: [&str; 12] = [
  "node_modules", ".git", "target", "dist", "build", "$recycle.bin", "appdata", "system volume information", ".cache", "__pycache__", ".venv", "venv",
];
const MAX_DEPTH: usize = 4;

fn skip_dir(name: &str) -> bool {
  let n = name.to_lowercase();
  n.starts_with('.') || SKIP_DIRS.contains(&n.as_str())
}

/// Lists files and folders under `roots`, to `MAX_DEPTH` levels, at most `cap` entries.
pub fn crawl(roots: &[PathBuf], cap: usize) -> Vec<Entry> {
  let mut out = Vec::new();
  let mut stack: Vec<(PathBuf, usize)> = roots.iter().map(|r| (r.clone(), 0)).collect();
  while let Some((dir, depth)) = stack.pop() {
    let Ok(rd) = std::fs::read_dir(&dir) else { continue };
    for e in rd.flatten() {
      if out.len() >= cap {
        return out;
      }
      let name = e.file_name().to_string_lossy().to_string();
      let Ok(ft) = e.file_type() else { continue };
      let path = e.path();
      if ft.is_dir() {
        if skip_dir(&name) {
          continue;
        }
        out.push(Entry {
          id: format!("folder:{}", path.display()),
          kind: Kind::Folder,
          title: name,
          subtitle: dir.display().to_string(),
          keywords: String::new(),
          target: path.display().to_string(),
        });
        if depth + 1 < MAX_DEPTH {
          stack.push((path, depth + 1));
        }
      } else if ft.is_file() && !name.starts_with('.') {
        out.push(Entry {
          id: format!("file:{}", path.display()),
          kind: Kind::File,
          title: name,
          subtitle: dir.display().to_string(),
          keywords: String::new(),
          target: path.display().to_string(),
        });
      }
    }
  }
  out
}

fn user_roots() -> Vec<PathBuf> {
  [dirs::desktop_dir(), dirs::document_dir(), dirs::download_dir(), dirs::picture_dir(), dirs::audio_dir(), dirs::video_dir()]
    .into_iter()
    .flatten()
    .filter(|p| p.is_dir())
    .collect()
}

async fn tokio_sleep() {
  tauri::async_runtime::spawn_blocking(|| std::thread::sleep(Duration::from_secs(8))).await.ok();
}

/// Starts the background file indexer: crawls shortly after startup (not while the shell is
/// still settling), then again a while after the folders change.
pub fn start(app: tauri::AppHandle) {
  use tauri::Manager;
  if let Ok(dir) = app.path().app_data_dir() {
    let file = dir.join("search_usage.json");
    if let Ok(raw) = std::fs::read_to_string(&file) {
      if let Ok(usage) = serde_json::from_str::<HashMap<String, Usage>>(&raw) {
        if let Ok(mut i) = index().write() {
          i.usage = usage;
        }
      }
    }
    if let Ok(mut f) = USAGE_FILE.lock() {
      *f = Some(file);
    }
  }
  tauri::async_runtime::spawn(async {
    tokio_sleep().await;
    let _ = search_refresh_apps().await;
  });
  let _ = super::supervisor::spawn("file-indexer", super::supervisor::Restart::OnPanic, || {
    std::thread::sleep(Duration::from_secs(20));
    let roots = user_roots();
    let (tx, rx) = std::sync::mpsc::channel::<()>();
    let _watchers: Vec<_> = roots
      .iter()
      .filter_map(|r| {
        use notify::Watcher;
        let tx = tx.clone();
        let mut w = notify::recommended_watcher(move |_r: notify::Result<notify::Event>| {
          let _ = tx.send(());
        })
        .ok()?;
        w.watch(r, notify::RecursiveMode::Recursive).ok()?;
        Some(w)
      })
      .collect();
    loop {
      let files = crawl(&roots, 60_000);
      if let Ok(mut i) = index().write() {
        i.replace("files", files);
      }
      // Sleep until something changes, then let the burst settle before crawling again.
      let _ = rx.recv();
      std::thread::sleep(Duration::from_secs(30));
      while rx.try_recv().is_ok() {}
    }
  });
}

// ---------------------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------------------

/// Replaces everything one source contributes (the app list, the Settings pages, actions).
#[tauri::command(async)]
pub fn search_register(source: String, entries: Vec<Entry>) {
  if let Ok(mut i) = index().write() {
    i.replace(&source, entries);
  }
}

/// Searches the index. An empty query returns what you open most.
#[tauri::command(async)]
pub fn search_query(query: String, limit: Option<usize>) -> Vec<Hit> {
  index().read().map(|i| i.query(&query, limit.unwrap_or(30), now_secs())).unwrap_or_default()
}

/// Notes that an entry was opened, so it ranks higher next time.
#[tauri::command(async)]
pub fn search_record_launch(id: String) {
  if let Ok(mut i) = index().write() {
    let u = i.usage.entry(id).or_default();
    u.count = u.count.saturating_add(1);
    u.last = now_secs();
  }
  save_usage();
}

/// How many entries each source has, for diagnostics.
#[tauri::command(async)]
pub fn search_status() -> HashMap<String, usize> {
  index().read().map(|i| i.sources.iter().map(|(k, v)| (k.clone(), v.len())).collect()).unwrap_or_default()
}

/// Every installed app (the same list the Windows Start menu shows), as search entries.
async fn load_apps() -> Vec<Entry> {
  match crate::shell::apps::shell_installed_apps().await {
    Ok(apps) => apps
      .into_iter()
      .map(|a| Entry { id: format!("app:{}", a.id), kind: Kind::App, title: a.name, subtitle: String::new(), keywords: String::new(), target: a.id })
      .collect(),
    Err(_) => Vec::new(),
  }
}

/// Re-reads the installed apps into the index. Returns how many there are.
#[tauri::command]
pub async fn search_refresh_apps() -> usize {
  let entries = load_apps().await;
  let n = entries.len();
  if n > 0 {
    if let Ok(mut i) = index().write() {
      i.replace("apps", entries);
    }
  }
  n
}

#[cfg(test)]
mod tests {
  use super::*;

  fn entry(id: &str, kind: Kind, title: &str, subtitle: &str, keywords: &str) -> Entry {
    Entry { id: id.into(), kind, title: title.into(), subtitle: subtitle.into(), keywords: keywords.into(), target: id.into() }
  }

  fn index_of(entries: Vec<Entry>) -> Index {
    let mut i = Index::default();
    i.replace("test", entries);
    i
  }

  fn titles(hits: &[Hit]) -> Vec<&str> {
    hits.iter().map(|h| h.entry.title.as_str()).collect()
  }

  #[test]
  fn better_matches_rank_higher() {
    let i = index_of(vec![
      entry("1", Kind::App, "Notes", "", ""),
      entry("2", Kind::App, "Notepad", "", ""),
      entry("3", Kind::App, "Sticky Notes", "", ""),
      entry("4", Kind::App, "Keynote Viewer", "", ""),
    ]);
    // exact < prefix < word-start < substring
    let hits = i.query("notes", 10, 0);
    assert_eq!(titles(&hits)[0], "Notes");
    assert!(titles(&hits).contains(&"Sticky Notes"));
    assert!(!titles(&hits).contains(&"Notepad"), "'notepad' does not contain 'notes'");
    let hits = i.query("note", 10, 0);
    assert_eq!(titles(&hits), vec!["Notes", "Notepad", "Sticky Notes", "Keynote Viewer"]);
  }

  #[test]
  fn every_word_must_match() {
    let i = index_of(vec![
      entry("1", Kind::Setting, "Dark mode", "Appearance", "theme night"),
      entry("2", Kind::Setting, "Dock", "Dock and menu bar", ""),
      entry("3", Kind::App, "Dark Souls", "", ""),
    ]);
    assert_eq!(titles(&i.query("dark mode", 10, 0)), vec!["Dark mode"]);
    assert_eq!(titles(&i.query("dark", 10, 0)).len(), 2);
    assert!(i.query("dark zebra", 10, 0).is_empty());
  }

  #[test]
  fn keywords_and_subtitles_find_things_but_rank_below_the_title() {
    let i = index_of(vec![entry("1", Kind::Setting, "Network", "Settings", "wifi wireless internet"), entry("2", Kind::App, "WiFi Analyzer", "", "")]);
    let hits = i.query("wifi", 10, 0);
    assert_eq!(titles(&hits), vec!["WiFi Analyzer", "Network"]);
  }

  #[test]
  fn fuzzy_matching_finds_abbreviations() {
    let i = index_of(vec![entry("1", Kind::App, "Visual Studio Code", "", ""), entry("2", Kind::App, "Calculator", "", "")]);
    assert_eq!(titles(&i.query("vsc", 10, 0)), vec!["Visual Studio Code"]);
    assert!(i.query("xq", 10, 0).is_empty(), "too short to fuzzy-match");
  }

  #[test]
  fn at_equal_quality_apps_beat_settings_beat_files() {
    let i = index_of(vec![
      entry("f", Kind::File, "Photos", "", ""),
      entry("s", Kind::Setting, "Photos", "", ""),
      entry("a", Kind::App, "Photos", "", ""),
    ]);
    let ids: Vec<_> = i.query("photos", 10, 0).iter().map(|h| h.entry.id.clone()).collect();
    assert_eq!(ids, vec!["a", "s", "f"]);
  }

  #[test]
  fn what_you_open_rises_and_fades() {
    let mut i = index_of(vec![entry("1", Kind::App, "Calendar", "", ""), entry("2", Kind::App, "Calculator", "", "")]);
    let now = 10_000_000;
    // before any history, the shorter title wins
    assert_eq!(titles(&i.query("cal", 10, now))[0], "Calendar");
    i.usage.insert("2".into(), Usage { count: 12, last: now });
    assert_eq!(titles(&i.query("cal", 10, now))[0], "Calculator", "used a lot, recently");
    // the same history from months ago counts for much less
    i.usage.insert("2".into(), Usage { count: 12, last: now - 90 * 86_400 });
    let recent = frecency(Usage { count: 12, last: now }, now);
    let stale = frecency(Usage { count: 12, last: now - 90 * 86_400 }, now);
    assert!(stale < recent / 3.0);
  }

  #[test]
  fn an_empty_query_lists_what_you_use_most() {
    let mut i = index_of(vec![entry("1", Kind::App, "A", "", ""), entry("2", Kind::App, "B", "", ""), entry("3", Kind::App, "C", "", "")]);
    i.usage.insert("2".into(), Usage { count: 9, last: 100 });
    i.usage.insert("3".into(), Usage { count: 2, last: 100 });
    assert_eq!(titles(&i.query("", 10, 100)), vec!["B", "C"], "only things you have opened, most used first");
  }

  #[test]
  fn crawl_respects_depth_skip_folders_and_cap() {
    let root = std::env::temp_dir().join(format!("udaan_search_{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    std::fs::create_dir_all(root.join("a/b/c/d/e")).unwrap();
    std::fs::create_dir_all(root.join("node_modules/pkg")).unwrap();
    std::fs::write(root.join("report.txt"), "x").unwrap();
    std::fs::write(root.join("a/b/deep.txt"), "x").unwrap();
    std::fs::write(root.join("a/b/c/d/e/too_deep.txt"), "x").unwrap();
    std::fs::write(root.join("node_modules/pkg/skipped.js"), "x").unwrap();
    std::fs::write(root.join(".hidden"), "x").unwrap();
    let found = crawl(&[root.clone()], 1000);
    let names: Vec<_> = found.iter().map(|e| e.title.as_str()).collect();
    assert!(names.contains(&"report.txt") && names.contains(&"deep.txt"));
    assert!(!names.contains(&"too_deep.txt"), "deeper than the depth limit");
    assert!(!names.contains(&"skipped.js") && !names.contains(&"node_modules"), "skipped folders");
    assert!(!names.contains(&".hidden"));
    assert_eq!(crawl(&[root.clone()], 2).len(), 2, "the cap is a hard limit");
    let _ = std::fs::remove_dir_all(&root);
  }
}
