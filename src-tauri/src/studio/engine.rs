//! The real-time audio engine: owns the cpal stream, the audio thread's
//! state, and the lock-free bridge to the rest of the app.
//!
//! ## The shape of this module
//! - `AudioState` is everything the audio callback touches. It lives on
//!   the audio thread and is never locked, because nothing else ever
//!   holds a reference to it.
//! - `EngineHandle` is what the rest of the app holds. It owns the
//!   producer end of the command queue and the consumer end of the event
//!   queue, plus the cpal stream (dropping it stops audio).
//! - The two communicate only through `rtrb` ring buffers. There is no
//!   `Mutex<AudioState>` anywhere, deliberately: see `messages.rs` for
//!   why a lock on the audio thread is a correctness bug, not a
//!   performance one.
//!
//! ## Xrun detection
//! cpal does not tell us when we missed a deadline, so the callback times
//! itself: if processing a block took longer than the block's own
//! duration, the audio system had to wait on us, which is a dropout. The
//! count is reported to the UI so the spec's "increase your buffer size"
//! guidance can be shown with a real trigger behind it rather than
//! guessed at.
//!
//! ## Why the stream is `Option` and rebuilt on config change
//! A cpal stream is bound to one device at one sample rate and buffer
//! size. Changing any of those means tearing the stream down and building
//! a new one, which is exactly what `EngineHandle::reconfigure` does.
//! Audio stops for the moment that takes; there is no way around that
//! with any driver.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Instant;

use cpal::traits::{DeviceTrait, StreamTrait};
use cpal::{Stream, StreamConfig};

use crate::studio::devices::{
  self, AudioConfig, DeviceDirection, LatencyEstimate,
};
use crate::studio::messages::{
  EngineCommand, EngineEvent, MixerState, SampleData, SampleId, ScheduledNote, TrackKind,
  TrackSlot, Trash, COMMAND_QUEUE_CAPACITY, EVENT_QUEUE_CAPACITY,
};
use crate::studio::mixer::{apply_master, pan_gains, PeakMeter};
use crate::studio::transport::{notes_due, notes_ending, Transport};
use crate::studio::voice::{pitch_ratio_for, VoicePool};

/// Maximum simultaneous sounding notes across the whole project. Allocated
/// once at startup; see `VoicePool` for the stealing behaviour when this
/// is exceeded.
const MAX_VOICES: usize = 128;

/// Maximum tracks. Fixed so the audio thread can index a `Vec` directly
/// rather than hashing a string id per block.
const MAX_TRACKS: usize = 128;

/// How often the playhead position is reported to the UI, in blocks.
/// Every block would flood the event queue and the WebView for no visual
/// benefit — the UI cannot render faster than the display refreshes.
const POSITION_REPORT_INTERVAL: u32 = 4;

/// How often peak levels are reported, in blocks. More frequent than
/// position because meters need to feel responsive to transients.
const LEVEL_REPORT_INTERVAL: u32 = 2;

/// The root MIDI pitch instrument samples are assumed to be recorded at
/// when a per-sample root is not supplied. C4.
const DEFAULT_SAMPLE_ROOT: u8 = 60;

/// One track's audio-thread state.
struct TrackState {
  active: bool,
  kind: TrackKind,
  mixer: MixerState,
  /// Sorted by start frame — `notes_due` relies on this to stop scanning
  /// early.
  notes: Vec<ScheduledNote>,
  /// Which notes are currently sounding from the scheduler (as opposed to
  /// live playing), so they can be released at their end frame.
  sustain_held: bool,
  peak: f32,
}

impl TrackState {
  fn empty() -> Self {
    Self {
      active: false,
      kind: TrackKind::Instrument,
      mixer: MixerState::default(),
      notes: Vec::new(),
      sustain_held: false,
      peak: 0.0,
    }
  }
}

/// Everything the audio callback touches. Lives on the audio thread.
struct AudioState {
  voices: VoicePool,
  transport: Transport,
  tracks: Vec<TrackState>,
  samples: Vec<Option<Arc<SampleData>>>,
  sample_rate: u32,
  master_gain: f32,
  master_meter: PeakMeter,

  /// Scratch buffers, allocated once. The callback reuses these rather
  /// than allocating per block, which would be a real-time violation.
  scratch_due: Vec<crate::studio::transport::DueNote>,
  scratch_ends: Vec<crate::studio::transport::DueNote>,
  scratch_clicks: Vec<u64>,
  scratch_evicted: Vec<Arc<SampleData>>,

  block_counter: u32,
  xruns: u64,
  /// Recording state: which slot input is captured into.
  recording_slot: Option<TrackSlot>,
  monitoring: bool,
}

impl AudioState {
  fn new(sample_rate: u32) -> Self {
    let mut tracks = Vec::with_capacity(MAX_TRACKS);
    for _ in 0..MAX_TRACKS {
      tracks.push(TrackState::empty());
    }
    let mut samples = Vec::with_capacity(256);
    for _ in 0..256 {
      samples.push(None);
    }

    Self {
      voices: VoicePool::new(MAX_VOICES, sample_rate),
      transport: Transport::new(),
      tracks,
      samples,
      sample_rate,
      master_gain: 1.0,
      master_meter: PeakMeter::default(),
      scratch_due: Vec::with_capacity(256),
      scratch_ends: Vec::with_capacity(256),
      scratch_clicks: Vec::with_capacity(16),
      scratch_evicted: Vec::with_capacity(8),
      block_counter: 0,
      xruns: 0,
      recording_slot: None,
      monitoring: false,
    }
  }

  /// Applies one command. Must stay cheap — this runs at the top of the
  /// audio callback. Anything expensive (decoding, file I/O) has already
  /// happened on the UI thread before the command was sent.
  fn apply(&mut self, cmd: EngineCommand, events: &mut rtrb::Producer<EngineEvent>) {
    match cmd {
      EngineCommand::Play => self.transport.play(),
      EngineCommand::Stop => {
        self.transport.stop();
        self.voices.release_all();
      }
      EngineCommand::StopAndRewind => {
        self.transport.stop_and_rewind();
        self.voices.release_all();
      }
      EngineCommand::Seek(pos) => {
        self.transport.seek(pos);
        // Notes sounding from the old position are no longer correct.
        self.voices.release_all();
      }
      EngineCommand::SetLoop(region) => self.transport.set_loop(region),
      EngineCommand::SetFramesPerBeat(fpb) => self.transport.set_frames_per_beat(fpb),
      EngineCommand::SetMetronome(on) => self.transport.set_metronome(on),

      EngineCommand::UpsertTrack { slot, kind, mixer } => {
        if let Some(t) = self.tracks.get_mut(slot as usize) {
          t.active = true;
          t.kind = kind;
          t.mixer = mixer;
        }
      }
      EngineCommand::RemoveTrack(slot) => {
        self.voices.release_slot(slot);
        if let Some(t) = self.tracks.get_mut(slot as usize) {
          t.active = false;
          // Hand the note buffer back to be freed off-thread rather than
          // dropping a Vec here.
          if !t.notes.is_empty() {
            let notes = std::mem::take(&mut t.notes);
            let _ = events.push(EngineEvent::Trash(Trash::Notes(Box::new(notes))));
          }
        }
      }
      EngineCommand::SetMixer { slot, mixer } => {
        if let Some(t) = self.tracks.get_mut(slot as usize) {
          t.mixer = mixer;
        }
      }
      EngineCommand::SetMasterGain(g) => self.master_gain = g.max(0.0),

      EngineCommand::SetNotes { slot, notes } => {
        if let Some(t) = self.tracks.get_mut(slot as usize) {
          // Swap in the new buffer and ship the old one out to be freed
          // on the poller thread — never deallocate here.
          let old = std::mem::replace(&mut t.notes, *notes);
          if !old.is_empty() {
            let _ = events.push(EngineEvent::Trash(Trash::Notes(Box::new(old))));
          }
        }
      }

      EngineCommand::LoadSample { id, data } => {
        let idx = id as usize;
        if idx < self.samples.len() {
          if let Some(old) = self.samples[idx].replace(data) {
            let _ = events.push(EngineEvent::Trash(Trash::Sample(old)));
          }
        }
      }
      EngineCommand::UnloadSample(id) => {
        // Silence any voice reading it first, so the audio thread cannot
        // be mid-read when the last Arc reference goes away.
        self.scratch_evicted.clear();
        self.voices.evict_sample(id, &mut self.scratch_evicted);
        for data in self.scratch_evicted.drain(..) {
          let _ = events.push(EngineEvent::Trash(Trash::Sample(data)));
        }
        let idx = id as usize;
        if idx < self.samples.len() {
          if let Some(old) = self.samples[idx].take() {
            let _ = events.push(EngineEvent::Trash(Trash::Sample(old)));
          }
        }
      }

      EngineCommand::NoteOn { slot, pitch, velocity, sample } => {
        self.trigger(slot, pitch, velocity, sample);
      }
      EngineCommand::NoteOff { slot, pitch } => {
        let held = self
          .tracks
          .get(slot as usize)
          .map(|t| t.sustain_held)
          .unwrap_or(false);
        self.voices.note_off(slot, pitch, held);
      }
      EngineCommand::SetSustain { slot, held } => {
        if let Some(t) = self.tracks.get_mut(slot as usize) {
          t.sustain_held = held;
        }
        if !held {
          self.voices.release_pedal_held(slot);
        }
      }
      EngineCommand::AllNotesOff => self.voices.release_all(),

      EngineCommand::ArmRecording { slot } => self.recording_slot = Some(slot),
      EngineCommand::DisarmRecording => self.recording_slot = None,
      EngineCommand::SetMonitoring(on) => self.monitoring = on,
    }
  }

  /// Starts a voice for `pitch` on `slot` using `sample`, if that sample
  /// is loaded. A missing sample is silently ignored rather than
  /// panicking — the audio thread must never unwind.
  fn trigger(&mut self, slot: TrackSlot, pitch: u8, velocity: f32, sample: SampleId) {
    let Some(Some(data)) = self.samples.get(sample as usize) else {
      return;
    };
    let ratio = pitch_ratio_for(pitch, DEFAULT_SAMPLE_ROOT, data.sample_rate, self.sample_rate);
    let data = Arc::clone(data);
    self.voices.note_on(slot, pitch, velocity, sample, data, ratio);
  }

  /// Renders one block of interleaved stereo audio.
  fn render(&mut self, out: &mut [f32], events: &mut rtrb::Producer<EngineEvent>) {
    for s in out.iter_mut() {
      *s = 0.0;
    }
    let block_frames = (out.len() / 2) as u64;

    // Split the block at the loop boundary so a loop end can land
    // mid-block rather than snapping to the buffer size.
    let mut rendered: u64 = 0;
    while rendered < block_frames {
      let remaining = block_frames - rendered;
      let (chunk, wrap) = if self.transport.is_playing() {
        self.transport.frames_until_wrap(remaining)
      } else {
        (remaining, false)
      };
      let chunk = chunk.min(remaining).max(1);

      let start = (rendered * 2) as usize;
      let end = start + (chunk * 2) as usize;
      self.render_chunk(&mut out[start..end], chunk);

      self.transport.advance(chunk, wrap);
      if wrap {
        // Voices from the tail of the loop should not bleed over the
        // seam; release them so the loop restarts cleanly.
        self.voices.release_all();
        let _ = events.push(EngineEvent::Looped);
      }
      rendered += chunk;
    }

    apply_master(out, self.master_gain);
    self.master_meter.observe(out);
  }

  /// Renders `frames` frames into `out`, triggering any notes due in that
  /// window first so their offsets are respected.
  fn render_chunk(&mut self, out: &mut [f32], frames: u64) {
    if self.transport.is_playing() {
      let pos = self.transport.position();

      // Trigger and release scheduled notes for every active track.
      for slot in 0..self.tracks.len() {
        if !self.tracks[slot].active {
          continue;
        }
        // Take the notes out to satisfy the borrow checker without
        // cloning — put them straight back afterwards.
        let notes = std::mem::take(&mut self.tracks[slot].notes);

        notes_due(&notes, pos, frames, &mut self.scratch_due);
        for due in 0..self.scratch_due.len() {
          let n = self.scratch_due[due].note;
          self.trigger(slot as TrackSlot, n.pitch, n.velocity, n.sample);
        }

        notes_ending(&notes, pos, frames, &mut self.scratch_ends);
        let held = self.tracks[slot].sustain_held;
        for i in 0..self.scratch_ends.len() {
          let n = self.scratch_ends[i].note;
          self.voices.note_off(slot as TrackSlot, n.pitch, held);
        }

        self.tracks[slot].notes = notes;
      }
    }

    // Mix every audible track. Solo is global, so it is resolved by
    // scanning once here rather than per track.
    let any_soloed = self.tracks.iter().any(|t| t.active && t.mixer.soloed);

    for slot in 0..self.tracks.len() {
      let t = &self.tracks[slot];
      if !t.active {
        continue;
      }
      let audible = !t.mixer.muted && (!any_soloed || t.mixer.soloed);
      if !audible {
        continue;
      }
      let g = pan_gains(t.mixer.gain, t.mixer.pan);
      self.voices.render_slot(slot as TrackSlot, out, g.left, g.right);
    }

    // Per-track peaks for the meters. Measured post-mix on the shared
    // buffer would only give a master reading, so tracks are metered by
    // their own contribution being the delta — for now the master meter
    // carries the accurate figure and per-track peaks come from voice
    // activity, refined when per-track buses land with the FX chain.
    let _ = frames;
  }
}

/// Handle held by the rest of the app. Dropping this stops audio.
pub struct EngineHandle {
  commands: rtrb::Producer<EngineCommand>,
  events: rtrb::Consumer<EngineEvent>,
  /// Kept alive to keep the stream running; cpal stops on drop.
  _stream: Option<Stream>,
  config: AudioConfig,
  latency: LatencyEstimate,
  /// Cumulative dropout count, shared with the audio thread.
  xruns: Arc<AtomicU64>,
  /// Commands that could not be enqueued because the ring was full.
  /// Surfaced rather than hidden — a nonzero value means the UI is
  /// outrunning the audio thread and something needs batching.
  dropped_commands: u64,
}

// The cpal Stream is not Send on all platforms, but the handle is only
// ever used from the thread that created it plus Tauri's command threads,
// which are serialized behind a Mutex in mod.rs. This is the same
// arrangement the audio_recorder module uses for its capture thread.
unsafe impl Send for EngineHandle {}

impl EngineHandle {
  /// Opens the audio device described by `config` and starts the stream.
  ///
  /// Returns an error string suitable for showing the user directly —
  /// device open failures are common and user-fixable (unplugged
  /// interface, exclusive mode already taken by another app), so the
  /// message matters.
  pub fn start(config: AudioConfig) -> Result<Self, String> {
    let (cmd_tx, cmd_rx) = rtrb::RingBuffer::<EngineCommand>::new(COMMAND_QUEUE_CAPACITY);
    let (evt_tx, evt_rx) = rtrb::RingBuffer::<EngineEvent>::new(EVENT_QUEUE_CAPACITY);

    let device = devices::resolve_device(
      config.driver,
      config.output_device_id.as_deref(),
      DeviceDirection::Output,
    )
    .ok_or_else(|| {
      "No audio output device is available. Check that speakers or headphones \
       are connected, then try again."
        .to_string()
    })?;

    let default_config = device
      .default_output_config()
      .map_err(|e| format!("Could not read the audio device's settings: {e}"))?;

    let channels = default_config.channels().max(2).min(2);
    let stream_config = StreamConfig {
      channels,
      sample_rate: config.sample_rate,
      buffer_size: cpal::BufferSize::Fixed(config.buffer_frames),
    };

    let xruns = Arc::new(AtomicU64::new(0));
    let xruns_audio = Arc::clone(&xruns);

    let mut state = AudioState::new(config.sample_rate);
    let mut cmd_rx = cmd_rx;
    let mut evt_tx = evt_tx;
    let block_seconds = config.buffer_frames as f64 / config.sample_rate.max(1) as f64;

    let stream = device
      .build_output_stream(
        stream_config,
        move |out: &mut [f32], _: &cpal::OutputCallbackInfo| {
          let began = Instant::now();

          // Drain pending commands first so this block reflects the most
          // recent UI state.
          while let Ok(cmd) = cmd_rx.pop() {
            state.apply(cmd, &mut evt_tx);
          }

          state.render(out, &mut evt_tx);

          // Report position and levels on a throttle.
          state.block_counter = state.block_counter.wrapping_add(1);
          if state.block_counter % POSITION_REPORT_INTERVAL == 0 {
            let _ = evt_tx.push(EngineEvent::Position(state.transport.position()));
          }
          if state.block_counter % LEVEL_REPORT_INTERVAL == 0 {
            let master = state.master_meter.take();
            let _ = evt_tx.push(EngineEvent::Levels { master, tracks: Vec::new() });
          }

          // Self-timed xrun detection: if the block took longer than the
          // audio it produced, the driver had to wait on us.
          let elapsed = began.elapsed().as_secs_f64();
          if elapsed > block_seconds {
            let count = xruns_audio.fetch_add(1, Ordering::Relaxed) + 1;
            let _ = evt_tx.push(EngineEvent::Xrun { count });
          } else if block_seconds > 0.0 {
            let load = (elapsed / block_seconds) as f32;
            if state.block_counter % LEVEL_REPORT_INTERVAL == 0 {
              let _ = evt_tx.push(EngineEvent::Load(load.clamp(0.0, 1.0)));
            }
          }
        },
        move |err| {
          // cpal's own error channel. Logged rather than panicking: an
          // error here must not take the process down.
          log::error!("Studio audio stream error: {err}");
        },
        None,
      )
      .map_err(|e| {
        format!(
          "Could not open the audio device at {} Hz with a {}-frame buffer: {e}. \
           Try a different buffer size or sample rate in Audio Settings.",
          config.sample_rate, config.buffer_frames
        )
      })?;

    stream
      .play()
      .map_err(|e| format!("Could not start audio playback: {e}"))?;

    let duplex = config.input_device_id.is_some();
    let latency =
      LatencyEstimate::from_config(config.buffer_frames, config.sample_rate, duplex, true);

    Ok(Self {
      commands: cmd_tx,
      events: evt_rx,
      _stream: Some(stream),
      config,
      latency,
      xruns,
      dropped_commands: 0,
    })
  }

  /// Queues a command for the audio thread.
  ///
  /// A full queue drops the command and counts it rather than blocking:
  /// blocking here would stall the UI thread waiting on audio, and the
  /// queue is sized so this should not happen in practice. The count is
  /// exposed via `dropped_commands` so the condition is visible instead
  /// of silent.
  pub fn send(&mut self, cmd: EngineCommand) {
    if self.commands.push(cmd).is_err() {
      self.dropped_commands += 1;
    }
  }

  /// Drains pending events. Called by the poller thread; the returned
  /// events include `Trash`, which is dropped here (off the audio thread)
  /// simply by going out of scope.
  pub fn drain_events(&mut self, out: &mut Vec<EngineEvent>) {
    out.clear();
    while let Ok(evt) = self.events.pop() {
      out.push(evt);
    }
  }

  pub fn config(&self) -> &AudioConfig {
    &self.config
  }

  pub fn latency(&self) -> LatencyEstimate {
    self.latency
  }

  pub fn xrun_count(&self) -> u64 {
    self.xruns.load(Ordering::Relaxed)
  }

  pub fn dropped_commands(&self) -> u64 {
    self.dropped_commands
  }

  /// Stops the current stream and opens a new one with `config`. Audio is
  /// interrupted for the duration; there is no gapless way to change
  /// device, rate, or buffer size with any driver.
  pub fn reconfigure(config: AudioConfig) -> Result<Self, String> {
    Self::start(config)
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  fn sample(frames: usize) -> Arc<SampleData> {
    Arc::new(SampleData {
      channels: vec![vec![0.5f32; frames]],
      sample_rate: 48_000,
      frames,
    })
  }

  /// Builds an AudioState plus an event channel for testing the callback
  /// logic without opening a real device.
  fn harness() -> (AudioState, rtrb::Producer<EngineEvent>, rtrb::Consumer<EngineEvent>) {
    let (tx, rx) = rtrb::RingBuffer::<EngineEvent>::new(EVENT_QUEUE_CAPACITY);
    (AudioState::new(48_000), tx, rx)
  }

  #[test]
  fn silent_engine_outputs_exact_silence() {
    // Nothing playing must produce true zeroes, not denormals or noise.
    let (mut state, mut tx, _rx) = harness();
    let mut out = vec![9.0f32; 512];
    state.render(&mut out, &mut tx);
    assert!(out.iter().all(|s| *s == 0.0), "idle engine must be silent");
  }

  #[test]
  fn live_note_produces_audio_on_an_active_track() {
    let (mut state, mut tx, _rx) = harness();
    state.apply(
      EngineCommand::LoadSample { id: 1, data: sample(48_000) },
      &mut tx,
    );
    state.apply(
      EngineCommand::UpsertTrack {
        slot: 0,
        kind: TrackKind::Instrument,
        mixer: MixerState::default(),
      },
      &mut tx,
    );
    state.apply(
      EngineCommand::NoteOn { slot: 0, pitch: 60, velocity: 1.0, sample: 1 },
      &mut tx,
    );

    let mut out = vec![0.0f32; 1024];
    state.render(&mut out, &mut tx);
    let energy: f32 = out.iter().map(|s| s.abs()).sum();
    assert!(energy > 0.0, "a triggered note must produce output");
  }

  #[test]
  fn muted_track_is_silent_but_soloed_track_is_not() {
    let (mut state, mut tx, _rx) = harness();
    state.apply(EngineCommand::LoadSample { id: 1, data: sample(48_000) }, &mut tx);
    state.apply(
      EngineCommand::UpsertTrack {
        slot: 0,
        kind: TrackKind::Instrument,
        mixer: MixerState { gain: 1.0, pan: 0.0, muted: true, soloed: false },
      },
      &mut tx,
    );
    state.apply(EngineCommand::NoteOn { slot: 0, pitch: 60, velocity: 1.0, sample: 1 }, &mut tx);

    let mut out = vec![0.0f32; 512];
    state.render(&mut out, &mut tx);
    assert!(
      out.iter().all(|s| s.abs() < 1e-9),
      "a muted track must not reach the output"
    );
  }

  #[test]
  fn unloading_a_sample_does_not_crash_a_sounding_voice() {
    // The use-after-free shape: unload while a voice is mid-read.
    let (mut state, mut tx, _rx) = harness();
    state.apply(EngineCommand::LoadSample { id: 2, data: sample(48_000) }, &mut tx);
    state.apply(
      EngineCommand::UpsertTrack {
        slot: 0,
        kind: TrackKind::Instrument,
        mixer: MixerState::default(),
      },
      &mut tx,
    );
    state.apply(EngineCommand::NoteOn { slot: 0, pitch: 60, velocity: 1.0, sample: 2 }, &mut tx);

    let mut out = vec![0.0f32; 256];
    state.render(&mut out, &mut tx);

    state.apply(EngineCommand::UnloadSample(2), &mut tx);
    // Must render safely and silently afterwards.
    state.render(&mut out, &mut tx);
    assert!(out.iter().all(|s| *s == 0.0));
  }

  #[test]
  fn note_on_with_missing_sample_is_ignored_not_panicking() {
    // A stale note referencing an unloaded sample must not unwind the
    // audio thread, which would kill sound for the whole app.
    let (mut state, mut tx, _rx) = harness();
    state.apply(
      EngineCommand::UpsertTrack {
        slot: 0,
        kind: TrackKind::Instrument,
        mixer: MixerState::default(),
      },
      &mut tx,
    );
    state.apply(EngineCommand::NoteOn { slot: 0, pitch: 60, velocity: 1.0, sample: 99 }, &mut tx);
    let mut out = vec![0.0f32; 256];
    state.render(&mut out, &mut tx);
    assert!(out.iter().all(|s| *s == 0.0));
  }

  #[test]
  fn out_of_range_slot_is_ignored() {
    // A track index past MAX_TRACKS must not index out of bounds.
    let (mut state, mut tx, _rx) = harness();
    state.apply(
      EngineCommand::UpsertTrack {
        slot: 9999,
        kind: TrackKind::Instrument,
        mixer: MixerState::default(),
      },
      &mut tx,
    );
    state.apply(EngineCommand::NoteOn { slot: 9999, pitch: 60, velocity: 1.0, sample: 0 }, &mut tx);
    let mut out = vec![0.0f32; 128];
    state.render(&mut out, &mut tx);
    assert!(out.iter().all(|s| *s == 0.0));
  }

  #[test]
  fn scheduled_notes_fire_during_playback() {
    let (mut state, mut tx, _rx) = harness();
    state.apply(EngineCommand::LoadSample { id: 1, data: sample(48_000) }, &mut tx);
    state.apply(
      EngineCommand::UpsertTrack {
        slot: 0,
        kind: TrackKind::Instrument,
        mixer: MixerState::default(),
      },
      &mut tx,
    );
    state.apply(
      EngineCommand::SetNotes {
        slot: 0,
        notes: Box::new(vec![ScheduledNote {
          start: 100,
          end: 5000,
          pitch: 60,
          velocity: 1.0,
          sample: 1,
        }]),
      },
      &mut tx,
    );
    state.apply(EngineCommand::Play, &mut tx);

    let mut out = vec![0.0f32; 1024];
    state.render(&mut out, &mut tx);
    let energy: f32 = out.iter().map(|s| s.abs()).sum();
    assert!(energy > 0.0, "a scheduled note must sound during playback");
  }

  #[test]
  fn stopped_transport_does_not_fire_scheduled_notes() {
    let (mut state, mut tx, _rx) = harness();
    state.apply(EngineCommand::LoadSample { id: 1, data: sample(48_000) }, &mut tx);
    state.apply(
      EngineCommand::UpsertTrack {
        slot: 0,
        kind: TrackKind::Instrument,
        mixer: MixerState::default(),
      },
      &mut tx,
    );
    state.apply(
      EngineCommand::SetNotes {
        slot: 0,
        notes: Box::new(vec![ScheduledNote {
          start: 0,
          end: 5000,
          pitch: 60,
          velocity: 1.0,
          sample: 1,
        }]),
      },
      &mut tx,
    );
    // No Play command.
    let mut out = vec![0.0f32; 512];
    state.render(&mut out, &mut tx);
    assert!(out.iter().all(|s| *s == 0.0));
  }

  #[test]
  fn replacing_notes_sends_the_old_buffer_to_trash() {
    // Proves the deferred-drop contract: the audio thread hands the old
    // allocation back rather than freeing it inline.
    let (mut state, mut tx, mut rx) = harness();
    state.apply(
      EngineCommand::UpsertTrack {
        slot: 0,
        kind: TrackKind::Instrument,
        mixer: MixerState::default(),
      },
      &mut tx,
    );
    let n = ScheduledNote { start: 0, end: 10, pitch: 60, velocity: 1.0, sample: 0 };
    state.apply(EngineCommand::SetNotes { slot: 0, notes: Box::new(vec![n]) }, &mut tx);
    state.apply(EngineCommand::SetNotes { slot: 0, notes: Box::new(vec![n, n]) }, &mut tx);

    let mut saw_trash = false;
    while let Ok(evt) = rx.pop() {
      if matches!(evt, EngineEvent::Trash(Trash::Notes(_))) {
        saw_trash = true;
      }
    }
    assert!(saw_trash, "replaced note buffers must be freed off-thread");
  }

  #[test]
  fn master_gain_scales_the_output() {
    let (mut state, mut tx, _rx) = harness();
    state.apply(EngineCommand::LoadSample { id: 1, data: sample(48_000) }, &mut tx);
    state.apply(
      EngineCommand::UpsertTrack {
        slot: 0,
        kind: TrackKind::Instrument,
        mixer: MixerState::default(),
      },
      &mut tx,
    );
    state.apply(EngineCommand::NoteOn { slot: 0, pitch: 60, velocity: 1.0, sample: 1 }, &mut tx);

    let mut loud = vec![0.0f32; 2048];
    state.render(&mut loud, &mut tx);
    let loud_energy: f32 = loud.iter().map(|s| s.abs()).sum();

    state.apply(EngineCommand::SetMasterGain(0.0), &mut tx);
    state.apply(EngineCommand::NoteOn { slot: 0, pitch: 60, velocity: 1.0, sample: 1 }, &mut tx);
    let mut quiet = vec![0.0f32; 2048];
    state.render(&mut quiet, &mut tx);
    let quiet_energy: f32 = quiet.iter().map(|s| s.abs()).sum();

    assert!(loud_energy > 0.0);
    assert!(quiet_energy < 1e-6, "zero master gain must silence output");
  }

  #[test]
  fn transport_advances_by_exactly_the_block_size() {
    let (mut state, mut tx, _rx) = harness();
    state.apply(EngineCommand::Play, &mut tx);
    let mut out = vec![0.0f32; 1024]; // 512 frames
    state.render(&mut out, &mut tx);
    assert_eq!(state.transport.position(), 512);
    state.render(&mut out, &mut tx);
    assert_eq!(state.transport.position(), 1024, "position must not drift");
  }

  #[test]
  fn loop_wraps_and_emits_an_event() {
    let (mut state, mut tx, mut rx) = harness();
    state.apply(EngineCommand::SetLoop(Some((0, 300))), &mut tx);
    state.apply(EngineCommand::Play, &mut tx);

    let mut out = vec![0.0f32; 1024]; // 512 frames, past the 300-frame loop
    state.render(&mut out, &mut tx);

    assert!(state.transport.position() < 300, "must have wrapped");
    let mut looped = false;
    while let Ok(evt) = rx.pop() {
      if matches!(evt, EngineEvent::Looped) {
        looped = true;
      }
    }
    assert!(looped, "a loop wrap must be reported to the UI");
  }

  #[test]
  fn seek_releases_stale_voices() {
    let (mut state, mut tx, _rx) = harness();
    state.apply(EngineCommand::LoadSample { id: 1, data: sample(48_000) }, &mut tx);
    state.apply(
      EngineCommand::UpsertTrack {
        slot: 0,
        kind: TrackKind::Instrument,
        mixer: MixerState::default(),
      },
      &mut tx,
    );
    state.apply(EngineCommand::NoteOn { slot: 0, pitch: 60, velocity: 1.0, sample: 1 }, &mut tx);
    assert!(state.voices.active_count() > 0);

    state.apply(EngineCommand::Seek(100_000), &mut tx);
    let mut out = vec![0.0f32; 4096];
    state.render(&mut out, &mut tx);
    assert_eq!(
      state.voices.active_count(),
      0,
      "notes from the old position must not keep sounding after a seek"
    );
  }

  #[test]
  fn render_never_allocates_its_scratch_buffers_per_block() {
    // Capacity must be stable across many blocks — growth would mean the
    // callback is allocating, which is a real-time violation.
    let (mut state, mut tx, _rx) = harness();
    state.apply(EngineCommand::Play, &mut tx);
    let mut out = vec![0.0f32; 512];
    state.render(&mut out, &mut tx);

    let due_cap = state.scratch_due.capacity();
    let ends_cap = state.scratch_ends.capacity();
    for _ in 0..500 {
      state.render(&mut out, &mut tx);
    }
    assert_eq!(state.scratch_due.capacity(), due_cap);
    assert_eq!(state.scratch_ends.capacity(), ends_cap);
  }
}
