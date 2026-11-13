//! Stem separation: splitting a track into vocals / drums / bass / other.
//!
//! # What is here and what is not
//!
//! This module owns the *pipeline*: where separated files live, how a
//! track's cache is looked up, what the frontend is told while a job is
//! pending, and how the whole thing degrades when separation is not
//! available. It does not own the model.
//!
//! That split is deliberate. A Demucs-class model is 80-300MB of weights
//! plus an `onnxruntime` native dependency — a large, platform-specific
//! addition to ship in an installer for a feature many users will never
//! open. So the model is fetched on demand the first time a user asks for
//! separation, and until then `stem_status` reports `ModelMissing` and
//! the UI offers the download rather than failing or silently doing
//! nothing.
//!
//! The consequence worth being explicit about: **separation does not work
//! yet.** `separate_track` returns `ModelMissing` for every call. What is
//! real and tested is everything around it — the cache layout, the status
//! contract, and the frontend playback path in `lib/stems.ts` that plays
//! four aligned sources once files exist. Wiring an actual model in means
//! implementing `run_separation` and adding the runtime dependency;
//! nothing else here changes shape.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

/// The four stems a Demucs-family model produces. Fixed rather than
/// configurable because the frontend's four-lane mixer is built around
/// exactly these.
pub const STEM_NAMES: [&str; 4] = ["vocals", "drums", "bass", "other"];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum StemStatus {
  /// Separated files exist on disk and are ready to play.
  Ready { paths: StemPaths },
  /// Never separated, and the model is present, so a job can be started.
  NotSeparated,
  /// The separation model has not been downloaded. The UI offers the
  /// download rather than presenting stems as broken.
  ModelMissing {
    #[serde(rename = "approxDownloadMb")]
    approx_download_mb: u32,
  },
  /// A job is running for this track.
  Separating { progress: f32 },
  /// A previous attempt failed. Carries the reason so the UI can say
  /// what went wrong rather than showing a generic failure.
  Failed { reason: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StemPaths {
  pub vocals: String,
  pub drums: String,
  pub bass: String,
  pub other: String,
}

/// Approximate download size quoted to the user before they commit to
/// fetching the model. Deliberately an over-estimate of a quantised
/// HT-Demucs export — quoting low and then downloading more is worse than
/// the reverse.
const APPROX_MODEL_DOWNLOAD_MB: u32 = 180;

/// Directory holding separated stems, under the app's data dir so it is
/// cleaned up with the app and never pollutes the user's music folder.
///
/// Stems are keyed by a hash of the source path rather than by filename:
/// two files called `track.wav` in different folders are different
/// tracks, and a filename can contain characters that are not valid in a
/// directory name on every platform.
pub fn stem_dir_for(data_dir: &Path, track_path: &str) -> PathBuf {
  data_dir.join("stems").join(hash_path(track_path))
}

/// FNV-1a over the path string. Not cryptographic and does not need to
/// be — this only needs to map a path to a stable, filesystem-safe
/// directory name, and a collision would at worst serve one track's
/// stems for another with an identical hash, which at 64 bits will not
/// happen across a personal music library.
fn hash_path(path: &str) -> String {
  let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
  for byte in path.as_bytes() {
    hash ^= *byte as u64;
    hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
  }
  format!("{hash:016x}")
}

/// Whether the separation model has been downloaded.
pub fn model_is_available(data_dir: &Path) -> bool {
  model_path(data_dir).is_file()
}

fn model_path(data_dir: &Path) -> PathBuf {
  data_dir.join("models").join("htdemucs.onnx")
}

/// Reports what can be done with a track right now.
///
/// Checks disk rather than a database: separated stems are files, and a
/// cache that disagrees with the filesystem (user cleared app data, disk
/// filled mid-write) is worse than no cache. Every stem must be present
/// for the set to count as ready — three of four is a failed job, not a
/// usable result.
pub fn stem_status(data_dir: &Path, track_path: &str) -> StemStatus {
  let dir = stem_dir_for(data_dir, track_path);
  let candidates: Vec<PathBuf> = STEM_NAMES.iter().map(|n| dir.join(format!("{n}.wav"))).collect();

  if candidates.iter().all(|p| p.is_file()) {
    return StemStatus::Ready {
      paths: StemPaths {
        vocals: candidates[0].to_string_lossy().into_owned(),
        drums: candidates[1].to_string_lossy().into_owned(),
        bass: candidates[2].to_string_lossy().into_owned(),
        other: candidates[3].to_string_lossy().into_owned(),
      },
    };
  }

  if !model_is_available(data_dir) {
    return StemStatus::ModelMissing {
      approx_download_mb: APPROX_MODEL_DOWNLOAD_MB,
    };
  }

  StemStatus::NotSeparated
}

/// Removes a track's separated stems. Four stems of a five-minute track
/// run to roughly 200MB of WAV, so a library-wide separation is
/// substantial disk use and needs a way back.
pub fn clear_stems(data_dir: &Path, track_path: &str) -> Result<(), String> {
  let dir = stem_dir_for(data_dir, track_path);
  if !dir.exists() {
    return Ok(());
  }
  std::fs::remove_dir_all(&dir).map_err(|e| format!("Failed to remove stems at {}: {e}", dir.display()))
}

/// Total bytes currently used by separated stems, so the UI can show
/// what the feature is costing before it grows without bound.
pub fn stems_disk_usage(data_dir: &Path) -> u64 {
  fn dir_size(path: &Path) -> u64 {
    let Ok(entries) = std::fs::read_dir(path) else {
      return 0;
    };
    entries
      .flatten()
      .map(|e| match e.metadata() {
        Ok(m) if m.is_dir() => dir_size(&e.path()),
        Ok(m) => m.len(),
        Err(_) => 0,
      })
      .sum()
  }
  dir_size(&data_dir.join("stems"))
}

/// Runs separation for one track.
///
/// Currently always reports `ModelMissing`: the ONNX runtime and model
/// weights are not part of the build (see the module docs for why). The
/// signature and the cache layout it writes into are settled, so adding
/// the model is a matter of implementing this function rather than
/// reshaping anything around it.
pub fn separate_track(data_dir: &Path, track_path: &str) -> Result<StemPaths, String> {
  if !model_is_available(data_dir) {
    return Err(format!(
      "The stem separation model is not installed. It is roughly {APPROX_MODEL_DOWNLOAD_MB}MB and is downloaded on first use."
    ));
  }
  // Unreachable until a model can actually be present. Left explicit
  // rather than as a todo!() so that if a model file somehow appears,
  // this returns a clear error instead of panicking and taking the app
  // down with it.
  let _ = track_path;
  Err("Stem separation is not implemented yet — the playback path is ready, the model is not wired in.".to_string())
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn hashes_are_stable_and_distinct() {
    assert_eq!(hash_path("/music/a.mp3"), hash_path("/music/a.mp3"));
    assert_ne!(hash_path("/music/a.mp3"), hash_path("/music/b.mp3"));
    // Two files with the same name in different folders must not share
    // a stem directory.
    assert_ne!(hash_path("/one/track.mp3"), hash_path("/two/track.mp3"));
  }

  #[test]
  fn hash_is_filesystem_safe() {
    let hashed = hash_path("C:\\Music\\Some: Track? *weird*.mp3");
    assert!(
      hashed.chars().all(|c| c.is_ascii_hexdigit()),
      "hash must be safe as a directory name, got {hashed}"
    );
  }

  #[test]
  fn reports_model_missing_before_download() {
    let dir = std::env::temp_dir().join("udaan_stem_test_missing");
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    match stem_status(&dir, "/music/a.mp3") {
      StemStatus::ModelMissing { approx_download_mb } => {
        assert!(approx_download_mb > 0);
      }
      other => panic!("expected ModelMissing, got {other:?}"),
    }
    let _ = std::fs::remove_dir_all(&dir);
  }

  /// A partial stem set must not read as ready — playing three of four
  /// stems would silently drop a whole instrument from the mix.
  #[test]
  fn partial_stem_set_is_not_ready() {
    let dir = std::env::temp_dir().join("udaan_stem_test_partial");
    let _ = std::fs::remove_dir_all(&dir);
    let track = "/music/partial.mp3";
    let stem_dir = stem_dir_for(&dir, track);
    std::fs::create_dir_all(&stem_dir).unwrap();
    // Model present, so a partial set cannot be excused as ModelMissing.
    std::fs::create_dir_all(dir.join("models")).unwrap();
    std::fs::write(dir.join("models").join("htdemucs.onnx"), b"stub").unwrap();
    for name in ["vocals", "drums", "bass"] {
      std::fs::write(stem_dir.join(format!("{name}.wav")), b"stub").unwrap();
    }
    assert!(
      matches!(stem_status(&dir, track), StemStatus::NotSeparated),
      "three of four stems must not report Ready"
    );
    let _ = std::fs::remove_dir_all(&dir);
  }
}
