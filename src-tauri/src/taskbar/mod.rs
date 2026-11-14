//! Window enumeration and small window helpers.
//!
//! What is left of the old "taskbar replacement" module after the rebuild: the dock and
//! menu bar are driven by `shell` and `engine` now, so everything that registered AppBars
//! or duplicated focus/minimise commands has been removed. This keeps only what the rest
//! of the shell genuinely calls: listing real top-level windows (with Alt+Tab rules),
//! closing one, extracting window and file icons, removing an AppBar registration by
//! handle, and the DWM live thumbnails the Expose view draws.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;

/// Live-thumbnail registration handles, keyed by the SOURCE window's HWND
/// (the real app window being previewed, not the popup) — one process-wide
/// table shared across every `taskbar_register_thumbnail`/
/// `taskbar_unregister_thumbnail` call, following the same
/// `tauri::State<Mutex<...>>` pattern as `omniroute::OmniRouteProcess`.
/// A raw `isize` stand-in for
/// `HTHUMBNAIL` is stored (rather than the real Windows type) so this
/// struct compiles identically on non-Windows targets, matching how
/// `OpenWindow::handle` already represents HWND as a plain `isize`.
#[derive(Default)]
pub struct ThumbnailRegistry(pub Mutex<HashMap<isize, isize>>);

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpenWindow {
  /// Raw HWND value, opaque to the frontend — passed back to
  /// `taskbar_focus_window`/`taskbar_minimize_window` to act on this
  /// specific window.
  pub handle: isize,
  pub title: String,
  pub process_name: String,
  pub pid: u32,
  pub exe_path: Option<String>,
  pub is_minimized: bool,
  pub is_maximized: bool,
  /// `data:image/png;base64,...` of the window's real icon (via
  /// WM_GETICON, falling back to the window class icon), or `None` if
  /// extraction failed — the frontend falls back to a generic glyph in
  /// that case rather than rendering a broken image.
  pub icon_data_url: Option<String>,
}

#[cfg(target_os = "windows")]
pub(crate) mod win {
  use super::*;
  use windows_sys::Win32::Foundation::{HWND, LPARAM, RECT, TRUE};
  use windows_sys::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_CLOAKED};
  use windows_sys::Win32::System::Threading::{
    OpenProcess, QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION,
  };
  use windows_sys::Win32::UI::Shell::{
    SHAppBarMessage, ABE_BOTTOM, ABE_LEFT, ABE_RIGHT, ABE_TOP, ABM_NEW, ABM_QUERYPOS, ABM_REMOVE,
    ABM_SETPOS, APPBARDATA,
  };
  use windows_sys::Win32::UI::WindowsAndMessaging::{
    EnumWindows, FindWindowW, GetForegroundWindow, GetSystemMetrics, GetWindow, GetWindowLongW,
    GetWindowTextLengthW, GetWindowTextW, GetWindowThreadProcessId, IsIconic, IsWindowVisible,
    IsZoomed, PostMessageW, SetForegroundWindow, SetWindowPos, ShowWindow, GWL_EXSTYLE,
    GW_OWNER, HWND_TOPMOST, SM_CXSCREEN, SM_CYSCREEN, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE,
    SW_HIDE, SW_MINIMIZE, SW_RESTORE, SW_SHOW, WM_CLOSE, WS_EX_APPWINDOW, WS_EX_NOACTIVATE,
    WS_EX_TOOLWINDOW,
  };

  // Icon extraction (WM_GETICON + GDI bitmap readback + PNG encode, see
  // extract_window_icon below) is the expensive part of one enumeration
  // pass — re-doing it for every window on every 700ms taskbar poll
  // (TaskbarWindow.tsx's WINDOW_POLL_MS) was real, continuous CPU/IPC
  // cost for icons that essentially never change after a window opens,
  // and was a real contributor to the taskbar feeling laggy (a slow poll
  // tick can delay the NEXT queued IPC command, e.g. the focus-window
  // call right after a click). Cached here, keyed by HWND, and reused on
  // every later poll instead of re-extracted — a `static` Mutex rather
  // than threading a cache through `lparam` since `enum_proc` is a raw
  // FFI callback with no other channel for extra state, and this only
  // ever runs on the one thread that calls `list_windows()`.
  static ICON_CACHE: std::sync::OnceLock<Mutex<HashMap<isize, Option<String>>>> =
    std::sync::OnceLock::new();

  fn icon_cache() -> &'static Mutex<HashMap<isize, Option<String>>> {
    ICON_CACHE.get_or_init(|| Mutex::new(HashMap::new()))
  }

  pub fn cached_icon(hwnd: HWND) -> Option<String> {
    let key = hwnd as isize;
    if let Some(cached) = icon_cache().lock().unwrap().get(&key) {
      return cached.clone();
    }
    let icon = extract_window_icon(hwnd);
    icon_cache().lock().unwrap().insert(key, icon.clone());
    icon
  }

  unsafe extern "system" fn enum_proc(hwnd: HWND, lparam: LPARAM) -> i32 {
    let windows = &mut *(lparam as *mut Vec<OpenWindow>);

    if IsWindowVisible(hwnd) == 0 {
      return TRUE;
    }
    // Tool windows (utility palettes, most tray-icon host windows) aren't
    // real taskbar-worthy top-level apps — the actual Explorer taskbar
    // excludes them the same way.
    let ex_style = GetWindowLongW(hwnd, GWL_EXSTYLE) as u32;
    if (ex_style & WS_EX_TOOLWINDOW) != 0 {
      return TRUE;
    }
    // Explorer's own Alt+Tab/taskbar rule: an owned window (dialogs,
    // palettes) only gets its own entry if it explicitly opts in with
    // WS_EX_APPWINDOW, and a no-activate window never does.
    let is_app_window = (ex_style & WS_EX_APPWINDOW) != 0;
    if !GetWindow(hwnd, GW_OWNER).is_null() && !is_app_window {
      return TRUE;
    }
    if (ex_style & WS_EX_NOACTIVATE) != 0 && !is_app_window {
      return TRUE;
    }
    // Cloaked windows are "visible" to IsWindowVisible but not on screen:
    // suspended UWP apps and windows on other virtual desktops.
    let mut cloaked: u32 = 0;
    DwmGetWindowAttribute(
      hwnd,
      DWMWA_CLOAKED as _,
      &mut cloaked as *mut u32 as *mut _,
      std::mem::size_of::<u32>() as u32,
    );
    if cloaked != 0 {
      return TRUE;
    }

    let title_len = GetWindowTextLengthW(hwnd);
    if title_len == 0 {
      return TRUE;
    }
    let mut title_buf = vec![0u16; title_len as usize + 1];
    let copied = GetWindowTextW(hwnd, title_buf.as_mut_ptr(), title_buf.len() as i32);
    if copied == 0 {
      return TRUE;
    }
    title_buf.truncate(copied as usize);
    let title = String::from_utf16_lossy(&title_buf);

    // Udaan's own auxiliary windows (see tauri.conf.json's "taskbar" and
    // "taskbar-popup" entries) — without excluding these, the taskbar
    // enumerates its own dock and/or its on-demand hover-preview popup as
    // separate running apps, showing "Udaan" 2-3 times in its own window
    // list even with only the main window open.
    if title == "Udaan Dock" || title == "Udaan Taskbar Popup" {
      return TRUE;
    }

    let mut pid: u32 = 0;
    GetWindowThreadProcessId(hwnd, &mut pid);
    let exe_path = exe_path_for_pid(pid);
    let process_name = exe_path
      .as_deref()
      .and_then(|p| std::path::Path::new(p).file_name())
      .map(|n| n.to_string_lossy().into_owned())
      .unwrap_or_else(|| "Unknown".to_string());

    // Background OS helper processes that own a visible, titled top-level
    // window but aren't something a user ever thinks of as "an open app"
    // — the real Explorer taskbar excludes these too. TextInputHost.exe
    // is the IME/emoji-panel/clipboard-history host; it's always running
    // and its window briefly becomes visible/titled during normal typing,
    // which is what made it show up here. ApplicationFrameHost.exe is the
    // invisible UWP "frame" process that hosts every packaged Windows app
    // window (Settings, Calculator, Photos, etc.) — it briefly owns a
    // visible top-level window of its own during a UWP app's launch/
    // teardown even when no such app is genuinely open, which is what
    // made "Application Host" show up on Udaan's dock unprompted.
    // SystemSettings.exe is the actual Settings app process itself — it
    // can likewise leave a stray background window registered after
    // being opened once (e.g. by Windows Update or a notification) and
    // "closed," without the process fully exiting.
    const SYSTEM_HELPER_PROCESSES: &[&str] = &[
      "TextInputHost.exe",
      "SearchHost.exe",
      "ShellExperienceHost.exe",
      "ApplicationFrameHost.exe",
      "SystemSettings.exe",
      // Windows' built-in "Movies & TV" app — same UWP-background-window
      // pattern as ApplicationFrameHost/SystemSettings above: it stays
      // resident with a stray registered top-level window (confirmed:
      // Video.UI.exe visible in Task Manager at ~1.6MB, clearly idle) long
      // after any video was actually closed, showing up on the dock as a
      // phantom "open app" that isn't actually open from the user's
      // perspective.
      "Video.UI.exe",
    ];
    if SYSTEM_HELPER_PROCESSES.iter().any(|p| p.eq_ignore_ascii_case(&process_name)) {
      return TRUE;
    }

    windows.push(OpenWindow {
      handle: hwnd as isize,
      title,
      process_name,
      pid,
      exe_path,
      is_minimized: IsIconic(hwnd) != 0,
      is_maximized: IsZoomed(hwnd) != 0,
      icon_data_url: None,
    });

    TRUE
  }

  /// Extracts the window's real icon (WM_GETICON, falling back to the
  /// window class icon via GCLP_HICON, then the small variants of each)
  /// and encodes it as a PNG data URI — real per-app icons for the
  /// taskbar's window list, not a generic placeholder glyph. Returns
  /// `None` on any failure rather than propagating an error, since a
  /// missing icon for one window shouldn't break the whole window list.
  fn extract_window_icon(hwnd: HWND) -> Option<String> {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
      GetClassLongPtrW, SendMessageTimeoutW, GCLP_HICON, GCLP_HICONSM, ICON_BIG,
      ICON_SMALL, ICON_SMALL2, SMTO_ABORTIFHUNG, WM_GETICON,
    };

    unsafe {
      // WM_GETICON can hang on an unresponsive window — SendMessageTimeoutW
      // with SMTO_ABORTIFHUNG avoids the whole window-list poll stalling
      // on one bad app.
      // ICON_BIG first (typically 32px) — the taskbar renders these at
      // 28px, so requesting the largest available source and letting the
      // frontend downscale reads far crisper than starting with
      // ICON_SMALL2/ICON_SMALL (typically 16px) and having the browser
      // upscale a tiny bitmap, which is what produced the "blurry" taskbar
      // icons this order previously preferred.
      let mut result: usize = 0;
      let mut hicon = 0isize;
      for icon_type in [ICON_BIG, ICON_SMALL2, ICON_SMALL] {
        SendMessageTimeoutW(
          hwnd,
          WM_GETICON,
          icon_type as usize,
          0,
          SMTO_ABORTIFHUNG,
          200,
          &mut result,
        );
        if result != 0 {
          hicon = result as isize;
          break;
        }
      }
      if hicon == 0 {
        hicon = GetClassLongPtrW(hwnd, GCLP_HICON) as isize;
      }
      if hicon == 0 {
        hicon = GetClassLongPtrW(hwnd, GCLP_HICONSM) as isize;
      }
      if hicon == 0 {
        return None;
      }

      hicon_to_data_url(hicon)
    }
  }

  /// Encodes an HICON as a PNG data URL. Icons without a real alpha
  /// channel (legacy 24-bit icons store transparency in the AND mask
  /// only) get their alpha rebuilt from that mask, instead of rendering
  /// as a solid black square.
  pub fn hicon_to_data_url(hicon: isize) -> Option<String> {
    let (w, h, px) = hicon_to_rgba(hicon)?;
    rgba_to_data_url(w, h, px)
  }

  pub fn rgba_to_data_url(width: u32, height: u32, pixels: Vec<u8>) -> Option<String> {
    let img = image::RgbaImage::from_raw(width, height, pixels)?;
    let mut png_bytes: Vec<u8> = Vec::new();
    image::DynamicImage::ImageRgba8(img)
      .write_to(&mut std::io::Cursor::new(&mut png_bytes), image::ImageFormat::Png)
      .ok()?;
    Some(format!(
      "data:image/png;base64,{}",
      base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &png_bytes)
    ))
  }

  /// HICON → (width, height, RGBA pixels).
  pub fn hicon_to_rgba(hicon: isize) -> Option<(u32, u32, Vec<u8>)> {
    use windows_sys::Win32::Graphics::Gdi::{
      CreateCompatibleDC, DeleteDC, DeleteObject, GetDIBits, GetObjectW, BITMAP, BITMAPINFO,
      BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, HBITMAP,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::GetIconInfo;

    unsafe fn read_bits(bitmap: HBITMAP, width: i32, height: i32) -> Option<Vec<u8>> {
      let mut bmi: BITMAPINFO = std::mem::zeroed();
      bmi.bmiHeader = BITMAPINFOHEADER {
        biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
        biWidth: width,
        biHeight: -height,
        biPlanes: 1,
        biBitCount: 32,
        biCompression: BI_RGB,
        ..std::mem::zeroed()
      };
      let mut pixels = vec![0u8; (width * height * 4) as usize];
      let dc = CreateCompatibleDC(std::ptr::null_mut());
      let copied = GetDIBits(dc, bitmap, 0, height as u32, pixels.as_mut_ptr() as *mut _, &mut bmi, DIB_RGB_COLORS);
      DeleteDC(dc);
      if copied == 0 { None } else { Some(pixels) }
    }

    unsafe {
      let mut info = std::mem::zeroed();
      if GetIconInfo(hicon as _, &mut info) == 0 {
        return None;
      }
      let cleanup = |info: &windows_sys::Win32::UI::WindowsAndMessaging::ICONINFO| {
        if !info.hbmColor.is_null() { DeleteObject(info.hbmColor as _); }
        if !info.hbmMask.is_null() { DeleteObject(info.hbmMask as _); }
      };
      if info.hbmColor.is_null() {
        cleanup(&info);
        return None;
      }
      let mut bmp: BITMAP = std::mem::zeroed();
      if GetObjectW(info.hbmColor as _, std::mem::size_of::<BITMAP>() as i32, &mut bmp as *mut _ as _) == 0 {
        cleanup(&info);
        return None;
      }
      let (width, height) = (bmp.bmWidth, bmp.bmHeight);
      if width <= 0 || height <= 0 || width > 256 || height > 256 {
        cleanup(&info);
        return None;
      }
      let Some(mut pixels) = read_bits(info.hbmColor, width, height) else {
        cleanup(&info);
        return None;
      };
      if pixels.chunks_exact(4).all(|px| px[3] == 0) {
        if let Some(mask) = read_bits(info.hbmMask, width, height) {
          for (px, m) in pixels.chunks_exact_mut(4).zip(mask.chunks_exact(4)) {
            px[3] = if m[0] == 0 { 255 } else { 0 };
          }
        }
      }
      cleanup(&info);

      for px in pixels.chunks_exact_mut(4) {
        px.swap(0, 2);
      }
      Some((width as u32, height as u32, pixels))
    }
  }

  // PROCESS_QUERY_LIMITED_INFORMATION alone is enough for
  // QueryFullProcessImageNameW and, unlike PROCESS_VM_READ, is granted for
  // elevated processes too — so admin apps no longer show as "Unknown".
  static EXE_CACHE: std::sync::OnceLock<Mutex<HashMap<u32, Option<String>>>> =
    std::sync::OnceLock::new();

  pub fn exe_path_for_pid(pid: u32) -> Option<String> {
    let cache = EXE_CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    if let Some(hit) = cache.lock().unwrap().get(&pid) {
      return hit.clone();
    }
    let path = unsafe {
      let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
      if handle.is_null() {
        None
      } else {
        let mut buf = [0u16; 1024];
        let mut len = buf.len() as u32;
        let ok = QueryFullProcessImageNameW(handle, 0, buf.as_mut_ptr(), &mut len);
        windows_sys::Win32::Foundation::CloseHandle(handle);
        if ok == 0 {
          None
        } else {
          Some(String::from_utf16_lossy(&buf[..len as usize]))
        }
      }
    };
    cache.lock().unwrap().insert(pid, path.clone());
    path
  }

  pub fn list_windows() -> Vec<OpenWindow> {
    let mut windows: Vec<OpenWindow> = Vec::new();
    unsafe {
      EnumWindows(Some(enum_proc), &mut windows as *mut _ as isize);
    }
    // Drop icon-cache entries for HWNDs that didn't show up in THIS pass
    // (window closed, or filtered out as a system helper/tool window) —
    // otherwise the cache would grow unbounded over a long-running
    // session as windows come and go. Cheap: one pass building a HashSet
    // of the handles just seen, compared against the cache's keys.
    {
      let seen: std::collections::HashSet<isize> = windows.iter().map(|w| w.handle).collect();
      icon_cache().lock().unwrap().retain(|handle, _| seen.contains(handle));
    }
    windows
  }

  /// Requests the window close itself via `WM_CLOSE`, the same message a
  /// real window's own close button/Alt-F4 sends — `PostMessageW` (not
  /// `SendMessageW`) so this never blocks waiting on an unresponsive or
  /// slow-to-repaint app; the app decides whether to actually exit (it may
  /// still show its own "save changes?" prompt first, same as clicking its
  /// titlebar X would).
  pub fn close_window(handle: isize) -> Result<(), String> {
    unsafe {
      let hwnd = handle as HWND;
      if PostMessageW(hwnd, WM_CLOSE, 0, 0) == 0 {
        return Err("Could not close that window — it may have already closed.".to_string());
      }
    }
    Ok(())
  }

  /// Unregisters the appbar, restoring the normal full-screen work area.
  /// Idempotent — safe to call even if `register_appbar` was never called
  /// or already failed.
  pub fn unregister_appbar(hwnd: isize) {
    unsafe {
      let mut data: APPBARDATA = std::mem::zeroed();
      data.cbSize = std::mem::size_of::<APPBARDATA>() as u32;
      data.hWnd = hwnd as HWND;
      SHAppBarMessage(ABM_REMOVE, &mut data);
    }
  }

  /// Registers a live DWM thumbnail of `source_hwnd` (a real app's window)
  /// to be composited into `dest_hwnd` (the taskbar-popup window) — the
  /// exact mechanism the real Windows 11 taskbar uses for its own hover
  /// previews. Returns the raw `HTHUMBNAIL` (as `isize`) the caller must
  /// hold onto and eventually pass to `unregister_thumbnail`; every
  /// registration MUST be unregistered (DWM does not garbage-collect these
  /// itself, and a well-behaved app is expected to unregister promptly).
  ///
  /// Fails gracefully (returns `Err`, never panics) if `source_hwnd` has
  /// closed, DWM composition is off, or access is denied — the caller
  /// falls back to an icon/title-only row in that case rather than
  /// showing a broken/black rect.
  pub fn register_thumbnail(dest_hwnd: isize, source_hwnd: isize) -> Result<isize, String> {
    use windows_sys::Win32::Graphics::Dwm::DwmRegisterThumbnail;
    unsafe {
      let mut thumb: isize = 0;
      let hr = DwmRegisterThumbnail(dest_hwnd as HWND, source_hwnd as HWND, &mut thumb);
      if hr < 0 {
        return Err(format!("DwmRegisterThumbnail failed (hresult={hr:#x})"));
      }
      Ok(thumb)
    }
  }

  /// Sizes/positions/shows a previously-registered thumbnail. `rect` is in
  /// the DESTINATION window's client coordinates (i.e. relative to the
  /// popup window's own top-left, not screen coordinates) — matches
  /// `DWM_THUMBNAIL_PROPERTIES::rcDestination`'s documented contract.
  /// `source_client_area_only` clips the thumbnail to the source window's
  /// client area (excluding its own titlebar/border) — always `true` here
  /// since the popup draws its own chrome around the thumbnail rather than
  /// wanting the source app's OS titlebar embedded inside it.
  pub fn update_thumbnail(
    thumb: isize,
    left: i32,
    top: i32,
    right: i32,
    bottom: i32,
    opacity: u8,
    visible: bool,
  ) -> Result<(), String> {
    use windows_sys::Win32::Graphics::Dwm::{
      DwmUpdateThumbnailProperties, DWM_TNP_OPACITY, DWM_TNP_RECTDESTINATION,
      DWM_TNP_SOURCECLIENTAREAONLY, DWM_TNP_VISIBLE, DWM_THUMBNAIL_PROPERTIES,
    };
    unsafe {
      let props = DWM_THUMBNAIL_PROPERTIES {
        dwFlags: (DWM_TNP_RECTDESTINATION
          | DWM_TNP_VISIBLE
          | DWM_TNP_OPACITY
          | DWM_TNP_SOURCECLIENTAREAONLY) as u32,
        rcDestination: RECT { left, top, right, bottom },
        rcSource: std::mem::zeroed(),
        opacity,
        fVisible: if visible { TRUE } else { 0 },
        fSourceClientAreaOnly: TRUE,
      };
      let hr = DwmUpdateThumbnailProperties(thumb as _, &props);
      if hr < 0 {
        return Err(format!("DwmUpdateThumbnailProperties failed (hresult={hr:#x})"));
      }
    }
    Ok(())
  }

  /// Unregisters a thumbnail handle. Idempotent-ish in intent (a
  /// double-unregister returns an error from DWM but never panics) —
  /// callers are expected to only call this once per successful
  /// `register_thumbnail`, tracked via `ThumbnailRegistry`.
  pub fn unregister_thumbnail(thumb: isize) {
    use windows_sys::Win32::Graphics::Dwm::DwmUnregisterThumbnail;
    unsafe {
      DwmUnregisterThumbnail(thumb as _);
    }
  }
}

#[cfg(not(target_os = "windows"))]
pub(crate) mod win {
  use super::*;

  pub fn list_windows() -> Vec<OpenWindow> {
    Vec::new()
  }
  pub fn close_window(_handle: isize) -> Result<(), String> {
    Err("Taskbar window control is only supported on Windows.".to_string())
  }
  pub fn unregister_appbar(_hwnd: isize) {}
  pub fn register_thumbnail(_dest_hwnd: isize, _source_hwnd: isize) -> Result<isize, String> {
    Err("Live thumbnails are only supported on Windows.".to_string())
  }
  pub fn update_thumbnail(
    _thumb: isize,
    _left: i32,
    _top: i32,
    _right: i32,
    _bottom: i32,
    _opacity: u8,
    _visible: bool,
  ) -> Result<(), String> {
    Err("Live thumbnails are only supported on Windows.".to_string())
  }
  pub fn unregister_thumbnail(_thumb: isize) {}
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct AppbarRect {
  pub left: i32,
  pub top: i32,
  pub right: i32,
  pub bottom: i32,
}

/// Every visible, titled, non-tool top-level window currently open on the
/// desktop — the real OS-level window list a taskbar shows, not just
/// Udaan's own windows.
#[tauri::command]
pub fn taskbar_list_windows() -> Vec<OpenWindow> {
  win::list_windows()
}

/// Same as `taskbar_unregister_appbar` but by raw HWND, not exposed as a
/// Tauri command — used by `lib.rs`'s `on_window_event` handler, which
/// already has a `tauri::Window` and its HWND in a plain
/// `WindowEvent::CloseRequested` callback (not an invoked command context),
/// so it calls this directly instead of round-tripping through the IPC
/// command layer.
pub fn unregister_appbar_by_hwnd(hwnd: isize) {
  win::unregister_appbar(hwnd);
}

/// Registers a live DWM thumbnail of `source_handle` (a real app's window,
/// e.g. one of the `handle`s returned by `taskbar_list_windows`) into the
/// CALLING window (the taskbar-popup window) and immediately sizes/shows it
/// at `left/top/right/bottom` (in the popup window's own client
/// coordinates). Returns an opaque thumbnail id the frontend must hold and
/// pass to `taskbar_update_thumbnail`/`taskbar_unregister_thumbnail` — also
/// tracked server-side in `ThumbnailRegistry` keyed by `source_handle`, so
/// `taskbar_unregister_all_thumbnails` can sweep every live registration on
/// popup hide even if the frontend loses track of an id (e.g. a bug, or a
/// window closing mid-animation).
///
/// Never fails loudly to the caller in a way that would crash the popup —
/// on any DWM failure (source window closed, composition off, access
/// denied) this returns `Err` and the frontend is expected to fall back to
/// an icon/title-only row for that window rather than show a broken thumbnail.
#[tauri::command]
pub fn taskbar_register_thumbnail(
  window: tauri::Window,
  registry: tauri::State<ThumbnailRegistry>,
  source_handle: isize,
  left: i32,
  top: i32,
  right: i32,
  bottom: i32,
) -> Result<isize, String> {
  let dest_hwnd = window_hwnd(&window)?;
  let thumb = win::register_thumbnail(dest_hwnd, source_handle)?;
  if let Err(e) = win::update_thumbnail(thumb, left, top, right, bottom, 255, true) {
    // Registered but couldn't size/show it — unregister immediately rather
    // than leaking a registered-but-invisible thumbnail handle.
    win::unregister_thumbnail(thumb);
    return Err(e);
  }
  registry.0.lock().unwrap().insert(source_handle, thumb);
  Ok(thumb)
}

/// Re-sizes/repositions an already-registered thumbnail — called on every
/// popup re-measure/reposition (see TaskbarPopupWindow.tsx) rather than
/// re-registering from scratch, since DWM thumbnails are cheap to reposition
/// but registration itself has more overhead.
#[tauri::command]
pub fn taskbar_update_thumbnail(
  thumb: isize,
  left: i32,
  top: i32,
  right: i32,
  bottom: i32,
  opacity: Option<u8>,
) -> Result<(), String> {
  win::update_thumbnail(thumb, left, top, right, bottom, opacity.unwrap_or(255), true)
}

/// Unregisters one thumbnail by its source window handle — called on hover
/// row change (switching which window is previewed in a grouped popup) and
/// on individual window close, so a stale thumbnail never lingers for a
/// window the frontend no longer shows.
#[tauri::command]
pub fn taskbar_unregister_thumbnail(
  registry: tauri::State<ThumbnailRegistry>,
  source_handle: isize,
) -> Result<(), String> {
  if let Some(thumb) = registry.0.lock().unwrap().remove(&source_handle) {
    win::unregister_thumbnail(thumb);
  }
  Ok(())
}

/// Unregisters EVERY currently-tracked thumbnail — the defensive sweep
/// called on popup hide (belt-and-suspenders alongside the frontend's own
/// per-window unregister calls) and from `lib.rs`'s `on_window_event`
/// close-cleanup, mirroring how `taskbar_unregister_appbar`/
/// `unregister_appbar_by_hwnd` already guard against leaking the appbar
/// registration if the popup window closes unexpectedly.
#[tauri::command]
pub fn taskbar_unregister_all_thumbnails(registry: tauri::State<ThumbnailRegistry>) -> Result<(), String> {
  let mut map = registry.0.lock().unwrap();
  for (_, thumb) in map.drain() {
    win::unregister_thumbnail(thumb);
  }
  Ok(())
}

/// Same as `taskbar_unregister_all_thumbnails` but callable directly (not
/// through the IPC command layer) — used by `lib.rs`'s `on_window_event`
/// handler on the popup window's close, the same pattern
/// `unregister_appbar_by_hwnd` already establishes for the appbar.
pub fn unregister_all_thumbnails_by_state(registry: &ThumbnailRegistry) {
  let mut map = registry.0.lock().unwrap();
  for (_, thumb) in map.drain() {
    win::unregister_thumbnail(thumb);
  }
}

#[cfg(target_os = "windows")]
fn window_hwnd(window: &tauri::Window) -> Result<isize, String> {
  window
    .hwnd()
    .map(|h| h.0 as isize)
    .map_err(|e| format!("Could not resolve this window's HWND: {e}"))
}

#[cfg(not(target_os = "windows"))]
fn window_hwnd(_window: &tauri::Window) -> Result<isize, String> {
  Err("The taskbar appbar is only supported on Windows.".to_string())
}

#[cfg(test)]
mod tests {
  use super::*;

  /// Read-only sanity check against the real live desktop — confirms
  /// EnumWindows actually finds real open windows with real titles rather
  /// than an empty or garbage list.
  #[test]
  fn list_windows_finds_real_windows() {
    let windows = taskbar_list_windows();
    println!("found {} open windows:", windows.len());
    let mut with_icon = 0;
    for w in &windows {
      let icon_len = w.icon_data_url.as_ref().map(|s| s.len()).unwrap_or(0);
      if icon_len > 0 {
        with_icon += 1;
      }
      println!(
        "  [{}] \"{}\" ({}) icon_bytes={}",
        w.handle, w.title, w.process_name, icon_len
      );
    }
    println!("{with_icon}/{} windows had an icon extracted", windows.len());
    assert!(!windows.is_empty(), "expected at least one visible titled window on a real desktop");
  }

}
