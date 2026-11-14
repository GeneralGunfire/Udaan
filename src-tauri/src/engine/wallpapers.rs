//! Wallpaper service: a library of pictures on disk, served at the size they are shown.
//!
//! A wallpaper picked from disk used to be handed to every window that shows it as the
//! original file. A 5120x2880 image decodes to about 59 MB of pixels in each renderer that
//! draws it, to be shown on a 1920x1080 screen. This service produces a cached JPEG scaled
//! to the screen once, in Rust, and everything draws that instead (about 8 MB), so the
//! decode cost and the memory both drop by the same factor. The original file is never
//! modified.
//!
//! It also scans folders into a library (name, dimensions, size) and makes small
//! thumbnails, which is what a wallpaper picker needs, so it is the foundation that picker
//! will be built on.

use image::imageops::FilterType;
use serde::Serialize;
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};

/// Cached copies kept on disk; the least recently written are deleted beyond this.
const CACHE_LIMIT: usize = 40;
const EXTENSIONS: [&str; 5] = ["png", "jpg", "jpeg", "webp", "bmp"];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WallpaperInfo {
  /// The wallpaper id the rest of the app uses: `file:<absolute path>`.
  pub id: String,
  pub path: String,
  pub name: String,
  pub width: u32,
  pub height: u32,
  pub bytes: u64,
}

fn cache_dir() -> Option<PathBuf> {
  let dir = dirs::data_local_dir()?.join("dev.udaan.workstation").join("wallpaper-cache");
  std::fs::create_dir_all(&dir).ok()?;
  Some(dir)
}

fn is_image(path: &Path) -> bool {
  path.extension().and_then(|e| e.to_str()).map(|e| EXTENSIONS.contains(&e.to_ascii_lowercase().as_str())).unwrap_or(false)
}

/// A name for the cached copy that changes whenever the source file or the requested size
/// does, so a replaced picture is never served stale.
fn cache_key(src: &Path, w: u32, h: u32, quality: u8) -> String {
  let meta = std::fs::metadata(src).ok();
  let mtime = meta.as_ref().and_then(|m| m.modified().ok()).and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_secs()).unwrap_or(0);
  let mut h2 = DefaultHasher::new();
  (src.to_string_lossy().to_lowercase(), meta.map(|m| m.len()).unwrap_or(0), mtime, w, h, quality).hash(&mut h2);
  format!("{:016x}", h2.finish())
}

/// Returns a picture that covers `max_w` x `max_h` without being bigger than needed: the
/// original if it is already that small, otherwise a cached scaled JPEG.
pub fn fit_in(cache: &Path, src: &Path, max_w: u32, max_h: u32, quality: u8) -> Result<PathBuf, String> {
  let (w, h) = image::image_dimensions(src).map_err(|e| format!("cannot read {}: {e}", src.display()))?;
  // Scale so the picture still covers the whole target (it is cropped, not letterboxed).
  let scale = (max_w as f64 / w as f64).max(max_h as f64 / h as f64);
  if scale >= 1.0 {
    return Ok(src.to_path_buf());
  }
  let out = cache.join(format!("{}.jpg", cache_key(src, max_w, max_h, quality)));
  if out.is_file() {
    return Ok(out);
  }
  let img = image::open(src).map_err(|e| format!("cannot decode {}: {e}", src.display()))?;
  let (nw, nh) = (((w as f64 * scale).round() as u32).max(1), ((h as f64 * scale).round() as u32).max(1));
  let scaled = img.resize_exact(nw, nh, FilterType::Triangle).to_rgb8();
  // Write beside, then rename, so a half-written file is never served.
  let tmp = out.with_extension("tmp");
  {
    let file = std::fs::File::create(&tmp).map_err(|e| e.to_string())?;
    let mut enc = image::codecs::jpeg::JpegEncoder::new_with_quality(std::io::BufWriter::new(file), quality);
    enc.encode_image(&scaled).map_err(|e| e.to_string())?;
  }
  std::fs::rename(&tmp, &out).map_err(|e| e.to_string())?;
  prune(cache);
  Ok(out)
}

/// Keeps the cache to [`CACHE_LIMIT`] files, oldest deleted first.
fn prune(cache: &Path) {
  let Ok(rd) = std::fs::read_dir(cache) else { return };
  let mut files: Vec<_> = rd.flatten().filter_map(|e| Some((e.metadata().ok()?.modified().ok()?, e.path()))).collect();
  if files.len() <= CACHE_LIMIT {
    return;
  }
  files.sort_by_key(|(t, _)| *t);
  for (_, p) in files.iter().take(files.len() - CACHE_LIMIT) {
    let _ = std::fs::remove_file(p);
  }
}

/// Scans folders (not recursively) for pictures. Reads only each file's header for its size.
pub fn scan_dirs(dirs: &[PathBuf]) -> Vec<WallpaperInfo> {
  let mut out = Vec::new();
  for dir in dirs {
    let Ok(rd) = std::fs::read_dir(dir) else { continue };
    for entry in rd.flatten() {
      let path = entry.path();
      if !path.is_file() || !is_image(&path) {
        continue;
      }
      let Ok((width, height)) = image::image_dimensions(&path) else { continue };
      let bytes = entry.metadata().map(|m| m.len()).unwrap_or(0);
      let p = path.to_string_lossy().to_string();
      let name = path.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
      out.push(WallpaperInfo { id: format!("file:{p}"), path: p, name, width, height, bytes });
    }
  }
  out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
  out
}

/// A picture sized for the screen it is shown on. Returns the path to draw.
#[tauri::command]
pub async fn wallpaper_fit(path: String, width: u32, height: u32) -> Result<String, String> {
  tauri::async_runtime::spawn_blocking(move || {
    let cache = cache_dir().ok_or("no cache folder")?;
    fit_in(&cache, Path::new(&path), width.max(1), height.max(1), 90).map(|p| p.to_string_lossy().to_string())
  })
  .await
  .map_err(|e| e.to_string())?
}

/// A small picture for a picker grid.
#[tauri::command]
pub async fn wallpaper_thumb(path: String, max_width: u32) -> Result<String, String> {
  tauri::async_runtime::spawn_blocking(move || {
    let cache = cache_dir().ok_or("no cache folder")?;
    let w = max_width.clamp(64, 1024);
    fit_in(&cache, Path::new(&path), w, w * 9 / 16, 80).map(|p| p.to_string_lossy().to_string())
  })
  .await
  .map_err(|e| e.to_string())?
}

/// The pictures in the given folders.
#[tauri::command]
pub async fn wallpaper_scan(dirs: Vec<String>) -> Vec<WallpaperInfo> {
  tauri::async_runtime::spawn_blocking(move || scan_dirs(&dirs.into_iter().map(PathBuf::from).collect::<Vec<_>>()))
    .await
    .unwrap_or_default()
}

#[cfg(test)]
mod tests {
  use super::*;

  fn temp_dir(name: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("udaan_wp_{name}_{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    d
  }

  fn make_png(path: &Path, w: u32, h: u32) {
    image::RgbImage::from_fn(w, h, |x, y| image::Rgb([(x % 256) as u8, (y % 256) as u8, 120])).save(path).unwrap();
  }

  #[test]
  fn large_pictures_are_scaled_to_cover_and_cached() {
    let dir = temp_dir("fit");
    let src = dir.join("big.png");
    make_png(&src, 400, 300);
    let cache = dir.join("cache");
    std::fs::create_dir_all(&cache).unwrap();

    let out = fit_in(&cache, &src, 200, 100, 85).unwrap();
    assert_ne!(out, src, "a larger picture must be replaced by a scaled copy");
    let (w, h) = image::image_dimensions(&out).unwrap();
    // cover: scale = max(200/400, 100/300) = 0.5, so 200x150 (covers 200x100 without letterboxing)
    assert_eq!((w, h), (200, 150));
    // second call is a cache hit: same path, no rewrite
    let again = fit_in(&cache, &src, 200, 100, 85).unwrap();
    assert_eq!(again, out);
  }

  #[test]
  fn pictures_already_small_enough_are_returned_untouched() {
    let dir = temp_dir("small");
    let src = dir.join("small.png");
    make_png(&src, 100, 80);
    let cache = dir.join("cache");
    std::fs::create_dir_all(&cache).unwrap();
    assert_eq!(fit_in(&cache, &src, 1920, 1080, 90).unwrap(), src);
    assert_eq!(std::fs::read_dir(&cache).unwrap().count(), 0, "nothing should be written");
  }

  #[test]
  fn scan_reads_sizes_and_ignores_other_files() {
    let dir = temp_dir("scan");
    make_png(&dir.join("b.png"), 64, 32);
    make_png(&dir.join("A.png"), 10, 20);
    std::fs::write(dir.join("notes.txt"), "not a picture").unwrap();
    let found = scan_dirs(&[dir.clone()]);
    assert_eq!(found.len(), 2);
    assert_eq!(found[0].name, "A", "sorted by name, case-insensitive");
    assert_eq!((found[1].width, found[1].height), (64, 32));
    assert!(found[0].id.starts_with("file:"));
  }
}
