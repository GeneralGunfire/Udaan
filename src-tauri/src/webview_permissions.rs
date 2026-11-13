/// WebView2 denies `getUserMedia` (mic/camera) by default for embedded apps —
/// there's no OS-level prompt like in a real browser, so the mic button's
/// `getUserMedia` call rejects silently unless the host explicitly grants it
/// via the `PermissionRequested` event. wry only wires this event up for
/// clipboard access, so we hook the raw WebView2 COM API ourselves.
#[cfg(windows)]
pub fn allow_media_capture(window: &tauri::WebviewWindow) {
  use webview2_com::Microsoft::Web::WebView2::Win32::{
    COREWEBVIEW2_PERMISSION_KIND_MICROPHONE, COREWEBVIEW2_PERMISSION_STATE_ALLOW,
  };
  use webview2_com::PermissionRequestedEventHandler;

  let result = window.with_webview(|webview| unsafe {
    let core = match webview.controller().CoreWebView2() {
      Ok(core) => core,
      Err(e) => {
        log::warn!("Failed to get CoreWebView2 for permission handling: {e}");
        return;
      }
    };

    let mut token: i64 = 0;
    let handler = PermissionRequestedEventHandler::create(Box::new(move |_sender, args| {
      let Some(args) = args else { return Ok(()) };
      let mut kind = Default::default();
      args.PermissionKind(&mut kind)?;
      if kind == COREWEBVIEW2_PERMISSION_KIND_MICROPHONE {
        args.SetState(COREWEBVIEW2_PERMISSION_STATE_ALLOW)?;
      }
      Ok(())
    }));

    if let Err(e) = core.add_PermissionRequested(&handler, &mut token) {
      log::warn!("Failed to register PermissionRequested handler: {e}");
    }
  });

  if let Err(e) = result {
    log::warn!("Failed to access webview for permission setup: {e}");
  }
}

#[cfg(not(windows))]
pub fn allow_media_capture(_window: &tauri::WebviewWindow) {}

/// Asks WebView2 to keep this window's memory low (it trims caches and
/// working set) or back to normal. Used for shell windows that sit hidden
/// most of the time: the launcher, flyouts and banners.
#[tauri::command]
pub fn shell_set_webview_memory_low(window: tauri::WebviewWindow, low: bool) {
  #[cfg(windows)]
  {
    use webview2_com::Microsoft::Web::WebView2::Win32::{
      ICoreWebView2_19, COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW, COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL,
    };
    use windows::core::Interface;
    let _ = window.with_webview(move |webview| unsafe {
      let Ok(core) = webview.controller().CoreWebView2() else { return };
      if let Ok(core19) = core.cast::<ICoreWebView2_19>() {
        let level = if low { COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW } else { COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL };
        let _ = core19.SetMemoryUsageTargetLevel(level);
      }
    });
  }
  #[cfg(not(windows))]
  let _ = (window, low);
}
