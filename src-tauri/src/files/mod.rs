//! FILES: the backend for the Files app (src/features/files).
//!
//! Everything here is either cheap or runs off the IPC thread. Listing uses the
//! metadata that `FindNextFile` already returned (no second stat per entry), so a
//! folder of thousands of files lists in one pass. Long jobs (duplicate scan,
//! index build, archive extract) run on blocking threads and report progress
//! through events.

mod archive;
mod dupes;
mod index;
mod recycle;

pub use archive::*;
pub use dupes::*;
pub use index::*;
pub use recycle::*;

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::UNIX_EPOCH;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
  pub name: String,
  pub path: String,
  pub is_dir: bool,
  pub size: u64,
  pub modified_ms: i64,
  pub created_ms: i64,
  /// Lowercase, no dot. Empty for folders.
  pub ext: String,
  pub hidden: bool,
  pub system: bool,
  pub readonly: bool,
}

fn ms(t: std::io::Result<std::time::SystemTime>) -> i64 {
  t.ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_millis() as i64).unwrap_or(0)
}

pub(crate) fn entry_from(path: &Path, md: &std::fs::Metadata) -> Entry {
  let is_dir = md.is_dir();
  let (hidden, system, readonly) = attrs(md);
  let modified_ms = ms(md.modified());
  Entry {
    name: path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| path.to_string_lossy().into_owned()),
    path: path.to_string_lossy().into_owned(),
    is_dir,
    size: if is_dir { 0 } else { md.len() },
    modified_ms,
    created_ms: { let c = ms(md.created()); if c == 0 { modified_ms } else { c } },
    ext: if is_dir { String::new() } else { path.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default() },
    hidden,
    system,
    readonly,
  }
}

#[cfg(windows)]
fn attrs(md: &std::fs::Metadata) -> (bool, bool, bool) {
  use std::os::windows::fs::MetadataExt;
  let a = md.file_attributes();
  (a & 0x2 != 0, a & 0x4 != 0, a & 0x1 != 0)
}
#[cfg(not(windows))]
fn attrs(md: &std::fs::Metadata) -> (bool, bool, bool) {
  (false, false, md.permissions().readonly())
}

pub(crate) fn stat(path: &Path) -> Option<Entry> {
  let md = std::fs::metadata(path).ok()?;
  Some(entry_from(path, &md))
}

/// One folder's children. On Windows `DirEntry::metadata` comes from the directory
/// enumeration itself, so this is one pass with no extra stat per file.
#[tauri::command]
pub async fn files_list(dir: String) -> Result<Vec<Entry>, String> {
  tauri::async_runtime::spawn_blocking(move || {
    let d = Path::new(&dir);
    let rd = std::fs::read_dir(d).map_err(|e| match e.kind() {
      std::io::ErrorKind::NotFound => format!("\"{dir}\" does not exist."),
      std::io::ErrorKind::PermissionDenied => format!("You do not have permission to open \"{dir}\"."),
      _ => e.to_string(),
    })?;
    let mut out = Vec::new();
    for e in rd.flatten() {
      let p = e.path();
      // A broken link has no metadata through the entry; fall back to a stat.
      let md = match e.metadata() {
        Ok(m) => m,
        Err(_) => match std::fs::symlink_metadata(&p) {
          Ok(m) => m,
          Err(_) => continue,
        },
      };
      // Junction points report as dirs; follow for the type, keep the entry.
      let md = if md.file_type().is_symlink() { std::fs::metadata(&p).unwrap_or(md) } else { md };
      out.push(entry_from(&p, &md));
    }
    Ok(out)
  })
  .await
  .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn files_stat(paths: Vec<String>) -> Vec<Option<Entry>> {
  tauri::async_runtime::spawn_blocking(move || paths.iter().map(|p| stat(Path::new(p))).collect())
    .await
    .unwrap_or_default()
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TreeNode {
  pub name: String,
  pub path: String,
  pub has_children: bool,
  pub hidden: bool,
}

/// Child folders only, for the sidebar tree. `has_children` stops at the first
/// sub-folder found, and gives up (assumes yes) after a few hundred plain files.
#[tauri::command]
pub async fn files_subdirs(dir: String) -> Result<Vec<TreeNode>, String> {
  tauri::async_runtime::spawn_blocking(move || {
    let rd = std::fs::read_dir(&dir).map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for e in rd.flatten() {
      let Ok(md) = e.metadata() else { continue };
      if !md.is_dir() {
        continue;
      }
      let (hidden, system, _) = attrs(&md);
      if system && hidden {
        continue;
      }
      let p = e.path();
      let has_children = match std::fs::read_dir(&p) {
        Ok(rd) => {
          let mut any = false;
          for (i, c) in rd.flatten().enumerate() {
            if i > 300 || c.file_type().map(|t| t.is_dir()).unwrap_or(false) {
              any = true;
              break;
            }
          }
          any
        }
        Err(_) => false,
      };
      out.push(TreeNode { name: e.file_name().to_string_lossy().into_owned(), path: p.to_string_lossy().into_owned(), has_children, hidden });
    }
    out.sort_by_key(|n| n.name.to_lowercase());
    Ok(out)
  })
  .await
  .map_err(|e| e.to_string())?
}

/// Renames many items as one step. Goes through temporary names first so a set
/// that swaps names (a -> b, b -> a) works, and puts everything back if any
/// rename fails part-way.
#[tauri::command]
pub async fn files_batch_rename(pairs: Vec<(String, String)>) -> Result<Vec<String>, String> {
  tauri::async_runtime::spawn_blocking(move || {
    // Validate first: same folder, legal names, no two targets equal, no clash with an untouched file.
    let mut targets = std::collections::HashSet::new();
    let sources: std::collections::HashSet<String> = pairs.iter().map(|(f, _)| f.to_lowercase()).collect();
    for (from, to) in &pairs {
      let name = Path::new(to).file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
      if name.is_empty() || name.contains(['<', '>', ':', '"', '/', '\\', '|', '?', '*']) || name.ends_with(' ') || name.ends_with('.') {
        return Err(format!("\"{name}\" is not a valid name."));
      }
      if Path::new(from).parent() != Path::new(to).parent() {
        return Err("Batch rename keeps items in their folder.".into());
      }
      if !targets.insert(to.to_lowercase()) {
        return Err(format!("Two items would both be called \"{name}\"."));
      }
      if Path::new(to).exists() && !sources.contains(&to.to_lowercase()) {
        return Err(format!("\"{name}\" already exists."));
      }
    }
    let stamp = format!("{:x}", std::time::SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_nanos());
    let mut staged: Vec<(PathBuf, PathBuf, PathBuf)> = Vec::new(); // (from, temp, to)
    let rollback = |staged: &Vec<(PathBuf, PathBuf, PathBuf)>, done_final: usize| {
      for (i, (from, temp, to)) in staged.iter().enumerate().rev() {
        if i < done_final {
          let _ = std::fs::rename(to, temp);
        }
        let _ = std::fs::rename(temp, from);
      }
    };
    for (i, (from, to)) in pairs.iter().enumerate() {
      let from = PathBuf::from(from);
      let temp = from.with_file_name(format!(".udaan-rn-{stamp}-{i}"));
      if let Err(e) = std::fs::rename(&from, &temp) {
        rollback(&staged, 0);
        return Err(format!("{}: {e}", from.display()));
      }
      staged.push((from, temp, PathBuf::from(to)));
    }
    for i in 0..staged.len() {
      if let Err(e) = std::fs::rename(&staged[i].1, &staged[i].2) {
        rollback(&staged, i);
        return Err(format!("{}: {e}", staged[i].2.display()));
      }
    }
    Ok(staged.into_iter().map(|(_, _, to)| to.to_string_lossy().into_owned()).collect())
  })
  .await
  .map_err(|e| e.to_string())?
}

/// Opens Windows Terminal (or PowerShell when it is not installed) in `dir`.
#[tauri::command]
pub fn files_open_terminal(dir: String) -> Result<(), String> {
  if !Path::new(&dir).is_dir() {
    return Err("That folder no longer exists.".into());
  }
  #[cfg(windows)]
  {
    use std::os::windows::process::CommandExt;
    const CREATE_NEW_CONSOLE: u32 = 0x10;
    if std::process::Command::new("wt.exe").arg("-d").arg(&dir).spawn().is_ok() {
      return Ok(());
    }
    std::process::Command::new("powershell.exe")
      .arg("-NoExit")
      .current_dir(&dir)
      .creation_flags(CREATE_NEW_CONSOLE)
      .spawn()
      .map(|_| ())
      .map_err(|e| e.to_string())
  }
  #[cfg(not(windows))]
  {
    Err("Not supported on this system.".into())
  }
}

/// Shows the item selected in Windows Explorer.
#[tauri::command]
pub fn files_reveal(path: String) -> Result<(), String> {
  #[cfg(windows)]
  {
    std::process::Command::new("explorer.exe").arg(format!("/select,{path}")).spawn().map(|_| ()).map_err(|e| e.to_string())
  }
  #[cfg(not(windows))]
  {
    let _ = path;
    Err("Not supported on this system.".into())
  }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Place {
  pub id: String,
  pub name: String,
  pub path: String,
}

/// Home and the standard user folders that exist on this machine.
#[tauri::command]
pub fn files_places() -> Vec<Place> {
  let c: Vec<(&str, &str, Option<PathBuf>)> = vec![
    ("home", "Home", dirs::home_dir()),
    ("desktop", "Desktop", dirs::desktop_dir()),
    ("documents", "Documents", dirs::document_dir()),
    ("downloads", "Downloads", dirs::download_dir()),
    ("pictures", "Pictures", dirs::picture_dir()),
    ("music", "Music", dirs::audio_dir()),
    ("videos", "Videos", dirs::video_dir()),
  ];
  c.into_iter()
    .filter_map(|(id, name, p)| p.filter(|p| p.is_dir()).map(|p| Place { id: id.into(), name: name.into(), path: p.to_string_lossy().into_owned() }))
    .collect()
}

/* ── live folders ─────────────────────────────────────────────────── */

use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use tauri::{AppHandle, Emitter};

type Watch = (RecommendedWatcher, Vec<PathBuf>);
static WATCHERS: OnceLock<Mutex<HashMap<String, Watch>>> = OnceLock::new();

#[derive(Serialize, Clone)]
struct Changed {
  dir: String,
}

/// Watches the folders a Files window shows (non-recursive) and emits
/// `files://changed { dir }`, debounced, so open panes refresh themselves.
/// Each window has its own set; an empty list stops watching for it.
#[tauri::command]
pub fn files_watch(app: AppHandle, window: tauri::Window, dirs: Vec<String>) -> Result<(), String> {
  let label = window.label().to_string();
  let slot = WATCHERS.get_or_init(|| Mutex::new(HashMap::new()));
  let mut map = slot.lock().map_err(|e| e.to_string())?;
  let wanted: Vec<PathBuf> = dirs.iter().map(PathBuf::from).filter(|p| p.is_dir()).collect();
  if map.get(&label).map(|(_, d)| *d == wanted).unwrap_or(false) {
    return Ok(());
  }
  map.remove(&label);
  if wanted.is_empty() {
    return Ok(());
  }
  let (tx, rx) = std::sync::mpsc::channel::<PathBuf>();
  let mut w = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
    if let Ok(ev) = res {
      for p in ev.paths {
        if let Some(parent) = p.parent() {
          let _ = tx.send(parent.to_path_buf());
        }
      }
    }
  })
  .map_err(|e| e.to_string())?;
  for d in &wanted {
    let _ = w.watch(d, RecursiveMode::NonRecursive);
  }
  let target = label.clone();
  std::thread::spawn(move || {
    // Coalesce bursts (a copy of 500 files) into one refresh per folder.
    while let Ok(first) = rx.recv() {
      let mut set = std::collections::HashSet::from([first]);
      let until = std::time::Instant::now() + std::time::Duration::from_millis(350);
      while let Some(left) = until.checked_duration_since(std::time::Instant::now()) {
        match rx.recv_timeout(left) {
          Ok(p) => {
            set.insert(p);
          }
          Err(std::sync::mpsc::RecvTimeoutError::Timeout) => break,
          Err(_) => return,
        }
      }
      for d in set {
        let _ = app.emit_to(target.as_str(), "files://changed", Changed { dir: d.to_string_lossy().into_owned() });
      }
    }
  });
  map.insert(label, (w, wanted));
  Ok(())
}

/* ── thumbnails ───────────────────────────────────────────────────── */

/// A small JPEG of an image, cached on disk by path + size + date, returned as
/// a file path for the asset protocol. The grid never pulls originals.
#[tauri::command]
pub async fn files_thumb(app: AppHandle, path: String, size: u32) -> Result<String, String> {
  use std::hash::{Hash, Hasher};
  use tauri::Manager;
  let dir = app.path().app_cache_dir().map_err(|e| e.to_string())?.join("files-thumbs");
  tauri::async_runtime::spawn_blocking(move || {
    let md = std::fs::metadata(&path).map_err(|e| e.to_string())?;
    if md.len() > 80 * 1024 * 1024 {
      return Err("Too large to preview.".into());
    }
    let mut h = std::collections::hash_map::DefaultHasher::new();
    (path.to_lowercase(), md.len(), ms(md.modified()), size).hash(&mut h);
    let out = dir.join(format!("{:016x}.jpg", h.finish()));
    if out.exists() {
      return Ok(out.to_string_lossy().into_owned());
    }
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let img = image::open(&path).map_err(|e| e.to_string())?;
    let t = img.thumbnail(size, size).to_rgb8();
    t.save_with_format(&out, image::ImageFormat::Jpeg).map_err(|e| e.to_string())?;
    Ok(out.to_string_lossy().into_owned())
  })
  .await
  .map_err(|e| e.to_string())?
}
