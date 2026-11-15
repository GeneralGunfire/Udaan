//! Live audio tap for the DJ board: lists which apps are making sound, and
//! streams one app's audio (a browser tab on YouTube Music, Spotify, …) to
//! the webview so the DJ effects can be applied to it in real time.
//!
//! Capture uses Windows' per-process loopback (build 19041+), which hands us
//! just that app's audio — not the whole system mix, and never Udaan's own
//! output, so there is no feedback loop. While the board is "taking over",
//! the original is turned right down at the app's audio session (muting it
//! would silence the tap too: capture happens after the session volume) and
//! the webview multiplies the stream back up to full level.

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
  /// 0.0–1.0 instantaneous peak.
  pub peak: f32,
}

#[cfg(target_os = "windows")]
mod imp {
  use super::*;
  use std::collections::{HashSet, VecDeque};
  use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
  use std::sync::{Arc, Mutex};
  use std::thread::JoinHandle;
  use std::time::{Duration, SystemTime, UNIX_EPOCH};
  use tauri::ipc::{Channel, InvokeResponseBody};
  use wasapi::{initialize_mta, AudioClient, Direction, SampleType, StreamMode, WaveFormat};
  use windows::core::Interface;
  use windows::Win32::Media::Audio::Endpoints::IAudioMeterInformation;
  use windows::Win32::Media::Audio::{
    eConsole, eRender, AudioSessionStateActive, IAudioSessionControl2, IAudioSessionManager2, IMMDeviceEnumerator, ISimpleAudioVolume, MMDeviceEnumerator,
  };
  use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_MULTITHREADED};
  use windows_sys::Win32::Foundation::CloseHandle;
  use windows_sys::Win32::System::Threading::{OpenProcess, QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION};

  /// The board pings while it is open. If the pings stop (window crashed or
  /// was killed) the tap shuts itself down and restores the source's volume, so an
  /// app is never left silenced with nobody processing it.
  const WATCHDOG: Duration = Duration::from_secs(8);

  /// Windows applies a session's volume scalar squared (0.5 → amplitude 0.25),
  /// and the tap is captured after it, so restoring full level needs
  /// 1 / level². The tap also has a small fixed noise floor, which that gain
  /// scales up too, so the source is only ever turned down as far as the user
  /// chooses: quieter original = more of that floor.
  pub fn gain_for(level: f32) -> f32 {
    let l = level.clamp(0.05, 1.0);
    1.0 / (l * l)
  }

  static LAST_PING: AtomicU64 = AtomicU64::new(0);
  /// How loud the tapped app keeps playing (f32 bits; 1.0 = untouched).
  static LEVEL: AtomicU32 = AtomicU32::new(0x3f800000);
  static MUTED: Mutex<Option<HashSet<u32>>> = Mutex::new(None);
  static CAPTURE: Mutex<Option<Capture>> = Mutex::new(None);

  struct Capture {
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
  }

  fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
  }

  pub fn ping() {
    LAST_PING.store(now_ms(), Ordering::Relaxed);
  }

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
    ping();
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

  /// Sets the session volume (0.0–1.0) of every audio session belonging to
  /// `pid`. Not a mute: a muted session also silences the tap, whereas a
  /// very low volume is simply scaled back up in the webview.
  pub fn set_session_volume(pid: u32, volume: f32) -> Result<(), String> {
    let mgr = session_manager()?;
    unsafe {
      let list = mgr.GetSessionEnumerator().map_err(|e| e.message().to_string())?;
      let n = list.GetCount().map_err(|e| e.message().to_string())?;
      for i in 0..n {
        let Ok(ctl) = list.GetSession(i) else { continue };
        let Ok(ctl2) = ctl.cast::<IAudioSessionControl2>() else { continue };
        if ctl2.GetProcessId().ok() != Some(pid) {
          continue;
        }
        if let Ok(vol) = ctl.cast::<ISimpleAudioVolume>() {
          let _ = vol.SetMute(false, std::ptr::null());
          let _ = vol.SetMasterVolume(volume.clamp(0.0, 1.0), std::ptr::null());
        }
      }
    }
    let mut guard = MUTED.lock().unwrap();
    let set = guard.get_or_insert_with(HashSet::new);
    if volume < 1.0 {
      set.insert(pid);
    } else {
      set.remove(&pid);
    }
    Ok(())
  }

  /// Restores everything this module ever turned down. Safe to call any time.
  pub fn restore_all() {
    let pids: Vec<u32> = MUTED.lock().unwrap().as_ref().map(|s| s.iter().copied().collect()).unwrap_or_default();
    for pid in pids {
      let _ = set_session_volume(pid, 1.0);
    }
  }

  /// The app's own level meters. They read the signal BEFORE the session volume, which is what lets the
  /// capture loop measure how much Windows really turned the app down (it is far less than a naive
  /// volume-squared guess: 0.3 is only about -8.5 dB), and so how much to give back.
  struct Meters {
    pid: u32,
    list: Vec<IAudioMeterInformation>,
    at: std::time::Instant,
  }

  impl Meters {
    fn new(pid: u32) -> Self {
      let mut m = Meters { pid, list: Vec::new(), at: std::time::Instant::now() - Duration::from_secs(10) };
      m.refresh();
      m
    }
    fn refresh(&mut self) {
      self.at = std::time::Instant::now();
      self.list.clear();
      let Ok(mgr) = session_manager() else { return };
      unsafe {
        let Ok(list) = mgr.GetSessionEnumerator() else { return };
        let n = list.GetCount().unwrap_or(0);
        for i in 0..n {
          let Ok(ctl) = list.GetSession(i) else { continue };
          let Ok(ctl2) = ctl.cast::<IAudioSessionControl2>() else { continue };
          if ctl2.GetProcessId().ok() != Some(self.pid) {
            continue;
          }
          if let Ok(m) = ctl.cast::<IAudioMeterInformation>() {
            self.list.push(m);
          }
        }
      }
    }
    fn peak(&mut self) -> f32 {
      if self.at.elapsed() > Duration::from_millis(500) {
        self.refresh();
      }
      let mut best = 0.0f32;
      for m in &self.list {
        if let Ok(v) = unsafe { m.GetPeakValue() } {
          best = best.max(v);
        }
      }
      best
    }
  }

  /// What Windows does to an app's level for a session volume, as measured (not squared): used until the
  /// meters have given a real reading.
  fn model_attenuation(volume: f32) -> f32 {
    volume.clamp(0.01, 1.0).powf(0.78)
  }

  /// Soft ceiling: a boosted peak bends toward full scale instead of flattening into a click.
  fn soft_limit(x: f32) -> f32 {
    let a = x.abs();
    if a <= 0.85 {
      x
    } else {
      x.signum() * (0.85 + 0.15 * ((a - 0.85) / 0.15).tanh())
    }
  }

  fn run_capture(pid: u32, rate: u32, stop: Arc<AtomicBool>, channel: Channel<InvokeResponseBody>) -> Result<(), String> {
    let _ = initialize_mta();
    let fmt = WaveFormat::new(32, 32, &SampleType::Float, rate as usize, 2, None);
    let mut client = AudioClient::new_application_loopback_client(pid, true).map_err(|e| e.to_string())?;
    let mode = StreamMode::EventsShared { autoconvert: true, buffer_duration_hns: 0 };
    client.initialize_client(&fmt, &Direction::Capture, &mode).map_err(|e| e.to_string())?;
    let event = client.set_get_eventhandle().map_err(|e| e.to_string())?;
    let capture = client.get_audiocaptureclient().map_err(|e| e.to_string())?;
    client.start_stream().map_err(|e| e.to_string())?;

    let mut queue: VecDeque<u8> = VecDeque::with_capacity(rate as usize * 8 / 10);
    let mut applied = 1.0f32;
    let mut last_duck = std::time::Instant::now();
    let clock_start = std::time::Instant::now();
    let mut sent_frames: u64 = 0;
    let mut meters = Meters::new(pid);
    let mut win_t = [0f32; 100];
    let mut win_m = [0f32; 100];
    let mut wi = 0usize;
    let mut a_est = 1.0f32;
    let mut last_est = std::time::Instant::now();
    while !stop.load(Ordering::Relaxed) {
      // The level can change while live (the board's "Original" control).
      // Apply the volume first, and only then use its gain, so the stream is
      // never boosted ahead of the source actually being turned down.
      // A browser opens new sessions for new tabs; those start at full
      // volume, so a turned-down process is re-asserted regularly or they'd
      // be both audible and multiplied by the gain.
      let wanted = f32::from_bits(LEVEL.load(Ordering::Relaxed));
      if (wanted - applied).abs() > 1e-4 || (applied < 0.999 && last_duck.elapsed() > Duration::from_millis(120)) {
        let _ = set_session_volume(pid, wanted);
        if (wanted - applied).abs() > 1e-4 {
          a_est = model_attenuation(wanted);
          win_t = [0f32; 100];
          win_m = [0f32; 100];
        }
        applied = wanted;
        last_duck = std::time::Instant::now();
      }
      if now_ms().saturating_sub(LAST_PING.load(Ordering::Relaxed)) > WATCHDOG.as_millis() as u64 {
        break;
      }
      // A silent app produces no packets at all. If that were passed on as "nothing", the player would
      // run dry on every quiet moment and keep growing its safety buffer (measured: 500+ dropouts and
      // 250 ms of delay on real music). So the stream follows the wall clock: when the source sends
      // less than the clock says it should have, the gap is filled with silence.
      let _ = event.wait_for_event(10);
      loop {
        match capture.get_next_packet_size() {
          Ok(Some(n)) if n > 0 => {
            if capture.read_from_device_to_deque(&mut queue).is_err() {
              break;
            }
          }
          _ => break,
        }
      }
      sent_frames += (queue.len() / 8) as u64;
      let due = (clock_start.elapsed().as_secs_f64() * rate as f64) as u64;
      if queue.is_empty() {
        if due > sent_frames + (rate as u64 / 100) {
          // More than 10 ms behind the clock: send the missing time as silence (at most 100 ms at once).
          let gap = (due - sent_frames).min(rate as u64 / 10);
          queue.extend(std::iter::repeat(0u8).take(gap as usize * 8));
          sent_frames += gap;
        }
      }
      if !queue.is_empty() {
        let mut bytes: Vec<u8> = queue.drain(..).collect();
        // How loud is the tap now, against how loud the app really is (its meter, before the volume)?
        let mut tap_peak = 0.0f32;
        for c in bytes.chunks_exact(4) {
          tap_peak = tap_peak.max(f32::from_le_bytes([c[0], c[1], c[2], c[3]]).abs());
        }
        win_t[wi] = tap_peak;
        win_m[wi] = meters.peak();
        wi = (wi + 1) % win_t.len();
        if applied < 0.999 {
          if last_est.elapsed() > Duration::from_millis(100) {
            last_est = std::time::Instant::now();
            let mt = win_t.iter().cloned().fold(0.0f32, f32::max);
            let mm = win_m.iter().cloned().fold(0.0f32, f32::max);
            if mm > 0.05 && mt > 1e-6 {
              let a_new = (mt / mm).clamp(0.003, 1.0);
              a_est = 0.7 * a_est + 0.3 * a_new;
            }
          }
          let gain = (1.0 / a_est.max(0.003)).clamp(1.0, 120.0);
          for c in bytes.chunks_exact_mut(4) {
            let v = soft_limit(f32::from_le_bytes([c[0], c[1], c[2], c[3]]) * gain);
            c.copy_from_slice(&v.to_le_bytes());
          }
        }
        if channel.send(InvokeResponseBody::Raw(bytes)).is_err() {
          break;
        }
      }
    }
    let _ = client.stop_stream();
    Ok(())
  }

  pub fn start(pid: u32, rate: u32, level: f32, channel: Channel<InvokeResponseBody>) -> Result<(), String> {
    stop();
    ping();
    let stop_flag = Arc::new(AtomicBool::new(false));
    let flag = stop_flag.clone();
    // Fail fast and visibly if the tap can't be built, instead of
    // muting an app and then discovering there's nothing to play.
    LEVEL.store(level.clamp(0.02, 1.0).to_bits(), Ordering::Relaxed);
    let (ready_tx, ready_rx) = std::sync::mpsc::channel::<Result<(), String>>();
    let thread = std::thread::Builder::new()
      .name("live-audio-capture".into())
      .spawn(move || {
        let _ = initialize_mta();
        let probe = (|| -> Result<(), String> {
          let fmt = WaveFormat::new(32, 32, &SampleType::Float, rate as usize, 2, None);
          let mut c = AudioClient::new_application_loopback_client(pid, true).map_err(|e| format!("Couldn't tap that app's audio: {e}"))?;
          c.initialize_client(&fmt, &Direction::Capture, &StreamMode::EventsShared { autoconvert: true, buffer_duration_hns: 0 }).map_err(|e| format!("Couldn't tap that app's audio: {e}"))?;
          Ok(())
        })();
        let failed = probe.is_err();
        let _ = ready_tx.send(probe);
        if failed {
          return;
        }
        if let Err(e) = run_capture(pid, rate, flag, channel) {
          log::warn!("live audio capture ended: {e}");
        }
        restore_all();
      })
      .map_err(|e| e.to_string())?;
    match ready_rx.recv_timeout(Duration::from_secs(5)) {
      Ok(Ok(())) => {}
      Ok(Err(e)) => return Err(e),
      Err(_) => {
        stop_flag.store(true, Ordering::Relaxed);
        return Err("Timed out starting the audio tap.".into());
      }
    }
    *CAPTURE.lock().unwrap() = Some(Capture { stop: stop_flag, thread: Some(thread) });
    Ok(())
  }

  /// Changes how loud the original plays while live; applied by the capture loop.
  pub fn set_level(level: f32) {
    LEVEL.store(level.clamp(0.02, 1.0).to_bits(), Ordering::Relaxed);
  }

  pub fn stop() {
    let taken = CAPTURE.lock().unwrap().take();
    if let Some(mut c) = taken {
      c.stop.store(true, Ordering::Relaxed);
      if let Some(t) = c.thread.take() {
        let _ = t.join();
      }
    }
    restore_all();
  }

  /// Streams a 2 s window of the process's audio and returns its RMS, with
  /// the source's session muted or not. Used by the tests to prove the tap
  /// keeps hearing an app that has been silenced at the speakers.
  #[cfg(test)]
  pub fn measure_samples(pid: u32, seconds: f32) -> Result<Vec<f32>, String> {
    measure_format(pid, seconds, 32, SampleType::Float, 48000)
  }

  #[cfg(test)]
  pub fn measure_format(pid: u32, seconds: f32, bits: usize, st: SampleType, rate: usize) -> Result<Vec<f32>, String> {
    let _ = initialize_mta();
    let fmt = WaveFormat::new(bits, bits, &st, rate, 2, None);
    let bytes_per = bits / 8;
    let mut client = AudioClient::new_application_loopback_client(pid, true).map_err(|e| e.to_string())?;
    client.initialize_client(&fmt, &Direction::Capture, &StreamMode::EventsShared { autoconvert: true, buffer_duration_hns: 0 }).map_err(|e| e.to_string())?;
    let event = client.set_get_eventhandle().map_err(|e| e.to_string())?;
    let capture = client.get_audiocaptureclient().map_err(|e| e.to_string())?;
    client.start_stream().map_err(|e| e.to_string())?;
    let mut queue: VecDeque<u8> = VecDeque::new();
    let end = std::time::Instant::now() + Duration::from_secs_f32(seconds);
    let mut out: Vec<f32> = Vec::new();
    while std::time::Instant::now() < end {
      if event.wait_for_event(200).is_err() {
        continue;
      }
      while let Ok(Some(n)) = capture.get_next_packet_size() {
        if n == 0 {
          break;
        }
        let _ = capture.read_from_device_to_deque(&mut queue);
      }
      let bytes: Vec<u8> = queue.drain(..).collect();
      for c in bytes.chunks_exact(bytes_per * 2) {
        out.push(match (bits, &st) {
          (32, SampleType::Float) => f32::from_le_bytes([c[0], c[1], c[2], c[3]]),
          (16, _) => i16::from_le_bytes([c[0], c[1]]) as f32 / 32768.0,
          (24, _) => (((c[0] as i32) << 8 | (c[1] as i32) << 16 | (c[2] as i32) << 24) >> 8) as f32 / 8388608.0,
          _ => 0.0,
        });
      }
    }
    let _ = client.stop_stream();
    Ok(out)
  }
}

#[cfg(not(target_os = "windows"))]
mod imp {
  use super::*;
  use tauri::ipc::{Channel, InvokeResponseBody};
  pub fn sources() -> Result<Vec<AudioSource>, String> {
    Err("Windows only".into())
  }
  pub fn start(_: u32, _: u32, _: f32, _: Channel<InvokeResponseBody>) -> Result<(), String> {
    Err("Windows only".into())
  }
  pub fn stop() {}
  pub fn gain_for(_: f32) -> f32 {
    1.0
  }
  pub fn set_session_volume(_: u32, _: f32) -> Result<(), String> {
    Err("Windows only".into())
  }
  pub fn restore_all() {}
  pub fn set_level(_: f32) {}
  pub fn ping() {}
}

/// Called when Udaan exits so a turned-down app is never left quiet.
pub fn restore_all() {
  imp::stop();
}

#[tauri::command]
pub async fn live_audio_sources() -> Result<Vec<AudioSource>, String> {
  tauri::async_runtime::spawn_blocking(imp::sources).await.map_err(|e| e.to_string())?
}

#[tauri::command]
/// `source_level` is how loud the original keeps playing (1 = untouched).
/// The Rust capture loop restores full level itself (in float, with a hard
/// ceiling), so the stream the webview receives is always at unity.
pub async fn live_audio_start(pid: u32, sample_rate: u32, source_level: f32, on_audio: tauri::ipc::Channel<tauri::ipc::InvokeResponseBody>) -> Result<(), String> {
  tauri::async_runtime::spawn_blocking(move || imp::start(pid, sample_rate.clamp(8000, 192000), source_level, on_audio))
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn live_audio_stop() {
  let _ = tauri::async_runtime::spawn_blocking(imp::stop).await;
}

/// Changes how loud the original plays while live.
#[tauri::command]
pub fn live_audio_set_level(level: f32) {
  imp::set_level(level);
}

#[tauri::command]
pub fn live_audio_ping() {
  imp::ping();
}

#[cfg(all(test, target_os = "windows"))]
mod tests {
  use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};

  /// Least-squares fit of a sine at `freq`; returns (signal rms, residual rms).
  fn fit(x: &[f32], freq: f32, rate: f32) -> (f32, f32) {
    let (mut cc, mut ss, mut sc, mut xc, mut xs) = (0f64, 0f64, 0f64, 0f64, 0f64);
    let phase = |i: usize| std::f32::consts::TAU * freq * i as f32 / rate;
    for (i, &v) in x.iter().enumerate() {
      let (s_, c_) = (phase(i).sin() as f64, phase(i).cos() as f64);
      cc += c_ * c_;
      ss += s_ * s_;
      sc += s_ * c_;
      xc += v as f64 * c_;
      xs += v as f64 * s_;
    }
    let det = cc * ss - sc * sc;
    let a = (xc * ss - xs * sc) / det;
    let b = (xs * cc - xc * sc) / det;
    let (mut sig, mut res) = (0f64, 0f64);
    for (i, &v) in x.iter().enumerate() {
      let m = a * phase(i).cos() as f64 + b * phase(i).sin() as f64;
      sig += m * m;
      res += (v as f64 - m).powi(2);
    }
    ((sig / x.len() as f64).sqrt() as f32, (res / x.len() as f64).sqrt() as f32)
  }

  fn with_tone(run: impl FnOnce(u32)) {
    let host = cpal::default_host();
    let dev = host.default_output_device().expect("output device");
    let cfg = dev.default_output_config().unwrap();
    let (rate, ch) = (cfg.sample_rate() as f32, cfg.channels() as usize);
    let mut t = 0f32;
    let stream = dev
      .build_output_stream(
        cfg.config(),
        move |data: &mut [f32], _| {
          for frame in data.chunks_mut(ch) {
            let v = (t * 1000.0 * std::f32::consts::TAU / rate).sin() * 0.2;
            t += 1.0;
            frame.iter_mut().for_each(|s| *s = v);
          }
        },
        |e| eprintln!("{e}"),
        None,
      )
      .unwrap();
    stream.play().unwrap();
    std::thread::sleep(std::time::Duration::from_millis(800));
    run(std::process::id());
    super::imp::restore_all();
  }

  /// At every level the user can choose, the gain restores the original
  /// level, and the restored signal stays clean enough to hear as music.
  #[test]
  fn restored_level_and_cleanliness() {
    with_tone(|pid| {
      let reference = {
        let x = super::imp::measure_samples(pid, 1.5).unwrap();
        fit(&x[4800..], 1000.0, 48000.0).0
      };
      for level in [0.55f32, 0.3] {
        super::imp::set_session_volume(pid, level).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(300));
        let x = super::imp::measure_samples(pid, 1.5).unwrap();
        let gain = super::imp::gain_for(level);
        let (sig, res) = fit(&x[4800..], 1000.0, 48000.0);
        let snr = 20.0 * (sig / res.max(1e-12)).log10();
        println!("level {level}: restored {:.5} (ref {reference:.5})  SNR {snr:.1} dB", sig * gain);
        assert!((sig * gain / reference - 1.0).abs() < 0.05, "gain does not restore the original level");
        assert!(snr > 45.0, "tap too noisy at level {level}: {snr:.1} dB");
      }
    });
  }
}
