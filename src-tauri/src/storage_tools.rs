//! STORAGE tools (src/os/apps/utilities/StorageApp): find the biggest and the oldest files under a folder.
//!
//! One walk, bounded in time, keeping only the best N in a small heap so memory stays flat however many
//! files there are. Reparse points (junctions, OneDrive placeholders) are never followed, and a new scan
//! cancels the one before it.

use serde::Serialize;
use std::cmp::Reverse;
use std::collections::BinaryHeap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};

static CURRENT: AtomicU64 = AtomicU64::new(0);

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FoundFile {
  pub path: String,
  pub size: u64,
  pub modified_ms: i64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Progress {
  scan_id: u64,
  files: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FindResult {
  pub files: Vec<FoundFile>,
  /// Files looked at in all.
  pub scanned: u64,
  /// The scan ran out of time and covered only part of the folder.
  pub partial: bool,
}

/// Stops a running scan.
#[tauri::command]
pub fn storage_find_cancel() {
  CURRENT.fetch_add(1, Ordering::SeqCst);
}

/// The `limit` best files under `root` with at least `min_size` bytes. `sort` is "size" (biggest first) or
/// "oldest" (least recently changed first). `older_than_days` keeps only files not changed for that long.
#[tauri::command]
pub async fn storage_find_files(app: AppHandle, root: String, min_size: u64, older_than_days: Option<u64>, sort: String, limit: usize) -> Result<FindResult, String> {
  let id = CURRENT.fetch_add(1, Ordering::SeqCst) + 1;
  tauri::async_runtime::spawn_blocking(move || {
    let live = || CURRENT.load(Ordering::SeqCst) == id;
    let deadline = Instant::now() + Duration::from_secs(120);
    let now_ms = std::time::SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0);
    let cutoff = older_than_days.map(|d| now_ms - (d as i64) * 86_400_000);
    let by_size = sort != "oldest";
    let limit = limit.clamp(1, 1000);

    // A min-heap on the sort key: once it is full, anything worse than its smallest entry is skipped.
    let mut heap: BinaryHeap<Reverse<(i64, u64, String)>> = BinaryHeap::new();
    let mut stack = vec![PathBuf::from(&root)];
    let (mut scanned, mut partial) = (0u64, false);
    while let Some(dir) = stack.pop() {
      if !live() {
        return Ok(FindResult { files: vec![], scanned, partial: true });
      }
      if Instant::now() > deadline {
        partial = true;
        break;
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
          if md.file_attributes() & 0x400 != 0 {
            continue; // reparse point
          }
        }
        if md.is_dir() {
          stack.push(e.path());
          continue;
        }
        scanned += 1;
        if scanned % 3000 == 0 {
          let _ = app.emit("storage://find-progress", Progress { scan_id: id, files: scanned });
        }
        let size = md.len();
        if size < min_size {
          continue;
        }
        let modified = md.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_millis() as i64).unwrap_or(0);
        if let Some(c) = cutoff {
          if modified > c {
            continue;
          }
        }
        // Rank by size (bigger is better) or by age (older is better, so negate the time).
        let key = if by_size { size as i64 } else { -modified };
        if heap.len() < limit {
          heap.push(Reverse((key, size, format!("{modified}|{}", e.path().to_string_lossy()))));
        } else if let Some(Reverse((worst, _, _))) = heap.peek() {
          if key > *worst {
            heap.pop();
            heap.push(Reverse((key, size, format!("{modified}|{}", e.path().to_string_lossy()))));
          }
        }
      }
    }
    let mut files: Vec<(i64, FoundFile)> = heap
      .into_iter()
      .map(|Reverse((key, size, packed))| {
        let (m, p) = packed.split_once('|').unwrap_or(("0", ""));
        (key, FoundFile { path: p.to_string(), size, modified_ms: m.parse().unwrap_or(0) })
      })
      .collect();
    files.sort_by(|a, b| b.0.cmp(&a.0));
    let _ = app.emit("storage://find-progress", Progress { scan_id: id, files: scanned });
    Ok(FindResult { files: files.into_iter().map(|(_, f)| f).collect(), scanned, partial })
  })
  .await
  .map_err(|e| e.to_string())?
}
