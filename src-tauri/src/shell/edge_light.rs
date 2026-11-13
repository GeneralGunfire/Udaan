//! Audio-reactive edge lighting: listens to whatever the speakers are
//! playing (default-output loopback, so it also reacts to the DJ board's
//! processed sound), turns it into 64 log-spaced frequency bands about 60
//! times a second, and hands those to the click-through `edgelight` overlay
//! window, which draws them around the screen border.
//!
//! The analysis lives in Rust so the overlay's webview spends its time
//! drawing, not decoding audio, and so it costs nothing while disabled.

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

pub const BANDS: usize = 64;

#[derive(Serialize, Clone)]
struct Frame {
  /// 0–255 per band, low to high frequency.
  bands: Vec<u8>,
}

/// Maps a linear FFT magnitude to 0..1 on a dB scale (-78 dB → 0, -6 dB → 1),
/// the range music actually occupies.
pub fn db_scale(mag: f32) -> f32 {
  let db = 20.0 * mag.max(1e-9).log10();
  ((db + 78.0) / 72.0).clamp(0.0, 1.0)
}

/// The speaker keep-awake signal (sound_fx.rs) is a 45 Hz tone at most
/// about -48 dBFS. The lowest bands ignore anything that quiet, so that
/// inaudible signal never reads as music; real bass sits far above it.
const BASS_GATE: f32 = 0.43;
const GATED_BANDS: usize = 6;

pub fn gate(level: f32, band: usize) -> f32 {
  if band < GATED_BANDS {
    ((level - BASS_GATE) / (1.0 - BASS_GATE)).max(0.0)
  } else {
    level
  }
}

/// Edges (Hz) of `BANDS` log-spaced bands between 35 Hz and 16 kHz.
pub fn band_edges() -> Vec<f32> {
  let (lo, hi) = (35.0f32, 16_000.0f32);
  (0..=BANDS).map(|i| lo * (hi / lo).powf(i as f32 / BANDS as f32)).collect()
}

#[cfg(target_os = "windows")]
mod imp {
  use super::*;
  use rustfft::{num_complex::Complex, FftPlanner};
  use std::collections::VecDeque;
  use std::sync::atomic::{AtomicBool, Ordering};
  use std::sync::{Arc, Mutex};
  use std::thread::JoinHandle;
  use wasapi::{get_default_device, initialize_mta, Direction, SampleType, StreamMode, WaveFormat};

  const FFT_N: usize = 2048;
  const HOP: usize = 800; // ≈16.7 ms at 48 kHz → 60 frames/s
  const RATE: usize = 48_000;

  struct Runner {
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
  }
  static RUNNER: Mutex<Option<Runner>> = Mutex::new(None);

  fn run(app: AppHandle, stop: Arc<AtomicBool>) -> Result<(), String> {
    let _ = initialize_mta();
    let device = get_default_device(&Direction::Render).map_err(|e| e.to_string())?;
    let mut client = device.get_iaudioclient().map_err(|e| e.to_string())?;
    let fmt = WaveFormat::new(32, 32, &SampleType::Float, RATE, 2, None);
    // Capture direction on a render device = loopback.
    client
      .initialize_client(&fmt, &Direction::Capture, &StreamMode::EventsShared { autoconvert: true, buffer_duration_hns: 0 })
      .map_err(|e| e.to_string())?;
    let event = client.set_get_eventhandle().map_err(|e| e.to_string())?;
    let capture = client.get_audiocaptureclient().map_err(|e| e.to_string())?;
    client.start_stream().map_err(|e| e.to_string())?;

    let fft = FftPlanner::<f32>::new().plan_fft_forward(FFT_N);
    let window: Vec<f32> = (0..FFT_N).map(|i| 0.5 - 0.5 * (std::f32::consts::TAU * i as f32 / (FFT_N - 1) as f32).cos()).collect();
    let edges = band_edges();
    let bin_hz = RATE as f32 / FFT_N as f32;
    // Window gain 0.5 and one-sided spectrum: scale so a full-scale sine ≈ 1.0.
    let norm = 4.0 / FFT_N as f32;

    let mut raw: VecDeque<u8> = VecDeque::new();
    let mut mono: VecDeque<f32> = VecDeque::with_capacity(FFT_N + 1);
    let mut since_hop = 0usize;
    let mut buf = vec![Complex { re: 0.0f32, im: 0.0 }; FFT_N];
    let mut silent_sent = false;

    while !stop.load(Ordering::Relaxed) {
      let got = event.wait_for_event(60).is_ok();
      if got {
        loop {
          match capture.get_next_packet_size() {
            Ok(Some(n)) if n > 0 => {
              if capture.read_from_device_to_deque(&mut raw).is_err() {
                break;
              }
            }
            _ => break,
          }
        }
        while raw.len() >= 8 {
          let mut f = [0f32; 2];
          for ch in &mut f {
            let b = [raw.pop_front().unwrap(), raw.pop_front().unwrap(), raw.pop_front().unwrap(), raw.pop_front().unwrap()];
            *ch = f32::from_le_bytes(b);
          }
          mono.push_back((f[0] + f[1]) * 0.5);
          since_hop += 1;
          if mono.len() > FFT_N {
            mono.pop_front();
          }
          if since_hop >= HOP && mono.len() == FFT_N {
            since_hop = 0;
            for (i, s) in mono.iter().enumerate() {
              buf[i] = Complex { re: s * window[i], im: 0.0 };
            }
            fft.process(&mut buf);
            let mut bands = vec![0u8; BANDS];
            for (b, out) in bands.iter_mut().enumerate() {
              let lo = ((edges[b] / bin_hz).floor() as usize).max(1);
              let hi = ((edges[b + 1] / bin_hz).ceil() as usize).clamp(lo + 1, FFT_N / 2);
              // Peak of the bins in the band: stays lively where bands are
              // narrow (bass) and doesn't wash out where they're wide (treble).
              let peak = buf[lo..hi].iter().map(|c| c.norm()).fold(0.0f32, f32::max) * norm;
              *out = (super::gate(super::db_scale(peak), b) * 255.0) as u8;
            }
            silent_sent = bands.iter().all(|&v| v == 0);
            let _ = app.emit_to("edgelight", "edge-light:frame", Frame { bands });
          }
        }
      } else if !silent_sent {
        // Nothing is playing: tell the overlay once so it can fade out.
        let _ = app.emit_to("edgelight", "edge-light:frame", Frame { bands: vec![0; BANDS] });
        silent_sent = true;
        mono.clear();
      }
    }
    let _ = client.stop_stream();
    Ok(())
  }

  pub fn start(app: AppHandle) {
    let mut g = RUNNER.lock().unwrap();
    if g.is_some() {
      return;
    }
    let stop = Arc::new(AtomicBool::new(false));
    let flag = stop.clone();
    let thread = std::thread::Builder::new()
      .name("edge-light-analysis".into())
      .spawn(move || {
        if let Err(e) = run(app, flag) {
          log::warn!("edge light analysis ended: {e}");
        }
      })
      .ok();
    *g = Some(Runner { stop, thread });
  }

  pub fn stop() {
    let r = RUNNER.lock().unwrap().take();
    if let Some(mut r) = r {
      r.stop.store(true, Ordering::Relaxed);
      if let Some(t) = r.thread.take() {
        let _ = t.join();
      }
    }
  }
}

#[cfg(not(target_os = "windows"))]
mod imp {
  use super::*;
  pub fn start(_: AppHandle) {}
  pub fn stop() {}
}

/// Turns the overlay and its audio analysis on or off. Placing the window
/// here (rather than from JS) keeps it exactly over the primary monitor
/// and click-through before it is ever shown.
#[tauri::command]
pub fn edge_light_set_enabled(app: AppHandle, enabled: bool) -> Result<(), String> {
  let win = app.get_webview_window("edgelight").ok_or("edge light window missing")?;
  if enabled {
    if let Ok(Some(m)) = win.primary_monitor() {
      let _ = win.set_position(*m.position());
      let _ = win.set_size(*m.size());
    }
    let _ = win.set_ignore_cursor_events(true);
    let _ = win.set_always_on_top(true);
    win.show().map_err(|e| e.to_string())?;
    imp::start(app);
  } else {
    imp::stop();
    let _ = win.hide();
  }
  Ok(())
}

pub fn shutdown() {
  imp::stop();
}

#[cfg(test)]
mod tests {
  #[test]
  fn bands_cover_the_range_in_order() {
    let e = super::band_edges();
    assert_eq!(e.len(), super::BANDS + 1);
    assert!(e.windows(2).all(|w| w[1] > w[0]));
    assert!((e[0] - 35.0).abs() < 0.01 && (e[super::BANDS] - 16_000.0).abs() < 1.0);
  }

  #[test]
  fn keep_awake_signal_never_lights_the_bass() {
    // Strongest keep-awake setting: 0.004 amplitude (about -48 dBFS).
    let tone = super::db_scale(0.004);
    for band in 0..super::GATED_BANDS {
      assert_eq!(super::gate(tone, band), 0.0, "band {band} lit by the keep-awake tone");
    }
    // Real bass is untouched in the upper range and higher bands are never gated.
    assert!(super::gate(1.0, 0) > 0.99);
    assert_eq!(super::gate(0.2, 20), 0.2);
  }

  #[test]
  fn db_scale_is_clamped_and_monotonic() {
    assert_eq!(super::db_scale(0.0), 0.0);
    assert_eq!(super::db_scale(10.0), 1.0);
    assert!(super::db_scale(0.01) < super::db_scale(0.1));
  }
}
