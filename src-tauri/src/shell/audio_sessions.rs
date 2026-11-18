//! Which apps are making sound right now. Used by the top bar to say what is playing when Windows has no
//! media title for it (some pages play sound without telling the system what it is).
//!
//! Read-only: it lists audio sessions and their peak level. It never changes volume or captures audio.

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioSource {
  pub pid: u32,
  /// Executable file name, e.g. "chrome.exe".
  pub exe: String,
  /// Readable name, e.g. "Chrome".
  pub name: String,
  /// Producing sound right now.
  pub active: bool,
  /// 0.0-1.0 instantaneous peak (read before the session volume is applied).
  pub peak: f32,
}

#[cfg(target_os = "windows")]
mod imp {
  use super::*;
  use windows::core::Interface;
  use windows::Win32::Media::Audio::Endpoints::IAudioMeterInformation;
  use windows::Win32::Media::Audio::{
    eConsole, eRender, AudioSessionStateActive, IAudioSessionControl2, IAudioSessionManager2, IMMDeviceEnumerator, MMDeviceEnumerator,
  };
  use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_MULTITHREADED};
  use windows_sys::Win32::Foundation::CloseHandle;
  use windows_sys::Win32::System::Threading::{OpenProcess, QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION};

  fn exe_of(pid: u32) -> Option<String> {
    unsafe {
      let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
      if h.is_null() {
        return None;
      }
      let mut buf = [0u16; 1024];
      let mut len = buf.len() as u32;
      let ok = QueryFullProcessImageNameW(h, 0, buf.as_mut_ptr(), &mut len);
      CloseHandle(h);
      if ok == 0 {
        return None;
      }
      let path = String::from_utf16_lossy(&buf[..len as usize]);
      path.rsplit(['\\', '/']).next().map(str::to_string)
    }
  }

  fn friendly(exe: &str) -> String {
    let stem = exe.trim_end_matches(".exe").trim_end_matches(".EXE");
    match stem.to_ascii_lowercase().as_str() {
      "chrome" => "Chrome".into(),
      "msedge" => "Edge".into(),
      "firefox" => "Firefox".into(),
      "brave" => "Brave".into(),
      "opera" => "Opera".into(),
      "vivaldi" => "Vivaldi".into(),
      "spotify" => "Spotify".into(),
      "vlc" => "VLC".into(),
      _ => {
        let mut c = stem.chars();
        c.next().map(|f| f.to_uppercase().collect::<String>() + c.as_str()).unwrap_or_default()
      }
    }
  }

  /// Our own processes (and the WebView2 runtime that hosts every Udaan
  /// window) are never offered: tapping them would feed the board its own
  /// output.
  fn is_own(exe: &str) -> bool {
    let e = exe.to_ascii_lowercase();
    e == "udaan.exe" || e == "msedgewebview2.exe"
  }

  fn session_manager() -> Result<IAudioSessionManager2, String> {
    unsafe {
      let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
      let devices: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL).map_err(|e| e.message().to_string())?;
      let device = devices.GetDefaultAudioEndpoint(eRender, eConsole).map_err(|_| "No audio output device.".to_string())?;
      device.Activate::<IAudioSessionManager2>(CLSCTX_ALL, None).map_err(|e| e.message().to_string())
    }
  }

  pub fn sources() -> Result<Vec<AudioSource>, String> {
    let mgr = session_manager()?;
    let mut out: Vec<AudioSource> = Vec::new();
    unsafe {
      let list = mgr.GetSessionEnumerator().map_err(|e| e.message().to_string())?;
      let n = list.GetCount().map_err(|e| e.message().to_string())?;
      for i in 0..n {
        let Ok(ctl) = list.GetSession(i) else { continue };
        let Ok(ctl2) = ctl.cast::<IAudioSessionControl2>() else { continue };
        let Ok(pid) = ctl2.GetProcessId() else { continue };
        // pid 0 is the system-sounds session.
        if pid == 0 {
          continue;
        }
        let Some(exe) = exe_of(pid) else { continue };
        if is_own(&exe) {
          continue;
        }
        let peak = ctl.cast::<IAudioMeterInformation>().and_then(|m| m.GetPeakValue()).unwrap_or(0.0);
        let active = ctl.GetState().map(|s| s == AudioSessionStateActive).unwrap_or(false);
        // A browser has one session per tab/stream: fold them into the
        // loudest entry for that process.
        if let Some(existing) = out.iter_mut().find(|s| s.pid == pid) {
          existing.active |= active;
          existing.peak = existing.peak.max(peak);
          continue;
        }
        out.push(AudioSource { pid, name: friendly(&exe), exe, active, peak });
      }
    }
    out.sort_by(|a, b| b.active.cmp(&a.active).then(b.peak.partial_cmp(&a.peak).unwrap_or(std::cmp::Ordering::Equal)));
    Ok(out)
  }
}

#[cfg(not(target_os = "windows"))]
mod imp {
  use super::*;
  pub fn sources() -> Result<Vec<AudioSource>, String> {
    Ok(Vec::new())
  }
}

#[tauri::command]
pub async fn audio_active_apps() -> Result<Vec<AudioSource>, String> {
  tauri::async_runtime::spawn_blocking(imp::sources).await.map_err(|e| e.to_string())?
}
