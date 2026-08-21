use serde::{Deserialize, Serialize};
use std::path::Path;

const AUDIO_EXTENSIONS: &[&str] = &["mp3", "wav", "ogg", "flac", "m4a", "aac"];

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AudioTrackEntry {
  pub path: String,
  pub file_name: String,
  pub size_bytes: u64,
}

fn is_audio_file(path: &Path) -> bool {
  path
    .extension()
    .and_then(|ext| ext.to_str())
    .map(|ext| AUDIO_EXTENSIONS.contains(&ext.to_lowercase().as_str()))
    .unwrap_or(false)
}

/// Scans a single directory (non-recursive) for supported audio files.
/// Non-recursive by design: a v1 local library should be predictable — the
/// user picks the folder that contains their tracks, not an entire drive tree.
#[tauri::command]
pub fn audio_library_scan_folder(folder_path: String) -> Result<Vec<AudioTrackEntry>, String> {
  let dir = Path::new(&folder_path);
  if !dir.is_dir() {
    return Err(format!("Not a directory: {folder_path}"));
  }

  let mut entries = Vec::new();
  let read_dir = std::fs::read_dir(dir).map_err(|e| e.to_string())?;
  for entry in read_dir {
    let entry = entry.map_err(|e| e.to_string())?;
    let path = entry.path();
    if path.is_file() && is_audio_file(&path) {
      let metadata = entry.metadata().map_err(|e| e.to_string())?;
      entries.push(AudioTrackEntry {
        path: path.to_string_lossy().to_string(),
        file_name: path
          .file_name()
          .map(|n| n.to_string_lossy().to_string())
          .unwrap_or_default(),
        size_bytes: metadata.len(),
      });
    }
  }
  entries.sort_by(|a, b| a.file_name.to_lowercase().cmp(&b.file_name.to_lowercase()));
  Ok(entries)
}

/// Reads an audio file's raw bytes for local decode via the Web Audio API.
/// Bytes (not a URL) so the frontend never needs filesystem-scoped asset
/// protocol permissions per-file — one broad read capability, exercised only
/// against paths the user picked via the folder scan above.
#[tauri::command]
pub fn audio_library_read_file(file_path: String) -> Result<Vec<u8>, String> {
  std::fs::read(&file_path).map_err(|e| e.to_string())
}

/// Stats a list of individually-picked files (single- or multi-file
/// dialog selection) into the same AudioTrackEntry shape the folder scan
/// produces, so the frontend can treat "picked a folder" and "picked one
/// or more files" uniformly. Skips paths that aren't files or aren't a
/// supported audio extension rather than erroring the whole batch.
#[tauri::command]
pub fn audio_library_stat_files(paths: Vec<String>) -> Result<Vec<AudioTrackEntry>, String> {
  let mut entries = Vec::new();
  for p in paths {
    let path = Path::new(&p);
    if !path.is_file() || !is_audio_file(path) {
      continue;
    }
    let metadata = std::fs::metadata(path).map_err(|e| e.to_string())?;
    entries.push(AudioTrackEntry {
      path: path.to_string_lossy().to_string(),
      file_name: path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default(),
      size_bytes: metadata.len(),
    });
  }
  Ok(entries)
}
