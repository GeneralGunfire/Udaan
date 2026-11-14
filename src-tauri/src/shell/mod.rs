//! Shell services: the small commands the shell windows call that are not window management.
//!
//! Real file and app icons, installed apps, the Recycle Bin and folder watching, the clipboard,
//! context-menu verbs, the session (startup programs, autostart), hot corners, media keys and
//! now-playing, process and network status, and the window material (blur). The core that used to
//! live here is the engine now: window tracking is `engine::tracker`, actions on windows are
//! `engine::window_actions`, the keyboard is `engine::keyboard`, app windows are `engine::apps`,
//! and Explorer's taskbar is `engine::explorer`.

use std::collections::HashMap;
use tauri::Manager;

mod icons;
pub mod fs;
pub mod clipboard;
pub mod verbs;
pub mod apps;
pub mod session;
pub mod corners;
pub mod media;
pub mod live_audio;
pub mod edge_light;
pub mod procs;
pub mod network;
pub mod gesture;
pub mod material;

fn hwnd_of(w: &tauri::WebviewWindow) -> Result<isize, String> {
  #[cfg(target_os = "windows")]
  {
    w.hwnd().map(|h| h.0 as isize).map_err(|e| e.to_string())
  }
  #[cfg(not(target_os = "windows"))]
  {
    let _ = w;
    Err("unsupported".into())
  }
}

// ---------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------

/// Real shell icons for many paths at once (desktop icons, dock pins).
#[tauri::command]
pub async fn shell_file_icons(paths: Vec<String>) -> HashMap<String, Option<String>> {
  tauri::async_runtime::spawn_blocking(move || {
    paths.into_iter().map(|p| { let icon = icons::file_icon(&p); (p, icon) }).collect()
  })
  .await
  .unwrap_or_default()
}

#[tauri::command]
pub async fn shell_app_names(paths: Vec<String>) -> HashMap<String, String> {
  tauri::async_runtime::spawn_blocking(move || {
    paths.into_iter().map(|p| { let n = icons::app_display_name(&p); (p, n) }).collect()
  })
  .await
  .unwrap_or_default()
}

/// Resolves launch targets for many executable names at once (dock pins).
#[tauri::command]
pub async fn shell_resolve_launch(exes: Vec<String>) -> HashMap<String, Option<String>> {
  tauri::async_runtime::spawn_blocking(move || {
    exes.into_iter().map(|e| { let t = crate::installed_apps::resolve_launch_target(&e); (e, t) }).collect()
  })
  .await
  .unwrap_or_default()
}

#[tauri::command]
pub fn shell_invalidate_icon(path: String) {
  icons::invalidate(&path);
}

/// Asks the compositor to blur the desktop behind the CALLING window.
///
/// This is what makes shell surfaces real glass rather than a tinted
/// rectangle: a webview can only blur its own pixels, so the one surface it
/// can never blur is the desktop it floats over. See `shell::material`.
///
/// Returns what the system actually gave us, because the webview must paint
/// a different tint depending on whether a real blur landed — two full tints
/// stacked turn any surface to mud.
#[tauri::command]
pub fn shell_set_material(
  window: tauri::WebviewWindow,
  material: material::Material,
  tint: u32,
  dark: bool,
  rounded: bool,
) -> Result<material::Applied, String> {
  let hwnd = hwnd_of(&window)?;
  let applied = material::apply(hwnd, material, tint, dark);
  material::set_corners(hwnd, rounded);
  Ok(applied)
}

#[cfg(all(test, target_os = "windows"))]
mod tests {
  #[test]
  fn shell_icon_for_explorer_exe_is_a_real_png() {
    let icon = super::icons::file_icon(r"C:\Windows\explorer.exe").expect("explorer.exe has an icon");
    assert!(icon.starts_with("data:image/png;base64,"));
    assert!(icon.len() > 1000, "icon suspiciously small: {} bytes", icon.len());
  }

  #[test]
  fn shell_icon_for_folder_and_unknown_extension() {
    assert!(super::icons::file_icon(r"C:\Windows").is_some());
    assert!(super::icons::file_icon(r"C:\Windows\win.ini").is_some());
  }

  #[test]
  fn clipboard_file_list_round_trips_with_cut_flag() {
    let path = std::env::temp_dir().join("udaan-clip-test.txt");
    std::fs::write(&path, "x").unwrap();
    let p = path.to_string_lossy().into_owned();
    super::clipboard::shell_clipboard_set_files(vec![p.clone()], true).unwrap();
    let got = super::clipboard::shell_clipboard_get_files().unwrap();
    assert_eq!(got.paths, vec![p.clone()]);
    assert!(got.cut);
    super::clipboard::shell_clipboard_set_files(vec![p.clone()], false).unwrap();
    assert!(!super::clipboard::shell_clipboard_get_files().unwrap().cut);
  }

  #[test]
  fn window_list_applies_alt_tab_rules() {
    let list = crate::engine::windowlist::win::list_windows();
    for w in &list {
      assert!(!w.title.is_empty());
      assert!(w.pid != 0);
    }
    println!("{} windows: {:?}", list.len(), list.iter().map(|w| (&w.title, &w.process_name, w.is_maximized)).collect::<Vec<_>>());
  }

  #[test]
  fn app_display_name_reads_file_description() {
    let name = super::icons::app_display_name(r"C:\Windows\explorer.exe");
    assert_eq!(name, "Windows Explorer");
  }

  #[test]
  fn recycle_bin_is_readable() {
    let items = trash::os_limited::list().expect("recycle bin list");
    println!("recycle bin items: {}", items.len());
  }
}

#[cfg(all(test, target_os = "windows"))]
mod pin_tests {
  #[test]
  fn resolves_users_pinned_apps() {
    for exe in ["Code.exe", "Claude.exe", "NortonPrivateBrowser.exe", "explorer.exe"] {
      println!("{exe} -> {:?}", crate::installed_apps::resolve_launch_target(exe));
    }
  }
}
