//! The instrument sample cache: gets sample files onto local disk so the
//! native engine can decode them.
//!
//! ## The problem this solves
//! The previous Web Audio engine streamed every instrument sample from a
//! remote CDN at play time, which had three consequences: the first note
//! of any instrument waited on a network round trip, nothing worked
//! offline, and — fatally for the native engine — a Rust audio thread has
//! no fetch API to lean on. The engine needs a real file path.
//!
//! ## Why a cache rather than bundling the samples
//! The full multi-instrument sample set is on the order of a hundred
//! megabytes. Bundling it would inflate every install, including for
//! users who never open Studio, and would put large binaries in the repo.
//! Downloading once into the app's data directory keeps the installer
//! small and, after first use, is strictly better than the old behaviour:
//! subsequent loads are local-disk reads with no network at all.
//!
//! ## Integrity and partial writes
//! A download interrupted midway would otherwise leave a truncated file
//! that decodes as garbage or silence — the kind of failure that presents
//! as "this instrument sounds broken" rather than "the download failed".
//! Every file is therefore written to a `.part` temporary and renamed
//! into place only once the body is fully read; a rename on the same
//! volume is atomic, so a cached path either does not exist or is
//! complete.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

/// One sample file to make available locally.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SampleRequest {
  /// Stable key the engine uses to refer to this sample, e.g.
  /// "piano/C4" or "drums/kick". Doubles as the cache-relative path.
  pub key: String,
  /// Absolute URL to fetch from if the file is not cached yet.
  pub url: String,
}

/// Where a requested sample ended up, plus whether the network was used.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SampleResult {
  pub key: String,
  /// Absolute local path, ready to hand to the decoder.
  pub path: String,
  /// False when the file was already cached — lets the UI show a
  /// one-time "downloading instrument" state only when it is real.
  pub downloaded: bool,
}

/// Root of the sample cache: `<app data>/studio-samples`.
fn cache_root(app: &AppHandle) -> Result<PathBuf, String> {
  let dir = app
    .path()
    .app_data_dir()
    .map_err(|e| format!("Could not find where to store instrument sounds: {e}"))?
    .join("studio-samples");
  std::fs::create_dir_all(&dir)
    .map_err(|e| format!("Could not create the instrument sound folder: {e}"))?;
  Ok(dir)
}

/// Rejects keys that would escape the cache directory.
///
/// Sample keys are currently authored in-app, but they are strings that
/// become filesystem paths, so a key like `../../evil` must not be able
/// to write outside the cache. Validating here keeps that guarantee at
/// the boundary rather than relying on every caller to be careful.
fn is_safe_key(key: &str) -> bool {
  !key.is_empty()
    && !key.starts_with('/')
    && !key.starts_with('\\')
    && !key.contains("..")
    && !key.contains(':')
    && key
      .chars()
      .all(|c| c.is_ascii_alphanumeric() || matches!(c, '/' | '-' | '_' | '.' | '#'))
}

/// Resolves a sample key to its local path, downloading it if needed.
///
/// Returns the path whether or not a download happened, so callers can
/// treat a cached and a freshly-fetched sample identically.
pub async fn ensure_sample(app: &AppHandle, req: &SampleRequest) -> Result<SampleResult, String> {
  if !is_safe_key(&req.key) {
    return Err(format!("\"{}\" is not a valid instrument sound name.", req.key));
  }

  let root = cache_root(app)?;
  let path = root.join(&req.key);

  if path.is_file() {
    return Ok(SampleResult {
      key: req.key.clone(),
      path: path.to_string_lossy().to_string(),
      downloaded: false,
    });
  }

  if let Some(parent) = path.parent() {
    std::fs::create_dir_all(parent)
      .map_err(|e| format!("Could not prepare the instrument sound folder: {e}"))?;
  }

  let bytes = reqwest::get(&req.url)
    .await
    .map_err(|e| {
      format!(
        "Could not download the sound for \"{}\". Check your internet connection. ({e})",
        req.key
      )
    })?
    .error_for_status()
    .map_err(|e| format!("The sound for \"{}\" is unavailable: {e}", req.key))?
    .bytes()
    .await
    .map_err(|e| format!("The download for \"{}\" was interrupted: {e}", req.key))?;

  if bytes.is_empty() {
    return Err(format!("The sound file for \"{}\" was empty.", req.key));
  }

  // Write-then-rename: a crash mid-download leaves a .part file, never a
  // truncated sample that would decode as noise or silence.
  let temp = path.with_extension("part");
  std::fs::write(&temp, &bytes)
    .map_err(|e| format!("Could not save the sound for \"{}\": {e}", req.key))?;
  std::fs::rename(&temp, &path).map_err(|e| {
    let _ = std::fs::remove_file(&temp);
    format!("Could not finish saving the sound for \"{}\": {e}", req.key)
  })?;

  Ok(SampleResult {
    key: req.key.clone(),
    path: path.to_string_lossy().to_string(),
    downloaded: true,
  })
}

/// Ensures many samples, returning results in the same order.
///
/// Fetched sequentially rather than in parallel: an instrument is dozens
/// of files from one host, and opening dozens of simultaneous connections
/// to it is both rude and usually slower than reusing one.
#[tauri::command]
pub async fn studio_ensure_samples(
  app: AppHandle,
  requests: Vec<SampleRequest>,
) -> Result<Vec<SampleResult>, String> {
  let mut out = Vec::with_capacity(requests.len());
  for req in &requests {
    out.push(ensure_sample(&app, req).await?);
  }
  Ok(out)
}

/// Reports how much disk the cache is using, for the settings screen.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheInfo {
  pub path: String,
  pub file_count: u64,
  pub bytes: u64,
}

fn measure(dir: &Path, count: &mut u64, bytes: &mut u64) {
  let Ok(entries) = std::fs::read_dir(dir) else { return };
  for entry in entries.flatten() {
    let Ok(meta) = entry.metadata() else { continue };
    if meta.is_dir() {
      measure(&entry.path(), count, bytes);
    } else {
      *count += 1;
      *bytes += meta.len();
    }
  }
}

#[tauri::command]
pub fn studio_sample_cache_info(app: AppHandle) -> Result<CacheInfo, String> {
  let root = cache_root(&app)?;
  let mut file_count = 0;
  let mut bytes = 0;
  measure(&root, &mut file_count, &mut bytes);
  Ok(CacheInfo {
    path: root.to_string_lossy().to_string(),
    file_count,
    bytes,
  })
}

/// Deletes every cached sample. Instruments re-download on next use.
#[tauri::command]
pub fn studio_clear_sample_cache(app: AppHandle) -> Result<(), String> {
  let root = cache_root(&app)?;
  std::fs::remove_dir_all(&root)
    .map_err(|e| format!("Could not clear the instrument sound cache: {e}"))?;
  std::fs::create_dir_all(&root)
    .map_err(|e| format!("Could not recreate the instrument sound folder: {e}"))?;
  Ok(())
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn accepts_ordinary_sample_keys() {
    assert!(is_safe_key("piano/C4.mp3"));
    assert!(is_safe_key("drums/kick.ogg"));
    assert!(is_safe_key("guitar-electric/A#3.mp3"));
    assert!(is_safe_key("strings/Cs4.ogg"));
  }

  #[test]
  fn rejects_path_traversal() {
    // The failure this guards: a key that writes outside the cache.
    assert!(!is_safe_key("../secrets"));
    assert!(!is_safe_key("piano/../../etc/passwd"));
    assert!(!is_safe_key("/absolute/path"));
    assert!(!is_safe_key("\\windows\\path"));
    assert!(!is_safe_key("C:/windows/system32"));
  }

  #[test]
  fn rejects_empty_and_exotic_keys() {
    assert!(!is_safe_key(""));
    assert!(!is_safe_key("with spaces"));
    assert!(!is_safe_key("semi;colon"));
    assert!(!is_safe_key("pipe|char"));
  }

  #[test]
  fn sharp_notes_are_valid_because_note_names_use_them() {
    // Sample sets name black keys with '#', so rejecting it would break
    // every sharp note in every instrument.
    assert!(is_safe_key("piano/F#4.mp3"));
  }
}
