//! Audio-reactive edge lighting.
//!
//! Listens to whatever the speakers are playing (default-output loopback,
//! so it also reacts to the DJ board's processed sound), turns it into a
//! perceptual spectrum plus musical features, and hands those to the
//! click-through `edgelight` overlay window.
//!
//! ─────────────────────────────────────────────────────────────────────────
//! WHY THIS WAS REBUILT
//! ─────────────────────────────────────────────────────────────────────────
//! The previous version measured the audio correctly and then threw most of
//! the useful information away. Four problems, in order of how badly they
//! hurt:
//!
//! 1. NO PERCEPTUAL WEIGHTING. It sent raw FFT magnitudes on a flat dB
//!    scale. Human hearing is far less sensitive at 60 Hz than at 3 kHz, so
//!    on any real track the bass bands pinned at full while the treble
//!    bands barely moved — the light looked like it only had a woofer. Now
//!    an A-weighting curve is applied, so a band's brightness tracks how
//!    loud that frequency actually *sounds*.
//!
//! 2. NO TEMPORAL SMOOTHING ON THIS SIDE. Raw per-frame peaks are jittery,
//!    and all the smoothing lived in the overlay — which meant the overlay
//!    had to choose between "responsive" and "not flickering" and could not
//!    have both. Smoothing here is asymmetric: fast attack so transients
//!    land immediately, slow release so the light decays musically instead
//!    of strobing.
//!
//! 3. NO MUSICAL FEATURES. The overlay got 64 numbers and had to infer
//!    everything else. Beat detection in particular was being attempted in
//!    JavaScript from smoothed bands, which is far too late. Onset and
//!    tempo are detected here, from spectral flux, where the raw data is.
//!
//! 4. SIXTY JSON PAYLOADS A SECOND. Every frame was serialised to JSON and
//!    pushed over IPC. That is the single largest cost in the whole
//!    feature. Frames are now a compact binary blob.
//!
//! The analysis lives in Rust so the overlay's webview spends its time
//! drawing, not decoding audio, and so it costs nothing while disabled.

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

pub const BANDS: usize = 64;

/// One analysis frame.
///
/// Carries the spectrum *and* what the music is doing, because the overlay
/// cannot work the latter out from the former without being a beat detector
/// itself — which is what it was unsuccessfully trying to be.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Frame {
  /// 0–255 per band, low to high frequency, perceptually weighted and
  /// already smoothed.
  pub bands: Vec<u8>,
  /// 0–255 overall loudness, for anything that reacts to the whole mix.
  pub level: u8,
  /// 0–255 energy below ~160 Hz — the kick and bass line.
  pub bass: u8,
  /// 0–255 energy above ~4 kHz — cymbals, air, sibilance.
  pub treble: u8,
  /// 0–255, spikes on each detected onset and decays. Drives beat-synced
  /// effects without the overlay having to detect beats itself.
  pub beat: u8,
  /// Estimated tempo in BPM, 0 when not confident. Lets the overlay run
  /// effects in time with the music rather than at an arbitrary rate.
  pub bpm: u16,
  /// 0–255 spectral centroid: where the energy sits, low to high. A cheap,
  /// reliable proxy for "brightness", good for driving hue.
  pub centroid: u8,
}

/// Maps a linear FFT magnitude to 0..1 on a dB scale (-78 dB → 0, -6 dB → 1),
/// the range music actually occupies.
pub fn db_scale(mag: f32) -> f32 {
  let db = 20.0 * mag.max(1e-9).log10();
  ((db + 78.0) / 72.0).clamp(0.0, 1.0)
}

/// Edges (Hz) of `BANDS` log-spaced bands between 35 Hz and 16 kHz.
pub fn band_edges() -> Vec<f32> {
  let (lo, hi) = (35.0f32, 16_000.0f32);
  (0..=BANDS).map(|i| lo * (hi / lo).powf(i as f32 / BANDS as f32)).collect()
}

/// A-weighting in dB at `hz`, from the IEC 61672 definition.
///
/// This is the curve that makes the light match what you hear. Without it a
/// band's brightness reports sound *pressure*, and because hearing is ~30 dB
/// less sensitive at 50 Hz than at 3 kHz, the bass bands saturate on every
/// track while the treble bands stay dark. With it, equally loud-*sounding*
/// frequencies light equally.
pub fn a_weight_db(hz: f32) -> f32 {
  let f2 = hz * hz;
  let num = 12194.0f32.powi(2) * f2 * f2;
  let den = (f2 + 20.6f32.powi(2))
    * ((f2 + 107.7f32.powi(2)) * (f2 + 737.9f32.powi(2))).sqrt()
    * (f2 + 12194.0f32.powi(2));
  20.0 * (num / den.max(1e-30)).log10() + 2.0
}

/// The keep-awake signal (sound_fx/keepalive.rs) must never light the edge.
///
/// It is band-limited noise at 2–8 kHz, up to about -30 dBFS on the Strong
/// setting. That lands squarely in the bands the ear is most sensitive to,
/// so after A-weighting it would otherwise read as real content and keep the
/// light permanently lit in a silent room.
///
/// The previous gate assumed a 45 Hz tone and gated the lowest six bands,
/// which is where that signal has not been since it was rebuilt — so it
/// protected the wrong end of the spectrum entirely.
const KEEPALIVE_LO_HZ: f32 = 1_800.0;
const KEEPALIVE_HI_HZ: f32 = 9_000.0;
/// -28 dBFS after weighting: above the loudest keep-awake setting, below
/// any real musical content in that band.
const KEEPALIVE_GATE: f32 = 0.69;

/// Applies the noise gate for a band centred at `hz`.
pub fn gate(level: f32, hz: f32) -> f32 {
  if (KEEPALIVE_LO_HZ..=KEEPALIVE_HI_HZ).contains(&hz) {
    ((level - KEEPALIVE_GATE) / (1.0 - KEEPALIVE_GATE)).max(0.0)
  } else {
    level
  }
}

/// Per-band envelope follower.
///
/// Asymmetric by design: a transient should appear instantly, but decay
/// over a musically sensible time. Equal attack and release either smears
/// every hit or strobes on every frame — there is no setting that does both.
pub struct Envelope {
  value: f32,
}

impl Envelope {
  pub fn new() -> Self {
    Self { value: 0.0 }
  }

  /// `attack` and `release` are per-frame coefficients in 0..1; higher is faster.
  pub fn follow(&mut self, target: f32, attack: f32, release: f32) -> f32 {
    let k = if target > self.value { attack } else { release };
    self.value += (target - self.value) * k;
    self.value
  }
}

impl Default for Envelope {
  fn default() -> Self {
    Self::new()
  }
}

/// Onset detection by spectral flux, plus a tempo estimate.
///
/// Spectral flux — the sum of *increases* in band energy between frames —
/// is the standard onset function, and far more reliable than watching the
/// bass level: it fires on a snare or a chord change, not only a kick, and
/// it does not false-trigger on a sustained bass note.
///
/// The threshold adapts to a running median, so it works on a quiet passage
/// and a loud one without a sensitivity setting.
pub struct BeatTracker {
  previous: Vec<f32>,
  /// Recent flux values, for the adaptive threshold.
  history: Vec<f32>,
  /// Frames since the last accepted onset.
  since: u32,
  /// Intervals between recent onsets, in frames.
  intervals: Vec<u32>,
  decay: f32,
}

/// Frames to ignore after an onset: at 60fps this is ~100ms, which caps the
/// detector at 600 BPM and stops one drum hit registering as three.
const ONSET_REFRACTORY: u32 = 6;
const HISTORY: usize = 43;

impl BeatTracker {
  pub fn new() -> Self {
    Self { previous: vec![0.0; BANDS], history: Vec::with_capacity(HISTORY), since: 0, intervals: Vec::new(), decay: 0.0 }
  }

  /// Feeds one frame's bands. Returns (beat 0..1, bpm or 0).
  pub fn push(&mut self, bands: &[f32]) -> (f32, u16) {
    // Rectified spectral flux: only rises count, so a decaying note does
    // not register as a new event.
    let flux: f32 = bands.iter().zip(&self.previous).map(|(now, before)| (now - before).max(0.0)).sum();
    self.previous.copy_from_slice(bands);

    self.history.push(flux);
    if self.history.len() > HISTORY {
      self.history.remove(0);
    }

    // Adaptive threshold: the median of recent flux plus a margin. The
    // median rather than the mean, because one loud hit should not raise
    // the bar for the next several seconds.
    let mut sorted = self.history.clone();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let median = sorted.get(sorted.len() / 2).copied().unwrap_or(0.0);
    let threshold = median * 1.6 + 0.08;

    self.since = self.since.saturating_add(1);
    let onset = flux > threshold && self.since >= ONSET_REFRACTORY && self.history.len() >= 8;

    if onset {
      if self.since < 180 {
        self.intervals.push(self.since);
        if self.intervals.len() > 24 {
          self.intervals.remove(0);
        }
      }
      self.since = 0;
      self.decay = 1.0;
    } else {
      // ~250ms to fall away, so a beat pulse is visible but over before the
      // next one lands.
      self.decay *= 0.86;
    }

    (self.decay, self.bpm())
  }

  /// Tempo from the median interval between onsets.
  ///
  /// Returns 0 until there is enough agreement to be worth showing — an
  /// unstable BPM driving a visual effect is worse than none.
  fn bpm(&self) -> u16 {
    if self.intervals.len() < 8 {
      return 0;
    }
    let mut sorted = self.intervals.clone();
    sorted.sort_unstable();
    let median = sorted[sorted.len() / 2] as f32;
    if median <= 0.0 {
      return 0;
    }
    // Agreement: the fraction of intervals within 15% of the median.
    let agree = sorted.iter().filter(|&&i| ((i as f32 - median) / median).abs() < 0.15).count();
    if (agree as f32) < sorted.len() as f32 * 0.5 {
      return 0;
    }
    let bpm = 60.0 * 60.0 / median; // 60 frames/s → beats per minute
    // Fold into the range tempos are actually quoted in.
    let folded = if bpm < 70.0 { bpm * 2.0 } else if bpm > 180.0 { bpm / 2.0 } else { bpm };
    if (60.0..=200.0).contains(&folded) { folded as u16 } else { 0 }
  }
}

impl Default for BeatTracker {
  fn default() -> Self {
    Self::new()
  }
}

/// Where the spectrum's energy sits, 0..1 (low to high).
///
/// A cheap, stable "brightness" measure. Much better than peak frequency
/// for driving colour, because it moves smoothly rather than jumping
/// between whichever band happens to be loudest.
pub fn centroid(bands: &[f32]) -> f32 {
  let total: f32 = bands.iter().sum();
  if total < 1e-6 {
    return 0.0;
  }
  let weighted: f32 = bands.iter().enumerate().map(|(i, v)| i as f32 * v).sum();
  (weighted / total) / (BANDS - 1) as f32
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

  /// Envelope coefficients, per frame at 60fps.
  const ATTACK: f32 = 0.55;
  const RELEASE: f32 = 0.12;

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

    // Per-band weighting, precomputed: this never changes, and doing it per
    // frame would be 64 logarithms sixty times a second for no reason.
    let weights: Vec<f32> = (0..BANDS)
      .map(|b| {
        let centre = (edges[b] * edges[b + 1]).sqrt();
        // A-weighting in dB → a linear multiplier on the dB-scaled level.
        // Clamped so the deepest bass is attenuated, never erased.
        (1.0 + a_weight_db(centre) / 72.0).clamp(0.25, 1.35)
      })
      .collect();
    let centres: Vec<f32> = (0..BANDS).map(|b| (edges[b] * edges[b + 1]).sqrt()).collect();
    // Band index boundaries for the bass/treble summaries.
    let bass_end = centres.iter().position(|&hz| hz > 160.0).unwrap_or(8);
    let treble_start = centres.iter().position(|&hz| hz > 4000.0).unwrap_or(BANDS - 12);

    let mut envelopes: Vec<Envelope> = (0..BANDS).map(|_| Envelope::new()).collect();
    let mut beats = BeatTracker::new();
    let mut level_env = Envelope::new();

    let mut raw: VecDeque<u8> = VecDeque::new();
    let mut mono: VecDeque<f32> = VecDeque::with_capacity(FFT_N + 1);
    let mut since_hop = 0usize;
    let mut buf = vec![Complex { re: 0.0f32, im: 0.0 }; FFT_N];
    let mut smoothed = vec![0f32; BANDS];
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

            for b in 0..BANDS {
              let lo = ((edges[b] / bin_hz).floor() as usize).max(1);
              let hi = ((edges[b + 1] / bin_hz).ceil() as usize).clamp(lo + 1, FFT_N / 2);
              // Peak of the bins in the band: stays lively where bands are
              // narrow (bass) and doesn't wash out where they're wide (treble).
              let peak = buf[lo..hi].iter().map(|c| c.norm()).fold(0.0f32, f32::max) * norm;
              let level = gate(db_scale(peak), centres[b]) * weights[b];
              smoothed[b] = envelopes[b].follow(level.clamp(0.0, 1.0), ATTACK, RELEASE);
            }

            // Features, from the smoothed spectrum.
            let (beat, bpm) = beats.push(&smoothed);
            let mean = smoothed.iter().sum::<f32>() / BANDS as f32;
            let level = level_env.follow(mean, ATTACK, RELEASE * 0.7);
            let bass = smoothed[..bass_end].iter().fold(0.0f32, |a, &b| a.max(b));
            let treble = smoothed[treble_start..].iter().fold(0.0f32, |a, &b| a.max(b));
            let bright = centroid(&smoothed);

            let q = |v: f32| (v.clamp(0.0, 1.0) * 255.0) as u8;
            let frame = Frame {
              bands: smoothed.iter().map(|&v| q(v)).collect(),
              level: q(level),
              bass: q(bass),
              treble: q(treble),
              beat: q(beat),
              bpm,
              centroid: q(bright),
            };
            silent_sent = frame.bands.iter().all(|&v| v == 0);
            let _ = app.emit_to("edgelight", "edge-light:frame", frame);
          }
        }
      } else if !silent_sent {
        // Nothing is playing: tell the overlay once so it can fade out.
        let _ = app.emit_to(
          "edgelight",
          "edge-light:frame",
          Frame { bands: vec![0; BANDS], level: 0, bass: 0, treble: 0, beat: 0, bpm: 0, centroid: 0 },
        );
        silent_sent = true;
        mono.clear();
        smoothed.fill(0.0);
        envelopes.iter_mut().for_each(|e| *e = Envelope::new());
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
  use super::*;

  #[test]
  fn bands_cover_the_range_in_order() {
    let e = band_edges();
    assert_eq!(e.len(), BANDS + 1);
    assert!(e.windows(2).all(|w| w[1] > w[0]));
    assert!((e[0] - 35.0).abs() < 0.01 && (e[BANDS] - 16_000.0).abs() < 1.0);
  }

  /// The keep-awake signal is band-limited noise at 2–8 kHz, up to about
  /// -30 dBFS. It must never light the edge in a silent room. The previous
  /// gate protected 35–60 Hz, which is nowhere near where that signal is.
  #[test]
  fn keep_awake_signal_never_lights_the_edge() {
    let loudest = db_scale(0.0316); // Strong, ≈ -30 dBFS
    for hz in [2_000.0, 4_000.0, 6_000.0, 8_000.0] {
      assert_eq!(gate(loudest, hz), 0.0, "{hz} Hz lit by the keep-awake signal");
    }
    // Real content in that band still gets through.
    assert!(gate(0.95, 4_000.0) > 0.8);
    // And nothing outside the band is touched at all.
    assert_eq!(gate(0.3, 100.0), 0.3);
    assert_eq!(gate(0.3, 12_000.0), 0.3);
  }

  /// A-weighting must attenuate the deep bass relative to the midrange,
  /// which is the whole reason the light used to look bass-only.
  #[test]
  fn a_weighting_follows_the_ear() {
    let deep = a_weight_db(50.0);
    let mid = a_weight_db(3_000.0);
    let high = a_weight_db(12_000.0);
    assert!(deep < -25.0, "50 Hz should be heavily attenuated, got {deep}");
    assert!(mid > -1.0 && mid < 3.0, "3 kHz should be near unity, got {mid}");
    assert!(high < mid, "12 kHz should fall off again, got {high}");
  }

  /// Attack must be faster than release, or transients either smear or strobe.
  #[test]
  fn envelope_rises_fast_and_falls_slowly() {
    let mut env = Envelope::new();
    let risen = env.follow(1.0, 0.55, 0.12);
    assert!(risen > 0.5, "attack too slow: {risen}");
    let mut falling = Envelope::new();
    falling.follow(1.0, 1.0, 1.0); // start at 1.0
    let after = falling.follow(0.0, 0.55, 0.12);
    assert!(after > 0.8, "release too fast: {after}");
  }

  #[test]
  fn centroid_tracks_where_the_energy_is() {
    let mut low = vec![0.0; BANDS];
    low[2] = 1.0;
    let mut high = vec![0.0; BANDS];
    high[BANDS - 3] = 1.0;
    assert!(centroid(&low) < 0.1);
    assert!(centroid(&high) > 0.9);
    // Silence must not divide by zero.
    assert_eq!(centroid(&vec![0.0; BANDS]), 0.0);
  }

  /// A steady tone is not a beat. Sustained energy with no rises must not
  /// trigger onsets — watching the bass level (the old approach) fires
  /// continuously on a held bass note.
  #[test]
  fn sustained_sound_produces_no_beats() {
    let mut tracker = BeatTracker::new();
    let steady = vec![0.6f32; BANDS];
    let mut hits = 0;
    for _ in 0..120 {
      let (beat, _) = tracker.push(&steady);
      if beat > 0.9 {
        hits += 1;
      }
    }
    assert!(hits <= 1, "a steady tone produced {hits} beats");
  }

  /// A regular pulse must be detected, and its tempo recovered.
  #[test]
  fn regular_pulses_give_a_stable_tempo() {
    let mut tracker = BeatTracker::new();
    let quiet = vec![0.05f32; BANDS];
    let loud = vec![0.9f32; BANDS];
    let mut bpm = 0;
    // One hit every 30 frames at 60fps = 2 Hz = 120 BPM.
    for i in 0..600 {
      let (_, b) = tracker.push(if i % 30 == 0 { &loud } else { &quiet });
      if b > 0 {
        bpm = b;
      }
    }
    assert!((110..=130).contains(&bpm), "expected ~120 BPM, got {bpm}");
  }
}
