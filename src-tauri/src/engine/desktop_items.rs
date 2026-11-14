//! The desktop's contents: what is on the desktop, kept current, the way Explorer would show it.
//!
//! The desktop is two folders merged (your Desktop and the all-users Public Desktop), minus what
//! Explorer hides. This used to be assembled in the frontend: it guessed the Public Desktop path,
//! showed items that Windows marks Hidden or System, and enumerated the whole Recycle Bin every
//! ten seconds to learn whether it was empty. Now the engine does it properly:
//!
//! - **The real folders.** Both are asked of Windows (known folders), so a Desktop redirected to
//!   OneDrive, or a profile on another drive, just works.
//! - **Explorer's visibility rules.** Hidden and System items, `desktop.ini`, `Thumbs.db` and Office
//!   `~$` lock files are not shown. The same item in both folders appears once.
//! - **One watcher.** The engine watches both folders and says so (debounced) when they change.
//! - **The Recycle Bin** is asked of Windows in one call (item count and size), not enumerated.

use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use windows::core::GUID;
use windows::Win32::System::Com::CoTaskMemFree;
use windows::Win32::UI::Shell::{
  FOLDERID_Desktop, FOLDERID_PublicDesktop, SHGetKnownFolderPath, SHQueryRecycleBinW, KF_FLAG_DEFAULT, SHQUERYRBINFO,
};

const FILE_ATTRIBUTE_HIDDEN: u32 = 0x2;
const FILE_ATTRIBUTE_SYSTEM: u32 = 0x4;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DesktopEntry {
  pub name: String,
  pub path: String,
  pub is_dir: bool,
  pub extension: String,
  pub size_bytes: u64,
  pub modified_ms: i64,
  pub created_ms: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecycleBin {
  pub item_count: i64,
  pub size_bytes: i64,
}

fn known_folder(id: &GUID) -> Option<PathBuf> {
  unsafe {
    let p = SHGetKnownFolderPath(id, KF_FLAG_DEFAULT, None).ok()?;
    let s = p.to_string().ok();
    CoTaskMemFree(Some(p.0 as *const _));
    s.map(PathBuf::from)
  }
}

/// The folders that make up the desktop, yours first. A folder that does not exist is left out.
pub fn desktop_dirs() -> Vec<PathBuf> {
  [known_folder(&FOLDERID_Desktop), known_folder(&FOLDERID_PublicDesktop)].into_iter().flatten().filter(|p| p.is_dir()).collect()
}

/// Whether Explorer would show a desktop item with this name and attributes.
pub fn is_visible(name: &str, attributes: u32) -> bool {
  if attributes & (FILE_ATTRIBUTE_HIDDEN | FILE_ATTRIBUTE_SYSTEM) != 0 {
    return false;
  }
  let lower = name.to_lowercase();
  !(lower == "desktop.ini" || lower == "thumbs.db" || lower.starts_with("~$"))
}

fn millis(t: std::io::Result<std::time::SystemTime>) -> i64 {
  t.ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_millis() as i64).unwrap_or(0)
}

/// Lists the given folders as one desktop. An item present in more than one appears once, from
/// the first folder.
pub fn list_dirs(dirs: &[PathBuf]) -> Vec<DesktopEntry> {
  use std::os::windows::fs::MetadataExt;
  let mut seen: HashMap<String, ()> = HashMap::new();
  let mut out = Vec::new();
  for dir in dirs {
    let Ok(rd) = std::fs::read_dir(dir) else { continue };
    for e in rd.flatten() {
      let Ok(meta) = e.metadata() else { continue };
      let name = e.file_name().to_string_lossy().to_string();
      if !is_visible(&name, meta.file_attributes()) {
        continue;
      }
      let key = name.to_lowercase();
      if seen.insert(key, ()).is_some() {
        continue;
      }
      let path = e.path();
      let extension = if meta.is_dir() { String::new() } else { path.extension().map(|x| x.to_string_lossy().to_string()).unwrap_or_default() };
      out.push(DesktopEntry {
        name,
        path: path.to_string_lossy().to_string(),
        is_dir: meta.is_dir(),
        extension,
        size_bytes: if meta.is_dir() { 0 } else { meta.len() },
        modified_ms: millis(meta.modified()),
        created_ms: millis(meta.created()),
      });
    }
  }
  out
}

/// Starts the watcher: when either folder changes, wait for the burst to settle and announce it.
pub fn start(app: AppHandle) {
  let _ = super::supervisor::spawn("desktop-watcher", super::supervisor::Restart::OnPanic, move || {
    let dirs = desktop_dirs();
    let (tx, rx) = std::sync::mpsc::channel::<()>();
    let _watchers: Vec<_> = dirs
      .iter()
      .filter_map(|d| {
        use notify::Watcher;
        let tx = tx.clone();
        let mut w = notify::recommended_watcher(move |_r: notify::Result<notify::Event>| {
          let _ = tx.send(());
        })
        .ok()?;
        w.watch(d, notify::RecursiveMode::NonRecursive).ok()?;
        Some(w)
      })
      .collect();
    while rx.recv().is_ok() {
      // A copy or an archive extraction fires hundreds of events: announce once, after it settles.
      std::thread::sleep(Duration::from_millis(150));
      while rx.try_recv().is_ok() {}
      let _ = app.emit("desktop://changed", ());
      // The event the existing desktop already listens to.
      for d in &dirs {
        let _ = app.emit("shell://dir-changed", serde_json::json!({ "dir": d.to_string_lossy() }));
      }
    }
  });
}

/// The folders that make up the desktop (for operations like "new folder").
#[tauri::command(async)]
pub fn desktop_items_dirs() -> Vec<String> {
  desktop_dirs().iter().map(|p| p.to_string_lossy().to_string()).collect()
}

/// Everything on the desktop, as Explorer would show it.
#[tauri::command(async)]
pub fn desktop_items_list() -> Vec<DesktopEntry> {
  list_dirs(&desktop_dirs())
}

/// The Recycle Bin's item count and size, from Windows in one call.
#[tauri::command(async)]
pub fn desktop_recycle_bin() -> Result<RecycleBin, String> {
  let mut info = SHQUERYRBINFO { cbSize: std::mem::size_of::<SHQUERYRBINFO>() as u32, ..Default::default() };
  unsafe { SHQueryRecycleBinW(windows::core::PCWSTR::null(), &mut info) }.map_err(|e| e.to_string())?;
  Ok(RecycleBin { item_count: info.i64NumItems, size_bytes: info.i64Size })
}

/// True if `p` is one of the desktop folders (so callers can ask "is this on the desktop?").
#[allow(dead_code)]
pub fn is_desktop_dir(p: &Path) -> bool {
  desktop_dirs().iter().any(|d| d.eq_ignore_ascii_case_path(p))
}

trait PathEq {
  fn eq_ignore_ascii_case_path(&self, other: &Path) -> bool;
}
impl PathEq for PathBuf {
  fn eq_ignore_ascii_case_path(&self, other: &Path) -> bool {
    self.to_string_lossy().eq_ignore_ascii_case(&other.to_string_lossy())
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::os::windows::fs::OpenOptionsExt;

  fn temp_dir(name: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("udaan_desk_{name}_{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    d
  }

  #[test]
  fn explorers_visibility_rules() {
    assert!(is_visible("Report.docx", 0));
    assert!(!is_visible("desktop.ini", 0));
    assert!(!is_visible("Thumbs.db", 0));
    assert!(!is_visible("~$Report.docx", 0), "Office lock file");
    assert!(!is_visible("secret.txt", FILE_ATTRIBUTE_HIDDEN));
    assert!(!is_visible("sys.dat", FILE_ATTRIBUTE_SYSTEM));
    assert!(is_visible("Folder", 0x10), "a directory attribute alone is visible");
  }

  #[test]
  fn two_folders_merge_into_one_desktop_without_duplicates() {
    let mine = temp_dir("mine");
    let public = temp_dir("public");
    std::fs::write(mine.join("notes.txt"), "a").unwrap();
    std::fs::write(mine.join("Shared.lnk"), "mine").unwrap();
    std::fs::write(public.join("shared.lnk"), "theirs").unwrap();
    std::fs::write(public.join("Everyone.lnk"), "x").unwrap();
    std::fs::write(public.join("desktop.ini"), "x").unwrap();
    std::fs::create_dir(mine.join("Projects")).unwrap();
    let found = list_dirs(&[mine.clone(), public.clone()]);
    let mut names: Vec<_> = found.iter().map(|e| e.name.to_lowercase()).collect();
    names.sort();
    assert_eq!(names, vec!["everyone.lnk", "notes.txt", "projects", "shared.lnk"]);
    let shared = found.iter().find(|e| e.name.eq_ignore_ascii_case("shared.lnk")).unwrap();
    assert!(shared.path.starts_with(&mine.to_string_lossy().to_string()), "the first folder wins");
    assert!(found.iter().find(|e| e.name == "Projects").unwrap().is_dir);
    let _ = std::fs::remove_dir_all(&mine);
    let _ = std::fs::remove_dir_all(&public);
  }

  #[test]
  fn hidden_files_are_not_listed() {
    let d = temp_dir("hidden");
    std::fs::write(d.join("visible.txt"), "a").unwrap();
    let hidden = d.join("hidden.txt");
    // create the file with the Hidden attribute set
    std::fs::OpenOptions::new().write(true).create(true).attributes(FILE_ATTRIBUTE_HIDDEN).open(&hidden).unwrap();
    let names: Vec<_> = list_dirs(&[d.clone()]).into_iter().map(|e| e.name).collect();
    assert_eq!(names, vec!["visible.txt"]);
    let _ = std::fs::remove_dir_all(&d);
  }

  #[test]
  fn windows_knows_the_real_desktop_and_the_bin_answers() {
    let dirs = desktop_dirs();
    assert!(!dirs.is_empty(), "the user's Desktop folder exists");
    assert!(desktop_recycle_bin().is_ok(), "the Recycle Bin can be queried in one call");
  }
}
