//! System audio: the real master volume (Core Audio) and whatever media is
//! playing anywhere (Windows' global media transport sessions).

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VolumeState {
  /// 0.0–1.0
  pub level: f32,
  pub muted: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NowPlaying {
  pub title: String,
  pub artist: String,
  pub album: String,
  /// The app playing it, e.g. "Spotify.exe" or a Store app id.
  pub source: String,
  pub playing: bool,
  pub can_next: bool,
  pub can_previous: bool,
  /// Album art as a data URL, when the app provides it.
  pub thumbnail: Option<String>,
  /// Position (advanced to now while playing) and length; None for live streams.
  pub position_ms: Option<u64>,
  pub duration_ms: Option<u64>,
  pub can_seek: bool,
}

#[cfg(target_os = "windows")]
mod imp {
  use super::*;
  use windows::Media::Control::{GlobalSystemMediaTransportControlsSessionManager, GlobalSystemMediaTransportControlsSessionPlaybackStatus};
  use windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolume;
  use windows::Win32::Media::Audio::{eConsole, eRender, IMMDeviceEnumerator, MMDeviceEnumerator};
  use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_MULTITHREADED};

  fn endpoint() -> Result<IAudioEndpointVolume, String> {
    unsafe {
      let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
      let devices: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL).map_err(|e| e.message().to_string())?;
      let device = devices.GetDefaultAudioEndpoint(eRender, eConsole).map_err(|_| "No audio output device.".to_string())?;
      device.Activate::<IAudioEndpointVolume>(CLSCTX_ALL, None).map_err(|e| e.message().to_string())
    }
  }

  pub fn volume() -> Result<VolumeState, String> {
    let ep = endpoint()?;
    unsafe {
      Ok(VolumeState {
        level: ep.GetMasterVolumeLevelScalar().map_err(|e| e.message().to_string())?,
        muted: ep.GetMute().map_err(|e| e.message().to_string())?.as_bool(),
      })
    }
  }

  pub fn set_volume(level: Option<f32>, muted: Option<bool>) -> Result<VolumeState, String> {
    let ep = endpoint()?;
    unsafe {
      if let Some(l) = level {
        ep.SetMasterVolumeLevelScalar(l.clamp(0.0, 1.0), std::ptr::null()).map_err(|e| e.message().to_string())?;
      }
      if let Some(m) = muted {
        ep.SetMute(m, std::ptr::null()).map_err(|e| e.message().to_string())?;
      }
    }
    volume()
  }

  fn session() -> Option<windows::Media::Control::GlobalSystemMediaTransportControlsSession> {
    let manager = GlobalSystemMediaTransportControlsSessionManager::RequestAsync().ok()?.get().ok()?;
    // Windows' "current" session is simply the one touched last, and is often not the app that is making
    // sound (an idle editor can be "current" while a browser plays). Prefer a session that is playing and
    // has a title; only fall back to the current one when none qualifies.
    let mut best = None;
    let mut best_score = 0u8;
    if let Ok(list) = manager.GetSessions() {
      for s in list {
        let playing = s
          .GetPlaybackInfo()
          .ok()
          .and_then(|i| i.PlaybackStatus().ok())
          .map(|st| st == GlobalSystemMediaTransportControlsSessionPlaybackStatus::Playing)
          .unwrap_or(false);
        let titled = s
          .TryGetMediaPropertiesAsync()
          .ok()
          .and_then(|o| o.get().ok())
          .and_then(|p| p.Title().ok())
          .map(|t| !t.is_empty())
          .unwrap_or(false);
        let score = (playing as u8) * 2 + titled as u8;
        if score > best_score {
          best_score = score;
          best = Some(s);
        }
      }
    }
    best.or_else(|| manager.GetCurrentSession().ok())
  }

  static ART: std::sync::Mutex<Option<(String, Option<String>)>> = std::sync::Mutex::new(None);

  /// Artwork is only re-read when the track changes: decoding it every
  /// poll would burn CPU for an image that doesn't move.
  fn artwork(props: &windows::Media::Control::GlobalSystemMediaTransportControlsSessionMediaProperties, key: String) -> Option<String> {
    if let Some((k, v)) = ART.lock().ok()?.as_ref() {
      if *k == key {
        return v.clone();
      }
    }
    let data = (|| -> Option<String> {
      use windows::Storage::Streams::{Buffer, DataReader, InputStreamOptions};
      let stream = props.Thumbnail().ok()?.OpenReadAsync().ok()?.get().ok()?;
      let size = stream.Size().ok()?;
      if size == 0 || size > 4_000_000 {
        return None;
      }
      let buf = Buffer::Create(size as u32).ok()?;
      let buf = stream.ReadAsync(&buf, size as u32, InputStreamOptions::None).ok()?.get().ok()?;
      let reader = DataReader::FromBuffer(&buf).ok()?;
      let mut bytes = vec![0u8; buf.Length().ok()? as usize];
      reader.ReadBytes(&mut bytes).ok()?;
      let mime = if bytes.starts_with(&[0xFF, 0xD8]) { "image/jpeg" } else { "image/png" };
      Some(format!("data:{mime};base64,{}", base64_encode(&bytes)))
    })();
    if let Ok(mut g) = ART.lock() {
      *g = Some((key, data.clone()));
    }
    data
  }

  fn base64_encode(b: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(b.len() * 4 / 3 + 4);
    for c in b.chunks(3) {
      let n = (c[0] as u32) << 16 | (*c.get(1).unwrap_or(&0) as u32) << 8 | *c.get(2).unwrap_or(&0) as u32;
      out.push(T[(n >> 18) as usize & 63] as char);
      out.push(T[(n >> 12) as usize & 63] as char);
      out.push(if c.len() > 1 { T[(n >> 6) as usize & 63] as char } else { '=' });
      out.push(if c.len() > 2 { T[n as usize & 63] as char } else { '=' });
    }
    out
  }

  pub fn seek(ms: u64) -> Result<(), String> {
    let s = session().ok_or("Nothing is playing.")?;
    s.TryChangePlaybackPositionAsync((ms as i64) * 10_000).and_then(|o| o.get()).map(|_| ()).map_err(|e| e.message().to_string())
  }

  pub fn now_playing() -> Option<NowPlaying> {
    let s = session()?;
    let props = s.TryGetMediaPropertiesAsync().ok()?.get().ok()?;
    let info = s.GetPlaybackInfo().ok()?;
    let controls = info.Controls().ok()?;
    let title = props.Title().map(|t| t.to_string()).unwrap_or_default();
    if title.is_empty() {
      return None;
    }
    let playing = info.PlaybackStatus().map(|st| st == GlobalSystemMediaTransportControlsSessionPlaybackStatus::Playing).unwrap_or(false);
    let artist_s = props.Artist().map(|t| t.to_string()).unwrap_or_default();
    let thumbnail = artwork(&props, format!("{title}|{artist_s}"));
    // The timeline position is a snapshot taken at LastUpdatedTime, so a
    // playing track is advanced by the time elapsed since.
    let (mut position_ms, mut duration_ms) = (None, None);
    if let Ok(t) = s.GetTimelineProperties() {
      let ticks = |v: windows::Foundation::TimeSpan| (v.Duration.max(0) / 10_000) as u64;
      let end = t.EndTime().map(ticks).unwrap_or(0);
      let start = t.StartTime().map(ticks).unwrap_or(0);
      if end > start {
        let len = end - start;
        duration_ms = Some(len);
        let mut pos = t.Position().map(ticks).unwrap_or(0).saturating_sub(start);
        if playing {
          if let Ok(updated) = t.LastUpdatedTime() {
            // DateTime counts 100 ns ticks since 1601.
            let now_ticks = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos() as i64 / 100 + 116_444_736_000_000_000).unwrap_or(0);
            pos += (((now_ticks - updated.UniversalTime) / 10_000).max(0) as u64).min(10 * 60 * 1000);
          }
        }
        position_ms = Some(pos.min(len));
      }
    }
    let can_seek = controls.IsPlaybackPositionEnabled().unwrap_or(false) && duration_ms.is_some();
    Some(NowPlaying {
      title,
      artist: artist_s,
      album: props.AlbumTitle().map(|t| t.to_string()).unwrap_or_default(),
      source: s.SourceAppUserModelId().map(|t| t.to_string()).unwrap_or_default(),
      playing,
      can_next: controls.IsNextEnabled().unwrap_or(false),
      can_previous: controls.IsPreviousEnabled().unwrap_or(false),
      thumbnail,
      position_ms,
      duration_ms,
      can_seek,
    })
  }

  pub fn media_command(cmd: &str) -> Result<(), String> {
    let s = session().ok_or("Nothing is playing.")?;
    let op = match cmd {
      "play-pause" => s.TryTogglePlayPauseAsync(),
      "next" => s.TrySkipNextAsync(),
      "previous" => s.TrySkipPreviousAsync(),
      _ => return Err(format!("unknown media command {cmd:?}")),
    };
    op.and_then(|o| o.get()).map(|_| ()).map_err(|e| e.message().to_string())
  }
}

#[cfg(not(target_os = "windows"))]
mod imp {
  use super::*;
  pub fn volume() -> Result<VolumeState, String> {
    Err("Windows only".into())
  }
  pub fn set_volume(_: Option<f32>, _: Option<bool>) -> Result<VolumeState, String> {
    Err("Windows only".into())
  }
  pub fn now_playing() -> Option<NowPlaying> {
    None
  }
  pub fn media_command(_: &str) -> Result<(), String> {
    Err("Windows only".into())
  }
  pub fn seek(_: u64) -> Result<(), String> {
    Err("Windows only".into())
  }
}

#[tauri::command]
pub async fn shell_volume() -> Result<VolumeState, String> {
  tauri::async_runtime::spawn_blocking(imp::volume).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn shell_set_volume(level: Option<f32>, muted: Option<bool>) -> Result<VolumeState, String> {
  tauri::async_runtime::spawn_blocking(move || imp::set_volume(level, muted)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn shell_now_playing() -> Option<NowPlaying> {
  tauri::async_runtime::spawn_blocking(imp::now_playing).await.ok().flatten()
}

#[tauri::command]
pub async fn shell_media_command(command: String) -> Result<(), String> {
  tauri::async_runtime::spawn_blocking(move || imp::media_command(&command)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn shell_media_seek(position_ms: u64) -> Result<(), String> {
  tauri::async_runtime::spawn_blocking(move || imp::seek(position_ms)).await.map_err(|e| e.to_string())?
}

#[cfg(all(test, target_os = "windows"))]
mod tests {
  #[test]
  fn reads_real_master_volume_and_media_session() {
    let v = super::imp::volume().expect("default audio endpoint");
    println!("volume {:.2} muted {}", v.level, v.muted);
    assert!((0.0..=1.0).contains(&v.level));
    println!("now playing: {:?}", super::imp::now_playing());
  }
}
