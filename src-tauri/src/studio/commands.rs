//! Tauri command surface for Studio's native audio engine.
//!
//! ## Why a global engine behind a Mutex, when the audio thread has none
//! There are two different concurrency problems here and they need
//! opposite solutions. The *audio thread* must never lock (see
//! `messages.rs`) — it talks to the rest of the app only through
//! lock-free ring buffers. The *command handlers*, on the other hand, run
//! on Tauri's thread pool, where several IPC calls can land at once, and
//! they share one `EngineHandle` (which owns the ring buffer's producer
//! end, and an SPSC producer genuinely has one writer). A `Mutex` around
//! the handle is correct there: it serializes UI-side writers without the
//! audio thread ever touching it.
//!
//! ## Why the engine starts lazily rather than at app boot
//! Opening an audio device takes exclusive resources and can fail
//! (unplugged interface, exclusive mode taken by another app). Doing that
//! at launch would make an audio problem look like an app problem for
//! every user, including those who never open Studio. So the engine is
//! created on the first Studio command and torn down when Studio closes.
//!
//! ## The event pump
//! The audio thread pushes events (playhead position, levels, xruns) into
//! a ring buffer that nothing would ever drain on its own. `start_engine`
//! spawns a normal thread that drains it on a timer and forwards to the
//! WebView via `app.emit`. That thread is also where deferred drops
//! actually happen: `EngineEvent::Trash` carries memory the audio thread
//! was forbidden to free, and simply letting it fall out of scope here
//! frees it on a thread where `free()` is allowed to block.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

use crate::studio::decode;
use crate::studio::devices::{
  self, AudioConfig, AudioDevice, DriverKind, LatencyEstimate, BUFFER_SIZE_CHOICES,
  SAMPLE_RATE_CHOICES,
};
use crate::studio::engine::EngineHandle;
use crate::studio::messages::{
  EngineCommand, EngineEvent, MixerState, ScheduledNote, TrackKind, TrackSlot,
};
use crate::studio::record::{write_wav_24, Capture};

/// Event name the frontend subscribes to for all engine state.
const EVENT_NAME: &str = "studio:engine";

/// How often the event pump drains the ring buffer. 16ms is roughly one
/// display frame at 60Hz — fast enough that the playhead and meters look
/// continuous, slow enough not to spend a core on IPC.
const PUMP_INTERVAL: Duration = Duration::from_millis(16);

/// The running engine plus everything that must be torn down with it.
struct EngineSlot {
  handle: EngineHandle,
  /// Signals the event pump to exit when the engine stops.
  pump_stop: Arc<AtomicBool>,
}

/// The one engine instance. `None` until Studio is opened.
static ENGINE: Mutex<Option<EngineSlot>> = Mutex::new(None);

/// The in-progress recording, if any.
static CAPTURE: Mutex<Option<Capture>> = Mutex::new(None);

/// Snapshot of the engine's status for the UI's status bar and settings.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineStatus {
  pub running: bool,
  pub config: Option<AudioConfig>,
  pub latency: Option<LatencyEstimate>,
  pub xruns: u64,
  /// Commands dropped because the queue was full. Nonzero means the UI is
  /// outrunning the audio thread; surfaced rather than hidden.
  pub dropped_commands: u64,
}

/// Everything the audio-settings screen needs in one round trip.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioOptions {
  pub drivers: Vec<DriverOption>,
  pub devices: Vec<AudioDevice>,
  pub buffer_sizes: Vec<u32>,
  pub sample_rates: Vec<u32>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DriverOption {
  pub kind: DriverKind,
  pub label: String,
  pub description: String,
}

/// The UI's note shape. Times arrive in frames, already resolved by the
/// TypeScript client — the engine never converts beats to frames itself
/// (see `messages.rs`).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteInput {
  pub start: u64,
  pub end: u64,
  pub pitch: u8,
  pub velocity: f32,
  pub sample: u32,
}

/// Serializable form of `EngineEvent` for the WebView. Deliberately not
/// the same type: `Trash` must never cross to JavaScript (it exists only
/// so Rust can free memory off the audio thread), and `RecordedChunk`
/// carries raw PCM that belongs on disk, not in an IPC message.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
enum UiEvent {
  #[serde(rename_all = "camelCase")]
  Position { frames: u64 },
  Looped,
  #[serde(rename_all = "camelCase")]
  Levels { master_left: f32, master_right: f32 },
  #[serde(rename_all = "camelCase")]
  Xrun { count: u64 },
  #[serde(rename_all = "camelCase")]
  Load { value: f32 },
}

/// Runs a closure against the live engine, or returns a friendly error if
/// Studio's engine is not running.
fn with_engine<T>(f: impl FnOnce(&mut EngineHandle) -> T) -> Result<T, String> {
  let mut guard = ENGINE
    .lock()
    .map_err(|_| "Studio's audio engine is in a bad state. Restart the app.".to_string())?;
  let slot = guard
    .as_mut()
    .ok_or_else(|| "Studio's audio engine is not running. Open Studio first.".to_string())?;
  Ok(f(&mut slot.handle))
}

/// Sends one command to the audio thread.
fn send(cmd: EngineCommand) -> Result<(), String> {
  with_engine(|h| h.send(cmd))
}

// ---------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------

/// Starts the audio engine with `config` (or sensible defaults), replacing
/// any engine already running.
#[tauri::command]
pub fn studio_start_engine(
  app: AppHandle,
  config: Option<AudioConfig>,
) -> Result<EngineStatus, String> {
  let config = config.unwrap_or_default();

  // Stop any existing engine first — two streams on one device fight.
  studio_stop_engine()?;

  let handle = EngineHandle::start(config)?;
  let pump_stop = Arc::new(AtomicBool::new(false));

  {
    let mut guard = ENGINE
      .lock()
      .map_err(|_| "Studio's audio engine is in a bad state. Restart the app.".to_string())?;
    *guard = Some(EngineSlot { handle, pump_stop: Arc::clone(&pump_stop) });
  }

  spawn_event_pump(app, pump_stop);
  studio_engine_status()
}

/// Drains engine events on a normal thread and forwards them to the
/// WebView. Also where deferred drops are freed — see the module docs.
fn spawn_event_pump(app: AppHandle, stop: Arc<AtomicBool>) {
  std::thread::spawn(move || {
    let mut batch: Vec<EngineEvent> = Vec::with_capacity(256);

    while !stop.load(Ordering::Relaxed) {
      {
        let Ok(mut guard) = ENGINE.lock() else { break };
        let Some(slot) = guard.as_mut() else { break };
        slot.handle.drain_events(&mut batch);
      }

      // Collapse the batch: position and level events arrive many times
      // per pump interval and only the newest is meaningful, so emitting
      // every one would flood the WebView for no visual benefit.
      let mut latest_position: Option<u64> = None;
      let mut latest_levels: Option<(f32, f32)> = None;
      let mut latest_load: Option<f32> = None;
      let mut latest_xrun: Option<u64> = None;
      let mut looped = false;

      for event in batch.drain(..) {
        match event {
          EngineEvent::Position(frames) => latest_position = Some(frames),
          EngineEvent::Levels { master, .. } => latest_levels = Some(master),
          EngineEvent::Load(v) => latest_load = Some(v),
          EngineEvent::Xrun { count } => latest_xrun = Some(count),
          EngineEvent::Looped => looped = true,
          // Recorded audio is written by the capture thread, not here.
          EngineEvent::RecordedChunk { .. } => {}
          // Dropping this frees memory the audio thread could not free.
          // The `drop` is the entire point; it is not dead code.
          EngineEvent::Trash(trash) => drop(trash),
        }
      }

      if let Some(frames) = latest_position {
        let _ = app.emit(EVENT_NAME, UiEvent::Position { frames });
      }
      if looped {
        let _ = app.emit(EVENT_NAME, UiEvent::Looped);
      }
      if let Some((l, r)) = latest_levels {
        let _ = app.emit(EVENT_NAME, UiEvent::Levels { master_left: l, master_right: r });
      }
      if let Some(count) = latest_xrun {
        let _ = app.emit(EVENT_NAME, UiEvent::Xrun { count });
      }
      if let Some(value) = latest_load {
        let _ = app.emit(EVENT_NAME, UiEvent::Load { value });
      }

      std::thread::sleep(PUMP_INTERVAL);
    }
  });
}

/// Stops the engine and its event pump. Safe to call when nothing runs.
#[tauri::command]
pub fn studio_stop_engine() -> Result<(), String> {
  let mut guard = ENGINE
    .lock()
    .map_err(|_| "Studio's audio engine is in a bad state. Restart the app.".to_string())?;
  if let Some(slot) = guard.take() {
    slot.pump_stop.store(true, Ordering::Relaxed);
    // Dropping the handle drops the cpal stream, which stops audio.
    drop(slot.handle);
  }
  Ok(())
}

#[tauri::command]
pub fn studio_engine_status() -> Result<EngineStatus, String> {
  let guard = ENGINE
    .lock()
    .map_err(|_| "Studio's audio engine is in a bad state. Restart the app.".to_string())?;
  Ok(match guard.as_ref() {
    Some(slot) => EngineStatus {
      running: true,
      config: Some(slot.handle.config().clone()),
      latency: Some(slot.handle.latency()),
      xruns: slot.handle.xrun_count(),
      dropped_commands: slot.handle.dropped_commands(),
    },
    None => EngineStatus {
      running: false,
      config: None,
      latency: None,
      xruns: 0,
      dropped_commands: 0,
    },
  })
}

// ---------------------------------------------------------------------
// Devices & settings
// ---------------------------------------------------------------------

/// Everything the audio-settings screen needs: drivers this build can
/// actually open, the devices behind `driver`, and the valid choices.
#[tauri::command]
pub fn studio_audio_options(driver: Option<DriverKind>) -> AudioOptions {
  let drivers: Vec<DriverOption> = devices::available_drivers()
    .into_iter()
    .map(|kind| DriverOption {
      kind,
      label: kind.label().to_string(),
      description: kind.description().to_string(),
    })
    .collect();

  // Default to the first (best-latency) driver this build supports.
  let target = driver.or_else(|| drivers.first().map(|d| d.kind));
  let devices = target.map(devices::enumerate).unwrap_or_default();

  AudioOptions {
    drivers,
    devices,
    buffer_sizes: BUFFER_SIZE_CHOICES.to_vec(),
    sample_rates: SAMPLE_RATE_CHOICES.to_vec(),
  }
}

/// Predicts latency for a configuration without opening the device, so
/// the settings screen can update as the user drags the buffer slider.
#[tauri::command]
pub fn studio_estimate_latency(
  buffer_frames: u32,
  sample_rate: u32,
  duplex: bool,
) -> LatencyEstimate {
  LatencyEstimate::from_config(buffer_frames, sample_rate, duplex, false)
}

/// Applies a new audio configuration by restarting the engine. Audio is
/// interrupted briefly; no driver supports changing device, rate, or
/// buffer size on a live stream.
#[tauri::command]
pub fn studio_apply_audio_config(
  app: AppHandle,
  config: AudioConfig,
) -> Result<EngineStatus, String> {
  studio_start_engine(app, Some(config))
}

// ---------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------

#[tauri::command]
pub fn studio_play() -> Result<(), String> {
  send(EngineCommand::Play)
}

#[tauri::command]
pub fn studio_stop() -> Result<(), String> {
  send(EngineCommand::Stop)
}

#[tauri::command]
pub fn studio_stop_and_rewind() -> Result<(), String> {
  send(EngineCommand::StopAndRewind)
}

#[tauri::command]
pub fn studio_seek(frames: u64) -> Result<(), String> {
  send(EngineCommand::Seek(frames))
}

#[tauri::command]
pub fn studio_set_loop(start: Option<u64>, end: Option<u64>) -> Result<(), String> {
  let region = match (start, end) {
    (Some(s), Some(e)) => Some((s, e)),
    _ => None,
  };
  send(EngineCommand::SetLoop(region))
}

#[tauri::command]
pub fn studio_set_tempo(frames_per_beat: f64) -> Result<(), String> {
  send(EngineCommand::SetFramesPerBeat(frames_per_beat))
}

#[tauri::command]
pub fn studio_set_metronome(enabled: bool) -> Result<(), String> {
  send(EngineCommand::SetMetronome(enabled))
}

// ---------------------------------------------------------------------
// Tracks & mixing
// ---------------------------------------------------------------------

#[tauri::command]
pub fn studio_upsert_track(
  slot: TrackSlot,
  kind: TrackKind,
  gain: f32,
  pan: f32,
  muted: bool,
  soloed: bool,
) -> Result<(), String> {
  send(EngineCommand::UpsertTrack {
    slot,
    kind,
    mixer: MixerState { gain, pan, muted, soloed },
  })
}

#[tauri::command]
pub fn studio_remove_track(slot: TrackSlot) -> Result<(), String> {
  send(EngineCommand::RemoveTrack(slot))
}

#[tauri::command]
pub fn studio_set_mixer(
  slot: TrackSlot,
  gain: f32,
  pan: f32,
  muted: bool,
  soloed: bool,
) -> Result<(), String> {
  send(EngineCommand::SetMixer {
    slot,
    mixer: MixerState { gain, pan, muted, soloed },
  })
}

#[tauri::command]
pub fn studio_set_master_gain(gain: f32) -> Result<(), String> {
  send(EngineCommand::SetMasterGain(gain))
}

/// Replaces a track's scheduled notes. Sorted here rather than trusting
/// the caller, because `notes_due` depends on ascending start order to
/// stop scanning early — an unsorted list would silently drop notes.
#[tauri::command]
pub fn studio_set_notes(slot: TrackSlot, notes: Vec<NoteInput>) -> Result<(), String> {
  let mut scheduled: Vec<ScheduledNote> = notes
    .into_iter()
    .map(|n| ScheduledNote {
      start: n.start,
      end: n.end,
      pitch: n.pitch,
      velocity: n.velocity.clamp(0.0, 1.0),
      sample: n.sample,
    })
    .collect();
  scheduled.sort_by_key(|n| n.start);

  send(EngineCommand::SetNotes { slot, notes: Box::new(scheduled) })
}

// ---------------------------------------------------------------------
// Samples
// ---------------------------------------------------------------------

/// Decodes an audio file and installs it in the engine's sample pool.
///
/// Decoding happens here, on a Tauri worker thread, precisely so it never
/// happens on the audio thread — only the finished `Arc<SampleData>`
/// crosses over.
#[tauri::command]
pub fn studio_load_sample(id: u32, path: String) -> Result<(), String> {
  let data = decode::decode_file(&PathBuf::from(&path))?;
  send(EngineCommand::LoadSample { id, data })
}

#[tauri::command]
pub fn studio_unload_sample(id: u32) -> Result<(), String> {
  send(EngineCommand::UnloadSample(id))
}

// ---------------------------------------------------------------------
// Live playing
// ---------------------------------------------------------------------

#[tauri::command]
pub fn studio_note_on(
  slot: TrackSlot,
  pitch: u8,
  velocity: f32,
  sample: u32,
) -> Result<(), String> {
  send(EngineCommand::NoteOn {
    slot,
    pitch,
    velocity: velocity.clamp(0.0, 1.0),
    sample,
  })
}

#[tauri::command]
pub fn studio_note_off(slot: TrackSlot, pitch: u8) -> Result<(), String> {
  send(EngineCommand::NoteOff { slot, pitch })
}

#[tauri::command]
pub fn studio_set_sustain(slot: TrackSlot, held: bool) -> Result<(), String> {
  send(EngineCommand::SetSustain { slot, held })
}

#[tauri::command]
pub fn studio_all_notes_off() -> Result<(), String> {
  send(EngineCommand::AllNotesOff)
}

// ---------------------------------------------------------------------
// Recording & export
// ---------------------------------------------------------------------

/// Recording status polled by the UI for its timer and input meter.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordingStatus {
  pub recording: bool,
  pub seconds: f64,
  /// Input peak since the last poll, 0-1, for the level meter.
  pub peak: f32,
  pub path: Option<String>,
}

/// Starts capturing audio input to `path`.
#[tauri::command]
pub fn studio_start_recording(path: String) -> Result<(), String> {
  let config = {
    let guard = ENGINE
      .lock()
      .map_err(|_| "Studio's audio engine is in a bad state. Restart the app.".to_string())?;
    guard
      .as_ref()
      .ok_or_else(|| "Start Studio's audio engine before recording.".to_string())?
      .handle
      .config()
      .clone()
  };

  let mut guard = CAPTURE
    .lock()
    .map_err(|_| "Studio's recorder is in a bad state. Restart the app.".to_string())?;
  if guard.is_some() {
    return Err("A recording is already in progress.".to_string());
  }

  let capture = Capture::start(&config, &PathBuf::from(&path))?;
  *guard = Some(capture);
  Ok(())
}

/// Stops capture and finalizes the file, returning its path.
#[tauri::command]
pub fn studio_stop_recording() -> Result<Option<String>, String> {
  let capture = {
    let mut guard = CAPTURE
      .lock()
      .map_err(|_| "Studio's recorder is in a bad state. Restart the app.".to_string())?;
    guard.take()
  };

  match capture {
    Some(c) => {
      let path = c.finish()?;
      Ok(Some(path.to_string_lossy().to_string()))
    }
    None => Ok(None),
  }
}

#[tauri::command]
pub fn studio_recording_status() -> Result<RecordingStatus, String> {
  let guard = CAPTURE
    .lock()
    .map_err(|_| "Studio's recorder is in a bad state. Restart the app.".to_string())?;
  Ok(match guard.as_ref() {
    Some(c) => RecordingStatus {
      recording: true,
      seconds: c.seconds_captured(),
      peak: c.take_peak(),
      path: Some(c.path().to_string_lossy().to_string()),
    },
    None => RecordingStatus { recording: false, seconds: 0.0, peak: 0.0, path: None },
  })
}

/// Writes interleaved stereo PCM to a 24-bit WAV. Used by the export
/// path once the mixdown has been rendered.
#[tauri::command]
pub fn studio_export_wav(
  path: String,
  samples: Vec<f32>,
  sample_rate: u32,
  channels: u16,
) -> Result<(), String> {
  write_wav_24(&PathBuf::from(&path), &samples, sample_rate, channels)
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn commands_fail_cleanly_when_engine_is_not_running() {
    // Every transport command must return a readable error rather than
    // panicking when Studio has not been opened yet.
    let _ = studio_stop_engine();
    let err = studio_play().unwrap_err();
    assert!(
      err.contains("not running"),
      "error should tell the user the engine is not running: {err}"
    );
  }

  #[test]
  fn status_reports_stopped_without_an_engine() {
    let _ = studio_stop_engine();
    let status = studio_engine_status().unwrap();
    assert!(!status.running);
    assert!(status.config.is_none());
    assert!(status.latency.is_none());
  }

  #[test]
  fn stopping_a_stopped_engine_is_not_an_error() {
    // Called on every Studio close, including when it never opened.
    assert!(studio_stop_engine().is_ok());
    assert!(studio_stop_engine().is_ok());
  }

  #[test]
  fn audio_options_never_offers_an_unopenable_driver() {
    let opts = studio_audio_options(None);
    assert!(!opts.drivers.is_empty(), "at least one driver must be offered");
    assert!(!opts.buffer_sizes.is_empty());
    assert!(!opts.sample_rates.is_empty());
    for d in &opts.drivers {
      assert!(!d.label.is_empty());
      assert!(!d.description.is_empty(), "every driver needs plain-language help text");
    }
    #[cfg(not(feature = "studio-asio"))]
    assert!(
      !opts.drivers.iter().any(|d| d.kind == DriverKind::Asio),
      "ASIO must not be offered when it cannot be opened in this build"
    );
  }

  #[test]
  fn latency_estimate_matches_the_devices_module() {
    // The settings slider calls this on every drag; it must agree with
    // what the engine will actually report once the stream opens.
    let est = studio_estimate_latency(256, 48_000, true);
    let expected = LatencyEstimate::from_config(256, 48_000, true, false);
    assert_eq!(est.round_trip_ms, expected.round_trip_ms);
    assert_eq!(est.rating, expected.rating);
    assert!(!est.is_measured, "a pre-open estimate must not claim to be measured");
  }

  #[test]
  fn recording_status_is_idle_when_nothing_is_recording() {
    let status = studio_recording_status().unwrap();
    assert!(!status.recording);
    assert_eq!(status.seconds, 0.0);
    assert!(status.path.is_none());
  }

  #[test]
  fn stopping_a_stopped_recording_returns_none_not_an_error() {
    assert_eq!(studio_stop_recording().unwrap(), None);
  }

  #[test]
  fn loading_a_missing_sample_reports_the_filename() {
    let err = studio_load_sample(0, "definitely-not-here.wav".into()).unwrap_err();
    assert!(
      err.contains("definitely-not-here.wav"),
      "the error must name the file: {err}"
    );
  }

  #[test]
  fn export_writes_a_readable_file() {
    let dir = std::env::temp_dir().join("udaan-studio-cmd-test");
    let _ = std::fs::create_dir_all(&dir);
    let path = dir.join("export.wav");

    studio_export_wav(
      path.to_string_lossy().to_string(),
      vec![0.25f32; 400],
      48_000,
      2,
    )
    .expect("export must succeed");

    let reader = hound::WavReader::open(&path).expect("exported file must be readable");
    assert_eq!(reader.spec().channels, 2);
    assert_eq!(reader.spec().sample_rate, 48_000);

    let _ = std::fs::remove_file(&path);
  }
}
