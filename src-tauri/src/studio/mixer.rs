//! Track mixing: pan law, solo resolution, summing, and peak metering.
//!
//! ## Pan law, and why it is not just `left = 1 - pan`
//! Linear panning sounds wrong: a source panned hard left and the same
//! source panned centre have different apparent loudness, because two
//! channels at 0.5 sum to less perceived power than one channel at 1.0.
//! The fix is a constant-power law — take the sine and cosine of the pan
//! position across a quarter turn, so `l^2 + r^2` stays constant. That is
//! the standard behaviour in every DAW, and it is why a track does not
//! appear to dip in level as you sweep it across the stereo field.
//!
//! ## Solo is a global property, not a per-track one
//! A track is audible if it is unmuted AND (nothing is soloed OR it is
//! itself soloed). That means muting cannot be decided by looking at one
//! track in isolation — the whole set must be considered, which is why
//! `resolve_audibility` takes the full slice. Getting this wrong produces
//! the classic bug where soloing a track silences everything including
//! the soloed one.
//!
//! ## Metering reports peaks, not averages
//! Meters exist to catch clipping, and an average hides exactly the brief
//! transient that clips. So each block reports the maximum absolute
//! sample seen. The value is reset per reporting interval by the caller,
//! not per block, so a fast transient is not missed between UI frames.

use crate::studio::messages::{MixerState, TrackSlot};

/// Left/right gain pair for one track, with volume and pan already folded
/// together so the render loop multiplies once per sample.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PanGains {
  pub left: f32,
  pub right: f32,
}

/// Applies the constant-power pan law. `pan` is -1.0 (hard left) to 1.0
/// (hard right); `gain` is the track's linear volume.
///
/// At centre both channels get `gain * 0.7071` (-3dB), which is what
/// keeps a centred source the same apparent loudness as a panned one.
pub fn pan_gains(gain: f32, pan: f32) -> PanGains {
  let pan = pan.clamp(-1.0, 1.0);
  // Map -1..1 onto 0..PI/2 so that sin/cos trace a quarter circle.
  let angle = (pan + 1.0) * 0.25 * std::f32::consts::PI;
  PanGains { left: gain * angle.cos(), right: gain * angle.sin() }
}

/// Decides which tracks may be heard, accounting for the global solo rule
/// described in the module docs. Writes into `out` (pre-sized by the
/// caller) rather than allocating, because this runs per audio block.
pub fn resolve_audibility(mixers: &[(TrackSlot, MixerState)], out: &mut Vec<bool>) {
  out.clear();
  let any_soloed = mixers.iter().any(|(_, m)| m.soloed);
  for (_, m) in mixers {
    let audible = !m.muted && (!any_soloed || m.soloed);
    out.push(audible);
  }
}

/// Tracks the loudest sample seen since the last reset, per channel.
#[derive(Debug, Clone, Copy, Default)]
pub struct PeakMeter {
  pub left: f32,
  pub right: f32,
}

impl PeakMeter {
  /// Folds an interleaved stereo block into the running peak.
  pub fn observe(&mut self, interleaved: &[f32]) {
    for frame in interleaved.chunks_exact(2) {
      let l = frame[0].abs();
      let r = frame[1].abs();
      if l > self.left {
        self.left = l;
      }
      if r > self.right {
        self.right = r;
      }
    }
  }

  /// Returns the peak and clears it, ready for the next interval.
  pub fn take(&mut self) -> (f32, f32) {
    let out = (self.left, self.right);
    self.left = 0.0;
    self.right = 0.0;
    out
  }

  /// True if anything in this interval exceeded full scale — what drives
  /// the mixer's clip indicator.
  pub fn is_clipping(&self) -> bool {
    self.left > 1.0 || self.right > 1.0
  }
}

/// Applies master gain to an interleaved stereo buffer in place, then
/// hard-limits to [-1, 1].
///
/// The clamp is a safety net against sending out-of-range samples to the
/// driver (which on some backends wraps rather than clips, producing loud
/// digital noise instead of mild distortion). It is deliberately the last
/// thing that happens, and it is NOT a substitute for a real limiter —
/// that lands as a master-chain processor in a later phase.
pub fn apply_master(buffer: &mut [f32], gain: f32) {
  for sample in buffer.iter_mut() {
    *sample = (*sample * gain).clamp(-1.0, 1.0);
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  fn mixer(muted: bool, soloed: bool) -> MixerState {
    MixerState { gain: 1.0, pan: 0.0, muted, soloed }
  }

  #[test]
  fn centre_pan_is_constant_power_not_unity() {
    // The classic mistake is left=right=1.0 at centre, which makes a
    // centred track ~3dB louder than a panned one.
    let g = pan_gains(1.0, 0.0);
    let expected = (0.5f32).sqrt();
    assert!((g.left - expected).abs() < 1e-5, "got {}", g.left);
    assert!((g.right - expected).abs() < 1e-5);
  }

  #[test]
  fn hard_pans_silence_the_opposite_channel() {
    let left = pan_gains(1.0, -1.0);
    assert!((left.left - 1.0).abs() < 1e-5);
    assert!(left.right.abs() < 1e-6, "hard left must silence the right");

    let right = pan_gains(1.0, 1.0);
    assert!(right.left.abs() < 1e-6, "hard right must silence the left");
    assert!((right.right - 1.0).abs() < 1e-5);
  }

  #[test]
  fn power_is_constant_across_the_sweep() {
    // The defining property: l^2 + r^2 stays put as pan moves, so a
    // track does not appear to dip in level while being swept.
    for step in 0..=20 {
      let pan = -1.0 + (step as f32 / 10.0);
      let g = pan_gains(1.0, pan);
      let power = g.left * g.left + g.right * g.right;
      assert!((power - 1.0).abs() < 1e-4, "power {power} at pan {pan}");
    }
  }

  #[test]
  fn pan_is_clamped_to_valid_range() {
    // Out-of-range pan from a bad UI value must not produce negative or
    // wrapping gains.
    let g = pan_gains(1.0, -5.0);
    assert!(g.left >= 0.0 && g.right >= 0.0);
    assert!((g.left - 1.0).abs() < 1e-5);
  }

  #[test]
  fn gain_scales_both_channels() {
    let g = pan_gains(0.5, 0.0);
    let full = pan_gains(1.0, 0.0);
    assert!((g.left - full.left * 0.5).abs() < 1e-6);
    assert!((g.right - full.right * 0.5).abs() < 1e-6);
  }

  #[test]
  fn without_solo_everything_unmuted_is_audible() {
    let mixers = vec![
      (0, mixer(false, false)),
      (1, mixer(true, false)),
      (2, mixer(false, false)),
    ];
    let mut out = Vec::new();
    resolve_audibility(&mixers, &mut out);
    assert_eq!(out, vec![true, false, true]);
  }

  #[test]
  fn solo_silences_others_but_never_itself() {
    // The classic solo bug is silencing the soloed track too.
    let mixers = vec![
      (0, mixer(false, false)),
      (1, mixer(false, true)),
      (2, mixer(false, false)),
    ];
    let mut out = Vec::new();
    resolve_audibility(&mixers, &mut out);
    assert_eq!(out, vec![false, true, false]);
  }

  #[test]
  fn mute_beats_solo_on_the_same_track() {
    // A track both muted and soloed stays silent — mute is the more
    // explicit instruction.
    let mixers = vec![(0, mixer(true, true)), (1, mixer(false, false))];
    let mut out = Vec::new();
    resolve_audibility(&mixers, &mut out);
    assert_eq!(out, vec![false, false]);
  }

  #[test]
  fn multiple_solos_all_sound() {
    let mixers = vec![
      (0, mixer(false, true)),
      (1, mixer(false, true)),
      (2, mixer(false, false)),
    ];
    let mut out = Vec::new();
    resolve_audibility(&mixers, &mut out);
    assert_eq!(out, vec![true, true, false]);
  }

  #[test]
  fn resolve_audibility_reuses_its_buffer() {
    // Must not allocate per block: the caller's Vec is cleared and
    // refilled, and repeated calls must not grow it.
    let mixers = vec![(0, mixer(false, false))];
    let mut out = Vec::with_capacity(8);
    let cap = out.capacity();
    for _ in 0..100 {
      resolve_audibility(&mixers, &mut out);
    }
    assert_eq!(out.len(), 1);
    assert_eq!(out.capacity(), cap, "buffer must be reused, not regrown");
  }

  #[test]
  fn meter_captures_transient_peaks_not_averages() {
    // One loud sample among quiet ones must register — that spike is
    // exactly what an averaging meter would hide.
    let mut meter = PeakMeter::default();
    let mut block = vec![0.01f32; 256];
    block[100] = 0.9; // left channel (even index)
    meter.observe(&block);
    assert!((meter.left - 0.9).abs() < 1e-6, "peak must catch the transient");
  }

  #[test]
  fn meter_take_resets_for_the_next_interval() {
    let mut meter = PeakMeter::default();
    meter.observe(&[0.5, 0.25]);
    let (l, r) = meter.take();
    assert!((l - 0.5).abs() < 1e-6);
    assert!((r - 0.25).abs() < 1e-6);
    let (l2, r2) = meter.take();
    assert_eq!((l2, r2), (0.0, 0.0), "take must clear the peak");
  }

  #[test]
  fn meter_detects_clipping() {
    let mut meter = PeakMeter::default();
    meter.observe(&[0.9, 0.9]);
    assert!(!meter.is_clipping());
    meter.observe(&[1.4, 0.2]);
    assert!(meter.is_clipping());
  }

  #[test]
  fn master_gain_scales_and_clamps() {
    let mut buf = vec![0.5f32, -0.5, 0.25, -0.25];
    apply_master(&mut buf, 2.0);
    assert!((buf[0] - 1.0).abs() < 1e-6);
    assert!((buf[1] + 1.0).abs() < 1e-6);
    assert!((buf[2] - 0.5).abs() < 1e-6);
  }

  #[test]
  fn master_clamp_prevents_out_of_range_output() {
    // Out-of-range samples can wrap on some drivers, turning mild
    // overdrive into loud digital noise — the clamp is the guard.
    let mut buf = vec![5.0f32, -5.0];
    apply_master(&mut buf, 1.0);
    assert_eq!(buf, vec![1.0, -1.0]);
  }
}
