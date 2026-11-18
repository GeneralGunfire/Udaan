//! A filename index for "search everywhere". Built in the background on demand,
//! saved to disk, loaded lazily. Memory is kept compact: every path lives in one
//! shared String buffer, and each record is 32 bytes.
//!
//! Query syntax (space separated, all must match):
//!   words           name contains each word (case-insensitive)
//!   ext:pdf         extension
//!   kind:image|video|audio|doc|archive|code|folder
//!   size:>10mb  size:<1kb
//!   modified:<7d    (newer than 7 days)   modified:>1y (older than a year)
//!   in:projects     the path contains this text

use serde::Serialize;
use std::io::{BufRead, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use tauri::{AppHandle, Emitter, Manager};

const MAX_ENTRIES: usize = 600_000;

struct Rec {
  start: u32,
  len: u16,
  name_at: u16,
  size: u64,
  mtime: i64,
  dir: bool,
}

#[derive(Default)]
struct Index {
  buf: String,
  recs: Vec<Rec>,
  built_ms: i64,
  roots: Vec<String>,
}

static INDEX: OnceLock<Mutex<Option<Index>>> = OnceLock::new();
static BUILDING: AtomicBool = AtomicBool::new(false);

fn slot() -> &'static Mutex<Option<Index>> {
  INDEX.get_or_init(|| Mutex::new(None))
}

fn file(app: &AppHandle) -> Option<PathBuf> {
  let d = app.path().app_data_dir().ok()?;
  std::fs::create_dir_all(&d).ok()?;
  Some(d.join("files-index.tsv"))
}

fn now_ms() -> i64 {
  std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

impl Index {
  fn push(&mut self, path: &str, size: u64, mtime: i64, dir: bool) {
    if path.len() > u16::MAX as usize || self.recs.len() >= MAX_ENTRIES {
      return;
    }
    let name_at = path.rfind(['\\', '/']).map(|i| i + 1).unwrap_or(0) as u16;
    let start = self.buf.len() as u32;
    self.buf.push_str(path);
    self.recs.push(Rec { start, len: path.len() as u16, name_at, size, mtime, dir });
  }
  fn path(&self, r: &Rec) -> &str {
    &self.buf[r.start as usize..r.start as usize + r.len as usize]
  }
}

/// Default roots: the user's home (minus AppData and dot-folders) and every non-system fixed drive.
fn default_roots() -> Vec<PathBuf> {
  let mut out = Vec::new();
  if let Some(h) = dirs::home_dir() {
    out.push(h);
  }
  let sys = std::env::var("SystemDrive").unwrap_or_else(|_| "C:".into()).to_uppercase();
  for d in sysinfo::Disks::new_with_refreshed_list().iter() {
    let m = d.mount_point().to_string_lossy().into_owned();
    if !d.is_removable() && !m.to_uppercase().starts_with(&sys) {
      out.push(PathBuf::from(m));
    }
  }
  out
}

fn skip_dir(name: &str) -> bool {
  let n = name.to_ascii_lowercase();
  n.starts_with('.') || matches!(n.as_str(), "appdata" | "node_modules" | "target" | "$recycle.bin" | "system volume information" | "windows" | "program files" | "program files (x86)" | "programdata" | "__pycache__")
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct IndexStatus {
  pub ready: bool,
  pub building: bool,
  pub count: usize,
  pub built_ms: i64,
  pub roots: Vec<String>,
}

fn status_of(g: &Option<Index>) -> IndexStatus {
  match g {
    Some(i) => IndexStatus { ready: true, building: BUILDING.load(Ordering::SeqCst), count: i.recs.len(), built_ms: i.built_ms, roots: i.roots.clone() },
    None => IndexStatus { ready: false, building: BUILDING.load(Ordering::SeqCst), count: 0, built_ms: 0, roots: vec![] },
  }
}

/// Loads the saved index if it is not in memory yet. Cheap when already loaded.
fn ensure_loaded(app: &AppHandle) {
  let mut g = slot().lock().unwrap();
  if g.is_some() {
    return;
  }
  let Some(f) = file(app) else { return };
  let Ok(fh) = std::fs::File::open(&f) else { return };
  let mut idx = Index::default();
  let mut lines = std::io::BufReader::new(fh).lines();
  // Header: built_ms \t roots joined by |
  if let Some(Ok(h)) = lines.next() {
    let mut it = h.splitn(2, '\t');
    idx.built_ms = it.next().and_then(|s| s.parse().ok()).unwrap_or(0);
    idx.roots = it.next().map(|s| s.split('|').filter(|x| !x.is_empty()).map(String::from).collect()).unwrap_or_default();
  }
  for l in lines.map_while(Result::ok) {
    let mut it = l.splitn(4, '\t');
    let (Some(d), Some(s), Some(m), Some(p)) = (it.next(), it.next(), it.next(), it.next()) else { continue };
    idx.push(p, s.parse().unwrap_or(0), m.parse().unwrap_or(0), d == "1");
  }
  *g = Some(idx);
}

#[tauri::command]
pub async fn files_index_status(app: AppHandle) -> IndexStatus {
  tauri::async_runtime::spawn_blocking(move || {
    ensure_loaded(&app);
    status_of(&slot().lock().unwrap())
  })
  .await
  .unwrap_or(IndexStatus { ready: false, building: false, count: 0, built_ms: 0, roots: vec![] })
}

/// Rebuilds the index in the background; emits `files://index` with the status as it goes and when done.
#[tauri::command]
pub fn files_index_build(app: AppHandle, roots: Option<Vec<String>>) -> Result<(), String> {
  if BUILDING.swap(true, Ordering::SeqCst) {
    return Ok(());
  }
  std::thread::spawn(move || {
    let roots: Vec<PathBuf> = roots.filter(|r| !r.is_empty()).map(|r| r.into_iter().map(PathBuf::from).collect()).unwrap_or_else(default_roots);
    let mut idx = Index { roots: roots.iter().map(|r| r.to_string_lossy().into_owned()).collect(), ..Default::default() };
    let mut stack: Vec<PathBuf> = roots.clone();
    let mut tick = 0usize;
    while let Some(dir) = stack.pop() {
      if idx.recs.len() >= MAX_ENTRIES {
        break;
      }
      let Ok(rd) = std::fs::read_dir(&dir) else { continue };
      for e in rd.flatten() {
        let Ok(md) = e.metadata() else { continue };
        let name = e.file_name().to_string_lossy().into_owned();
        #[cfg(windows)]
        let attrs = {
          use std::os::windows::fs::MetadataExt;
          md.file_attributes()
        };
        #[cfg(not(windows))]
        let attrs = 0u32;
        let hidden_sys = attrs & 0x6 != 0;
        let reparse = attrs & 0x400 != 0;
        let p = e.path();
        let mtime = md.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_millis() as i64).unwrap_or(0);
        if md.is_dir() {
          if hidden_sys || reparse || skip_dir(&name) {
            continue;
          }
          idx.push(&p.to_string_lossy(), 0, mtime, true);
          stack.push(p);
        } else if !hidden_sys {
          idx.push(&p.to_string_lossy(), md.len(), mtime, false);
        }
      }
      tick += 1;
      if tick % 400 == 0 {
        let _ = app.emit("files://index", IndexStatus { ready: false, building: true, count: idx.recs.len(), built_ms: 0, roots: vec![] });
        // Be gentle on a slow, nearly full disk.
        std::thread::sleep(std::time::Duration::from_millis(2));
      }
    }
    idx.built_ms = now_ms();
    if let Some(f) = file(&app) {
      if let Ok(fh) = std::fs::File::create(&f) {
        let mut w = std::io::BufWriter::new(fh);
        let _ = writeln!(w, "{}\t{}", idx.built_ms, idx.roots.join("|"));
        for r in &idx.recs {
          let _ = writeln!(w, "{}\t{}\t{}\t{}", if r.dir { 1 } else { 0 }, r.size, r.mtime, idx.path(r));
        }
      }
    }
    let mut g = slot().lock().unwrap();
    *g = Some(idx);
    BUILDING.store(false, Ordering::SeqCst);
    let _ = app.emit("files://index", status_of(&g));
  });
  Ok(())
}

fn contains_ci(hay: &str, needle: &str) -> bool {
  if needle.is_empty() {
    return true;
  }
  let (h, n) = (hay.as_bytes(), needle.as_bytes());
  if n.len() > h.len() {
    return false;
  }
  if hay.is_ascii() && needle.is_ascii() {
    return h.windows(n.len()).any(|w| w.eq_ignore_ascii_case(n));
  }
  hay.to_lowercase().contains(&needle.to_lowercase())
}

fn parse_size(s: &str) -> Option<u64> {
  let s = s.to_ascii_lowercase();
  let (num, mul) = if let Some(n) = s.strip_suffix("gb") {
    (n, 1u64 << 30)
  } else if let Some(n) = s.strip_suffix("mb") {
    (n, 1 << 20)
  } else if let Some(n) = s.strip_suffix("kb") {
    (n, 1 << 10)
  } else {
    (s.trim_end_matches('b'), 1)
  };
  num.parse::<f64>().ok().map(|v| (v * mul as f64) as u64)
}

fn parse_age(s: &str) -> Option<i64> {
  let (n, unit) = s.split_at(s.find(|c: char| c.is_alphabetic())?);
  let v: i64 = n.parse().ok()?;
  let day = 86_400_000i64;
  Some(v * match unit {
    "h" => day / 24,
    "d" => day,
    "w" => day * 7,
    "m" => day * 30,
    "y" => day * 365,
    _ => return None,
  })
}

fn kind_exts(k: &str) -> Option<&'static [&'static str]> {
  Some(match k {
    "image" => &["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "heic", "tif", "tiff", "ico", "avif"],
    "video" => &["mp4", "mkv", "mov", "avi", "webm", "wmv", "m4v"],
    "audio" => &["mp3", "wav", "flac", "ogg", "m4a", "aac", "wma", "opus"],
    "doc" => &["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "md", "rtf", "odt", "csv"],
    "archive" => &["zip", "7z", "rar", "tar", "gz", "xz", "bz2"],
    "code" => &["rs", "ts", "tsx", "js", "jsx", "py", "c", "cpp", "h", "cs", "java", "go", "json", "toml", "yaml", "yml", "html", "css"],
    _ => return None,
  })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Hit {
  pub path: String,
  pub name: String,
  pub is_dir: bool,
  pub size: u64,
  pub modified_ms: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryResult {
  pub hits: Vec<Hit>,
  pub total: usize,
  pub status: IndexStatus,
}

#[tauri::command]
pub async fn files_index_query(app: AppHandle, query: String, limit: usize) -> Result<QueryResult, String> {
  tauri::async_runtime::spawn_blocking(move || {
    ensure_loaded(&app);
    let g = slot().lock().unwrap();
    let status = status_of(&g);
    let Some(idx) = g.as_ref() else { return Ok(QueryResult { hits: vec![], total: 0, status }) };
    let mut words: Vec<String> = Vec::new();
    let mut exts: Vec<String> = Vec::new();
    let mut kinds: Vec<&'static [&'static str]> = Vec::new();
    let mut want_dir: Option<bool> = None;
    let (mut min, mut max) = (0u64, u64::MAX);
    let (mut newer, mut older) = (i64::MIN, i64::MAX);
    let mut ins: Vec<String> = Vec::new();
    let now = now_ms();
    for tok in query.split_whitespace() {
      let (k, v) = tok.split_once(':').unwrap_or(("", tok));
      match k.to_ascii_lowercase().as_str() {
        "ext" => exts.extend(v.split(',').map(|e| e.trim_start_matches('.').to_ascii_lowercase())),
        "kind" if v == "folder" => want_dir = Some(true),
        "kind" => {
          if let Some(e) = kind_exts(v) {
            kinds.push(e);
            want_dir = Some(false);
          }
        }
        "size" => {
          if let Some(n) = v.strip_prefix('>').and_then(parse_size) {
            min = n;
          } else if let Some(n) = v.strip_prefix('<').and_then(parse_size) {
            max = n;
          }
        }
        "modified" => {
          if let Some(a) = v.strip_prefix('<').and_then(parse_age) {
            newer = now - a;
          } else if let Some(a) = v.strip_prefix('>').and_then(parse_age) {
            older = now - a;
          }
        }
        "in" => ins.push(v.to_string()),
        _ => words.push(tok.to_string()),
      }
    }
    let mut hits = Vec::new();
    let mut total = 0usize;
    for r in &idx.recs {
      if let Some(d) = want_dir {
        if r.dir != d {
          continue;
        }
      }
      if r.size < min || r.size > max || r.mtime < newer || r.mtime > older {
        continue;
      }
      let path = idx.path(r);
      let name = &path[r.name_at as usize..];
      if !words.iter().all(|w| contains_ci(name, w)) {
        continue;
      }
      if !exts.is_empty() || !kinds.is_empty() {
        let ext = name.rsplit_once('.').map(|(_, e)| e.to_ascii_lowercase()).unwrap_or_default();
        if !exts.is_empty() && !exts.contains(&ext) {
          continue;
        }
        if !kinds.is_empty() && !kinds.iter().any(|k| k.contains(&ext.as_str())) {
          continue;
        }
      }
      if !ins.iter().all(|i| contains_ci(&path[..r.name_at as usize], i)) {
        continue;
      }
      total += 1;
      if hits.len() < limit {
        hits.push(Hit { path: path.to_string(), name: name.to_string(), is_dir: r.dir, size: r.size, modified_ms: r.mtime });
      }
    }
    // Shortest names that start with the first word read best first.
    if let Some(first) = words.first() {
      let f = first.to_lowercase();
      hits.sort_by_key(|h| (!h.name.to_lowercase().starts_with(&f), h.name.len()));
    }
    Ok(QueryResult { hits, total, status })
  })
  .await
  .map_err(|e| e.to_string())?
}

/// Keeps the index honest between rebuilds: Files reports what it created,
/// renamed or deleted, so a search right after shows the change.
#[tauri::command]
pub fn files_index_touch(removed: Vec<String>, added: Vec<String>) {
  let mut g = slot().lock().unwrap();
  let Some(idx) = g.as_mut() else { return };
  if !removed.is_empty() {
    let gone: Vec<String> = removed.iter().map(|p| p.to_lowercase()).collect();
    let mut keep = Index { built_ms: idx.built_ms, roots: idx.roots.clone(), ..Default::default() };
    for r in &idx.recs {
      let p = idx.path(r);
      let lp = p.to_lowercase();
      if gone.iter().any(|g| lp == *g || lp.starts_with(&format!("{g}\\"))) {
        continue;
      }
      keep.push(p, r.size, r.mtime, r.dir);
    }
    *idx = keep;
  }
  for a in added {
    if let Some(e) = super::stat(Path::new(&a)) {
      if idx.roots.iter().any(|r| a.to_lowercase().starts_with(&r.to_lowercase())) {
        idx.push(&e.path, e.size, e.modified_ms, e.is_dir);
      }
    }
  }
}
