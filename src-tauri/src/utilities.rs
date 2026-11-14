//! Native backends for Udaan's utility apps: Clipboard history, Screenshot,
//! Photos and Storage.

use base64::Engine;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};

fn now_ms() -> u64 {
  SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn data_dir(app: &AppHandle, sub: &str) -> Result<PathBuf, String> {
  let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join(sub);
  std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
  Ok(dir)
}

// ===================================================================
// Clipboard history
// ===================================================================

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipItem {
  pub id: String,
  /// "text" or "image".
  pub kind: String,
  pub text: Option<String>,
  /// PNG file for images.
  pub image_path: Option<String>,
  pub pinned: bool,
  pub at: u64,
}

const CLIP_MAX: usize = 200;
static CLIPS: Mutex<Vec<ClipItem>> = Mutex::new(Vec::new());
static CLIP_FILE: Mutex<Option<PathBuf>> = Mutex::new(None);
/// Set while Udaan itself writes the clipboard, so that copy isn't recorded twice.
static SUPPRESS_SEQ: Mutex<u32> = Mutex::new(0);

fn persist_clips() {
  if let (Some(path), Ok(list)) = (CLIP_FILE.lock().unwrap().clone(), CLIPS.lock()) {
    if let Ok(json) = serde_json::to_string(&*list) {
      let _ = std::fs::write(path, json);
    }
  }
}

fn push_clip(app: &AppHandle, item: ClipItem) {
  {
    let mut list = CLIPS.lock().unwrap();
    // Copying the same text again just moves it to the top.
    if let Some(t) = &item.text {
      list.retain(|c| c.text.as_ref() != Some(t) || c.pinned);
    }
    list.insert(0, item);
    // Unpinned items beyond the cap drop off the end.
    let mut kept = 0;
    list.retain(|c| {
      kept += 1;
      c.pinned || kept <= CLIP_MAX
    });
  }
  persist_clips();
  let _ = app.emit("clipboard://changed", ());
}

#[cfg(windows)]
fn read_clipboard(app: &AppHandle) -> Option<ClipItem> {
  use clipboard_win::{formats, get_clipboard};
  if let Ok(text) = clipboard_win::get_clipboard_string() {
    if !text.trim().is_empty() && text.len() < 200_000 {
      return Some(ClipItem { id: format!("c{}", now_ms()), kind: "text".into(), text: Some(text), image_path: None, pinned: false, at: now_ms() });
    }
  }
  if let Ok(bmp) = get_clipboard::<Vec<u8>, _>(formats::Bitmap) {
    let img = image::load_from_memory_with_format(&bmp, image::ImageFormat::Bmp).ok()?;
    let dir = data_dir(app, "clipboard").ok()?;
    let path = dir.join(format!("{}.png", now_ms()));
    img.save(&path).ok()?;
    return Some(ClipItem { id: format!("c{}", now_ms()), kind: "image".into(), text: None, image_path: Some(path.to_string_lossy().into_owned()), pinned: false, at: now_ms() });
  }
  None
}

/// Loads saved history and starts watching the clipboard.
pub fn start_clipboard_watch(app: AppHandle) {
  if let Ok(dir) = data_dir(&app, "clipboard") {
    let file = dir.join("history.json");
    if let Ok(raw) = std::fs::read_to_string(&file) {
      if let Ok(list) = serde_json::from_str::<Vec<ClipItem>>(&raw) {
        *CLIPS.lock().unwrap() = list;
      }
    }
    *CLIP_FILE.lock().unwrap() = Some(file);
  }
  // Event-driven: Windows posts a message when the clipboard changes and `Monitor::recv`
  // blocks on it, so an idle clipboard costs no wake-ups (this used to poll every 600 ms
  // for the life of the session). Polling remains only as a fallback if the monitor
  // window cannot be created. Runs under the engine's supervisor.
  #[cfg(windows)]
  {
    let mut last = clipboard_win::raw::seq_num().map(|n| n.get()).unwrap_or(0);
    let mut on_change = move |app: &AppHandle| {
      let seq = clipboard_win::raw::seq_num().map(|n| n.get()).unwrap_or(0);
      if seq == last {
        return;
      }
      last = seq;
      if *SUPPRESS_SEQ.lock().unwrap() == seq {
        return;
      }
      // The clipboard can be briefly locked by the app that just wrote it.
      let item = (0..3).find_map(|_| {
        let _clip = clipboard_win::Clipboard::new_attempts(10).ok()?;
        read_clipboard(app)
      });
      if let Some(item) = item {
        push_clip(app, item);
      }
    };
    let _ = crate::engine::supervisor::spawn("clipboard", crate::engine::supervisor::Restart::OnPanic, move || {
      match clipboard_win::Monitor::new() {
        Ok(mut monitor) => loop {
          match monitor.recv() {
            Ok(true) => on_change(&app),
            Ok(false) => return,
            Err(_) => std::thread::sleep(Duration::from_secs(1)),
          }
        },
        Err(_) => loop {
          std::thread::sleep(Duration::from_millis(600));
          on_change(&app);
        },
      }
    });
  }
}

#[tauri::command]
pub fn clip_history_list() -> Vec<ClipItem> {
  CLIPS.lock().unwrap().clone()
}

/// Puts an item back on the clipboard.
#[tauri::command]
pub fn clip_history_copy(id: String) -> Result<(), String> {
  let item = CLIPS.lock().unwrap().iter().find(|c| c.id == id).cloned().ok_or("Item not found")?;
  #[cfg(windows)]
  {
    let _clip = clipboard_win::Clipboard::new_attempts(10).map_err(|e| e.to_string())?;
    match (item.text, item.image_path) {
      (Some(t), _) => clipboard_win::set_clipboard_string(&t).map_err(|e| e.to_string())?,
      (_, Some(p)) => {
        let img = image::open(&p).map_err(|e| e.to_string())?;
        let mut bmp = std::io::Cursor::new(Vec::new());
        img.write_to(&mut bmp, image::ImageFormat::Bmp).map_err(|e| e.to_string())?;
        clipboard_win::set_clipboard(clipboard_win::formats::Bitmap, bmp.into_inner()).map_err(|e| e.to_string())?;
      }
      _ => return Err("Empty item".into()),
    }
    *SUPPRESS_SEQ.lock().unwrap() = clipboard_win::raw::seq_num().map(|n| n.get()).unwrap_or(0);
  }
  Ok(())
}

#[tauri::command]
pub fn clip_history_pin(app: AppHandle, id: String, pinned: bool) {
  if let Some(c) = CLIPS.lock().unwrap().iter_mut().find(|c| c.id == id) {
    c.pinned = pinned;
  }
  persist_clips();
  let _ = app.emit("clipboard://changed", ());
}

#[tauri::command]
pub fn clip_history_delete(app: AppHandle, id: Option<String>) {
  let removed: Vec<ClipItem> = {
    let mut list = CLIPS.lock().unwrap();
    let (gone, keep): (Vec<_>, Vec<_>) = list.drain(..).partition(|c| match &id {
      Some(id) => &c.id == id,
      None => !c.pinned, // "Clear" keeps pinned items
    });
    *list = keep;
    gone
  };
  for c in removed {
    if let Some(p) = c.image_path {
      let _ = std::fs::remove_file(p);
    }
  }
  persist_clips();
  let _ = app.emit("clipboard://changed", ());
}

// ===================================================================
// Screenshot
// ===================================================================

#[cfg(windows)]
fn capture_screen_rgba() -> Result<image::RgbaImage, String> {
  use windows_sys::Win32::Graphics::Gdi::*;
  use windows_sys::Win32::UI::WindowsAndMessaging::{GetSystemMetrics, SM_CXVIRTUALSCREEN, SM_CYVIRTUALSCREEN, SM_XVIRTUALSCREEN, SM_YVIRTUALSCREEN};
  unsafe {
    let (x, y) = (GetSystemMetrics(SM_XVIRTUALSCREEN), GetSystemMetrics(SM_YVIRTUALSCREEN));
    let (w, h) = (GetSystemMetrics(SM_CXVIRTUALSCREEN), GetSystemMetrics(SM_CYVIRTUALSCREEN));
    let screen = GetDC(std::ptr::null_mut());
    let dc = CreateCompatibleDC(screen);
    let bmp = CreateCompatibleBitmap(screen, w, h);
    let old = SelectObject(dc, bmp);
    BitBlt(dc, 0, 0, w, h, screen, x, y, SRCCOPY);
    let mut info: BITMAPINFO = std::mem::zeroed();
    info.bmiHeader.biSize = std::mem::size_of::<BITMAPINFOHEADER>() as u32;
    info.bmiHeader.biWidth = w;
    info.bmiHeader.biHeight = -h;
    info.bmiHeader.biPlanes = 1;
    info.bmiHeader.biBitCount = 32;
    let mut buf = vec![0u8; (w * h * 4) as usize];
    let ok = GetDIBits(dc, bmp, 0, h as u32, buf.as_mut_ptr() as *mut _, &mut info, DIB_RGB_COLORS) != 0;
    SelectObject(dc, old);
    DeleteObject(bmp);
    DeleteDC(dc);
    ReleaseDC(std::ptr::null_mut(), screen);
    if !ok {
      return Err("Screen capture failed".into());
    }
    for px in buf.chunks_exact_mut(4) {
      px.swap(0, 2);
      px[3] = 255;
    }
    image::RgbaImage::from_raw(w as u32, h as u32, buf).ok_or_else(|| "Screen capture failed".into())
  }
}

/// Captures the whole screen to a temporary PNG and returns its path.
#[tauri::command]
pub async fn screenshot_capture(app: AppHandle) -> Result<String, String> {
  let dir = data_dir(&app, "screenshots-tmp")?;
  tauri::async_runtime::spawn_blocking(move || {
    #[cfg(windows)]
    {
      let img = capture_screen_rgba()?;
      let path = dir.join(format!("{}.png", now_ms()));
      img.save(&path).map_err(|e| e.to_string())?;
      Ok(path.to_string_lossy().into_owned())
    }
    #[cfg(not(windows))]
    {
      let _ = dir;
      Err("Windows only".to_string())
    }
  })
  .await
  .map_err(|e| e.to_string())?
}

/// Saves an edited screenshot (PNG bytes) to Pictures\Screenshots and/or
/// the clipboard. Returns the saved file path when saved.
#[tauri::command]
pub fn screenshot_save(png: Vec<u8>, to_file: bool, to_clipboard: bool) -> Result<Option<String>, String> {
  let img = image::load_from_memory_with_format(&png, image::ImageFormat::Png).map_err(|e| e.to_string())?;
  let mut saved = None;
  if to_file {
    let base = std::env::var_os("USERPROFILE").ok_or("No user folder")?;
    let dir = PathBuf::from(base).join(r"Pictures\Screenshots");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let stamp = chrono::Local::now().format("Screenshot %Y-%m-%d %H-%M-%S");
    let path = dir.join(format!("{stamp}.png"));
    img.save(&path).map_err(|e| e.to_string())?;
    saved = Some(path.to_string_lossy().into_owned());
  }
  #[cfg(windows)]
  if to_clipboard {
    let mut bmp = std::io::Cursor::new(Vec::new());
    img.write_to(&mut bmp, image::ImageFormat::Bmp).map_err(|e| e.to_string())?;
    let _clip = clipboard_win::Clipboard::new_attempts(10).map_err(|e| e.to_string())?;
    clipboard_win::set_clipboard(clipboard_win::formats::Bitmap, bmp.into_inner()).map_err(|e| e.to_string())?;
  }
  Ok(saved)
}

// ===================================================================
// Photos
// ===================================================================

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Photo {
  pub path: String,
  pub folder: String,
  pub modified_ms: u64,
  pub size: u64,
}

const PHOTO_EXT: [&str; 7] = ["jpg", "jpeg", "png", "gif", "webp", "bmp", "heic"];

/// Every image under the usual picture folders (two levels deep), newest first.
#[tauri::command]
pub async fn photos_scan() -> Vec<Photo> {
  tauri::async_runtime::spawn_blocking(|| {
    let Some(home) = std::env::var_os("USERPROFILE").map(PathBuf::from) else { return vec![] };
    let roots = [("Pictures", home.join("Pictures")), ("Downloads", home.join("Downloads")), ("Desktop", home.join("Desktop")), ("OneDrive Pictures", home.join(r"OneDrive\Pictures"))];
    let mut out = Vec::new();
    fn walk(dir: &Path, folder: &str, depth: u8, out: &mut Vec<Photo>) {
      let Ok(entries) = std::fs::read_dir(dir) else { return };
      for e in entries.flatten() {
        let p = e.path();
        let Ok(meta) = e.metadata() else { continue };
        if meta.is_dir() {
          if depth > 0 && !p.file_name().map(|n| n.to_string_lossy().starts_with('.')).unwrap_or(true) {
            walk(&p, folder, depth - 1, out);
          }
        } else if p.extension().map(|x| PHOTO_EXT.contains(&x.to_string_lossy().to_lowercase().as_str())).unwrap_or(false) {
          out.push(Photo {
            path: p.to_string_lossy().into_owned(),
            folder: folder.to_string(),
            modified_ms: meta.modified().ok().and_then(|m| m.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_millis() as u64).unwrap_or(0),
            size: meta.len(),
          });
        }
      }
    }
    for (name, root) in roots {
      walk(&root, name, 2, &mut out);
    }
    out.sort_by(|a, b| b.modified_ms.cmp(&a.modified_ms));
    out.dedup_by(|a, b| a.path == b.path);
    out
  })
  .await
  .unwrap_or_default()
}

/// A small cached JPEG thumbnail for a photo, as a data URL.
#[tauri::command]
pub async fn photos_thumb(app: AppHandle, path: String, size: u32) -> Result<String, String> {
  let dir = data_dir(&app, "thumbs")?;
  tauri::async_runtime::spawn_blocking(move || {
    let meta = std::fs::metadata(&path).map_err(|e| e.to_string())?;
    let stamp = meta.modified().ok().and_then(|m| m.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_secs()).unwrap_or(0);
    let key = format!("{:x}-{stamp}-{size}-o.jpg", fxhash(&path));
    let cached = dir.join(&key);
    let bytes = if let Ok(b) = std::fs::read(&cached) {
      b
    } else {
      // Phones store rotation in EXIF; apply it so pictures aren't sideways.
      use image::ImageDecoder;
      let mut decoder = image::ImageReader::open(&path).map_err(|e| e.to_string())?.with_guessed_format().map_err(|e| e.to_string())?.into_decoder().map_err(|e| e.to_string())?;
      let orientation = decoder.orientation().unwrap_or(image::metadata::Orientation::NoTransforms);
      let mut img = image::DynamicImage::from_decoder(decoder).map_err(|e| e.to_string())?;
      img.apply_orientation(orientation);
      let thumb = img.thumbnail(size, size).to_rgb8();
      let mut out = std::io::Cursor::new(Vec::new());
      thumb.write_to(&mut out, image::ImageFormat::Jpeg).map_err(|e| e.to_string())?;
      let b = out.into_inner();
      let _ = std::fs::write(&cached, &b);
      b
    };
    Ok(format!("data:image/jpeg;base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes)))
  })
  .await
  .map_err(|e| e.to_string())?
}

fn fxhash(s: &str) -> u64 {
  s.bytes().fold(0xcbf29ce484222325u64, |h, b| (h ^ b as u64).wrapping_mul(0x100000001b3))
}

/// Saves edited image bytes (PNG) next to the original as "name (edited).png".
#[tauri::command]
pub fn photos_save_copy(original: String, png: Vec<u8>) -> Result<String, String> {
  let orig = PathBuf::from(&original);
  let stem = orig.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_else(|| "photo".into());
  let dir = orig.parent().ok_or("No folder")?;
  let mut path = dir.join(format!("{stem} (edited).png"));
  let mut n = 2;
  while path.exists() {
    path = dir.join(format!("{stem} (edited {n}).png"));
    n += 1;
  }
  std::fs::write(&path, png).map_err(|e| e.to_string())?;
  Ok(path.to_string_lossy().into_owned())
}

// ===================================================================
// Storage
// ===================================================================

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirSize {
  pub path: String,
  pub name: String,
  pub bytes: u64,
  pub is_dir: bool,
}

fn size_of(path: &Path, deadline: std::time::Instant) -> u64 {
  let Ok(meta) = std::fs::symlink_metadata(path) else { return 0 };
  if meta.file_type().is_symlink() {
    return 0;
  }
  if !meta.is_dir() {
    return meta.len();
  }
  if std::time::Instant::now() > deadline {
    return 0;
  }
  std::fs::read_dir(path).map(|it| it.flatten().map(|e| size_of(&e.path(), deadline)).sum()).unwrap_or(0)
}

/// The immediate contents of a folder with their total sizes, biggest first.
#[tauri::command]
pub async fn storage_scan(path: String) -> Result<Vec<DirSize>, String> {
  tauri::async_runtime::spawn_blocking(move || {
    let deadline = std::time::Instant::now() + Duration::from_secs(90);
    let entries: Vec<_> = std::fs::read_dir(&path).map_err(|e| e.to_string())?.flatten().collect();
    // Children are measured in parallel threads: a big folder takes seconds, not minutes.
    let handles: Vec<_> = entries
      .into_iter()
      .map(|e| {
        std::thread::spawn(move || {
          let p = e.path();
          let is_dir = p.is_dir();
          DirSize { name: e.file_name().to_string_lossy().into_owned(), bytes: size_of(&p, deadline), is_dir, path: p.to_string_lossy().into_owned() }
        })
      })
      .collect();
    let mut out: Vec<DirSize> = handles.into_iter().filter_map(|h| h.join().ok()).collect();
    out.sort_by(|a, b| b.bytes.cmp(&a.bytes));
    Ok(out)
  })
  .await
  .map_err(|e| e.to_string())?
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Cleanable {
  pub id: String,
  pub label: String,
  pub detail: String,
  pub path: String,
  pub bytes: u64,
}

/// Known-safe clutter: caches and temp files that rebuild themselves.
fn cleanable_paths() -> Vec<(&'static str, &'static str, &'static str, PathBuf)> {
  let local = std::env::var_os("LOCALAPPDATA").map(PathBuf::from).unwrap_or_default();
  let home = std::env::var_os("USERPROFILE").map(PathBuf::from).unwrap_or_default();
  vec![
    ("temp", "Temporary files", "Left behind by apps and installers", std::env::temp_dir()),
    ("npm", "npm download cache", "Packages re-download when needed", local.join("npm-cache")),
    ("pnpm", "pnpm store (unused)", "Rebuilt on next install", local.join(r"pnpm\store")),
    ("cargo", "Rust download cache", "Crates re-download when needed", home.join(r".cargo\registry\cache")),
    ("udaan-debug", "Udaan developer build", "Rebuilt by the next developer run", PathBuf::from(r"C:\Udaan\src-tauri\target\debug")),
    ("thumbs", "Windows thumbnail cache", "Windows recreates thumbnails", local.join(r"Microsoft\Windows\Explorer")),
    ("crash", "Crash dumps", "Diagnostic files from app crashes", local.join("CrashDumps")),
  ]
}

#[tauri::command]
pub async fn storage_cleanables() -> Vec<Cleanable> {
  tauri::async_runtime::spawn_blocking(|| {
    let deadline = std::time::Instant::now() + Duration::from_secs(60);
    cleanable_paths()
      .into_iter()
      .filter(|(_, _, _, p)| p.exists())
      .map(|(id, label, detail, p)| Cleanable { id: id.into(), label: label.into(), detail: detail.into(), bytes: size_of(&p, deadline), path: p.to_string_lossy().into_owned() })
      .filter(|c| c.bytes > 1_000_000)
      .collect()
  })
  .await
  .unwrap_or_default()
}

/// Empties one known-safe location. Files in use are skipped. Returns bytes freed.
#[tauri::command]
pub async fn storage_clean(id: String) -> Result<u64, String> {
  tauri::async_runtime::spawn_blocking(move || {
    let (_, _, _, path) = cleanable_paths().into_iter().find(|(i, ..)| *i == id).ok_or("Unknown item")?;
    let deadline = std::time::Instant::now() + Duration::from_secs(60);
    let before = size_of(&path, deadline);
    let only_thumbs = id == "thumbs";
    for e in std::fs::read_dir(&path).map_err(|e| e.to_string())?.flatten() {
      let p = e.path();
      // The Explorer folder holds more than thumbnails; only its thumbcache files go.
      if only_thumbs && !e.file_name().to_string_lossy().starts_with("thumbcache_") {
        continue;
      }
      let _ = if p.is_dir() { std::fs::remove_dir_all(&p) } else { std::fs::remove_file(&p) };
    }
    let after = size_of(&path, std::time::Instant::now() + Duration::from_secs(60));
    Ok(before.saturating_sub(after))
  })
  .await
  .map_err(|e| e.to_string())?
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DriveInfo {
  pub mount: String,
  pub name: String,
  pub total: u64,
  pub free: u64,
}

#[tauri::command]
pub fn storage_drives() -> Vec<DriveInfo> {
  sysinfo::Disks::new_with_refreshed_list()
    .iter()
    .map(|d| DriveInfo { mount: d.mount_point().to_string_lossy().into_owned(), name: d.name().to_string_lossy().into_owned(), total: d.total_space(), free: d.available_space() })
    .collect()
}
