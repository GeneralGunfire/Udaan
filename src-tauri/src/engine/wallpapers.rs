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
use serde::{Deserialize, Serialize};
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};

/// Cached copies kept on disk; the least recently written are deleted beyond this.
const CACHE_LIMIT: usize = 120;
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

// ---------------------------------------------------------------------------------------
// Rendering a picture for one specific screen
// ---------------------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FitMode {
  /// Fill the screen exactly, cropping what does not fit around a focal point.
  #[default]
  Fill,
  /// Show the whole picture; the rest of the screen is its own blurred colours.
  Fit,
}

/// How one picture is placed on the screen. Everything is optional: with nothing set, the
/// picture fills the screen around the part of it that matters most (see [`auto_focus`]).
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FitSpec {
  #[serde(default)]
  pub mode: FitMode,
  /// Focal point as a fraction of the picture (0..1). `None` = decided automatically.
  #[serde(default)]
  pub fx: Option<f32>,
  #[serde(default)]
  pub fy: Option<f32>,
  /// Extra zoom into the focal point, 1.0 to 4.0.
  #[serde(default = "one")]
  pub zoom: f32,
}

fn one() -> f32 {
  1.0
}

impl Default for FitSpec {
  fn default() -> Self {
    FitSpec { mode: FitMode::Fill, fx: None, fy: None, zoom: 1.0 }
  }
}

/// Where the eye goes in a picture: the centre of its detail (edges and contrast), blended with
/// the middle so a bright corner can't drag the crop off. Returns fractions 0..1.
pub fn auto_focus(img: &image::RgbImage) -> (f32, f32) {
  let (w, h) = img.dimensions();
  if w < 4 || h < 4 {
    return (0.5, 0.5);
  }
  let tw = 96u32;
  let th = ((tw as f64 * h as f64 / w as f64).round() as u32).max(4);
  let small = image::imageops::thumbnail(img, tw, th);
  let gray = image::imageops::grayscale(&small);
  let (mut sum, mut sx, mut sy) = (0.0f64, 0.0f64, 0.0f64);
  for y in 1..th - 1 {
    for x in 1..tw - 1 {
      let g = |dx: i32, dy: i32| gray.get_pixel((x as i32 + dx) as u32, (y as i32 + dy) as u32)[0] as f64;
      let mag = (g(1, 0) - g(-1, 0)).abs() + (g(0, 1) - g(0, -1)).abs();
      sum += mag;
      sx += mag * x as f64;
      sy += mag * y as f64;
    }
  }
  if sum < 1.0 {
    return (0.5, 0.5);
  }
  let cx = (sx / sum) / tw as f64;
  let cy = (sy / sum) / th as f64;
  (((cx + 0.5) / 2.0) as f32, ((cy + 0.5) / 2.0) as f32)
}

/// The rectangle of the source to keep so it matches the target's shape, centred on the focal
/// point and never leaving the picture. Pure, so it is tested.
pub fn crop_rect(sw: u32, sh: u32, tw: u32, th: u32, fx: f32, fy: f32, zoom: f32) -> (u32, u32, u32, u32) {
  let ta = tw as f64 / th.max(1) as f64;
  let sa = sw as f64 / sh.max(1) as f64;
  let (mut cw, mut ch) = if sa > ta { (sh as f64 * ta, sh as f64) } else { (sw as f64, sw as f64 / ta) };
  let z = (zoom as f64).clamp(1.0, 4.0);
  cw /= z;
  ch /= z;
  let cw = cw.round().clamp(1.0, sw as f64);
  let ch = ch.round().clamp(1.0, sh as f64);
  let x = (fx.clamp(0.0, 1.0) as f64 * sw as f64 - cw / 2.0).clamp(0.0, sw as f64 - cw);
  let y = (fy.clamp(0.0, 1.0) as f64 * sh as f64 - ch / 2.0).clamp(0.0, sh as f64 - ch);
  (x.round() as u32, y.round() as u32, cw as u32, ch as u32)
}

fn render_fill(img: &image::RgbImage, w: u32, h: u32, spec: &FitSpec) -> image::RgbImage {
  let (sw, sh) = img.dimensions();
  let (afx, afy) = if spec.fx.is_none() || spec.fy.is_none() { auto_focus(img) } else { (0.5, 0.5) };
  let (fx, fy) = (spec.fx.unwrap_or(afx), spec.fy.unwrap_or(afy));
  let (x, y, cw, ch) = crop_rect(sw, sh, w, h, fx, fy, spec.zoom);
  let cropped = image::imageops::crop_imm(img, x, y, cw, ch).to_image();
  // Lanczos keeps fine detail whether the picture is scaled down or (for a small source) up.
  let mut out = image::imageops::resize(&cropped, w, h, FilterType::Lanczos3);
  if cw as f64 / w as f64 > 1.25 {
    // Scaling down softens; a light sharpen brings the edges back.
    out = image::imageops::unsharpen(&out, 0.6, 2);
  }
  out
}

fn render_fit(img: &image::RgbImage, w: u32, h: u32) -> image::RgbImage {
  let (sw, sh) = img.dimensions();
  let (bw, bh) = ((w / 8).max(8), (h / 8).max(8));
  // Backdrop: the picture's own colours, filled and heavily blurred.
  let small = render_fill(&image::imageops::thumbnail(img, bw, bh), bw, bh, &FitSpec::default());
  let blurred = image::imageops::blur(&small, 8.0);
  let mut canvas = image::imageops::resize(&blurred, w, h, FilterType::Triangle);
  let s = (w as f64 / sw as f64).min(h as f64 / sh as f64);
  let (nw, nh) = (((sw as f64 * s).round() as u32).clamp(1, w), ((sh as f64 * s).round() as u32).clamp(1, h));
  let fitted = image::imageops::resize(img, nw, nh, FilterType::Lanczos3);
  image::imageops::overlay(&mut canvas, &fitted, ((w - nw) / 2) as i64, ((h - nh) / 2) as i64);
  canvas
}

fn render_key(src: &Path, w: u32, h: u32, spec: &FitSpec) -> String {
  let meta = std::fs::metadata(src).ok();
  let mtime = meta.as_ref().and_then(|m| m.modified().ok()).and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_secs()).unwrap_or(0);
  let mut h2 = DefaultHasher::new();
  (
    src.to_string_lossy().to_lowercase(),
    meta.map(|m| m.len()).unwrap_or(0),
    mtime,
    w,
    h,
    spec.mode as u8,
    spec.fx.map(|v| (v * 1000.0) as i32),
    spec.fy.map(|v| (v * 1000.0) as i32),
    (spec.zoom * 100.0) as i32,
    "r2",
  )
    .hash(&mut h2);
  format!("r{:016x}", h2.finish())
}

/// The picture made for exactly this screen: cropped to its shape around the point that matters,
/// resampled with Lanczos, sharpened a touch, saved as a high-quality JPEG. Cached. The result
/// is the same size as the screen, so nothing in the shell ever scales it again.
pub fn render(cache: &Path, src: &Path, w: u32, h: u32, spec: &FitSpec) -> Result<PathBuf, String> {
  let out = cache.join(format!("{}.jpg", render_key(src, w, h, spec)));
  if out.is_file() {
    return Ok(out);
  }
  let img = image::open(src).map_err(|e| format!("cannot decode {}: {e}", src.display()))?.to_rgb8();
  let canvas = match spec.mode {
    FitMode::Fill => render_fill(&img, w, h, spec),
    FitMode::Fit => render_fit(&img, w, h),
  };
  let tmp = out.with_extension("tmp");
  {
    let file = std::fs::File::create(&tmp).map_err(|e| e.to_string())?;
    let mut enc = image::codecs::jpeg::JpegEncoder::new_with_quality(std::io::BufWriter::new(file), 95);
    enc.encode_image(&canvas).map_err(|e| e.to_string())?;
  }
  std::fs::rename(&tmp, &out).map_err(|e| e.to_string())?;
  prune(cache);
  Ok(out)
}

pub fn cache_path() -> Option<PathBuf> {
  cache_dir()
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
  fn crop_matches_the_target_shape_and_stays_inside() {
    // 21:9 source onto 16:9: full height, narrower width.
    let (x, y, w, h) = crop_rect(2560, 1080, 1920, 1080, 0.5, 0.5, 1.0);
    assert_eq!((y, h), (0, 1080));
    assert_eq!(w, 1920);
    assert_eq!(x, 320);
    // a focal point at the far right cannot push the crop outside the picture
    let (x, _, w, _) = crop_rect(2560, 1080, 1920, 1080, 1.0, 0.5, 1.0);
    assert_eq!(x + w, 2560);
    // zoom keeps the shape
    let (_, _, w, h) = crop_rect(3840, 2160, 1920, 1080, 0.5, 0.5, 2.0);
    assert_eq!((w, h), (1920, 1080));
  }

  #[test]
  fn render_produces_exactly_the_screen_size() {
    let dir = temp_dir("render");
    let src = dir.join("wide.png");
    make_png(&src, 700, 300);
    let cache = dir.join("cache");
    std::fs::create_dir_all(&cache).unwrap();
    for spec in [FitSpec::default(), FitSpec { mode: FitMode::Fit, ..FitSpec::default() }] {
      let out = render(&cache, &src, 320, 180, &spec).unwrap();
      assert_eq!(image::image_dimensions(&out).unwrap(), (320, 180));
    }
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
