//! File copy/cut/paste through the real Windows clipboard (CF_HDROP plus
//! the "Preferred DropEffect" format Explorer uses to mark a cut).

use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardFiles {
  pub paths: Vec<String>,
  pub cut: bool,
}

#[cfg(target_os = "windows")]
mod imp {
  use super::ClipboardFiles;
  use clipboard_win::{formats, raw, register_format, Clipboard, Getter, Setter};

  const DROPEFFECT_COPY: u32 = 1;
  const DROPEFFECT_MOVE: u32 = 2;

  fn open() -> Result<Clipboard, String> {
    Clipboard::new_attempts(10).map_err(|e| format!("clipboard busy: {e}"))
  }

  pub fn set(paths: Vec<String>, cut: bool) -> Result<(), String> {
    let _clip = open()?;
    raw::empty().map_err(|e| e.to_string())?;
    formats::FileList.write_clipboard(&paths).map_err(|e| e.to_string())?;
    if let Some(fmt) = register_format("Preferred DropEffect") {
      let effect = if cut { DROPEFFECT_MOVE } else { DROPEFFECT_COPY | 4 };
      raw::set_without_clear(fmt.get(), &effect.to_le_bytes()).map_err(|e| e.to_string())?;
    }
    Ok(())
  }

  pub fn get() -> Result<ClipboardFiles, String> {
    let _clip = open()?;
    let mut paths: Vec<String> = Vec::new();
    if formats::FileList.read_clipboard(&mut paths).is_err() {
      return Ok(ClipboardFiles { paths: Vec::new(), cut: false });
    }
    let mut cut = false;
    if let Some(fmt) = register_format("Preferred DropEffect") {
      let mut buf = Vec::new();
      if raw::get_vec(fmt.get(), &mut buf).is_ok() && buf.len() >= 4 {
        cut = u32::from_le_bytes([buf[0], buf[1], buf[2], buf[3]]) & DROPEFFECT_MOVE != 0;
      }
    }
    Ok(ClipboardFiles { paths, cut })
  }
}

#[cfg(not(target_os = "windows"))]
mod imp {
  use super::ClipboardFiles;
  pub fn set(_: Vec<String>, _: bool) -> Result<(), String> {
    Err("Windows only".into())
  }
  pub fn get() -> Result<ClipboardFiles, String> {
    Ok(ClipboardFiles { paths: Vec::new(), cut: false })
  }
}

#[tauri::command]
pub fn shell_clipboard_set_files(paths: Vec<String>, cut: bool) -> Result<(), String> {
  imp::set(paths, cut)
}

#[tauri::command]
pub fn shell_clipboard_get_files() -> Result<ClipboardFiles, String> {
  imp::get()
}
