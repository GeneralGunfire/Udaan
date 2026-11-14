use serde::{Deserialize, Serialize};
use std::path::Path;

const IMAGE_EXTENSIONS: &[&str] = &["png", "jpg", "jpeg", "gif", "webp", "bmp"];
const VIDEO_EXTENSIONS: &[&str] = &["mp4", "mov", "webm", "mkv", "avi"];

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AssetEntry {
  pub path: String,
  pub file_name: String,
  pub size_bytes: u64,
  pub kind: String,
}

fn classify(path: &Path) -> &'static str {
  let ext = path
    .extension()
    .and_then(|e| e.to_str())
    .map(|e| e.to_lowercase())
    .unwrap_or_default();
  if IMAGE_EXTENSIONS.contains(&ext.as_str()) {
    "image"
  } else if VIDEO_EXTENSIONS.contains(&ext.as_str()) {
    "video"
  } else {
    "other"
  }
}

/// Non-recursive scan of a folder for image/video assets — shared by the
/// Image Editor, Video Editor, and any future Creativity tool that needs a
/// local asset browser. Same predictability rationale as audio_library:
/// one chosen folder, not a recursive drive walk.
#[tauri::command(async)]
pub fn asset_library_scan_folder(folder_path: String) -> Result<Vec<AssetEntry>, String> {
  let dir = Path::new(&folder_path);
  if !dir.is_dir() {
    return Err(format!("Not a directory: {folder_path}"));
  }

  let mut entries = Vec::new();
  let read_dir = std::fs::read_dir(dir).map_err(|e| e.to_string())?;
  for entry in read_dir {
    let entry = entry.map_err(|e| e.to_string())?;
    let path = entry.path();
    if !path.is_file() {
      continue;
    }
    let kind = classify(&path);
    if kind == "other" {
      continue;
    }
    let metadata = entry.metadata().map_err(|e| e.to_string())?;
    entries.push(AssetEntry {
      path: path.to_string_lossy().to_string(),
      file_name: path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default(),
      size_bytes: metadata.len(),
      kind: kind.to_string(),
    });
  }
  entries.sort_by(|a, b| a.file_name.to_lowercase().cmp(&b.file_name.to_lowercase()));
  Ok(entries)
}

#[tauri::command(async)]
pub fn asset_library_read_file(file_path: String) -> Result<Vec<u8>, String> {
  std::fs::read(&file_path).map_err(|e| e.to_string())
}

/// Writes bytes to disk — used by the Image Editor's export (Save As).
/// Only ever called with a path the user picked via the native save dialog,
/// never a path derived from arbitrary user text input.
#[tauri::command(async)]
pub fn asset_library_write_file(file_path: String, data: Vec<u8>) -> Result<(), String> {
  std::fs::write(&file_path, data).map_err(|e| e.to_string())
}

/// Stats a list of individually-picked files (single- or multi-file
/// dialog selection) into the same AssetEntry shape the folder scan
/// produces. Skips paths that aren't files or aren't image/video —
/// same "other" filtering as the folder scan, so mixed selections
/// silently drop unsupported files rather than erroring.
#[tauri::command(async)]
pub fn asset_library_stat_files(paths: Vec<String>) -> Result<Vec<AssetEntry>, String> {
  let mut entries = Vec::new();
  for p in paths {
    let path = Path::new(&p);
    if !path.is_file() {
      continue;
    }
    let kind = classify(path);
    if kind == "other" {
      continue;
    }
    let metadata = std::fs::metadata(path).map_err(|e| e.to_string())?;
    entries.push(AssetEntry {
      path: path.to_string_lossy().to_string(),
      file_name: path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default(),
      size_bytes: metadata.len(),
      kind: kind.to_string(),
    });
  }
  Ok(entries)
}
