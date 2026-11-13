//! The message types crossing the UI thread <-> audio thread boundary.
//!
//! ## The one rule this module exists to enforce
//! The audio callback runs on a real-time thread with a hard deadline: at
//! 48kHz with a 128-frame buffer it must produce samples every 2.7ms, and
//! missing that deadline is an audible click, not a slow frame. So the
//! callback may never do anything with unbounded or unpredictable latency:
//! **no locks, no allocation, no deallocation, no file or network I/O, no
//! logging**. Everything it needs must already be in memory and reachable
//! without blocking.
//!
//! That constraint shapes these types:
//! - `EngineCommand` is `Send` and allocation-free to *consume*. Where a
//!   command must carry heap data (a decoded sample, a whole clip's
//!   notes), the allocation happens on the UI thread and the audio thread
//!   only ever moves the `Box`/`Arc` — it never builds or frees one
//!   inline. Dropping is deferred via `Trash` (see below).
//! - Commands go out through an `rtrb` SPSC ring buffer, which is wait-free
//!   on both ends. A full queue is dropped-with-a-count rather than
//!   blocked on, because blocking the UI is bad but blocking audio is
//!   unacceptable.
//! - State comes back the same way, as `EngineEvent`, and is drained by a
//!   normal (non-real-time) poller thread that forwards to the WebView via
//!   `app.emit`. The audio thread never touches Tauri.
//!
//! ## Why deferred drops (`Trash`) matter
//! When the UI replaces a track's sample or removes a track, the old data
//! must be freed — but `drop` on the audio thread means `free()`, which
//! can take a lock inside the allocator. So the audio thread hands the
//! dead object back through the event channel as `Trash`, and the poller
//! thread drops it. This is the standard pattern for real-time audio and
//! is the reason `EngineEvent` carries a variant that looks, at a glance,
//! like it does nothing.

use std::sync::Arc;

use serde::{Deserialize, Serialize};

/// Sample-accurate position in the project, counted in frames from the
/// start of the timeline. Frames (not seconds, not beats) are the audio
/// thread's native unit — converting to musical time is the UI's job, so
/// tempo changes never introduce drift in the engine's own bookkeeping.
pub type FramePos = u64;

/// Identifies a track for the audio thread. A dense `u32` rather than the
/// UI's string id, so the audio thread can index straight into a `Vec`
/// without hashing or string comparison in the callback.
pub type TrackSlot = u32;

/// Identifies a loaded sample in the engine's sample pool.
pub type SampleId = u32;

/// Immutable, decoded PCM ready for playback. Shared by `Arc` so multiple
/// voices can play the same sample without copying it, and so handing one
/// to the audio thread is a pointer move rather than a memcpy.
#[derive(Debug)]
pub struct SampleData {
  /// De-interleaved channels; `channels[0]` is left. Always at least one.
  pub channels: Vec<Vec<f32>>,
  /// The rate this data is stored at. The engine resamples on the fly
  /// when it differs from the device rate.
  pub sample_rate: u32,
  /// Frame count (per channel), cached so the audio thread never calls
  /// `.len()` on a nested Vec in a hot loop.
  pub frames: usize,
}

impl SampleData {
  pub fn channel_count(&self) -> usize {
    self.channels.len()
  }
}

/// Anything the audio thread needs freed but must not free itself.
/// See the module docs on deferred drops.
#[derive(Debug)]
pub enum Trash {
  Sample(Arc<SampleData>),
  Notes(Box<Vec<ScheduledNote>>),
}

/// A note the scheduler will play, already resolved to absolute frame
/// positions. The audio thread never converts beats to frames itself —
/// that arithmetic (and any tempo-map lookup it implies) happens on the
/// UI thread, so the callback only ever compares integers.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ScheduledNote {
  pub start: FramePos,
  pub end: FramePos,
  pub pitch: u8,
  /// 0.0-1.0.
  pub velocity: f32,
  pub sample: SampleId,
}

/// How a track's audio is produced.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TrackKind {
  /// Plays scheduled notes through the sample pool.
  Instrument,
  /// Plays a recorded/imported audio region.
  Audio,
}

/// Per-track mixer state. Kept as one struct so a mixer change is a single
/// command rather than four, which keeps the ring buffer shallow.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MixerState {
  /// Linear gain, not dB. The UI owns the dB<->linear curve so the audio
  /// thread never calls `powf` per sample.
  pub gain: f32,
  /// -1.0 (hard left) .. 1.0 (hard right).
  pub pan: f32,
  pub muted: bool,
  pub soloed: bool,
}

impl Default for MixerState {
  fn default() -> Self {
    Self { gain: 1.0, pan: 0.0, muted: false, soloed: false }
  }
}

/// Commands sent UI thread -> audio thread. Every variant must be cheap to
/// apply: the audio thread drains these at the top of each callback, so a
/// command that took milliseconds would blow the buffer deadline.
#[derive(Debug)]
pub enum EngineCommand {
  // --- Transport -----------------------------------------------------
  /// Begin playback from the current position.
  Play,
  /// Stop and hold position.
  Stop,
  /// Stop and return to the start of the timeline.
  StopAndRewind,
  /// Jump the playhead. Sample-accurate.
  Seek(FramePos),
  /// Loop region; `None` disables looping.
  SetLoop(Option<(FramePos, FramePos)>),
  /// Frames per beat, precomputed by the UI from BPM and sample rate.
  /// Only used for the metronome click — note scheduling is already in
  /// absolute frames.
  SetFramesPerBeat(f64),
  SetMetronome(bool),

  // --- Tracks --------------------------------------------------------
  /// Create or replace the track occupying `slot`.
  UpsertTrack { slot: TrackSlot, kind: TrackKind, mixer: MixerState },
  RemoveTrack(TrackSlot),
  SetMixer { slot: TrackSlot, mixer: MixerState },
  SetMasterGain(f32),

  /// Replace a track's scheduled notes wholesale. Boxed so the audio
  /// thread moves one pointer; the displaced Vec goes back out as `Trash`.
  SetNotes { slot: TrackSlot, notes: Box<Vec<ScheduledNote>> },

  // --- Sample pool ---------------------------------------------------
  /// Install decoded PCM at `id`. Decoding happened off the audio thread.
  LoadSample { id: SampleId, data: Arc<SampleData> },
  UnloadSample(SampleId),

  // --- Live playing --------------------------------------------------
  /// Immediate note-on, for playing an instrument from the keyboard or
  /// on-screen piano. Bypasses the scheduler entirely.
  NoteOn { slot: TrackSlot, pitch: u8, velocity: f32, sample: SampleId },
  NoteOff { slot: TrackSlot, pitch: u8 },
  /// Sustain pedal: held notes keep sounding through their note-off.
  SetSustain { slot: TrackSlot, held: bool },
  /// Silence everything immediately (panic button).
  AllNotesOff,

  // --- Recording -----------------------------------------------------
  /// Route input capture into `slot` starting at the current position.
  ArmRecording { slot: TrackSlot },
  DisarmRecording,
  /// Monitor input through to the output while armed.
  SetMonitoring(bool),
}

/// Events sent audio thread -> UI thread. Drained by a poller thread that
/// forwards them to the WebView; the audio thread itself never blocks on
/// this channel and never calls into Tauri.
#[derive(Debug)]
pub enum EngineEvent {
  /// Playhead moved. Emitted at a throttled rate (not every callback) so
  /// the UI is not flooded — the audio thread counts down to decide.
  Position(FramePos),
  /// Transport reached the end of the loop region and wrapped.
  Looped,
  /// Per-track peak levels since the last report, for the meters.
  /// Fixed-capacity to avoid allocating in the callback.
  Levels { master: (f32, f32), tracks: Vec<(TrackSlot, f32)> },
  /// Audio dropout: the callback missed its deadline. The count is
  /// cumulative. Surfaced to the user as the spec's "increase your buffer
  /// size" warning rather than silently swallowed.
  Xrun { count: u64 },
  /// Fraction of the available callback time being used, 0.0-1.0.
  Load(f32),
  /// Captured input frames to be written to disk by the poller thread —
  /// the audio thread must never touch the filesystem.
  RecordedChunk { slot: TrackSlot, frames: Box<Vec<f32>> },
  /// Deferred deallocation. The poller thread drops this. See module docs.
  Trash(Trash),
}

/// Ring-buffer capacity for commands. Sized so a burst of UI activity
/// (loading a template project: dozens of tracks, notes, and samples at
/// once) fits without dropping, while staying small enough to stay in
/// cache.
pub const COMMAND_QUEUE_CAPACITY: usize = 1024;

/// Ring-buffer capacity for events. Larger than the command queue because
/// level updates and recorded chunks are frequent, and because a stalled
/// UI thread must not cause the audio thread to start discarding
/// recorded audio.
pub const EVENT_QUEUE_CAPACITY: usize = 4096;

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn mixer_defaults_are_unity_and_audible() {
    // A newly created track must be audible at unit gain and centred —
    // a default that muted or attenuated would make new tracks silently
    // "broken" from the user's point of view.
    let m = MixerState::default();
    assert_eq!(m.gain, 1.0);
    assert_eq!(m.pan, 0.0);
    assert!(!m.muted);
    assert!(!m.soloed);
  }

  #[test]
  fn sample_data_reports_channel_count() {
    let mono = SampleData { channels: vec![vec![0.0; 8]], sample_rate: 48_000, frames: 8 };
    assert_eq!(mono.channel_count(), 1);

    let stereo = SampleData {
      channels: vec![vec![0.0; 8], vec![0.0; 8]],
      sample_rate: 44_100,
      frames: 8,
    };
    assert_eq!(stereo.channel_count(), 2);
  }

  #[test]
  fn commands_are_send_across_the_thread_boundary() {
    // The whole design depends on these crossing threads; a non-Send
    // field slipping into a variant must fail the build, not surprise us
    // at the ring buffer.
    fn assert_send<T: Send>() {}
    assert_send::<EngineCommand>();
    assert_send::<EngineEvent>();
    assert_send::<Trash>();
  }

  #[test]
  fn scheduled_notes_use_absolute_frames() {
    // Frame positions are the audio thread's only time unit — this test
    // pins that contract so a future "start_beats" field cannot quietly
    // push tempo math into the callback.
    let n = ScheduledNote { start: 48_000, end: 96_000, pitch: 60, velocity: 0.8, sample: 3 };
    assert_eq!(n.end - n.start, 48_000);
    assert!(n.velocity > 0.0 && n.velocity <= 1.0);
  }

  #[test]
  fn queue_capacities_are_powers_of_two() {
    // rtrb performs best with power-of-two capacities, and the event
    // queue must be the larger of the two (see the constants' docs).
    assert!(COMMAND_QUEUE_CAPACITY.is_power_of_two());
    assert!(EVENT_QUEUE_CAPACITY.is_power_of_two());
    assert!(EVENT_QUEUE_CAPACITY > COMMAND_QUEUE_CAPACITY);
  }
}
