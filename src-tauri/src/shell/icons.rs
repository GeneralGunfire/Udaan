//! Real Windows shell icons for any file, folder, shortcut or executable,
//! straight from the system image list (the same icons Explorer shows).

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

static CACHE: OnceLock<Mutex<HashMap<String, Option<String>>>> = OnceLock::new();

/// Icons that are per-file (an exe's own icon, a shortcut's target icon)
/// are cached by path; everything else shares one icon per extension.
fn cache_key(path: &str) -> String {
  let p = std::path::Path::new(path);
  let ext = p.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
  let per_file = p.is_dir() || matches!(ext.as_str(), "exe" | "lnk" | "url" | "ico" | "appref-ms" | "msc" | "cpl" | "");
  if per_file { path.to_lowercase() } else { format!(".{ext}") }
}

pub fn file_icon(path: &str) -> Option<String> {
  let key = cache_key(path);
  let cache = CACHE.get_or_init(|| Mutex::new(HashMap::new()));
  if let Some(hit) = cache.lock().unwrap().get(&key) {
    return hit.clone();
  }
  // The system image list is process-global and not safe to read from
  // several threads at once (concurrent reads returned no icon), so
  // loading is serialized; results are cached, so this is rarely hit.
  static LOAD: Mutex<()> = Mutex::new(());
  let icon = {
    let _guard = LOAD.lock().unwrap_or_else(|e| e.into_inner());
    imp::load(path)
  };
  cache.lock().unwrap().insert(key, icon.clone());
  icon
}

pub fn invalidate(path: &str) {
  if let Some(cache) = CACHE.get() {
    cache.lock().unwrap().remove(&cache_key(path));
  }
}

#[cfg(target_os = "windows")]
mod imp {
  use crate::taskbar::win::{hicon_to_rgba, rgba_to_data_url};
  use windows::core::HSTRING;
  use windows::Win32::Storage::FileSystem::FILE_FLAGS_AND_ATTRIBUTES;
  use windows::Win32::System::Com::{CoInitializeEx, COINIT_APARTMENTTHREADED};
  use windows::Win32::UI::Controls::{IImageList, ILD_TRANSPARENT};
  use windows::Win32::UI::Shell::{SHGetFileInfoW, SHGetImageList, SHFILEINFOW, SHGFI_SYSICONINDEX, SHIL_EXTRALARGE, SHIL_JUMBO};
  use windows::Win32::UI::WindowsAndMessaging::DestroyIcon;

  fn icon_from_list(list_kind: u32, index: i32) -> Option<(u32, u32, Vec<u8>)> {
    unsafe {
      let list: IImageList = SHGetImageList(list_kind as i32).ok()?;
      let hicon = list.GetIcon(index, ILD_TRANSPARENT.0).ok()?;
      let out = hicon_to_rgba(hicon.0 as isize);
      let _ = DestroyIcon(hicon);
      out
    }
  }

  /// Size of the opaque content inside the canvas.
  fn content_extent(w: u32, h: u32, px: &[u8]) -> u32 {
    let (mut max_x, mut max_y) = (0u32, 0u32);
    for y in 0..h {
      for x in 0..w {
        if px[((y * w + x) * 4 + 3) as usize] > 8 {
          max_x = max_x.max(x + 1);
          max_y = max_y.max(y + 1);
        }
      }
    }
    max_x.max(max_y)
  }

  pub fn load(path: &str) -> Option<String> {
    unsafe {
      // S_FALSE / RPC_E_CHANGED_MODE just mean COM is already initialised
      // on this thread; SHGetFileInfo works either way.
      let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
      let mut info = SHFILEINFOW::default();
      let ok = SHGetFileInfoW(
        &HSTRING::from(path),
        FILE_FLAGS_AND_ATTRIBUTES(0),
        Some(&mut info),
        std::mem::size_of::<SHFILEINFOW>() as u32,
        SHGFI_SYSICONINDEX,
      );
      if ok == 0 {
        return None;
      }
      // Apps that only ship a 32/48px icon come back from the jumbo list
      // as a tiny icon in the corner of a 256px canvas; use 48px then.
      if let Some((w, h, px)) = icon_from_list(SHIL_JUMBO, info.iIcon) {
        if content_extent(w, h, &px) > 64 {
          return rgba_to_data_url(w, h, px);
        }
      }
      let (w, h, px) = icon_from_list(SHIL_EXTRALARGE, info.iIcon)?;
      rgba_to_data_url(w, h, px)
    }
  }
}

#[cfg(not(target_os = "windows"))]
mod imp {
  pub fn load(_path: &str) -> Option<String> {
    None
  }
}

/// A program's human name: the "File description" from its version
/// resource (what Task Manager and the taskbar show), else the file stem.
pub fn app_display_name(exe_path: &str) -> String {
  let stem = std::path::Path::new(exe_path)
    .file_stem()
    .map(|s| s.to_string_lossy().into_owned())
    .unwrap_or_else(|| exe_path.to_string());
  imp_name::file_description(exe_path).filter(|d| !d.trim().is_empty()).unwrap_or(stem)
}

#[cfg(target_os = "windows")]
mod imp_name {
  use windows::core::{HSTRING, PCWSTR};
  use windows::Win32::Storage::FileSystem::{GetFileVersionInfoSizeW, GetFileVersionInfoW, VerQueryValueW};

  pub fn file_description(path: &str) -> Option<String> {
    unsafe {
      let file = HSTRING::from(path);
      let size = GetFileVersionInfoSizeW(&file, None);
      if size == 0 {
        return None;
      }
      let mut data = vec![0u8; size as usize];
      GetFileVersionInfoW(&file, None, size, data.as_mut_ptr() as *mut _).ok()?;

      // First language/codepage pair from the translation table.
      let mut ptr: *mut core::ffi::c_void = std::ptr::null_mut();
      let mut len: u32 = 0;
      let key = HSTRING::from(r"\VarFileInfo\Translation");
      if !VerQueryValueW(data.as_ptr() as *const _, PCWSTR(key.as_ptr()), &mut ptr, &mut len).as_bool() || len < 4 {
        return None;
      }
      let pair = std::slice::from_raw_parts(ptr as *const u16, 2);
      let sub = HSTRING::from(format!(r"\StringFileInfo\{:04x}{:04x}\FileDescription", pair[0], pair[1]));
      if !VerQueryValueW(data.as_ptr() as *const _, PCWSTR(sub.as_ptr()), &mut ptr, &mut len).as_bool() || len == 0 {
        return None;
      }
      let chars = std::slice::from_raw_parts(ptr as *const u16, len as usize);
      let end = chars.iter().position(|&c| c == 0).unwrap_or(chars.len());
      Some(String::from_utf16_lossy(&chars[..end]))
    }
  }
}

#[cfg(not(target_os = "windows"))]
mod imp_name {
  pub fn file_description(_: &str) -> Option<String> {
    None
  }
}
