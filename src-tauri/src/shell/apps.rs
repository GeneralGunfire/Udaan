//! Every installed app, from the same source as the Windows Start menu
//! (the shell's AppsFolder: classic programs and Store apps alike).

use serde::Serialize;
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledApp {
  pub name: String,
  /// AppsFolder parsing name: an AUMID for Store apps or a path/known-folder
  /// path for classic ones. Launch with `shell:AppsFolder\<id>`.
  pub id: String,
}

static ICONS: OnceLock<Mutex<HashMap<String, Option<String>>>> = OnceLock::new();

#[cfg(target_os = "windows")]
mod imp {
  use super::InstalledApp;
  use windows::core::{Interface, PWSTR};
  use windows::Win32::Foundation::SIZE;
  use windows::Win32::Graphics::Gdi::{
    CreateCompatibleDC, DeleteDC, DeleteObject, GetDIBits, GetObjectW, BITMAP, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, HGDIOBJ,
  };
  use windows::Win32::System::Com::{CoInitializeEx, CoTaskMemFree, COINIT_APARTMENTTHREADED};
  use windows::Win32::UI::Shell::{
    BHID_EnumItems, FOLDERID_AppsFolder, IEnumShellItems, IShellItem, IShellItemImageFactory, SHCreateItemFromParsingName, SHGetKnownFolderItem,
    KF_FLAG_DEFAULT, SIGDN_NORMALDISPLAY, SIGDN_PARENTRELATIVEPARSING, SIIGBF_ICONONLY,
  };

  unsafe fn take(p: PWSTR) -> String {
    let s = p.to_string().unwrap_or_default();
    CoTaskMemFree(Some(p.0 as *const _));
    s
  }

  pub fn list() -> Result<Vec<InstalledApp>, String> {
    unsafe {
      let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
      let folder: IShellItem = SHGetKnownFolderItem(&FOLDERID_AppsFolder, KF_FLAG_DEFAULT, None).map_err(|e| e.message().to_string())?;
      let items: IEnumShellItems = folder.BindToHandler(None, &BHID_EnumItems).map_err(|e| e.message().to_string())?;
      let mut out = Vec::new();
      loop {
        let mut batch = [None];
        let mut fetched = 0u32;
        if items.Next(&mut batch, Some(&mut fetched)).is_err() || fetched == 0 {
          break;
        }
        let Some(item) = batch[0].take() else { break };
        let (Ok(name), Ok(id)) = (item.GetDisplayName(SIGDN_NORMALDISPLAY), item.GetDisplayName(SIGDN_PARENTRELATIVEPARSING)) else {
          continue;
        };
        let (name, id) = (take(name), take(id));
        if name.is_empty() || id.is_empty() {
          continue;
        }
        out.push(InstalledApp { name, id });
      }
      Ok(out)
    }
  }

  /// The app's icon as the shell renders it, at `size` px.
  pub fn icon(id: &str, size: i32) -> Option<String> {
    unsafe {
      let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
      let path = windows::core::HSTRING::from(format!(r"shell:AppsFolder\{id}"));
      let item: IShellItem = SHCreateItemFromParsingName(&path, None).ok()?;
      let factory: IShellItemImageFactory = item.cast().ok()?;
      let hbmp = factory.GetImage(SIZE { cx: size, cy: size }, SIIGBF_ICONONLY).ok()?;
      let mut bmp = BITMAP::default();
      if GetObjectW(HGDIOBJ(hbmp.0), std::mem::size_of::<BITMAP>() as i32, Some(&mut bmp as *mut _ as *mut _)) == 0 {
        let _ = DeleteObject(HGDIOBJ(hbmp.0));
        return None;
      }
      let (w, h) = (bmp.bmWidth, bmp.bmHeight.abs());
      let mut bmi = BITMAPINFO::default();
      bmi.bmiHeader = BITMAPINFOHEADER {
        biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
        biWidth: w,
        biHeight: -h,
        biPlanes: 1,
        biBitCount: 32,
        biCompression: BI_RGB.0,
        ..Default::default()
      };
      let mut px = vec![0u8; (w * h * 4) as usize];
      let dc = CreateCompatibleDC(None);
      let copied = GetDIBits(dc, hbmp, 0, h as u32, Some(px.as_mut_ptr() as *mut _), &mut bmi, DIB_RGB_COLORS);
      let _ = DeleteDC(dc);
      let _ = DeleteObject(HGDIOBJ(hbmp.0));
      if copied == 0 {
        return None;
      }
      // BGRA, premultiplied → straight RGBA.
      for p in px.chunks_exact_mut(4) {
        let a = p[3] as u32;
        let (b, g, r) = (p[0] as u32, p[1] as u32, p[2] as u32);
        let un = |c: u32| if a == 0 { 0 } else { ((c * 255 + a / 2) / a).min(255) as u8 };
        p[0] = un(r);
        p[1] = un(g);
        p[2] = un(b);
      }
      crate::taskbar::win::rgba_to_data_url(w as u32, h as u32, px)
    }
  }
}

#[cfg(not(target_os = "windows"))]
mod imp {
  use super::InstalledApp;
  pub fn list() -> Result<Vec<InstalledApp>, String> {
    Ok(Vec::new())
  }
  pub fn icon(_: &str, _: i32) -> Option<String> {
    None
  }
}

/// Noise the real Start menu also hides from its app list.
fn is_noise(app: &InstalledApp) -> bool {
  let n = app.name.to_lowercase();
  let id = app.id.to_lowercase();
  const NOISE: &[&str] = &["readme", "documentation", "release notes", "installation notes", "user guide", "manual", "license", "website", "what's new"];
  n.starts_with("uninstall") || n.ends_with(" help") || NOISE.iter().any(|w| n.contains(w)) || id.ends_with(".url") || id.ends_with(".chm") || id.ends_with(".txt") || id.ends_with(".pdf") || id.ends_with(".html")
}

#[tauri::command]
pub async fn shell_installed_apps() -> Result<Vec<InstalledApp>, String> {
  tauri::async_runtime::spawn_blocking(|| {
    let mut apps: Vec<InstalledApp> = imp::list()?.into_iter().filter(|a| !is_noise(a)).collect();
    apps.sort_by_key(|a| a.name.to_lowercase());
    apps.dedup_by(|a, b| a.name.eq_ignore_ascii_case(&b.name));
    Ok(apps)
  })
  .await
  .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn shell_installed_app_icons(ids: Vec<String>) -> HashMap<String, Option<String>> {
  tauri::async_runtime::spawn_blocking(move || {
    let cache = ICONS.get_or_init(|| Mutex::new(HashMap::new()));
    ids
      .into_iter()
      .map(|id| {
        if let Some(hit) = cache.lock().unwrap().get(&id) {
          return (id, hit.clone());
        }
        let icon = imp::icon(&id, 96);
        cache.lock().unwrap().insert(id.clone(), icon.clone());
        (id, icon)
      })
      .collect()
  })
  .await
  .unwrap_or_default()
}

#[cfg(all(test, target_os = "windows"))]
mod tests {
  #[test]
  fn lists_real_start_menu_apps_with_icons() {
    let apps = super::imp::list().expect("apps folder");
    println!("{} apps; first: {:?}", apps.len(), apps.iter().take(8).map(|a| &a.name).collect::<Vec<_>>());
    assert!(apps.len() > 10, "expected a real app list");
    let with_icon = apps.iter().take(10).filter(|a| super::imp::icon(&a.id, 64).is_some()).count();
    println!("{with_icon}/10 icons");
    assert!(with_icon >= 7);
  }
}
