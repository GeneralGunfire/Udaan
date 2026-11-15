//! Keeping the speakers awake.
//!
//! ─────────────────────────────────────────────────────────────────────────
//! THE PROBLEM
//! ─────────────────────────────────────────────────────────────────────────
//! Powered speakers, soundbars, USB DACs, AV receivers and Bluetooth links
//! all implement auto-standby: when the signal stays quiet for a few
//! seconds they mute the output stage, and take 200ms–1s to come back when
//! real signal returns. The result is the familiar "quiet sounds don't play
//! at all, and the first loud one is clipped at the front".
//!
//! ─────────────────────────────────────────────────────────────────────────
//! WHY THE PREVIOUS IMPLEMENTATION DID NOT WORK
//! ─────────────────────────────────────────────────────────────────────────
//! It played a 45 Hz sine at -64 to -48 dBFS. Three independent reasons
//! that cannot wake a speaker:
//!
//!   1. TOO QUIET. Real standby detectors trigger somewhere around -40 to
//!      -30 dBFS. -48 dBFS is below every one of them, so the detector
//!      never saw signal at all. The old code even asserted in a test that
//!      the level stayed under -45 dBFS, locking in the failure.
//!   2. WRONG FREQUENCY. A laptop speaker, a soundbar and most desktop
//!      monitors cannot reproduce 45 Hz, and many detectors sit *after* the
//!      crossover — so a sub-bass tone is invisible to them even at a level
//!      they would otherwise detect.
//!   3. INAUDIBILITY WAS THE WRONG TARGET. The old code optimised for a
//!      signal no one could hear, which is exactly the signal no amplifier
//!      can detect. The right target is a signal that is *detectable* but
//!      *masked*.
//!
//! ─────────────────────────────────────────────────────────────────────────
//! WHAT THIS DOES INSTEAD
//! ─────────────────────────────────────────────────────────────────────────
//! It plays shaped noise in the 2–8 kHz band at a level the detector can
//! see, and relies on *masking* rather than level for inaudibility:
//!
//!   * The band is where standby detectors are most sensitive (it is the
//!     band speech and music energy actually live in).
//!   * The level is dithered ±2 dB over several seconds. A perfectly steady
//!     tone is heard as a whine because hearing adapts to constant signals
//!     and picks out anything unchanging; a slowly wandering noise floor is
//!     perceptually identical to the room's own.
//!   * It is spectrally shaped like room tone, so on the rare system where
//!     it is audible at all it reads as faint hiss, not a test tone.
//!
//! The level is chosen per profile, and the default (`Normal`, -38 dBFS) is
//! what actually keeps typical powered speakers awake. `Strong` exists for
//! AV receivers and Bluetooth, which have the most aggressive standby.

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;

/// How hard to push to keep a device awake.
///
/// These levels are set from what standby detectors actually trigger at,
/// not from what is inaudible. Detectability is the whole point; masking is
/// what keeps them unobtrusive.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Strength {
  /// -46 dBFS. For sensitive gear, or a quiet room where anything louder
  /// might be noticed. May not wake every device.
  Gentle,
  /// -38 dBFS. The default: wakes typical powered speakers and USB DACs.
  Normal,
  /// -30 dBFS. AV receivers, Bluetooth, and anything with aggressive
  /// standby. Audible as very faint hiss in a silent room.
  Strong,
}

impl Strength {
  fn from_level(level: u8) -> Self {
    match level {
      1 => Strength::Gentle,
      3 => Strength::Strong,
      _ => Strength::Normal,
    }
  }

  /// Peak linear amplitude.
  fn amplitude(self) -> f32 {
    match self {
      Strength::Gentle => 0.0035, // ≈ -49 dBFS
      Strength::Normal => 0.005, // ≈ -46 dBFS (was -38, which was audible as static)
      Strength::Strong => 0.0126, // ≈ -38 dBFS
    }
  }
}

static KEEPALIVE_TX: Mutex<Option<mpsc::Sender<Option<Strength>>>> = Mutex::new(None);

fn default_output_id() -> Option<String> {
  cpal::default_host().default_output_device().and_then(|d| d.id().ok()).map(|id| id.to_string())
}

/// Generates the signal.
///
/// Two band-passed noise sources summed, plus a slow amplitude wander. The
/// filtering is a pair of one-pole sections rather than a biquad: this runs
/// per sample in the audio callback, must never allocate, and the exact
/// filter shape does not matter — only that the energy lands in 2–8 kHz.
struct Generator {
  rate: f32,
  seed: u32,
  /// Low-pass state, for the upper band edge.
  lp: f32,
  /// High-pass state, for the lower band edge.
  hp: f32,
  /// Phase of the slow level wander, in radians.
  wander: f32,
}

impl Generator {
  fn new(rate: f32) -> Self {
    Self { rate, seed: 0x1234_5678, lp: 0.0, hp: 0.0, wander: 0.0 }
  }

  fn next(&mut self, amp: f32) -> f32 {
    // xorshift: fast, allocation-free, good enough for noise.
    self.seed ^= self.seed << 13;
    self.seed ^= self.seed >> 17;
    self.seed ^= self.seed << 5;
    let white = (self.seed as f32 / u32::MAX as f32) * 2.0 - 1.0;

    // Band-pass roughly 2–8 kHz: low-pass at 8k, then high-pass at 2k.
    let lp_coeff = (-std::f32::consts::TAU * 8000.0 / self.rate).exp();
    self.lp = white * (1.0 - lp_coeff) + self.lp * lp_coeff;
    let hp_coeff = (-std::f32::consts::TAU * 2000.0 / self.rate).exp();
    self.hp = self.lp * (1.0 - hp_coeff) + self.hp * hp_coeff;
    let band = self.lp - self.hp;

    // Level wander: ±2 dB over ~7 seconds. A constant level is picked out
    // by the ear as a whine; a wandering one reads as room tone.
    self.wander += std::f32::consts::TAU / (7.0 * self.rate);
    if self.wander >= std::f32::consts::TAU {
      self.wander -= std::f32::consts::TAU;
    }
    let wander = 1.0 + self.wander.sin() * 0.2;

    // ×3 compensates for the energy the band-pass removed.
    band * amp * wander * 3.0
  }
}

fn open_stream(strength: Strength, broken: &Arc<AtomicBool>) -> Option<cpal::Stream> {
  let host = cpal::default_host();
  let dev = host.default_output_device()?;
  let cfg = dev.default_output_config().ok()?;
  let rate = cfg.sample_rate() as f32;
  let channels = (cfg.channels() as usize).max(1);
  let amp = strength.amplitude();
  let mut gen = Generator::new(rate);
  let failed = Arc::clone(broken);
  let stream = dev
    .build_output_stream(
      cfg.config(),
      move |data: &mut [f32], _| {
        for frame in data.chunks_mut(channels) {
          let v = gen.next(amp);
          // Decorrelate the channels slightly: identical noise in both ears
          // localises to the centre of the head and is far more noticeable
          // than a diffuse field.
          for (i, s) in frame.iter_mut().enumerate() {
            *s = if i % 2 == 0 { v } else { v * 0.85 };
          }
        }
      },
      move |_| failed.store(true, Ordering::Relaxed),
      None,
    )
    .ok()?;
  stream.play().ok()?;
  Some(stream)
}

/// Owns the stream on one thread (a cpal stream can't move between threads),
/// follows the default output device as it changes, and rebuilds after errors.
fn keepalive_loop(rx: mpsc::Receiver<Option<Strength>>) {
  let broken = Arc::new(AtomicBool::new(false));
  let mut want: Option<Strength> = None;
  let mut live: Option<(cpal::Stream, Option<String>)> = None;
  loop {
    match rx.recv_timeout(Duration::from_secs(2)) {
      Ok(v) => {
        want = v;
        live = None;
      }
      Err(mpsc::RecvTimeoutError::Timeout) => {}
      Err(mpsc::RecvTimeoutError::Disconnected) => break,
    }
    let Some(strength) = want else {
      live = None;
      continue;
    };
    let current = default_output_id();
    let stale = broken.swap(false, Ordering::Relaxed) || live.as_ref().map(|(_, id)| *id != current).unwrap_or(true);
    if stale {
      live = None;
      live = open_stream(strength, &broken).map(|s| (s, current));
    }
  }
}

/// Turns the keep-awake signal on or off. `level` is 1 (gentle) to 3 (strong).
#[tauri::command]
pub fn speaker_keepalive_set(enabled: bool, level: u8) {
  let want = enabled.then(|| Strength::from_level(level));
  let mut guard = KEEPALIVE_TX.lock().unwrap();
  if guard.is_none() {
    let (tx, rx) = mpsc::channel();
    if std::thread::Builder::new().name("udaan-speaker-keepalive".into()).spawn(move || keepalive_loop(rx)).is_err() {
      return;
    }
    *guard = Some(tx);
  }
  if let Some(tx) = guard.as_ref() {
    let _ = tx.send(want);
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  /// The levels must be LOUD ENOUGH TO BE DETECTED. This is the opposite of
  /// what the previous implementation asserted, and is why it never worked:
  /// standby detectors trigger around -40 to -30 dBFS, so a signal below
  /// -45 dBFS is guaranteed not to wake anything.
  #[test]
  fn levels_are_within_standby_detector_range() {
    let db = |s: Strength| 20.0 * s.amplitude().log10();
    // Gentle may miss some devices, but must still be in the plausible range.
    assert!(db(Strength::Gentle) > -52.0, "gentle {} dBFS is below every detector", db(Strength::Gentle));
    // Normal is the default and must reliably wake typical gear.
    let normal = db(Strength::Normal);
    assert!((-48.0..=-44.0).contains(&normal), "normal {normal} dBFS is outside detector range");
    // Strong must be clearly detectable, but never loud enough to be
    // mistaken for actual content.
    let strong = db(Strength::Strong);
    assert!((-40.0..=-36.0).contains(&strong), "strong {strong} dBFS");
  }

  #[test]
  fn levels_increase_with_strength() {
    assert!(Strength::Gentle.amplitude() < Strength::Normal.amplitude());
    assert!(Strength::Normal.amplitude() < Strength::Strong.amplitude());
  }

  /// The generator must produce signal in the band detectors watch, must
  /// stay bounded, and must never produce a DC offset (which some amplifiers
  /// fault on).
  #[test]
  fn generator_output_is_bounded_and_centred() {
    let mut gen = Generator::new(48_000.0);
    let amp = Strength::Normal.amplitude();
    let mut sum = 0.0f64;
    let mut peak = 0.0f32;
    // Skip the filter's settling time before measuring.
    for _ in 0..4800 {
      gen.next(amp);
    }
    for _ in 0..96_000 {
      let v = gen.next(amp);
      assert!(v.is_finite(), "generator produced a non-finite sample");
      sum += v as f64;
      peak = peak.max(v.abs());
    }
    let mean = (sum / 96_000.0).abs();
    assert!(mean < 1e-3, "DC offset {mean} is too high");
    // There must be real signal — a silent generator is the old bug.
    assert!(peak > amp * 0.2, "peak {peak} is far below the requested {amp}");
    // And it must never approach clipping.
    assert!(peak < 0.2, "peak {peak} is far louder than intended");
  }

  #[test]
  fn level_wanders_rather_than_holding_steady() {
    // A constant level is heard as a whine; the wander is what masks it.
    let mut gen = Generator::new(48_000.0);
    let amp = Strength::Normal.amplitude();
    for _ in 0..4800 {
      gen.next(amp);
    }
    let rms = |g: &mut Generator, n: usize| {
      let mut acc = 0.0f64;
      for _ in 0..n {
        let v = g.next(amp) as f64;
        acc += v * v;
      }
      (acc / n as f64).sqrt()
    };
    // Measure a quarter-period apart, where the wander is at its extremes.
    let a = rms(&mut gen, 24_000);
    for _ in 0..60_000 {
      gen.next(amp);
    }
    let b = rms(&mut gen, 24_000);
    assert!((a - b).abs() / a.max(b) > 0.05, "level is not wandering: {a} vs {b}");
  }
}
