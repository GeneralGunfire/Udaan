mod office_templates;

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DirEntryInfo {
  pub name: String,
  pub path: String,
  pub is_dir: bool,
  pub size_bytes: u64,
  /// Milliseconds since epoch, so the frontend can format with `Date`.
  pub modified_ms: i64,
  /// Milliseconds since epoch. Falls back to `modified_ms` on filesystems
  /// that don't track creation time (most Linux setups) — Windows (the
  /// primary target here) always has it.
  pub created_ms: i64,
  /// Lowercase extension without the dot, empty for directories/extensionless files.
  pub extension: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QuickAccessLocation {
  pub name: String,
  pub path: String,
}

fn entry_info(path: PathBuf) -> Option<DirEntryInfo> {
  let metadata = std::fs::metadata(&path).ok()?;
  let is_dir = metadata.is_dir();
  let modified_ms = metadata
    .modified()
    .ok()
    .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
    .map(|d| d.as_millis() as i64)
    .unwrap_or(0);
  let created_ms = metadata
    .created()
    .ok()
    .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
    .map(|d| d.as_millis() as i64)
    .unwrap_or(modified_ms);
  let extension = if is_dir {
    String::new()
  } else {
    path
      .extension()
      .and_then(|e| e.to_str())
      .map(|e| e.to_lowercase())
      .unwrap_or_default()
  };
  Some(DirEntryInfo {
    name: path.file_name()?.to_string_lossy().to_string(),
    path: path.to_string_lossy().to_string(),
    is_dir,
    size_bytes: if is_dir { 0 } else { metadata.len() },
    modified_ms,
    created_ms,
    extension,
  })
}

/// Stats a single path — used by the Properties dialog.
#[tauri::command(async)]
pub fn file_explorer_stat(path: String) -> Result<DirEntryInfo, String> {
  entry_info(PathBuf::from(&path)).ok_or_else(|| format!("Couldn't read \"{path}\""))
}

/// Non-recursive listing of a single directory's immediate children.
#[tauri::command(async)]
pub fn file_explorer_list_dir(dir_path: String) -> Result<Vec<DirEntryInfo>, String> {
  let dir = Path::new(&dir_path);
  if !dir.is_dir() {
    return Err(format!("Not a directory: {dir_path}"));
  }
  let read_dir = std::fs::read_dir(dir).map_err(|e| e.to_string())?;
  let mut entries = Vec::new();
  for entry in read_dir {
    let entry = entry.map_err(|e| e.to_string())?;
    if let Some(info) = entry_info(entry.path()) {
      entries.push(info);
    }
  }
  Ok(entries)
}

/// Recursive search under `dir_path` for entries whose name contains `query`
/// (case-insensitive). Depth-bounded AND visited-node-bounded (not just
/// matched-result-bounded) so a search from a huge folder (Documents, home
/// dir, ...) can't spend minutes stat-ing hundreds of thousands of entries
/// before giving up — that unbounded walk was previously also running
/// synchronously on the IPC thread, freezing the whole UI while it ran.
/// `async` + `spawn_blocking` moves the walk off that thread so typing and
/// other commands stay responsive while a search is in flight; the
/// visited-node cap bounds how long any single search can run at all.
#[tauri::command]
pub async fn file_explorer_search(
  dir_path: String,
  query: String,
  recursive: bool,
) -> Result<Vec<DirEntryInfo>, String> {
  tauri::async_runtime::spawn_blocking(move || {
    let root = Path::new(&dir_path);
    if !root.is_dir() {
      return Err(format!("Not a directory: {dir_path}"));
    }
    let needle = query.to_lowercase();
    let mut results = Vec::new();
    let mut visited = 0usize;
    let max_depth = if recursive { 8 } else { 1 };
    search_dir(root, &needle, 0, max_depth, &mut results, &mut visited);
    Ok(results)
  })
  .await
  .map_err(|e| e.to_string())?
}

/// Caps on a single search: how many results to collect, and how many
/// filesystem entries to visit total (directories can fan out far faster
/// than matches accumulate, so both caps are needed independently).
const MAX_SEARCH_RESULTS: usize = 500;
const MAX_SEARCH_VISITED: usize = 20_000;

fn search_dir(
  dir: &Path,
  needle: &str,
  depth: usize,
  max_depth: usize,
  out: &mut Vec<DirEntryInfo>,
  visited: &mut usize,
) {
  if depth >= max_depth || out.len() >= MAX_SEARCH_RESULTS || *visited >= MAX_SEARCH_VISITED {
    return;
  }
  let Ok(read_dir) = std::fs::read_dir(dir) else { return };
  for entry in read_dir.flatten() {
    if out.len() >= MAX_SEARCH_RESULTS || *visited >= MAX_SEARCH_VISITED {
      return;
    }
    *visited += 1;
    let path = entry.path();
    let name_matches = path
      .file_name()
      .map(|n| n.to_string_lossy().to_lowercase().contains(needle))
      .unwrap_or(false);
    if name_matches {
      if let Some(info) = entry_info(path.clone()) {
        out.push(info);
      }
    }
    if path.is_dir() {
      search_dir(&path, needle, depth + 1, max_depth, out, visited);
    }
  }
}

#[tauri::command(async)]
pub fn file_explorer_create_folder(parent_dir: String, name: String) -> Result<DirEntryInfo, String> {
  let new_path = Path::new(&parent_dir).join(&name);
  if new_path.exists() {
    return Err(format!("\"{name}\" already exists"));
  }
  std::fs::create_dir(&new_path).map_err(|e| e.to_string())?;
  entry_info(new_path).ok_or_else(|| "Failed to stat created folder".to_string())
}

#[tauri::command(async)]
pub fn file_explorer_rename(old_path: String, new_name: String) -> Result<DirEntryInfo, String> {
  let old = Path::new(&old_path);
  let new_path = old
    .parent()
    .ok_or("Path has no parent")?
    .join(&new_name);
  if new_path.exists() {
    return Err(format!("\"{new_name}\" already exists"));
  }
  std::fs::rename(old, &new_path).map_err(|e| e.to_string())?;
  entry_info(new_path).ok_or_else(|| "Failed to stat renamed entry".to_string())
}

/// Kinds of "New file" the toolbar/context menu can create — one variant
/// per template in `office_templates`, plus a genuinely empty text file.
#[derive(Debug, Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum NewFileKind {
  Text,
  Word,
  Excel,
  PowerPoint,
}

impl NewFileKind {
  fn extension(self) -> &'static str {
    match self {
      NewFileKind::Text => "txt",
      NewFileKind::Word => "docx",
      NewFileKind::Excel => "xlsx",
      NewFileKind::PowerPoint => "pptx",
    }
  }

  fn default_base_name(self) -> &'static str {
    match self {
      NewFileKind::Text => "New Text Document",
      NewFileKind::Word => "New Word Document",
      NewFileKind::Excel => "New Excel Spreadsheet",
      NewFileKind::PowerPoint => "New PowerPoint Presentation",
    }
  }

  fn bytes(self) -> Result<Vec<u8>, String> {
    match self {
      NewFileKind::Text => Ok(Vec::new()),
      NewFileKind::Word => office_templates::empty_docx(),
      NewFileKind::Excel => office_templates::empty_xlsx(),
      NewFileKind::PowerPoint => office_templates::empty_pptx(),
    }
  }
}

/// Creates a new file of `kind` in `parent_dir`, named uniquely from that
/// kind's default base name (Explorer's "New Text Document (2).txt"
/// pattern) so callers never have to pre-check for a collision.
#[tauri::command(async)]
pub fn file_explorer_create_file(parent_dir: String, kind: NewFileKind) -> Result<DirEntryInfo, String> {
  let dir = Path::new(&parent_dir);
  let file_name = format!("{}.{}", kind.default_base_name(), kind.extension());
  let dest_path = unique_destination(dir, &file_name);
  std::fs::write(&dest_path, kind.bytes()?).map_err(|e| e.to_string())?;
  entry_info(dest_path).ok_or_else(|| "Failed to stat created file".to_string())
}

fn remove_path(path: &Path) -> std::io::Result<()> {
  if path.is_dir() {
    std::fs::remove_dir_all(path)
  } else {
    std::fs::remove_file(path)
  }
}

/// Deletes files/folders permanently. The frontend is responsible for
/// confirming with the user first — this command performs no confirmation
/// of its own, matching the "no silent/instant delete" requirement being
/// enforced at the UI layer.
#[tauri::command(async)]
pub fn file_explorer_delete(paths: Vec<String>) -> Result<(), String> {
  for p in paths {
    remove_path(Path::new(&p)).map_err(|e| format!("{p}: {e}"))?;
  }
  Ok(())
}

fn trash_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
  use tauri::Manager;
  let dir = app
    .path()
    .app_data_dir()
    .map_err(|e| e.to_string())?
    .join("file-explorer-trash");
  std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
  Ok(dir)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrashedEntry {
  /// Original absolute path, so the frontend can restore it exactly there.
  pub original_path: String,
  /// Where the item currently lives in the trash — pass this to `file_explorer_restore`.
  pub trash_path: String,
}

/// Soft-deletes files/folders by moving them into a hidden per-app trash
/// directory rather than removing them from disk — what makes "Undo" after
/// a delete possible. The confirm-before-delete UI still applies; this is
/// about making that confirmed action reversible, not about skipping the
/// confirmation. Not a full Recycle Bin: no restore UI beyond the app's own
/// undo stack, and entries accumulate here rather than expiring.
#[tauri::command(async)]
pub fn file_explorer_soft_delete(app: tauri::AppHandle, paths: Vec<String>) -> Result<Vec<TrashedEntry>, String> {
  let trash = trash_dir(&app)?;
  let mut results = Vec::new();
  for p in paths {
    let src_path = Path::new(&p);
    let file_name = src_path
      .file_name()
      .ok_or_else(|| format!("Invalid path: {p}"))?
      .to_string_lossy()
      .to_string();
    // Prefix with a short unique token so two different folders' same-named
    // files don't collide inside the flat trash directory.
    let token = format!("{:x}", std::time::SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_nanos());
    let trash_name = format!("{token}-{file_name}");
    let trash_path = trash.join(&trash_name);
    if std::fs::rename(src_path, &trash_path).is_err() {
      copy_recursive(src_path, &trash_path).map_err(|e| format!("{p}: {e}"))?;
      remove_path(src_path).map_err(|e| format!("{p}: {e}"))?;
    }
    results.push(TrashedEntry {
      original_path: p,
      trash_path: trash_path.to_string_lossy().to_string(),
    });
  }
  Ok(results)
}

/// Moves a previously soft-deleted item back to its original path — the
/// undo half of `file_explorer_soft_delete`.
#[tauri::command(async)]
pub fn file_explorer_restore(trash_path: String, original_path: String) -> Result<DirEntryInfo, String> {
  let trash = Path::new(&trash_path);
  let dest = Path::new(&original_path);
  if let Some(parent) = dest.parent() {
    std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
  }
  if std::fs::rename(trash, dest).is_err() {
    copy_recursive(trash, dest).map_err(|e| e.to_string())?;
    remove_path(trash).map_err(|e| e.to_string())?;
  }
  entry_info(dest.to_path_buf()).ok_or_else(|| "Failed to stat restored entry".to_string())
}

fn unique_destination(dest_dir: &Path, file_name: &str) -> PathBuf {
  let candidate = dest_dir.join(file_name);
  if !candidate.exists() {
    return candidate;
  }
  let stem = Path::new(file_name)
    .file_stem()
    .map(|s| s.to_string_lossy().to_string())
    .unwrap_or_else(|| file_name.to_string());
  let ext = Path::new(file_name)
    .extension()
    .map(|e| e.to_string_lossy().to_string());
  let mut n = 2;
  loop {
    let candidate_name = match &ext {
      Some(ext) => format!("{stem} ({n}).{ext}"),
      None => format!("{stem} ({n})"),
    };
    let candidate = dest_dir.join(candidate_name);
    if !candidate.exists() {
      return candidate;
    }
    n += 1;
  }
}

fn copy_recursive(src: &Path, dest: &Path) -> std::io::Result<()> {
  if src.is_dir() {
    std::fs::create_dir_all(dest)?;
    for entry in std::fs::read_dir(src)? {
      let entry = entry?;
      copy_recursive(&entry.path(), &dest.join(entry.file_name()))?;
    }
    Ok(())
  } else {
    std::fs::copy(src, dest).map(|_| ())
  }
}

/// Counts files under `path` (a file counts as 1) — used up front so
/// progress events can report "N of TOTAL" rather than an indeterminate
/// spinner for multi-file/folder transfers.
fn count_files(path: &Path) -> usize {
  if path.is_dir() {
    std::fs::read_dir(path)
      .map(|read_dir| read_dir.flatten().map(|e| count_files(&e.path())).sum())
      .unwrap_or(0)
  } else {
    1
  }
}

#[derive(Debug, Clone, Serialize)]
struct TransferProgress {
  /// Echoed back so the frontend can ignore events from a superseded transfer.
  transfer_id: String,
  done: usize,
  total: usize,
  current_name: String,
}

fn copy_recursive_tracked(
  app: &tauri::AppHandle,
  transfer_id: &str,
  src: &Path,
  dest: &Path,
  done: &mut usize,
  total: usize,
) -> std::io::Result<()> {
  use tauri::Emitter;
  if src.is_dir() {
    std::fs::create_dir_all(dest)?;
    for entry in std::fs::read_dir(src)? {
      let entry = entry?;
      copy_recursive_tracked(app, transfer_id, &entry.path(), &dest.join(entry.file_name()), done, total)?;
    }
  } else {
    std::fs::copy(src, dest)?;
    *done += 1;
    let _ = app.emit(
      "file-explorer://transfer-progress",
      TransferProgress {
        transfer_id: transfer_id.to_string(),
        done: *done,
        total,
        current_name: src.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default(),
      },
    );
  }
  Ok(())
}

/// How to resolve a name collision at the destination — surfaced to the
/// user as a prompt (overwrite / keep both / skip) rather than silently
/// picking one, per file.
#[derive(Debug, Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ConflictMode {
  /// Auto-suffix on collision — today's default behavior, used when the
  /// caller hasn't asked the user yet (e.g. the very first collision check).
  KeepBoth,
  Overwrite,
  Skip,
}

fn resolve_destination(dest_dir: &Path, file_name: &str, mode: ConflictMode) -> Option<PathBuf> {
  let candidate = dest_dir.join(file_name);
  if !candidate.exists() {
    return Some(candidate);
  }
  match mode {
    ConflictMode::KeepBoth => Some(unique_destination(dest_dir, file_name)),
    ConflictMode::Overwrite => Some(candidate),
    ConflictMode::Skip => None,
  }
}

/// Copies each source path into `dest_dir`. `conflict_mode` governs every
/// collision in this batch uniformly — the frontend detects a collision
/// up front (via `file_explorer_check_conflicts`) and asks the user once
/// before calling this with their choice.
///
/// `async` + `spawn_blocking`: a copy of a large folder is real, possibly
/// slow disk I/O — running it synchronously on the IPC thread would freeze
/// the whole app the same way the old recursive search did. `transfer_id`
/// is echoed back on every `file-explorer://transfer-progress` event this
/// emits, so the frontend can show "N of TOTAL" and ignore stale events
/// from a transfer it's no longer tracking.
#[tauri::command]
pub async fn file_explorer_copy(
  app: tauri::AppHandle,
  source_paths: Vec<String>,
  dest_dir: String,
  conflict_mode: ConflictMode,
  transfer_id: String,
) -> Result<Vec<DirEntryInfo>, String> {
  tauri::async_runtime::spawn_blocking(move || {
    let dest_dir = Path::new(&dest_dir);
    let total: usize = source_paths.iter().map(|p| count_files(Path::new(p))).sum();
    let mut done = 0usize;
    let mut results = Vec::new();
    for src in source_paths {
      let src_path = Path::new(&src);
      let file_name = src_path
        .file_name()
        .ok_or_else(|| format!("Invalid source path: {src}"))?
        .to_string_lossy()
        .to_string();
      let Some(dest_path) = resolve_destination(dest_dir, &file_name, conflict_mode) else {
        continue;
      };
      if dest_path.exists() && matches!(conflict_mode, ConflictMode::Overwrite) {
        remove_path(&dest_path).map_err(|e| format!("{file_name}: {e}"))?;
      }
      copy_recursive_tracked(&app, &transfer_id, src_path, &dest_path, &mut done, total)
        .map_err(|e| format!("{src}: {e}"))?;
      if let Some(info) = entry_info(dest_path) {
        results.push(info);
      }
    }
    Ok(results)
  })
  .await
  .map_err(|e| e.to_string())?
}

/// Moves (cuts) each source path into `dest_dir`. Falls back to copy+delete
/// when `rename` fails, which happens when source and destination are on
/// different drives/volumes. Same `conflict_mode`/`transfer_id`/async
/// contract as `file_explorer_copy`. A same-volume `rename` is effectively
/// instant regardless of folder size, so progress events only fire on the
/// copy+delete fallback path.
#[tauri::command]
pub async fn file_explorer_move(
  app: tauri::AppHandle,
  source_paths: Vec<String>,
  dest_dir: String,
  conflict_mode: ConflictMode,
  transfer_id: String,
) -> Result<Vec<DirEntryInfo>, String> {
  tauri::async_runtime::spawn_blocking(move || {
    let dest_dir_path = Path::new(&dest_dir);
    let total: usize = source_paths.iter().map(|p| count_files(Path::new(p))).sum();
    let mut done = 0usize;
    let mut results = Vec::new();
    for src in source_paths {
      let src_path = Path::new(&src);
      let file_name = src_path
        .file_name()
        .ok_or_else(|| format!("Invalid source path: {src}"))?
        .to_string_lossy()
        .to_string();
      let Some(dest_path) = resolve_destination(dest_dir_path, &file_name, conflict_mode) else {
        continue;
      };
      if dest_path.exists() && matches!(conflict_mode, ConflictMode::Overwrite) {
        remove_path(&dest_path).map_err(|e| format!("{file_name}: {e}"))?;
      }
      if std::fs::rename(src_path, &dest_path).is_err() {
        copy_recursive_tracked(&app, &transfer_id, src_path, &dest_path, &mut done, total)
          .map_err(|e| format!("{src}: {e}"))?;
        remove_path(src_path).map_err(|e| format!("{src}: {e}"))?;
      }
      if let Some(info) = entry_info(dest_path) {
        results.push(info);
      }
    }
    Ok(results)
  })
  .await
  .map_err(|e| e.to_string())?
}

/// Checks which of `source_paths` would collide with an existing entry of
/// the same name in `dest_dir` — called before copy/move so the frontend
/// can prompt the user once, up front, rather than failing/clobbering
/// mid-batch.
#[tauri::command(async)]
pub fn file_explorer_check_conflicts(source_paths: Vec<String>, dest_dir: String) -> Vec<String> {
  let dest_dir = Path::new(&dest_dir);
  source_paths
    .into_iter()
    .filter(|src| {
      Path::new(src)
        .file_name()
        .map(|name| dest_dir.join(name).exists())
        .unwrap_or(false)
    })
    .collect()
}

fn duplicate_destination(dir: &Path, file_name: &str) -> PathBuf {
  let stem = Path::new(file_name)
    .file_stem()
    .map(|s| s.to_string_lossy().to_string())
    .unwrap_or_else(|| file_name.to_string());
  let ext = Path::new(file_name).extension().map(|e| e.to_string_lossy().to_string());
  let base_name = match &ext {
    Some(ext) => format!("{stem} - Copy.{ext}"),
    None => format!("{stem} - Copy"),
  };
  let candidate = dir.join(&base_name);
  if !candidate.exists() {
    return candidate;
  }
  unique_destination(dir, &base_name)
}

/// Duplicates a single item into the same folder, named "<name> - Copy"
/// (Explorer's paste-into-same-folder convention) without needing a
/// separate copy+paste round trip.
#[tauri::command(async)]
pub fn file_explorer_duplicate(path: String) -> Result<DirEntryInfo, String> {
  let src = Path::new(&path);
  let file_name = src
    .file_name()
    .ok_or_else(|| format!("Invalid path: {path}"))?
    .to_string_lossy()
    .to_string();
  let dir = src.parent().ok_or("Path has no parent")?;
  let dest = duplicate_destination(dir, &file_name);
  copy_recursive(src, &dest).map_err(|e| e.to_string())?;
  entry_info(dest).ok_or_else(|| "Failed to stat duplicated entry".to_string())
}

/// `async` + `spawn_blocking`: reading a file's full bytes is real disk
/// I/O — for a multi-MB file this was previously running synchronously on
/// the IPC thread, and Grid view fans this out once per visible image
/// simultaneously (see `file_explorer_read_thumbnail` below, which Grid
/// view should prefer). Same freeze class as the search/copy/move fixes.
#[tauri::command]
pub async fn file_explorer_read_file(file_path: String) -> Result<Vec<u8>, String> {
  tauri::async_runtime::spawn_blocking(move || std::fs::read(&file_path).map_err(|e| e.to_string()))
    .await
    .map_err(|e| e.to_string())?
}

/// Reads and downsizes an image to a small thumbnail (JPEG-encoded bytes,
/// longest edge capped at `max_dimension`) instead of handing back the
/// full original file — a 64px grid tile has no use for a 40MB RAW-sized
/// photo's full bytes, and decoding+shrinking here means the frontend
/// never has to pull the whole file across IPC just to draw a tiny tile.
/// `async` + `spawn_blocking` for the same reason as every other real I/O
/// command in this module; also bounds the CPU-bound decode/resize so it
/// can't itself become a fan-out freeze when many tiles load at once
/// (paired with a frontend concurrency limiter — see useImageThumbnail.ts).
#[tauri::command]
pub async fn file_explorer_read_thumbnail(file_path: String, max_dimension: u32) -> Result<Vec<u8>, String> {
  tauri::async_runtime::spawn_blocking(move || {
    let img = image::open(&file_path).map_err(|e| e.to_string())?;
    let thumbnail = img.thumbnail(max_dimension, max_dimension);
    let mut buffer = Vec::new();
    thumbnail
      .to_rgb8()
      .write_to(&mut std::io::Cursor::new(&mut buffer), image::ImageFormat::Jpeg)
      .map_err(|e| e.to_string())?;
    Ok(buffer)
  })
  .await
  .map_err(|e| e.to_string())?
}

/// Reads a text file as UTF-8 (lossy) for the in-app text preview, capped
/// so opening a huge log/binary-ish file can't stall the UI.
#[tauri::command(async)]
pub fn file_explorer_read_text_preview(file_path: String) -> Result<String, String> {
  let bytes = std::fs::read(&file_path).map_err(|e| e.to_string())?;
  let capped = &bytes[..bytes.len().min(200_000)];
  Ok(String::from_utf8_lossy(capped).to_string())
}

/// Opens a file (or reveals a folder) with the OS default handler.
#[tauri::command(async)]
pub fn file_explorer_open_with_system(path: String) -> Result<(), String> {
  opener::open(&path).map_err(|e| e.to_string())
}

/// Best-effort quick-access locations detectable on this system (home,
/// desktop, documents, downloads, pictures, music) — entries that don't
/// exist on this machine are simply omitted.
#[tauri::command(async)]
pub fn file_explorer_quick_access() -> Vec<QuickAccessLocation> {
  let mut locations = Vec::new();
  let candidates: Vec<(&str, Option<PathBuf>)> = vec![
    ("Home", dirs::home_dir()),
    ("Desktop", dirs::desktop_dir()),
    ("Documents", dirs::document_dir()),
    ("Downloads", dirs::download_dir()),
    ("Pictures", dirs::picture_dir()),
    ("Music", dirs::audio_dir()),
  ];
  for (name, path) in candidates {
    if let Some(path) = path {
      if path.is_dir() {
        locations.push(QuickAccessLocation {
          name: name.to_string(),
          path: path.to_string_lossy().to_string(),
        });
      }
    }
  }
  locations
}

#[cfg(test)]
mod office_template_tests {
  use super::office_templates;

  #[test]
  fn docx_is_valid_zip_with_required_parts() {
    let bytes = office_templates::empty_docx().unwrap();
    let mut zip = zip::ZipArchive::new(std::io::Cursor::new(bytes)).unwrap();
    assert!(zip.by_name("[Content_Types].xml").is_ok());
    assert!(zip.by_name("word/document.xml").is_ok());
  }

  #[test]
  fn xlsx_is_valid_zip_with_required_parts() {
    let bytes = office_templates::empty_xlsx().unwrap();
    let mut zip = zip::ZipArchive::new(std::io::Cursor::new(bytes)).unwrap();
    assert!(zip.by_name("xl/workbook.xml").is_ok());
    assert!(zip.by_name("xl/worksheets/sheet1.xml").is_ok());
  }

  #[test]
  fn pptx_is_valid_zip_with_required_parts() {
    let bytes = office_templates::empty_pptx().unwrap();
    let mut zip = zip::ZipArchive::new(std::io::Cursor::new(bytes)).unwrap();
    assert!(zip.by_name("ppt/presentation.xml").is_ok());
    assert!(zip.by_name("ppt/slides/slide1.xml").is_ok());
  }
}
