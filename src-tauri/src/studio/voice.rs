//! Sample playback voices: the thing that actually turns a note into
//! sound, and the polyphony pool that manages them.
//!
//! ## Real-time constraints shape every choice here
//! Everything in this file runs inside the audio callback (see
//! `messages.rs` for the full rule). Concretely that means:
//! - The voice pool is allocated once at engine start and never grows.
//!   Running out of voices steals the quietest one rather than allocating.
//! - No branching on `Option::unwrap`, no panics: a voice referencing a
//!   sample that has been unloaded goes silent instead of crashing the
//!   audio thread, which would take the whole app's sound with it.
//! - Pitch shifting and resampling are done with linear interpolation on
//!   a fractional read position. Higher-quality interpolation is possible
//!   but costs more per sample; linear is the standard choice for a
//!   sampler playing pitched material within a couple of semitones of the
//!   source, which is how the instrument sample sets are laid out.
//!
//! ## Why an envelope at all
//! Cutting a sample off the instant a key is released produces a click,
//! because the waveform almost never happens to be at zero at that moment.
//! A short release ramp avoids that. The attack ramp serves the same
//! purpose at note-on. These are deliberately short (a few milliseconds)
//! so they shape nothing musically — they exist purely to prevent
//! discontinuities.

use std::sync::Arc;

use crate::studio::messages::{SampleData, SampleId, TrackSlot};

/// Attack ramp length. Long enough to remove the click at note-on, short
/// enough to stay percussive — a drum hit must still sound immediate.
const ATTACK_SECONDS: f32 = 0.002;

/// Release ramp length. Slightly longer than the attack because a release
/// click is more audible, and because it doubles as the fade used when a
/// voice is stolen.
const RELEASE_SECONDS: f32 = 0.008;

/// Where a voice is in its lifecycle.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum VoiceStage {
  /// Not in use; available for allocation.
  Idle,
  /// Ramping up from silence.
  Attack,
  /// At full level, playing.
  Sustain,
  /// Ramping down to silence, then becomes Idle.
  Release,
}

/// One sounding note.
pub struct Voice {
  stage: VoiceStage,
  /// Which track this voice belongs to, so a track's voices can be
  /// silenced or mixed independently.
  pub slot: TrackSlot,
  /// MIDI pitch that triggered it, used to match a later note-off.
  pub pitch: u8,
  sample_id: SampleId,
  data: Option<Arc<SampleData>>,
  /// Fractional read head into the sample, advanced by `pitch_ratio` each
  /// output frame. Fractional because pitch shifting means the read rate
  /// is rarely exactly 1.0.
  position: f64,
  /// Combined pitch-shift and sample-rate-conversion ratio.
  pitch_ratio: f64,
  /// Note velocity, applied as a constant gain.
  velocity: f32,
  /// Current envelope level, 0.0-1.0.
  env: f32,
  /// Per-frame envelope increment for the current stage.
  env_step: f32,
  /// True while the sustain pedal is holding this voice past its note-off.
  held_by_pedal: bool,
  /// Monotonic counter recording when this voice started, for
  /// oldest-first stealing.
  pub age: u64,
}

impl Voice {
  fn idle() -> Self {
    Self {
      stage: VoiceStage::Idle,
      slot: 0,
      pitch: 0,
      sample_id: 0,
      data: None,
      position: 0.0,
      pitch_ratio: 1.0,
      velocity: 0.0,
      env: 0.0,
      env_step: 0.0,
      held_by_pedal: false,
      age: 0,
    }
  }

  pub fn is_active(&self) -> bool {
    self.stage != VoiceStage::Idle
  }

  /// Current output level, used to choose the least-audible voice to
  /// steal when the pool is exhausted.
  fn loudness(&self) -> f32 {
    self.env * self.velocity
  }

  /// Begins release. Idempotent — a second note-off (or an all-notes-off
  /// following one) must not restart or extend the ramp.
  fn release(&mut self, sample_rate: u32) {
    if self.stage == VoiceStage::Idle || self.stage == VoiceStage::Release {
      return;
    }
    self.stage = VoiceStage::Release;
    let frames = (RELEASE_SECONDS * sample_rate as f32).max(1.0);
    self.env_step = -self.env / frames;
  }

  /// Renders `frames` frames into the interleaved stereo `out` buffer,
  /// adding (not overwriting) so multiple voices sum naturally.
  ///
  /// `gain_l`/`gain_r` carry the track's volume and pan, already resolved
  /// by the mixer so this loop does no per-sample panning math.
  fn render(&mut self, out: &mut [f32], gain_l: f32, gain_r: f32, sample_rate: u32) {
    if self.stage == VoiceStage::Idle {
      return;
    }
    // A voice whose sample was unloaded goes silent rather than panicking
    // — an unwrap here would kill the audio thread and mute the whole app.
    let Some(data) = self.data.clone() else {
      self.stage = VoiceStage::Idle;
      return;
    };

    let frames = data.frames;
    if frames == 0 {
      self.stage = VoiceStage::Idle;
      return;
    }

    let channels = data.channel_count();
    let left = &data.channels[0];
    // Mono samples feed both output channels; stereo uses its own pair.
    let right = if channels > 1 { &data.channels[1] } else { left };

    let attack_step = 1.0 / (ATTACK_SECONDS * sample_rate as f32).max(1.0);

    for frame in out.chunks_exact_mut(2) {
      if self.stage == VoiceStage::Idle {
        break;
      }

      let idx = self.position as usize;
      if idx + 1 >= frames {
        // Ran off the end of the sample.
        self.stage = VoiceStage::Idle;
        break;
      }

      // Linear interpolation between the two straddling samples.
      let frac = (self.position - idx as f64) as f32;
      let l = left[idx] + (left[idx + 1] - left[idx]) * frac;
      let r = right[idx] + (right[idx + 1] - right[idx]) * frac;

      let amp = self.env * self.velocity;
      frame[0] += l * amp * gain_l;
      frame[1] += r * amp * gain_r;

      // Advance the envelope.
      match self.stage {
        VoiceStage::Attack => {
          self.env += attack_step;
          if self.env >= 1.0 {
            self.env = 1.0;
            self.stage = VoiceStage::Sustain;
          }
        }
        VoiceStage::Release => {
          self.env += self.env_step;
          if self.env <= 0.0 {
            self.env = 0.0;
            self.stage = VoiceStage::Idle;
          }
        }
        VoiceStage::Sustain | VoiceStage::Idle => {}
      }

      self.position += self.pitch_ratio;
    }

    // Drop our reference without freeing on the audio thread: the pool
    // still holds the Arc in `self.data`, so this clone's refcount
    // decrement is all that happens here, never a deallocation.
    drop(data);
  }
}

/// Fixed-size polyphony pool.
pub struct VoicePool {
  voices: Vec<Voice>,
  sample_rate: u32,
  /// Monotonic tick used to age voices for stealing.
  counter: u64,
}

impl VoicePool {
  /// Allocates the whole pool up front. `capacity` is the maximum number
  /// of simultaneously sounding notes across all tracks.
  pub fn new(capacity: usize, sample_rate: u32) -> Self {
    let mut voices = Vec::with_capacity(capacity);
    for _ in 0..capacity {
      voices.push(Voice::idle());
    }
    Self { voices, sample_rate, counter: 0 }
  }

  pub fn set_sample_rate(&mut self, sample_rate: u32) {
    self.sample_rate = sample_rate;
  }

  pub fn active_count(&self) -> usize {
    self.voices.iter().filter(|v| v.is_active()).count()
  }

  /// Picks a voice index for a new note: a free one if any, otherwise the
  /// quietest active voice (stealing the least audible note causes the
  /// least noticeable artefact).
  fn allocate(&mut self) -> usize {
    if let Some(i) = self.voices.iter().position(|v| !v.is_active()) {
      return i;
    }
    let mut best = 0;
    let mut best_loudness = f32::MAX;
    for (i, v) in self.voices.iter().enumerate() {
      let l = v.loudness();
      if l < best_loudness {
        best_loudness = l;
        best = i;
      }
    }
    best
  }

  /// Starts a note.
  ///
  /// `pitch_ratio` combines transposition and sample-rate conversion and
  /// is computed by the caller — see `pitch_ratio_for` below.
  pub fn note_on(
    &mut self,
    slot: TrackSlot,
    pitch: u8,
    velocity: f32,
    sample_id: SampleId,
    data: Arc<SampleData>,
    pitch_ratio: f64,
  ) {
    let idx = self.allocate();
    self.counter += 1;

    let v = &mut self.voices[idx];
    v.stage = VoiceStage::Attack;
    v.slot = slot;
    v.pitch = pitch;
    v.sample_id = sample_id;
    v.data = Some(data);
    v.position = 0.0;
    v.pitch_ratio = pitch_ratio;
    v.velocity = velocity.clamp(0.0, 1.0);
    v.env = 0.0;
    v.env_step = 0.0;
    v.held_by_pedal = false;
    v.age = self.counter;
  }

  /// Releases every voice on `slot` matching `pitch`. If the pedal is
  /// held the voice is flagged instead, and released when the pedal lifts.
  pub fn note_off(&mut self, slot: TrackSlot, pitch: u8, sustain_held: bool) {
    let rate = self.sample_rate;
    for v in self.voices.iter_mut() {
      if v.is_active() && v.slot == slot && v.pitch == pitch && v.stage != VoiceStage::Release {
        if sustain_held {
          v.held_by_pedal = true;
        } else {
          v.release(rate);
        }
      }
    }
  }

  /// Called when the sustain pedal lifts: releases everything it was
  /// holding on that track.
  pub fn release_pedal_held(&mut self, slot: TrackSlot) {
    let rate = self.sample_rate;
    for v in self.voices.iter_mut() {
      if v.is_active() && v.slot == slot && v.held_by_pedal {
        v.held_by_pedal = false;
        v.release(rate);
      }
    }
  }

  /// Silences one track's voices (used when a track is removed or muted
  /// hard). Ramps rather than cutting, to avoid a click.
  pub fn release_slot(&mut self, slot: TrackSlot) {
    let rate = self.sample_rate;
    for v in self.voices.iter_mut() {
      if v.is_active() && v.slot == slot {
        v.release(rate);
      }
    }
  }

  /// Panic button: ramps every voice down.
  pub fn release_all(&mut self) {
    let rate = self.sample_rate;
    for v in self.voices.iter_mut() {
      v.release(rate);
    }
  }

  /// Drops references to a sample being unloaded. Any voice still playing
  /// it is silenced first, so the audio thread never reads freed memory.
  /// Returns the Arcs so the caller can send them off-thread to be freed.
  pub fn evict_sample(&mut self, sample_id: SampleId, out: &mut Vec<Arc<SampleData>>) {
    for v in self.voices.iter_mut() {
      if v.sample_id == sample_id {
        v.stage = VoiceStage::Idle;
        if let Some(data) = v.data.take() {
          out.push(data);
        }
      }
    }
  }

  /// Renders every voice belonging to `slot` into `out`.
  pub fn render_slot(&mut self, slot: TrackSlot, out: &mut [f32], gain_l: f32, gain_r: f32) {
    let rate = self.sample_rate;
    for v in self.voices.iter_mut() {
      if v.is_active() && v.slot == slot {
        v.render(out, gain_l, gain_r, rate);
      }
    }
  }
}

/// Computes the read-rate ratio for playing `sample` (recorded at
/// `source_root` pitch and its own sample rate) at `pitch`, on a device
/// running at `device_rate`.
///
/// Two independent effects multiply together:
/// 1. **Transposition** — each semitone is a factor of 2^(1/12).
/// 2. **Sample-rate conversion** — a 44.1kHz sample played on a 48kHz
///    device must be read slower than 1.0 or it plays sharp and short.
///
/// Doing this as one combined ratio means the render loop advances a
/// single accumulator instead of resampling twice.
pub fn pitch_ratio_for(pitch: u8, source_root: u8, source_rate: u32, device_rate: u32) -> f64 {
  let semitones = pitch as f64 - source_root as f64;
  let transpose = 2.0_f64.powf(semitones / 12.0);
  let rate_ratio = if device_rate == 0 {
    1.0
  } else {
    source_rate as f64 / device_rate as f64
  };
  transpose * rate_ratio
}

#[cfg(test)]
mod tests {
  use super::*;

  fn test_sample(frames: usize, rate: u32) -> Arc<SampleData> {
    // A ramp from 0..1 makes interpolation errors easy to spot.
    let data: Vec<f32> = (0..frames).map(|i| i as f32 / frames as f32).collect();
    Arc::new(SampleData { channels: vec![data], sample_rate: rate, frames })
  }

  #[test]
  fn unison_at_matching_rate_is_ratio_one() {
    // Same pitch as the source, same rate: must read at exactly 1.0 or
    // the sample plays detuned.
    assert!((pitch_ratio_for(60, 60, 48_000, 48_000) - 1.0).abs() < 1e-12);
  }

  #[test]
  fn octave_up_doubles_read_rate() {
    let r = pitch_ratio_for(72, 60, 48_000, 48_000);
    assert!((r - 2.0).abs() < 1e-9, "an octave up must read twice as fast, got {r}");
    let down = pitch_ratio_for(48, 60, 48_000, 48_000);
    assert!((down - 0.5).abs() < 1e-9, "an octave down must read half as fast, got {down}");
  }

  #[test]
  fn sample_rate_conversion_is_applied() {
    // 44.1k sample on a 48k device at unison: must read slower than 1.0,
    // otherwise it plays sharp. This is the bug that makes a whole
    // sample library sound subtly out of tune.
    let r = pitch_ratio_for(60, 60, 44_100, 48_000);
    assert!(r < 1.0);
    assert!((r - (44_100.0 / 48_000.0)).abs() < 1e-12);
  }

  #[test]
  fn zero_device_rate_does_not_produce_nan() {
    let r = pitch_ratio_for(60, 60, 44_100, 0);
    assert!(r.is_finite(), "a zero device rate must not poison the read head");
  }

  #[test]
  fn note_on_then_off_eventually_frees_the_voice() {
    let mut pool = VoicePool::new(4, 48_000);
    assert_eq!(pool.active_count(), 0);

    pool.note_on(0, 60, 1.0, 1, test_sample(4096, 48_000), 1.0);
    assert_eq!(pool.active_count(), 1);

    pool.note_off(0, 60, false);
    // Still active while the release ramp runs.
    assert_eq!(pool.active_count(), 1);

    // Render past the release ramp; the voice must return to the pool.
    let mut buf = vec![0.0f32; 2 * 2048];
    pool.render_slot(0, &mut buf, 1.0, 1.0);
    assert_eq!(pool.active_count(), 0, "released voice must free itself");
  }

  #[test]
  fn sustain_pedal_holds_notes_past_note_off() {
    let mut pool = VoicePool::new(4, 48_000);
    pool.note_on(0, 60, 1.0, 1, test_sample(48_000, 48_000), 1.0);

    // With the pedal down, note-off must not start the release.
    pool.note_off(0, 60, true);
    let mut buf = vec![0.0f32; 2 * 1024];
    pool.render_slot(0, &mut buf, 1.0, 1.0);
    assert_eq!(pool.active_count(), 1, "pedal must hold the note");

    // Lifting the pedal releases it.
    pool.release_pedal_held(0);
    let mut buf = vec![0.0f32; 2 * 2048];
    pool.render_slot(0, &mut buf, 1.0, 1.0);
    assert_eq!(pool.active_count(), 0);
  }

  #[test]
  fn exhausted_pool_steals_instead_of_growing() {
    let mut pool = VoicePool::new(2, 48_000);
    pool.note_on(0, 60, 1.0, 1, test_sample(48_000, 48_000), 1.0);
    pool.note_on(0, 62, 1.0, 1, test_sample(48_000, 48_000), 1.0);
    assert_eq!(pool.active_count(), 2);

    // A third note on a 2-voice pool must steal, never allocate.
    pool.note_on(0, 64, 1.0, 1, test_sample(48_000, 48_000), 1.0);
    assert_eq!(pool.active_count(), 2, "pool must not grow at runtime");
    assert_eq!(pool.voices.len(), 2);
  }

  #[test]
  fn voices_sum_additively_and_respect_pan_gains() {
    let mut pool = VoicePool::new(4, 48_000);
    // Hard-right gains: left must stay silent, right must receive signal.
    pool.note_on(0, 60, 1.0, 1, test_sample(4096, 48_000), 1.0);
    let mut buf = vec![0.0f32; 2 * 512];
    pool.render_slot(0, &mut buf, 0.0, 1.0);

    let left_energy: f32 = buf.iter().step_by(2).map(|s| s.abs()).sum();
    let right_energy: f32 = buf.iter().skip(1).step_by(2).map(|s| s.abs()).sum();
    assert!(left_energy < 1e-6, "left gain of 0 must produce silence");
    assert!(right_energy > 0.0, "right channel must receive the voice");
  }

  #[test]
  fn voice_survives_its_sample_being_unloaded() {
    // The crash case: a sample is unloaded while a voice still plays it.
    // The voice must go silent, not read freed memory or panic.
    let mut pool = VoicePool::new(4, 48_000);
    pool.note_on(0, 60, 1.0, 7, test_sample(48_000, 48_000), 1.0);

    let mut freed = Vec::new();
    pool.evict_sample(7, &mut freed);

    assert_eq!(pool.active_count(), 0, "evicted voice must stop");
    assert_eq!(freed.len(), 1, "the Arc must be handed back for off-thread drop");

    // Rendering after eviction must be safe.
    let mut buf = vec![0.0f32; 2 * 256];
    pool.render_slot(0, &mut buf, 1.0, 1.0);
    assert!(buf.iter().all(|s| *s == 0.0));
  }

  #[test]
  fn render_does_not_click_at_note_on() {
    // The first output sample must not jump straight to full amplitude —
    // that discontinuity is the click the attack ramp exists to prevent.
    let mut pool = VoicePool::new(4, 48_000);
    // Use a DC-valued sample so any envelope shape is directly visible.
    let flat = Arc::new(SampleData {
      channels: vec![vec![1.0f32; 4096]],
      sample_rate: 48_000,
      frames: 4096,
    });
    pool.note_on(0, 60, 1.0, 1, flat, 1.0);

    let mut buf = vec![0.0f32; 2 * 64];
    pool.render_slot(0, &mut buf, 1.0, 1.0);

    assert!(buf[0].abs() < 0.2, "first sample must start near silence, got {}", buf[0]);
    let last = buf[buf.len() - 2];
    assert!(last > buf[0], "envelope must be rising through the attack");
  }

  #[test]
  fn double_note_off_does_not_restart_the_release_ramp() {
    // Idempotence matters: an all-notes-off arriving after a note-off
    // must not extend the ramp and leave the voice hanging.
    let mut pool = VoicePool::new(4, 48_000);
    pool.note_on(0, 60, 1.0, 1, test_sample(48_000, 48_000), 1.0);
    pool.note_off(0, 60, false);
    pool.note_off(0, 60, false);
    pool.release_all();

    let mut buf = vec![0.0f32; 2 * 2048];
    pool.render_slot(0, &mut buf, 1.0, 1.0);
    assert_eq!(pool.active_count(), 0);
  }
}
