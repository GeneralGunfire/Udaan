//! Duplicate finder. Three narrowing passes so almost nothing is read in full:
//! group by size, then by a hash of the first 64 KB, then by SHA-256 of the
//! whole file. Only files that survive all three are reported.

use serde::Serialize;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use tauri::{AppHandle, Emitter};

static CURRENT: AtomicU64 = AtomicU64::new(0);

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Progress {
  scan_id: u64,
  stage: &'static str,
  done: u64,
  total: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DupeFile {
  pub path: String,
  pub modified_ms: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DupeGroup {
  pub size: u64,
  pub files: Vec<DupeFile>,
}

fn hash_file(p: &Path, limit: Option<u64>) -> Option<[u8; 32]> {
  let f = std::fs::File::open(p).ok()?;
  let mut r: Box<dyn Read> = match limit {
    Some(n) => Box::new(f.take(n)),
    None => Box::new(f),
  };
  let mut h = Sha256::new();
  let mut buf = vec![0u8; 256 * 1024];
  loop {
    let n = r.read(&mut buf).ok()?;
    if n == 0 {
      break;
    }
    h.update(&buf[..n]);
  }
  Some(h.finalize().into())
}

/// Stops a running scan (the next file it looks at, it returns empty).
#[tauri::command]
pub fn files_dupes_cancel() {
  CURRENT.fetch_add(1, Ordering::SeqCst);
}

#[tauri::command]
pub async fn files_find_duplicates(app: AppHandle, root: String, min_size: u64, include_hidden: bool) -> Result<Vec<DupeGroup>, String> {
  let id = CURRENT.fetch_add(1, Ordering::SeqCst) + 1;
  tauri::async_runtime::spawn_blocking(move || {
    let live = || CURRENT.load(Ordering::SeqCst) == id;
    let emit = |stage: &'static str, done: u64, total: u64| {
      let _ = app.emit("files://dupes-progress", Progress { scan_id: id, stage, done, total });
    };
    // 1. Walk.
    let mut by_size: HashMap<u64, Vec<(PathBuf, i64)>> = HashMap::new();
    let mut stack = vec![PathBuf::from(&root)];
    let mut seen = 0u64;
    while let Some(dir) = stack.pop() {
      if !live() {
        return Ok(vec![]);
      }
      let Ok(rd) = std::fs::read_dir(&dir) else { continue };
      for e in rd.flatten() {
        let Ok(md) = e.metadata() else { continue };
        if md.file_type().is_symlink() {
          continue;
        }
        #[cfg(windows)]
        {
          use std::os::windows::fs::MetadataExt;
          let a = md.file_attributes();
          if !include_hidden && a & 0x6 != 0 {
            continue;
          }
          // Reparse points (junctions, OneDrive placeholders) would loop or download.
          if a & 0x400 != 0 {
            continue;
          }
        }
        if md.is_dir() {
          stack.push(e.path());
        } else if md.len() >= min_size.max(1) {
          let ms = md.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_millis() as i64).unwrap_or(0);
          by_size.entry(md.len()).or_default().push((e.path(), ms));
        }
        seen += 1;
        if seen % 2000 == 0 {
          emit("Looking through folders", seen, 0);
        }
      }
    }
    let candidates: Vec<(u64, Vec<(PathBuf, i64)>)> = by_size.into_iter().filter(|(_, v)| v.len() > 1).collect();
    let total: u64 = candidates.iter().map(|(_, v)| v.len() as u64).sum();
    let mut done = 0u64;
    let mut groups = Vec::new();
    for (size, files) in candidates {
      if !live() {
        return Ok(vec![]);
      }
      // 2. First 64 KB.
      let mut by_head: HashMap<[u8; 32], Vec<(PathBuf, i64)>> = HashMap::new();
      for (p, m) in files {
        done += 1;
        if done % 50 == 0 {
          emit("Comparing contents", done, total);
        }
        if let Some(h) = hash_file(&p, Some(64 * 1024)) {
          by_head.entry(h).or_default().push((p, m));
        }
      }
      for (_, same_head) in by_head.into_iter().filter(|(_, v)| v.len() > 1) {
        // 3. Whole file, only when it is bigger than what the head hash covered.
        let buckets: Vec<Vec<(PathBuf, i64)>> = if size <= 64 * 1024 {
          vec![same_head]
        } else {
          let mut by_full: HashMap<[u8; 32], Vec<(PathBuf, i64)>> = HashMap::new();
          for (p, m) in same_head {
            if !live() {
              return Ok(vec![]);
            }
            if let Some(h) = hash_file(&p, None) {
              by_full.entry(h).or_default().push((p, m));
            }
          }
          by_full.into_values().collect()
        };
        for b in buckets.into_iter().filter(|b| b.len() > 1) {
          let mut files: Vec<DupeFile> = b.into_iter().map(|(p, m)| DupeFile { path: p.to_string_lossy().into_owned(), modified_ms: m }).collect();
          files.sort_by(|a, b| a.modified_ms.cmp(&b.modified_ms));
          groups.push(DupeGroup { size, files });
        }
      }
    }
    emit("Done", total, total);
    // Most wasted space first.
    groups.sort_by(|a, b| (b.size * (b.files.len() as u64 - 1)).cmp(&(a.size * (a.files.len() as u64 - 1))));
    Ok(groups)
  })
  .await
  .map_err(|e| e.to_string())?
}
