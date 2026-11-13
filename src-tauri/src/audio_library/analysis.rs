//! Offline musical analysis: tempo (BPM), key (Camelot notation), and a
//! beatgrid, computed once per track when it enters the library.
//!
//! Runs in Rust rather than the frontend for three reasons: decoding a
//! whole file to PCM and running an FFT over it would block the UI thread
//! or need a worker plus a caching layer; `symphonia` is already a
//! dependency here for every format the library accepts; and the results
//! belong in the same SQLite store as favourites and presets so they
//! survive a restart rather than being recomputed on every launch.
//!
//! The algorithms are deliberately classical rather than ML-based — no
//! model to ship, no weights to download, and entirely adequate for the
//! four-on-the-floor and backbeat-driven material a DJ board is used on.
//! Both are approximations and are treated as such by the UI, which shows
//! a confidence value alongside the result.

use std::path::Path;

use serde::{Deserialize, Serialize};
use symphonia::core::codecs::audio::AudioDecoderOptions;
use symphonia::core::formats::probe::Hint;
use symphonia::core::formats::{FormatOptions, TrackType};
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;

/// Analysis is run on a mono, heavily downsampled signal. Tempo lives in
/// the envelope of the signal, not its waveform, so 11.025kHz preserves
/// everything the onset detector can use while cutting the work by four
/// against CD rate.
const TARGET_SAMPLE_RATE: u32 = 11_025;

/// Tempo search range. Below 60 and above 190 the detector starts
/// reporting half- and double-time of the real tempo as if it were the
/// answer, and for DJ material the true tempo is essentially always
/// inside this window.
const MIN_BPM: f32 = 70.0;
const MAX_BPM: f32 = 180.0;

/// Cap on how much audio is analysed. A track's tempo and key do not
/// change often enough to justify decoding twelve minutes of it, and this
/// bounds worst-case time on a large library import.
const MAX_ANALYSIS_SECONDS: usize = 150;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrackAnalysis {
  /// Detected tempo. `None` when the signal had too little rhythmic
  /// content to pick a peak (ambient, spoken word, silence).
  pub bpm: Option<f32>,
  /// 0.0-1.0. How far the winning tempo stood above the runners-up —
  /// low values mean the detector essentially guessed, and the UI shows
  /// the number differently rather than pretending it is solid.
  #[serde(rename = "bpmConfidence")]
  pub bpm_confidence: f32,
  /// Camelot wheel notation, e.g. "8A" / "5B" — the notation DJs
  /// actually mix by, rather than "A minor".
  #[serde(rename = "camelotKey")]
  pub camelot_key: Option<String>,
  /// Musical spelling of the same key, for display alongside it.
  #[serde(rename = "musicalKey")]
  pub musical_key: Option<String>,
  #[serde(rename = "keyConfidence")]
  pub key_confidence: f32,
  /// Seconds from file start to the first detected beat. Combined with
  /// bpm this defines the whole grid, so storing every beat position
  /// would be redundant.
  #[serde(rename = "firstBeatSeconds")]
  pub first_beat_seconds: Option<f32>,
  /// Peak sample magnitude, 0.0-1.0 — lets the deck apply sane starting
  /// trim so two tracks mastered decades apart do not need manual
  /// gain-matching before every mix.
  pub peak: f32,
  /// Mean square root magnitude, a rough loudness proxy for the same use.
  pub rms: f32,
}

/// Decodes a file to a mono f32 signal at `TARGET_SAMPLE_RATE`.
///
/// Downmixing and decimating here rather than in the analysis functions
/// means the expensive part (decode) happens exactly once, and both the
/// tempo and key passes read the same buffer.
fn decode_mono(path: &Path) -> Result<(Vec<f32>, u32), String> {
  let file = std::fs::File::open(path).map_err(|e| format!("Failed to open {}: {e}", path.display()))?;
  let stream = MediaSourceStream::new(Box::new(file), Default::default());

  let mut hint = Hint::new();
  if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
    hint.with_extension(ext);
  }

  // symphonia 0.6's `probe` both sniffs the container and returns a ready
  // FormatReader, so there is no separate "probed.format" step.
  let mut format = symphonia::default::get_probe()
    .probe(&hint, stream, FormatOptions::default(), MetadataOptions::default())
    .map_err(|e| format!("Unsupported or corrupt audio: {e}"))?;

  let track = format
    .default_track(TrackType::Audio)
    .or_else(|| {
      format
        .tracks()
        .iter()
        .find(|t| t.codec_params.as_ref().map(|p| p.is_audio()).unwrap_or(false))
    })
    .ok_or_else(|| "No decodable audio track".to_string())?;

  let track_id = track.id;
  let params = track
    .codec_params
    .as_ref()
    .and_then(|p| p.audio())
    .cloned()
    .ok_or_else(|| "No readable audio settings".to_string())?;

  let source_rate = params
    .sample_rate
    .ok_or_else(|| "File does not declare a sample rate".to_string())?;

  let mut decoder = symphonia::default::get_codecs()
    .make_audio_decoder(&params, &AudioDecoderOptions::default())
    .map_err(|e| format!("No decoder for this format: {e}"))?;

  // Integer decimation: taking every Nth sample is crude but correct
  // enough here because the onset envelope is extracted from magnitudes,
  // not from the waveform, so the aliasing a proper anti-alias filter
  // would prevent does not affect what is measured.
  let decimation = (source_rate / TARGET_SAMPLE_RATE).max(1) as usize;
  let effective_rate = source_rate / decimation as u32;
  let max_samples = MAX_ANALYSIS_SECONDS * effective_rate as usize;

  let mut mono: Vec<f32> = Vec::new();
  let mut planes: Vec<Vec<f32>> = Vec::new();
  let mut counter = 0usize;

  'outer: loop {
    let packet = match format.next_packet() {
      // 0.6 signals clean end-of-stream with Ok(None) rather than an EOF error.
      Ok(None) => break,
      Ok(Some(p)) => p,
      Err(symphonia::core::errors::Error::IoError(ref e))
        if e.kind() == std::io::ErrorKind::UnexpectedEof =>
      {
        break
      }
      Err(symphonia::core::errors::Error::ResetRequired) => break,
      // Analyse whatever decoded successfully rather than failing the
      // whole track over one unreadable packet near the end.
      Err(_) => break,
    };

    if packet.track_id != track_id {
      continue;
    }

    let decoded = match decoder.decode(&packet) {
      Ok(d) => d,
      // A single corrupt packet mid-file should not abort analysis of an
      // otherwise fine track.
      Err(symphonia::core::errors::Error::DecodeError(_)) => continue,
      Err(_) => break,
    };

    decoded.copy_to_vecs_planar::<f32>(&mut planes);
    if planes.is_empty() {
      continue;
    }
    let channel_count = planes.len();
    let frames = planes[0].len();
    for frame in 0..frames {
      if counter % decimation == 0 {
        let sum: f32 = planes.iter().map(|ch| ch[frame]).sum();
        mono.push(sum / channel_count as f32);
        if mono.len() >= max_samples {
          counter += 1;
          break 'outer;
        }
      }
      counter += 1;
    }
  }

  if mono.is_empty() {
    return Err("Decoded no audio samples".to_string());
  }
  Ok((mono, effective_rate))
}

/// Builds an onset-strength envelope: how much the signal's energy is
/// *rising* over time, which is what a beat is, as opposed to how loud it
/// is, which a sustained pad also is.
fn onset_envelope(samples: &[f32], rate: u32) -> (Vec<f32>, f32) {
  // ~11ms hops give roughly 90 envelope samples per second — fine enough
  // to place a beat within a few milliseconds, coarse enough that the
  // autocorrelation below stays cheap.
  let hop = (rate as usize / 90).max(1);
  let window = hop * 2;
  let mut energies = Vec::with_capacity(samples.len() / hop + 1);
  let mut i = 0;
  while i + window <= samples.len() {
    let e: f32 = samples[i..i + window].iter().map(|s| s * s).sum::<f32>() / window as f32;
    // Log compression: without it, one loud drop dominates the whole
    // envelope and quiet intro beats vanish below the detector's floor.
    energies.push((1.0 + 1000.0 * e).ln());
    i += hop;
  }

  // Half-wave rectified first difference — keep energy increases, discard
  // decreases. A beat is an attack; the decay after it is not a second beat.
  let mut env = Vec::with_capacity(energies.len());
  env.push(0.0);
  for w in energies.windows(2) {
    env.push((w[1] - w[0]).max(0.0));
  }

  let envelope_rate = rate as f32 / hop as f32;
  (env, envelope_rate)
}

/// Finds the tempo by autocorrelating the onset envelope: a periodic
/// pattern of attacks correlates most strongly with itself when shifted
/// by exactly one beat period.
fn detect_tempo(env: &[f32], envelope_rate: f32) -> (Option<f32>, f32, Option<f32>) {
  if env.len() < 64 {
    return (None, 0.0, None);
  }

  let min_lag = (envelope_rate * 60.0 / MAX_BPM).round() as usize;
  let max_lag = (envelope_rate * 60.0 / MIN_BPM).round() as usize;
  if max_lag >= env.len() || min_lag == 0 || min_lag >= max_lag {
    return (None, 0.0, None);
  }

  let mean = env.iter().sum::<f32>() / env.len() as f32;
  let centered: Vec<f32> = env.iter().map(|v| v - mean).collect();

  let mut best_lag = 0usize;
  let mut best_score = f32::MIN;
  let mut scores = Vec::with_capacity(max_lag - min_lag + 1);

  for lag in min_lag..=max_lag {
    let mut sum = 0.0f32;
    for i in 0..(centered.len() - lag) {
      sum += centered[i] * centered[i + lag];
    }
    let score = sum / (centered.len() - lag) as f32;
    scores.push(score);
    if score > best_score {
      best_score = score;
      best_lag = lag;
    }
  }

  if best_lag == 0 || best_score <= 0.0 {
    return (None, 0.0, None);
  }

  // Confidence: how far the winning peak stands above the typical score.
  // A flat autocorrelation means no real periodicity was found and the
  // argmax is just noise, which must not be reported as a tempo.
  let mean_score = scores.iter().sum::<f32>() / scores.len() as f32;
  let variance = scores.iter().map(|s| (s - mean_score).powi(2)).sum::<f32>() / scores.len() as f32;
  let std_dev = variance.sqrt();
  let confidence = if std_dev > 0.0 {
    (((best_score - mean_score) / std_dev) / 6.0).clamp(0.0, 1.0)
  } else {
    0.0
  };

  let bpm = 60.0 * envelope_rate / best_lag as f32;

  // Phase: which offset within one beat period accumulates the most
  // onset strength. That offset is the first beat, and with the tempo it
  // defines the whole grid.
  let mut best_phase = 0usize;
  let mut best_phase_energy = f32::MIN;
  for phase in 0..best_lag {
    let mut sum = 0.0f32;
    let mut k = phase;
    while k < env.len() {
      sum += env[k];
      k += best_lag;
    }
    if sum > best_phase_energy {
      best_phase_energy = sum;
      best_phase = phase;
    }
  }
  let first_beat = best_phase as f32 / envelope_rate;

  (Some(bpm), confidence, Some(first_beat))
}

/// Krumhansl-Schmuckler key profiles — empirically derived ratings of how
/// characteristic each of the twelve pitch classes is for a major and a
/// minor key. Correlating a track's measured pitch-class distribution
/// against all 24 rotations of these gives the key.
const MAJOR_PROFILE: [f32; 12] = [
  6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88,
];
const MINOR_PROFILE: [f32; 12] = [
  6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17,
];

const NOTE_NAMES: [&str; 12] = [
  "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B",
];

/// Camelot wheel positions. Index is the pitch class; the pair is
/// (minor number, major number) — minor keys take the "A" ring and major
/// keys the "B" ring, which is the convention every DJ tool uses.
const CAMELOT: [(u8, u8); 12] = [
  (5, 8),   // C
  (12, 3),  // C#
  (7, 10),  // D
  (2, 5),   // D#
  (9, 12),  // E
  (4, 7),   // F
  (11, 2),  // F#
  (6, 9),   // G
  (1, 4),   // G#
  (8, 11),  // A
  (3, 6),   // A#
  (10, 1),  // B
];

/// Estimates key by building a chromagram — total energy per pitch class
/// across the track — then correlating it against all 24 key profiles.
fn detect_key(samples: &[f32], rate: u32) -> (Option<String>, Option<String>, f32) {
  // 4096 samples at 11kHz is a ~370ms window: long enough to resolve the
  // low end (a bass note near 55Hz needs several cycles), short enough
  // that a few hundred windows cover the analysed span.
  const FFT_SIZE: usize = 4096;
  if samples.len() < FFT_SIZE * 2 {
    return (None, None, 0.0);
  }

  let mut chroma = [0.0f32; 12];
  let hop = FFT_SIZE / 2;
  let mut offset = 0;
  let mut windows = 0usize;

  // Precomputed Hann window — without it, each frame's abrupt edges
  // smear energy across every bin and the chromagram washes out.
  let hann: Vec<f32> = (0..FFT_SIZE)
    .map(|i| 0.5 - 0.5 * (2.0 * std::f32::consts::PI * i as f32 / FFT_SIZE as f32).cos())
    .collect();

  while offset + FFT_SIZE <= samples.len() {
    let frame: Vec<f32> = samples[offset..offset + FFT_SIZE]
      .iter()
      .zip(hann.iter())
      .map(|(s, w)| s * w)
      .collect();

    let spectrum = real_fft_magnitudes(&frame);
    for (bin, mag) in spectrum.iter().enumerate().skip(1) {
      let freq = bin as f32 * rate as f32 / FFT_SIZE as f32;
      // Restrict to the range where pitch is actually perceived and
      // harmonics are not yet dominant noise.
      if !(55.0..=2000.0).contains(&freq) {
        continue;
      }
      // MIDI note number from frequency, folded to a pitch class.
      let midi = 69.0 + 12.0 * (freq / 440.0).log2();
      let pitch_class = (midi.round() as i32).rem_euclid(12) as usize;
      chroma[pitch_class] += mag;
    }
    offset += hop;
    windows += 1;
    if windows > 400 {
      break;
    }
  }

  let total: f32 = chroma.iter().sum();
  if total <= 0.0 {
    return (None, None, 0.0);
  }
  for c in chroma.iter_mut() {
    *c /= total;
  }

  let mut best_score = f32::MIN;
  let mut second_score = f32::MIN;
  let mut best_root = 0usize;
  let mut best_is_minor = false;

  for root in 0..12 {
    for is_minor in [false, true] {
      let profile = if is_minor { &MINOR_PROFILE } else { &MAJOR_PROFILE };
      let rotated: Vec<f32> = (0..12).map(|i| profile[(i + 12 - root) % 12]).collect();
      let score = pearson(&chroma, &rotated);
      if score > best_score {
        second_score = best_score;
        best_score = score;
        best_root = root;
        best_is_minor = is_minor;
      } else if score > second_score {
        second_score = score;
      }
    }
  }

  // Margin over the runner-up, not the raw correlation: a track can
  // correlate 0.8 with its true key and 0.79 with the relative minor,
  // which is not a confident answer however high the number looks.
  let confidence = if best_score > 0.0 {
    ((best_score - second_score) / best_score.abs()).clamp(0.0, 1.0)
  } else {
    0.0
  };

  let (minor_num, major_num) = CAMELOT[best_root];
  let camelot = if best_is_minor {
    format!("{minor_num}A")
  } else {
    format!("{major_num}B")
  };
  let musical = format!("{}{}", NOTE_NAMES[best_root], if best_is_minor { "m" } else { "" });

  (Some(camelot), Some(musical), confidence)
}

fn pearson(a: &[f32; 12], b: &[f32]) -> f32 {
  let mean_a = a.iter().sum::<f32>() / 12.0;
  let mean_b = b.iter().sum::<f32>() / 12.0;
  let mut num = 0.0f32;
  let mut den_a = 0.0f32;
  let mut den_b = 0.0f32;
  for i in 0..12 {
    let da = a[i] - mean_a;
    let db = b[i] - mean_b;
    num += da * db;
    den_a += da * da;
    den_b += db * db;
  }
  let den = (den_a * den_b).sqrt();
  if den > 0.0 {
    num / den
  } else {
    0.0
  }
}

/// Radix-2 FFT returning magnitudes for the lower half of the spectrum.
///
/// Written out rather than pulled from a crate: this is the only FFT the
/// project needs, `rustfft` would add a dependency and its own SIMD
/// machinery for one call site, and at 4096 points on a few hundred
/// windows the difference is immaterial next to decode time.
fn real_fft_magnitudes(input: &[f32]) -> Vec<f32> {
  let n = input.len();
  debug_assert!(n.is_power_of_two(), "FFT size must be a power of two");

  let mut re: Vec<f32> = input.to_vec();
  let mut im: Vec<f32> = vec![0.0; n];

  // Bit-reversal permutation.
  let mut j = 0usize;
  for i in 1..n {
    let mut bit = n >> 1;
    while j & bit != 0 {
      j ^= bit;
      bit >>= 1;
    }
    j |= bit;
    if i < j {
      re.swap(i, j);
      im.swap(i, j);
    }
  }

  let mut len = 2usize;
  while len <= n {
    let angle = -2.0 * std::f32::consts::PI / len as f32;
    let (wlen_re, wlen_im) = (angle.cos(), angle.sin());
    let mut i = 0usize;
    while i < n {
      let mut w_re = 1.0f32;
      let mut w_im = 0.0f32;
      for k in 0..len / 2 {
        let u_re = re[i + k];
        let u_im = im[i + k];
        let v_re = re[i + k + len / 2] * w_re - im[i + k + len / 2] * w_im;
        let v_im = re[i + k + len / 2] * w_im + im[i + k + len / 2] * w_re;
        re[i + k] = u_re + v_re;
        im[i + k] = u_im + v_im;
        re[i + k + len / 2] = u_re - v_re;
        im[i + k + len / 2] = u_im - v_im;
        let next_w_re = w_re * wlen_re - w_im * wlen_im;
        w_im = w_re * wlen_im + w_im * wlen_re;
        w_re = next_w_re;
      }
      i += len;
    }
    len <<= 1;
  }

  (0..n / 2).map(|i| (re[i] * re[i] + im[i] * im[i]).sqrt()).collect()
}

/// Full analysis pass over one file. Expensive (decode plus two DSP
/// passes), so callers should run it off the UI thread and cache the
/// result — `audio_library` stores it in SQLite keyed by track path.
pub fn analyze_file(path: &Path) -> Result<TrackAnalysis, String> {
  let (samples, rate) = decode_mono(path)?;

  let peak = samples.iter().fold(0.0f32, |acc, s| acc.max(s.abs()));
  let rms = (samples.iter().map(|s| s * s).sum::<f32>() / samples.len() as f32).sqrt();

  let (env, envelope_rate) = onset_envelope(&samples, rate);
  let (bpm, bpm_confidence, first_beat_seconds) = detect_tempo(&env, envelope_rate);
  let (camelot_key, musical_key, key_confidence) = detect_key(&samples, rate);

  Ok(TrackAnalysis {
    bpm,
    bpm_confidence,
    camelot_key,
    musical_key,
    key_confidence,
    first_beat_seconds,
    peak,
    rms,
  })
}

#[cfg(test)]
mod tests {
  use super::*;

  /// A synthetic click track at a known tempo must come back at that
  /// tempo. This is the one property of the detector worth asserting
  /// mechanically — everything else about it is a judgement call, but
  /// "120 BPM in, 120 BPM out" is not.
  #[test]
  fn detects_tempo_of_synthetic_click_track() {
    let rate = TARGET_SAMPLE_RATE;
    let bpm = 120.0f32;
    let period = (rate as f32 * 60.0 / bpm) as usize;
    let mut samples = vec![0.0f32; rate as usize * 20];
    let mut i = 0;
    while i < samples.len() {
      // Short decaying burst per beat, roughly a kick drum's envelope.
      for k in 0..(rate as usize / 40) {
        if i + k < samples.len() {
          let decay = 1.0 - (k as f32 / (rate as f32 / 40.0));
          samples[i + k] = decay * decay;
        }
      }
      i += period;
    }

    let (env, envelope_rate) = onset_envelope(&samples, rate);
    let (detected, confidence, first_beat) = detect_tempo(&env, envelope_rate);

    let detected = detected.expect("should detect a tempo in a click track");
    assert!(
      (detected - bpm).abs() < 2.0,
      "expected ~{bpm} BPM, got {detected}"
    );
    assert!(confidence > 0.1, "expected real confidence, got {confidence}");
    assert!(first_beat.is_some(), "should locate the first beat");
  }

  /// Silence has no tempo, and the detector must say so rather than
  /// returning the argmax of a flat autocorrelation as if it meant
  /// something.
  #[test]
  fn reports_no_tempo_for_silence() {
    let rate = TARGET_SAMPLE_RATE;
    let samples = vec![0.0f32; rate as usize * 10];
    let (env, envelope_rate) = onset_envelope(&samples, rate);
    let (bpm, confidence, _) = detect_tempo(&env, envelope_rate);
    assert!(
      bpm.is_none() || confidence < 0.2,
      "silence should not yield a confident tempo (got {bpm:?} at {confidence})"
    );
  }

  /// A pure A440 tone should land on a key containing A. This checks the
  /// FFT, the frequency-to-pitch-class mapping, and the profile
  /// correlation are all wired the right way round.
  #[test]
  fn detects_pitch_class_of_pure_tone() {
    let rate = TARGET_SAMPLE_RATE;
    let len = rate as usize * 5;
    let samples: Vec<f32> = (0..len)
      .map(|i| (2.0 * std::f32::consts::PI * 440.0 * i as f32 / rate as f32).sin() * 0.5)
      .collect();
    let (camelot, musical, _) = detect_key(&samples, rate);
    assert!(camelot.is_some(), "should produce a key for a pure tone");
    let musical = musical.unwrap();
    assert!(
      musical.starts_with('A'),
      "A440 should map to an A-rooted key, got {musical}"
    );
  }

  #[test]
  fn fft_resolves_a_known_frequency() {
    const N: usize = 1024;
    let rate = 8000.0f32;
    let freq = 500.0f32;
    let input: Vec<f32> = (0..N)
      .map(|i| (2.0 * std::f32::consts::PI * freq * i as f32 / rate).sin())
      .collect();
    let mags = real_fft_magnitudes(&input);
    let peak_bin = mags
      .iter()
      .enumerate()
      .max_by(|a, b| a.1.partial_cmp(b.1).unwrap())
      .map(|(i, _)| i)
      .unwrap();
    let peak_freq = peak_bin as f32 * rate / N as f32;
    assert!(
      (peak_freq - freq).abs() < rate / N as f32 * 2.0,
      "expected peak near {freq}Hz, got {peak_freq}Hz"
    );
  }
}
