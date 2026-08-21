use chrono::Local;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};
use xcap::{Monitor, Window};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScreenshotEntry {
  pub path: String,
  pub file_name: String,
  pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MonitorInfo {
  pub id: u32,
  pub name: String,
  pub is_primary: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WindowInfo {
  pub id: u32,
  pub title: String,
}

fn workspace_dir(app: &AppHandle) -> Result<PathBuf, String> {
  let data_dir = app.path().app_data_dir().map_err(|e| format!("Failed to resolve app data dir: {e}"))?;
  let today = Local::now().format("%Y-%m-%d").to_string();
  let dir = data_dir.join("screenshots").join(today);
  std::fs::create_dir_all(&dir).map_err(|e| format!("Failed to create screenshots dir: {e}"))?;
  Ok(dir)
}

fn save_and_describe(dir: PathBuf, img: image::RgbaImage) -> Result<ScreenshotEntry, String> {
  let file_name = format!("screenshot-{}.png", Local::now().format("%H-%M-%S%.3f"));
  let path = dir.join(&file_name);
  img.save(&path).map_err(|e| format!("Failed to save screenshot: {e}"))?;
  Ok(ScreenshotEntry {
    path: path.to_string_lossy().to_string(),
    file_name,
    created_at: chrono::Utc::now().to_rfc3339(),
  })
}

#[tauri::command]
pub fn screenshot_tool_list_monitors() -> Result<Vec<MonitorInfo>, String> {
  let monitors = Monitor::all().map_err(|e| e.to_string())?;
  Ok(
    monitors
      .into_iter()
      .enumerate()
      .map(|(idx, m)| MonitorInfo {
        id: idx as u32,
        name: m.name().unwrap_or_else(|_| format!("Display {}", idx + 1)),
        is_primary: m.is_primary().unwrap_or(false),
      })
      .collect(),
  )
}

#[tauri::command]
pub fn screenshot_tool_list_windows() -> Result<Vec<WindowInfo>, String> {
  let windows = Window::all().map_err(|e| e.to_string())?;
  Ok(
    windows
      .into_iter()
      .enumerate()
      .filter(|(_, w)| !w.title().unwrap_or_default().trim().is_empty() && !w.is_minimized().unwrap_or(false))
      .map(|(idx, w)| WindowInfo {
        id: idx as u32,
        title: w.title().unwrap_or_default(),
      })
      .collect(),
  )
}

/// Captures the full extent of one monitor (index into the list returned by
/// `screenshot_tool_list_monitors`, not a persistent OS handle).
#[tauri::command]
pub fn screenshot_tool_capture_screen(app: AppHandle, monitor_index: u32) -> Result<ScreenshotEntry, String> {
  let monitors = Monitor::all().map_err(|e| e.to_string())?;
  let monitor = monitors
    .into_iter()
    .nth(monitor_index as usize)
    .ok_or("Monitor index out of range")?;
  let img = monitor.capture_image().map_err(|e| e.to_string())?;
  save_and_describe(workspace_dir(&app)?, img)
}

/// Captures one specific window (index into the list returned by
/// `screenshot_tool_list_windows`).
#[tauri::command]
pub fn screenshot_tool_capture_window(app: AppHandle, window_index: u32) -> Result<ScreenshotEntry, String> {
  let windows = Window::all().map_err(|e| e.to_string())?;
  let window = windows
    .into_iter()
    .nth(window_index as usize)
    .ok_or("Window index out of range")?;
  let img = window.capture_image().map_err(|e| e.to_string())?;
  save_and_describe(workspace_dir(&app)?, img)
}

/// Captures the primary monitor's full frame, then crops to the caller-supplied region
/// (screen-space pixel coordinates). Region selection UI lives on the frontend — this command
/// just does the crop once the user has drawn a rectangle.
#[tauri::command]
pub fn screenshot_tool_capture_region(
  app: AppHandle,
  monitor_index: u32,
  x: u32,
  y: u32,
  width: u32,
  height: u32,
) -> Result<ScreenshotEntry, String> {
  let monitors = Monitor::all().map_err(|e| e.to_string())?;
  let monitor = monitors
    .into_iter()
    .nth(monitor_index as usize)
    .ok_or("Monitor index out of range")?;
  let full = monitor.capture_image().map_err(|e| e.to_string())?;
  if x + width > full.width() || y + height > full.height() {
    return Err("Region out of bounds for the captured monitor".to_string());
  }
  let cropped = image::imageops::crop_imm(&full, x, y, width, height).to_image();
  save_and_describe(workspace_dir(&app)?, cropped)
}

#[tauri::command]
pub fn screenshot_tool_list_history(app: AppHandle) -> Result<Vec<ScreenshotEntry>, String> {
  let data_dir = app.path().app_data_dir().map_err(|e| format!("Failed to resolve app data dir: {e}"))?;
  let root = data_dir.join("screenshots");
  if !root.is_dir() {
    return Ok(Vec::new());
  }
  let mut entries = Vec::new();
  for day_entry in std::fs::read_dir(&root).map_err(|e| e.to_string())?.flatten() {
    let day_path = day_entry.path();
    if !day_path.is_dir() {
      continue;
    }
    for file_entry in std::fs::read_dir(&day_path).map_err(|e| e.to_string())?.flatten() {
      let path = file_entry.path();
      if path.extension().and_then(|e| e.to_str()) != Some("png") {
        continue;
      }
      let metadata = file_entry.metadata().map_err(|e| e.to_string())?;
      let created_at = metadata
        .modified()
        .ok()
        .map(chrono::DateTime::<chrono::Utc>::from)
        .map(|dt| dt.to_rfc3339())
        .unwrap_or_default();
      entries.push(ScreenshotEntry {
        path: path.to_string_lossy().to_string(),
        file_name: path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default(),
        created_at,
      });
    }
  }
  entries.sort_by(|a, b| b.created_at.cmp(&a.created_at));
  Ok(entries)
}

#[tauri::command]
pub fn screenshot_tool_read_file(file_path: String) -> Result<Vec<u8>, String> {
  std::fs::read(&file_path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn screenshot_tool_copy_to_clipboard(file_path: String) -> Result<(), String> {
  let bytes = std::fs::read(&file_path).map_err(|e| e.to_string())?;
  let decoded = image::load_from_memory(&bytes).map_err(|e| e.to_string())?.to_rgba8();
  let (width, height) = decoded.dimensions();
  let mut clipboard = arboard::Clipboard::new().map_err(|e| e.to_string())?;
  clipboard
    .set_image(arboard::ImageData {
      width: width as usize,
      height: height as usize,
      bytes: decoded.into_raw().into(),
    })
    .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
  use super::*;

  /// Exercises the real PNG-save path used by every capture command (screen/window/region all
  /// funnel through this), without needing a Tauri AppHandle — just a plain temp dir.
  #[test]
  fn save_and_describe_writes_a_readable_png() {
    let dir = std::env::temp_dir().join(format!("udaan-screenshot-test-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).unwrap();

    let img = image::RgbaImage::from_fn(10, 8, |x, y| image::Rgba([x as u8, y as u8, 128, 255]));
    let entry = save_and_describe(dir.clone(), img).unwrap();

    assert!(entry.file_name.starts_with("screenshot-"));
    assert!(entry.file_name.ends_with(".png"));

    let saved_bytes = std::fs::read(&entry.path).unwrap();
    let reloaded = image::load_from_memory(&saved_bytes).unwrap().to_rgba8();
    assert_eq!(reloaded.dimensions(), (10, 8));
    // Spot-check one pixel survived the round trip intact.
    assert_eq!(reloaded.get_pixel(3, 5), &image::Rgba([3, 5, 128, 255]));

    std::fs::remove_dir_all(&dir).ok();
  }

  /// Exercises the real crop logic used by region capture, against a real in-memory image
  /// (not a live monitor grab, so this stays deterministic and doesn't depend on desktop state).
  #[test]
  fn region_crop_extracts_the_correct_sub_image() {
    let full = image::RgbaImage::from_fn(20, 20, |x, y| image::Rgba([x as u8, y as u8, 0, 255]));
    let cropped = image::imageops::crop_imm(&full, 5, 5, 6, 4).to_image();
    assert_eq!(cropped.dimensions(), (6, 4));
    assert_eq!(cropped.get_pixel(0, 0), &image::Rgba([5, 5, 0, 255]));
    assert_eq!(cropped.get_pixel(5, 3), &image::Rgba([10, 8, 0, 255]));
  }

  /// Exercises the real xcap monitor enumeration against this machine's actual display(s) —
  /// the interactive desktop this test runs on has at least one, so this is a real capture
  /// smoke test, not a mock.
  #[test]
  fn can_enumerate_and_capture_a_real_monitor() {
    let monitors = Monitor::all().expect("Monitor::all should succeed on an interactive desktop");
    assert!(!monitors.is_empty(), "expected at least one real display");

    let img = monitors[0].capture_image().expect("capturing the primary monitor should succeed");
    assert!(img.width() > 0 && img.height() > 0);
  }
}
