mod store;

use std::sync::Arc;
use std::time::Duration;

use arboard::Clipboard;
use base64::Engine;
use image::codecs::png::PngEncoder;
use image::{ExtendedColorType, ImageEncoder};
use tauri::{AppHandle, Emitter, Manager, State};
use uuid::Uuid;

pub use store::ClipboardEntry;
use store::Store;

const MAX_ROWS: i64 = 500;
const MAX_AGE_DAYS: i64 = 30;
const POLL_INTERVAL: Duration = Duration::from_millis(800);
/// Images larger than this (as encoded PNG bytes) are skipped rather than stored — keeps the
/// sqlite DB and in-memory history list from ballooning on large screenshots copied to clipboard.
const MAX_IMAGE_BYTES: usize = 5 * 1024 * 1024;

pub struct ClipboardManagerState {
  store: Arc<Store>,
}

pub fn init(app: &AppHandle) -> Result<ClipboardManagerState, String> {
  let data_dir = app
    .path()
    .app_data_dir()
    .map_err(|e| format!("Failed to resolve app data dir: {e}"))?;
  std::fs::create_dir_all(&data_dir).map_err(|e| format!("Failed to create app data dir: {e}"))?;
  let db_path = data_dir.join("clipboard_history.sqlite3");

  let store = Arc::new(Store::open(db_path).map_err(|e| format!("Failed to open clipboard store: {e}"))?);
  store.prune(MAX_ROWS, MAX_AGE_DAYS).map_err(|e| e.to_string())?;

  spawn_watcher(app.clone(), Arc::clone(&store));

  Ok(ClipboardManagerState { store })
}

/// Polls the system clipboard on a background thread. Tauri's clipboard plugin has no native
/// "changed" event on any platform, so polling at a modest interval is the standard approach
/// (same technique other clipboard-history apps use). A fresh `arboard::Clipboard` handle is
/// opened per tick rather than held across the loop — holding a long-lived handle on Windows
/// can interfere with other apps' clipboard access.
fn spawn_watcher(app: AppHandle, store: Arc<Store>) {
  std::thread::spawn(move || {
    let mut last_seen: Option<String> = store.last_content().ok().flatten();
    loop {
      std::thread::sleep(POLL_INTERVAL);
      let Ok(mut clipboard) = Clipboard::new() else { continue };

      if let Ok(text) = clipboard.get_text() {
        let trimmed = text.trim();
        if trimmed.is_empty() {
          continue;
        }
        if last_seen.as_deref() == Some(text.as_str()) {
          continue;
        }
        last_seen = Some(text.clone());
        let entry = ClipboardEntry {
          id: Uuid::new_v4().to_string(),
          kind: "text".to_string(),
          preview: preview_of(&text),
          content: text,
          created_at: chrono::Utc::now().to_rfc3339(),
        };
        if store.insert(&entry).is_ok() {
          let _ = app.emit("clipboard://changed", &entry);
        }
        continue;
      }

      if let Ok(img) = clipboard.get_image() {
        if let Some(data_url) = encode_image_data_url(&img) {
          if last_seen.as_deref() == Some(data_url.as_str()) {
            continue;
          }
          last_seen = Some(data_url.clone());
          let entry = ClipboardEntry {
            id: Uuid::new_v4().to_string(),
            kind: "image".to_string(),
            preview: format!("Image ({}×{})", img.width, img.height),
            content: data_url,
            created_at: chrono::Utc::now().to_rfc3339(),
          };
          if store.insert(&entry).is_ok() {
            let _ = app.emit("clipboard://changed", &entry);
          }
        }
      }
    }
  });
}

fn preview_of(text: &str) -> String {
  let collapsed: String = text.split_whitespace().collect::<Vec<_>>().join(" ");
  if collapsed.chars().count() > 140 {
    collapsed.chars().take(140).collect::<String>() + "…"
  } else {
    collapsed
  }
}

fn encode_image_data_url(img: &arboard::ImageData) -> Option<String> {
  let mut png_bytes = Vec::new();
  PngEncoder::new(&mut png_bytes)
    .write_image(&img.bytes, img.width as u32, img.height as u32, ExtendedColorType::Rgba8)
    .ok()?;
  if png_bytes.len() > MAX_IMAGE_BYTES {
    return None;
  }
  let encoded = base64::engine::general_purpose::STANDARD.encode(&png_bytes);
  Some(format!("data:image/png;base64,{encoded}"))
}

#[tauri::command]
pub fn clipboard_manager_list(state: State<ClipboardManagerState>) -> Result<Vec<ClipboardEntry>, String> {
  state.store.list().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn clipboard_manager_delete(state: State<ClipboardManagerState>, id: String) -> Result<(), String> {
  state.store.delete(&id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn clipboard_manager_clear(state: State<ClipboardManagerState>) -> Result<(), String> {
  state.store.clear().map_err(|e| e.to_string())
}

/// Re-copies a stored entry back onto the system clipboard — text directly, images by decoding
/// the stored PNG data URL back into raw RGBA bytes arboard expects.
#[tauri::command]
pub fn clipboard_manager_restore(kind: String, content: String) -> Result<(), String> {
  let mut clipboard = Clipboard::new().map_err(|e| e.to_string())?;
  if kind == "image" {
    let b64 = content
      .strip_prefix("data:image/png;base64,")
      .ok_or("Malformed image data URL")?;
    let png_bytes = base64::engine::general_purpose::STANDARD
      .decode(b64)
      .map_err(|e| e.to_string())?;
    let decoded = image::load_from_memory(&png_bytes).map_err(|e| e.to_string())?.to_rgba8();
    let (width, height) = decoded.dimensions();
    clipboard
      .set_image(arboard::ImageData {
        width: width as usize,
        height: height as usize,
        bytes: decoded.into_raw().into(),
      })
      .map_err(|e| e.to_string())
  } else {
    clipboard.set_text(content).map_err(|e| e.to_string())
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  /// Exercises the real PNG-encode -> base64 -> data-URL path used by the clipboard watcher,
  /// then the real decode path used by `clipboard_manager_restore`, without touching the live
  /// system clipboard (which would be unsafe/flaky to poke from an automated test run).
  #[test]
  fn image_data_url_round_trips_real_pixels() {
    let width = 4u32;
    let height = 3u32;
    let mut rgba = Vec::with_capacity((width * height * 4) as usize);
    for i in 0..(width * height) {
      rgba.extend_from_slice(&[(i * 10) as u8, 50, 100, 255]);
    }

    let img = arboard::ImageData {
      width: width as usize,
      height: height as usize,
      bytes: rgba.clone().into(),
    };
    let data_url = encode_image_data_url(&img).expect("encode should succeed for a small image");
    assert!(data_url.starts_with("data:image/png;base64,"));

    let b64 = data_url.strip_prefix("data:image/png;base64,").unwrap();
    let png_bytes = base64::engine::general_purpose::STANDARD.decode(b64).unwrap();
    let decoded = image::load_from_memory(&png_bytes).unwrap().to_rgba8();
    assert_eq!(decoded.dimensions(), (width, height));
    assert_eq!(decoded.into_raw(), rgba);
  }

  #[test]
  fn oversized_image_is_skipped_not_stored() {
    // A 4000x4000 solid-color RGBA image PNG-compresses to well under 5MB (solid color
    // compresses extremely well), so use noise-like data that resists compression to
    // actually exceed MAX_IMAGE_BYTES and verify the cap kicks in.
    let width = 4000usize;
    let height = 4000usize;
    let mut rgba = vec![0u8; width * height * 4];
    for (i, byte) in rgba.iter_mut().enumerate() {
      *byte = ((i * 2654435761u64 as usize) % 256) as u8;
    }
    let img = arboard::ImageData { width, height, bytes: rgba.into() };
    assert!(encode_image_data_url(&img).is_none());
  }

  #[test]
  fn preview_of_truncates_long_text_and_collapses_whitespace() {
    let short = preview_of("hello   world");
    assert_eq!(short, "hello world");

    let long = "a".repeat(500);
    let truncated = preview_of(&long);
    assert_eq!(truncated.chars().count(), 141); // 140 chars + ellipsis
    assert!(truncated.ends_with('…'));
  }
}
