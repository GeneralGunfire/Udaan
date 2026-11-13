//! Backend for the Private Player port: scans a local folder of audio
//! files, reads ID3/Vorbis/etc. tags (title/artist/album/duration/embedded
//! cover art) via `lofty`, and persists player settings (music folder,
//! last-played track + position, volume, shuffle/repeat) and user playlists
//! in the same SQLite-backed `Store` convention as document_reader/notes.
//!
//! Playback itself streams straight off disk through Tauri's asset
//! protocol (see `tauri.conf.json` / capabilities) rather than crossing the
//! IPC bridge as bytes — files here run to ~13MB, too large to shuttle
//! through `invoke` on every track change without a stutter.

mod analysis;
mod stems;
mod store;

use std::path::Path;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};

pub use analysis::TrackAnalysis;
pub use stems::{StemPaths, StemStatus};
pub use store::{DjPreset, PlayerSettings, StoredPlaylist};
use store::Store;

const AUDIO_EXTENSIONS: &[&str] = &["mp3", "wav", "ogg", "flac", "m4a", "aac"];

pub struct AudioLibraryState {
  store: Arc<Store>,
}

pub fn init(app: &AppHandle) -> Result<AudioLibraryState, String> {
  let data_dir = app
    .path()
    .app_data_dir()
    .map_err(|e| format!("Failed to resolve app data dir: {e}"))?;
  std::fs::create_dir_all(&data_dir).map_err(|e| format!("Failed to create app data dir: {e}"))?;
  let db_path = data_dir.join("audio_library.sqlite3");

  let store = Arc::new(Store::open(db_path).map_err(|e| format!("Failed to open audio_library store: {e}"))?);
  Ok(AudioLibraryState { store })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AudioTrack {
  /// Absolute filesystem path — also the stable identifier used everywhere
  /// else (playlists, last-played, queue) since there's no separate DB of
  /// track rows to key against.
  pub path: String,
  #[serde(rename = "fileName")]
  pub file_name: String,
  pub title: String,
  pub artist: String,
  pub album: String,
  /// Seconds; None when a tag reader couldn't determine it.
  #[serde(rename = "durationSeconds")]
  pub duration_seconds: Option<f64>,
  /// True when an embedded cover picture was found — the frontend fetches
  /// it separately via `audio_library_read_cover` rather than inlining
  /// base64 into every scan result.
  #[serde(rename = "hasCoverArt")]
  pub has_cover_art: bool,
}

fn is_audio_file(path: &Path) -> bool {
  path
    .extension()
    .and_then(|ext| ext.to_str())
    .map(|ext| AUDIO_EXTENSIONS.contains(&ext.to_lowercase().as_str()))
    .unwrap_or(false)
}

fn read_track_tags(path: &Path) -> AudioTrack {
  use lofty::file::{AudioFile, TaggedFileExt};
  use lofty::prelude::Accessor;

  let file_name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
  let fallback_title = path.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| file_name.clone());

  let probe = lofty::probe::Probe::open(path).and_then(|p| p.read());

  match probe {
    Ok(tagged) => {
      let tag = tagged.primary_tag().or_else(|| tagged.first_tag());
      // Empty rather than "Unknown Album" when the tag is missing — most
      // files in a typical folder here are untagged rips with no real
      // album metadata at all, so that placeholder was showing up as
      // repetitive noise on nearly every track across the UI. An empty
      // string lets each render site simply omit the album when there's
      // nothing real to show (NowPlayingView.tsx already guards on
      // `track?.album` being truthy — this is what makes that guard
      // actually fire instead of always seeing a non-empty placeholder).
      let (title, artist, album, has_cover_art) = match tag {
        Some(t) => (
          t.title().map(|s| s.to_string()).unwrap_or_else(|| fallback_title.clone()),
          t.artist().map(|s| s.to_string()).unwrap_or_else(|| "Unknown Artist".to_string()),
          t.album().map(|s| s.to_string()).unwrap_or_default(),
          !t.pictures().is_empty(),
        ),
        None => (fallback_title.clone(), "Unknown Artist".to_string(), String::new(), false),
      };
      let duration_seconds = Some(tagged.properties().duration().as_secs_f64());
      AudioTrack { path: path.to_string_lossy().to_string(), file_name, title, artist, album, duration_seconds, has_cover_art }
    }
    Err(_) => AudioTrack {
      path: path.to_string_lossy().to_string(),
      file_name,
      title: fallback_title,
      artist: "Unknown Artist".to_string(),
      album: String::new(),
      duration_seconds: None,
      has_cover_art: false,
    },
  }
}

/// Scans a single directory (non-recursive, matching the original v1
/// design note: predictable — the user picks the folder that holds their
/// tracks) for supported audio files and reads each one's tags.
#[tauri::command]
pub fn audio_library_scan_folder(folder_path: String) -> Result<Vec<AudioTrack>, String> {
  let dir = Path::new(&folder_path);
  if !dir.is_dir() {
    return Err(format!("Not a directory: {folder_path}"));
  }

  let mut tracks = Vec::new();
  let read_dir = std::fs::read_dir(dir).map_err(|e| e.to_string())?;
  for entry in read_dir {
    let entry = entry.map_err(|e| e.to_string())?;
    let path = entry.path();
    if path.is_file() && is_audio_file(&path) {
      tracks.push(read_track_tags(&path));
    }
  }
  tracks.sort_by(|a, b| a.title.to_lowercase().cmp(&b.title.to_lowercase()));
  Ok(tracks)
}

/// Reads a track's embedded cover picture (if any) as raw bytes plus its
/// mime type, for the frontend to wrap in a blob URL. Returns `None` when
/// the file has no embedded picture rather than erroring, since "no cover
/// art" is an expected, common case this feature falls back on a generated
/// placeholder for.
#[tauri::command]
pub fn audio_library_read_cover(file_path: String) -> Result<Option<(String, Vec<u8>)>, String> {
  use lofty::file::TaggedFileExt;

  let path = Path::new(&file_path);
  let tagged = lofty::probe::Probe::open(path).and_then(|p| p.read()).map_err(|e| e.to_string())?;
  let tag = match tagged.primary_tag().or_else(|| tagged.first_tag()) {
    Some(t) => t,
    None => return Ok(None),
  };
  match tag.pictures().first() {
    Some(pic) => Ok(Some((pic.mime_type().map(|m| m.to_string()).unwrap_or_else(|| "image/jpeg".to_string()), pic.data().to_vec()))),
    None => Ok(None),
  }
}

#[tauri::command]
pub fn audio_library_get_settings(state: State<AudioLibraryState>) -> Result<PlayerSettings, String> {
  state.store.get_settings().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn audio_library_save_settings(state: State<AudioLibraryState>, settings: PlayerSettings) -> Result<(), String> {
  state.store.save_settings(&settings).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn audio_library_list_playlists(state: State<AudioLibraryState>) -> Result<Vec<StoredPlaylist>, String> {
  state.store.list_playlists().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn audio_library_save_playlist(state: State<AudioLibraryState>, playlist: StoredPlaylist) -> Result<(), String> {
  state.store.upsert_playlist(&playlist).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn audio_library_delete_playlist(state: State<AudioLibraryState>, id: String) -> Result<(), String> {
  state.store.delete_playlist(&id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn audio_library_list_favorites(state: State<AudioLibraryState>) -> Result<Vec<String>, String> {
  state.store.list_favorites().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn audio_library_set_favorite(state: State<AudioLibraryState>, track_path: String, favorite: bool) -> Result<(), String> {
  state.store.set_favorite(&track_path, favorite).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn audio_library_list_dj_presets(state: State<AudioLibraryState>) -> Result<Vec<DjPreset>, String> {
  state.store.list_dj_presets().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn audio_library_save_dj_preset(state: State<AudioLibraryState>, preset: DjPreset) -> Result<(), String> {
  state.store.save_dj_preset(&preset).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn audio_library_delete_dj_preset(state: State<AudioLibraryState>, id: String) -> Result<(), String> {
  state.store.delete_dj_preset(&id).map_err(|e| e.to_string())
}

/// Copies a picked file into the music folder so it becomes a permanent
/// part of the library (no re-upload/re-picking needed on future
/// launches — a plain folder scan finds it from then on), then embeds a
/// randomly-picked cover picture borrowed from another track already in
/// the folder if the imported file has no cover art of its own. Returns
/// the new file's scanned AudioTrack so the frontend can add it to the
/// current view without a full re-scan.
#[tauri::command]
pub fn audio_library_import_file(source_path: String, music_folder: String) -> Result<AudioTrack, String> {
  use lofty::file::{AudioFile, TaggedFileExt};
  use lofty::picture::{Picture, PictureType};
  use lofty::tag::Tag;

  let source = Path::new(&source_path);
  if !source.is_file() || !is_audio_file(source) {
    return Err("Not a supported audio file".to_string());
  }
  let dest_dir = Path::new(&music_folder);
  if !dest_dir.is_dir() {
    return Err(format!("Music folder does not exist: {music_folder}"));
  }

  let file_name = source.file_name().ok_or("Source file has no name")?;
  let mut dest_path = dest_dir.join(file_name);
  // Avoid clobbering an existing file with the same name — append a
  // numeric suffix rather than silently overwriting someone's track.
  if dest_path.exists() {
    let stem = source.file_stem().and_then(|s| s.to_str()).unwrap_or("track");
    let ext = source.extension().and_then(|e| e.to_str()).unwrap_or("mp3");
    let mut n = 1;
    loop {
      let candidate = dest_dir.join(format!("{stem} ({n}).{ext}"));
      if !candidate.exists() {
        dest_path = candidate;
        break;
      }
      n += 1;
    }
  }

  std::fs::copy(source, &dest_path).map_err(|e| format!("Failed to copy file: {e}"))?;

  // If the imported file has no embedded cover, borrow one at random from
  // another track already in the folder — "a random cover from what's
  // already there," per the feature request, rather than generating a new
  // image (this app has no image-generation capability, and reusing real
  // embedded art keeps every cover visually consistent with the rest of
  // the library).
  let has_own_art = lofty::probe::Probe::open(&dest_path)
    .and_then(|p| p.read())
    .ok()
    .and_then(|t| t.primary_tag().or_else(|| t.first_tag()).map(|tag| !tag.pictures().is_empty()))
    .unwrap_or(false);

  if !has_own_art {
    if let Some(borrowed) = find_random_cover(dest_dir, &dest_path) {
      if let Ok(mut tagged) = lofty::probe::Probe::open(&dest_path).and_then(|p| p.read()) {
        let tag = match tagged.primary_tag_mut() {
          Some(t) => t,
          None => {
            tagged.insert_tag(Tag::new(tagged.primary_tag_type()));
            tagged.primary_tag_mut().unwrap()
          }
        };
        let picture = Picture::new_unchecked(
          PictureType::CoverFront,
          Some(lofty::picture::MimeType::from_str(&borrowed.0)),
          None,
          borrowed.1,
        );
        tag.push_picture(picture);
        if let Ok(mut file) = std::fs::OpenOptions::new().read(true).write(true).open(&dest_path) {
          let _ = tagged.save_to(&mut file, lofty::config::WriteOptions::default());
        }
      }
    }
  }

  Ok(read_track_tags(&dest_path))
}

/// Scans sibling audio files in `dir` (excluding `exclude`) for one that
/// already has embedded cover art, and returns that art's (mime, bytes).
/// Stops at the first hit rather than collecting every candidate first —
/// this only needs ONE borrowed cover, and the folder can hold hundreds of
/// files.
fn find_random_cover(dir: &Path, exclude: &Path) -> Option<(String, Vec<u8>)> {
  use lofty::file::TaggedFileExt;

  let mut candidates: Vec<_> = std::fs::read_dir(dir)
    .ok()?
    .filter_map(|e| e.ok())
    .map(|e| e.path())
    .filter(|p| p.is_file() && is_audio_file(p) && p != exclude)
    .collect();
  if candidates.is_empty() {
    return None;
  }
  // No `rand` dependency needed for a one-off "pick something" — a
  // nanosecond-resolution timestamp modulo the candidate count is plenty
  // random for "which existing cover does a freshly imported track
  // borrow," and rotating the start point means repeated imports don't
  // all land on the same first-found file with art.
  let seed = std::time::SystemTime::now()
    .duration_since(std::time::UNIX_EPOCH)
    .map(|d| d.subsec_nanos() as usize)
    .unwrap_or(0);
  let start = seed % candidates.len();
  candidates.rotate_left(start);

  for path in candidates {
    if let Ok(tagged) = lofty::probe::Probe::open(&path).and_then(|p| p.read()) {
      if let Some(tag) = tagged.primary_tag().or_else(|| tagged.first_tag()) {
        if let Some(pic) = tag.pictures().first() {
          return Some((pic.mime_type().map(|m| m.to_string()).unwrap_or_else(|| "image/jpeg".to_string()), pic.data().to_vec()));
        }
      }
    }
  }
  None
}

/// Analyses one track for tempo, key, beatgrid and loudness, returning a
/// cached result when one exists.
///
/// `blocking` work runs on Tauri's async runtime via `spawn_blocking`
/// rather than inline: a full decode plus two DSP passes takes on the
/// order of a second per track, and holding the command thread for that
/// would stall every other IPC call behind it during a library import.
#[tauri::command]
pub async fn audio_library_analyze_track(
  state: State<'_, AudioLibraryState>,
  track_path: String,
  force: Option<bool>,
) -> Result<TrackAnalysis, String> {
  let store = state.store.clone();

  if !force.unwrap_or(false) {
    if let Ok(Some(cached)) = store.get_analysis(&track_path) {
      if let Ok(parsed) = serde_json::from_value::<TrackAnalysis>(cached) {
        return Ok(parsed);
      }
      // A cache entry that no longer matches the current shape falls
      // through to a fresh analysis rather than failing the call.
    }
  }

  let path_for_task = track_path.clone();
  let result = tauri::async_runtime::spawn_blocking(move || analysis::analyze_file(Path::new(&path_for_task)))
    .await
    .map_err(|e| format!("Analysis task failed: {e}"))??;

  if let Ok(value) = serde_json::to_value(&result) {
    // A failed cache write is not a failed analysis — the caller still
    // gets its result, it just costs a recompute next time.
    if let Err(e) = store.save_analysis(&track_path, &value) {
      log::warn!("Failed to cache analysis for {track_path}: {e}");
    }
  }

  Ok(result)
}

/// Paths that already have cached analysis, so the UI can show progress
/// across a library without issuing one call per track.
#[tauri::command]
pub fn audio_library_list_analyzed(state: State<'_, AudioLibraryState>) -> Result<Vec<String>, String> {
  state
    .store
    .list_analyzed_paths()
    .map_err(|e| format!("Failed to list analyzed tracks: {e}"))
}

/// What can be done with a track's stems right now — ready, needs
/// separating, or needs the model downloading first.
#[tauri::command]
pub fn audio_library_stem_status(
  app: AppHandle,
  track_path: String,
) -> Result<StemStatus, String> {
  let data_dir = app
    .path()
    .app_data_dir()
    .map_err(|e| format!("Failed to resolve app data dir: {e}"))?;
  Ok(stems::stem_status(&data_dir, &track_path))
}

/// Starts separation for one track.
///
/// Runs on a blocking thread since separation is minutes of CPU-bound
/// work, not a query. Currently always errors — the pipeline is in place
/// but the model is not (see `stems.rs` module docs); the frontend
/// surfaces that as an offer to download rather than as a failure.
#[tauri::command]
pub async fn audio_library_separate_stems(
  app: AppHandle,
  track_path: String,
) -> Result<StemPaths, String> {
  let data_dir = app
    .path()
    .app_data_dir()
    .map_err(|e| format!("Failed to resolve app data dir: {e}"))?;
  tauri::async_runtime::spawn_blocking(move || stems::separate_track(&data_dir, &track_path))
    .await
    .map_err(|e| format!("Separation task failed: {e}"))?
}

/// Deletes a track's separated stems. Four WAV stems of a five-minute
/// track run to roughly 200MB, so this is a real need, not a tidy-up.
#[tauri::command]
pub fn audio_library_clear_stems(app: AppHandle, track_path: String) -> Result<(), String> {
  let data_dir = app
    .path()
    .app_data_dir()
    .map_err(|e| format!("Failed to resolve app data dir: {e}"))?;
  stems::clear_stems(&data_dir, &track_path)
}

/// Total bytes used by separated stems across the library.
#[tauri::command]
pub fn audio_library_stems_disk_usage(app: AppHandle) -> Result<u64, String> {
  let data_dir = app
    .path()
    .app_data_dir()
    .map_err(|e| format!("Failed to resolve app data dir: {e}"))?;
  Ok(stems::stems_disk_usage(&data_dir))
}
