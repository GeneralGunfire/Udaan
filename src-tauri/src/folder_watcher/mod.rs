use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::Path;
use std::sync::Mutex;

/// Snapshot-diff folder watcher: the frontend polls this command on an
/// interval and gets back files that are new since the last poll for
/// that specific folder. Simpler and more portable than wiring up the
/// `notify` crate's native OS file-event backends (which need
/// platform-specific features and a background thread/channel) for a
/// need this modest — "check a folder every few seconds" is plenty for
/// a personal automation trigger, not a low-latency requirement.
#[derive(Default)]
pub struct FolderWatcherState {
  known_files: Mutex<std::collections::HashMap<String, HashSet<String>>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NewFileEntry {
  pub path: String,
  pub file_name: String,
}

#[tauri::command]
pub fn folder_watcher_poll(
  state: tauri::State<FolderWatcherState>,
  folder_path: String,
) -> Result<Vec<NewFileEntry>, String> {
  let dir = Path::new(&folder_path);
  if !dir.is_dir() {
    return Err(format!("Not a directory: {folder_path}"));
  }

  let mut current = HashSet::new();
  let read_dir = std::fs::read_dir(dir).map_err(|e| e.to_string())?;
  for entry in read_dir {
    let entry = entry.map_err(|e| e.to_string())?;
    if entry.path().is_file() {
      current.insert(entry.file_name().to_string_lossy().to_string());
    }
  }

  let mut known = state.known_files.lock().unwrap();
  let previously_known = known.get(&folder_path).cloned();

  let new_files: Vec<NewFileEntry> = match &previously_known {
    // First poll for this folder: don't report every existing file as
    // "new" — only report files that arrive after we start watching.
    None => Vec::new(),
    Some(prev) => current
      .difference(prev)
      .map(|file_name| NewFileEntry {
        path: dir.join(file_name).to_string_lossy().to_string(),
        file_name: file_name.clone(),
      })
      .collect(),
  };

  known.insert(folder_path, current);
  Ok(new_files)
}
