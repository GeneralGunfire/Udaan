//! System-audio ("loopback") recorder: captures whatever is currently
//! playing through the default output device — game audio, video, music,
//! calls — and NOT the microphone, encoding directly to MP3 as it captures.
//!
//! ## Capture approach
//! WASAPI loopback capture via the `wasapi` crate: opening the default
//! **Render** (output) device and initializing its `AudioClient` with
//! `Direction::Capture` makes the crate set `AUDCLNT_STREAMFLAGS_LOOPBACK`
//! internally (see `wasapi::api::AudioClient::initialize_client`, matched
//! on `(Direction::Render, Direction::Capture, ShareMode::Shared)`). This is
//! a genuine OS/audio-engine feature — Microsoft's own loopback-recording
//! docs confirm it works "regardless of whether the audio hardware contains
//! a loopback device" — so **no virtual audio cable/driver is required**.
//! The device's real mix format is queried via `get_mixformat()` rather than
//! assumed, since it can vary by device/system (commonly float32 @ 44.1kHz
//! or 48kHz stereo, but never hardcoded here).
//!
//! ## Encoding approach: real-time streaming, not post-process
//! PCM frames are encoded to MP3 and written to disk AS THEY ARRIVE, rather
//! than buffering raw PCM in memory and encoding once at the end. Two
//! reasons: (1) MP3 is a frame-based streaming format, so a file that's
//! flushed incrementally already contains complete, independently-decodable
//! frames up to whatever was written — an abrupt crash/kill leaves a
//! shorter-than-intended but genuinely PLAYABLE file, not a corrupted one;
//! (2) a long recording never needs to hold its entire raw PCM history in
//! memory. The output file handle is explicitly flushed after every encoded
//! chunk (see `flush()` calls below) specifically for that crash-safety
//! guarantee — this is the "no room for errors" requirement from the spec.
//!
//! ## Silence auto-stop
//! Every captured chunk's RMS level (in dBFS) is tracked; if the level
//! stays below `SILENCE_THRESHOLD_DBFS` continuously for
//! `SILENCE_TIMEOUT` (3 minutes), the recorder stops and finalizes itself
//! exactly as a manual stop would, then emits an event explaining why.
//! -50dBFS was chosen as the threshold after considering both failure
//! modes: quiet-but-real content (a soft dialogue scene, ambient game
//! audio) commonly still sits in the -35..-45dBFS range on modern
//! loudness-normalized media, so -50dBFS sits below that with real margin
//! against false stops, while genuine silence (nothing playing, or a
//! muted/paused source) measures far lower, close to the noise floor.

mod store;

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

pub use store::RecorderSettings;
use store::Store;

/// -50dBFS: see the module doc comment above for the reasoning.
const SILENCE_THRESHOLD_DBFS: f32 = -50.0;
/// 3 minutes, per the feature spec.
const SILENCE_TIMEOUT: Duration = Duration::from_secs(180);
/// High-quality VBR target — the spec asked for "256-320kbps VBR or a
/// clearly justified equivalent." LAME's VBR quality 0 (best) targets
/// roughly this range adaptively per-frame based on actual content
/// complexity, which is a better fit for arbitrary system audio (games,
/// calls, music alike) than a fixed CBR bitrate would be.
const VBR_QUALITY: mp3lame_encoder::Quality = mp3lame_encoder::Quality::Best;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RecorderState {
  Idle,
  Recording,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind")]
pub enum RecorderEvent {
  #[serde(rename = "started")]
  Started { path: String },
  #[serde(rename = "progress")]
  Progress { elapsed_seconds: u64, level_dbfs: f32 },
  #[serde(rename = "stopped")]
  Stopped { path: String, reason: StopReason },
  #[serde(rename = "error")]
  Error { message: String },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StopReason {
  Manual,
  Silence,
}

#[derive(Debug, Clone, Serialize)]
pub struct RecorderStatus {
  pub state: RecorderState,
  #[serde(rename = "elapsedSeconds")]
  pub elapsed_seconds: u64,
}

const EVENT_NAME: &str = "audio-recorder:event";

struct RecorderThread {
  handle: std::thread::JoinHandle<()>,
  stop_flag: Arc<AtomicBool>,
}

static RECORDER: Mutex<Option<RecorderThread>> = Mutex::new(None);
static ELAPSED_SECONDS: AtomicU64 = AtomicU64::new(0);

pub struct AudioRecorderState {
  store: Arc<Store>,
}

pub fn init(app: &AppHandle) -> Result<AudioRecorderState, String> {
  use tauri::Manager;
  let data_dir = app
    .path()
    .app_data_dir()
    .map_err(|e| format!("Failed to resolve app data dir: {e}"))?;
  std::fs::create_dir_all(&data_dir).map_err(|e| format!("Failed to create app data dir: {e}"))?;
  let db_path = data_dir.join("audio_recorder.sqlite3");
  let store = Arc::new(Store::open(db_path).map_err(|e| format!("Failed to open audio_recorder store: {e}"))?);
  Ok(AudioRecorderState { store })
}

fn is_recording() -> bool {
  RECORDER.lock().unwrap().is_some()
}

#[tauri::command(async)]
pub fn audio_recorder_status() -> RecorderStatus {
  RecorderStatus {
    state: if is_recording() { RecorderState::Recording } else { RecorderState::Idle },
    elapsed_seconds: ELAPSED_SECONDS.load(Ordering::Relaxed),
  }
}

#[tauri::command(async)]
pub fn audio_recorder_start(app: AppHandle) -> Result<RecorderStatus, String> {
  let mut guard = RECORDER.lock().unwrap();
  if guard.is_some() {
    return Ok(RecorderStatus { state: RecorderState::Recording, elapsed_seconds: ELAPSED_SECONDS.load(Ordering::Relaxed) });
  }

  let downloads_dir = dirs::download_dir().ok_or_else(|| "Could not resolve the Downloads folder".to_string())?;
  std::fs::create_dir_all(&downloads_dir).map_err(|e| format!("Failed to access Downloads folder: {e}"))?;
  let filename = format!("Udaan Recording {}.mp3", chrono::Local::now().format("%Y-%m-%d %H-%M-%S"));
  let out_path = downloads_dir.join(filename);

  ELAPSED_SECONDS.store(0, Ordering::Relaxed);
  let stop_flag = Arc::new(AtomicBool::new(false));
  let stop_flag_thread = stop_flag.clone();
  let out_path_thread = out_path.clone();
  let app_thread = app.clone();

  let handle = std::thread::Builder::new()
    .name("audio-recorder".to_string())
    .spawn(move || {
      if let Err(err) = win::run_capture_loop(&app_thread, &out_path_thread, stop_flag_thread) {
        let _ = app_thread.emit(EVENT_NAME, RecorderEvent::Error { message: err });
      }
      // Always clear the slot on the way out, however the loop ended
      // (manual stop, silence auto-stop, or a hard error) — otherwise a
      // failed start would permanently wedge the recorder in "busy".
      *RECORDER.lock().unwrap() = None;
    })
    .map_err(|e| format!("Failed to start recorder thread: {e}"))?;

  *guard = Some(RecorderThread { handle, stop_flag });
  drop(guard);

  Ok(RecorderStatus { state: RecorderState::Recording, elapsed_seconds: 0 })
}

#[tauri::command(async)]
pub fn audio_recorder_stop() -> Result<RecorderStatus, String> {
  let recorder = RECORDER.lock().unwrap().take();
  if let Some(recorder) = recorder {
    recorder.stop_flag.store(true, Ordering::Relaxed);
    // Join on a background thread rather than blocking this command's
    // caller — the capture loop can take up to one buffer period to
    // notice the flag and finalize the MP3 (flush + write final frames),
    // and the frontend already treats the eventual `stopped` event as the
    // real completion signal, not this command's return.
    std::thread::spawn(move || {
      let _ = recorder.handle.join();
    });
  }
  Ok(RecorderStatus { state: RecorderState::Idle, elapsed_seconds: ELAPSED_SECONDS.load(Ordering::Relaxed) })
}

#[tauri::command(async)]
pub fn audio_recorder_open_downloads() -> Result<(), String> {
  let downloads_dir = dirs::download_dir().ok_or_else(|| "Could not resolve the Downloads folder".to_string())?;
  opener::open(downloads_dir).map_err(|e| format!("Failed to open Downloads folder: {e}"))
}

/// Renames a just-finished recording on disk to a user-chosen name,
/// keeping the same directory and `.mp3` extension. Called right after a
/// `stopped` event, once the file is fully flushed/finalized — this is a
/// plain filesystem rename, not a re-encode, so it's instant regardless of
/// how long the recording was. Refuses to clobber an existing file with
/// the target name (matches the same collision-avoidance convention as
/// audio_library_import_file) rather than silently overwriting something.
#[tauri::command(async)]
pub fn audio_recorder_rename(old_path: String, new_name: String) -> Result<String, String> {
  let old = std::path::Path::new(&old_path);
  let dir = old.parent().ok_or_else(|| "Recording path has no parent directory".to_string())?;

  let trimmed = new_name.trim();
  if trimmed.is_empty() {
    return Err("Name cannot be empty".to_string());
  }
  // Strip characters Windows filenames can't contain rather than erroring
  // — a pasted/typed name with e.g. a colon shouldn't block saving.
  let sanitized: String = trimmed.chars().filter(|c| !r#"<>:"/\|?*"#.contains(*c)).collect();
  if sanitized.is_empty() {
    return Err("Name contains no valid characters".to_string());
  }

  let mut new_path = dir.join(format!("{sanitized}.mp3"));
  if new_path == old {
    return Ok(old_path);
  }
  let mut n = 1;
  while new_path.exists() {
    new_path = dir.join(format!("{sanitized} ({n}).mp3"));
    n += 1;
  }

  std::fs::rename(old, &new_path).map_err(|e| format!("Failed to rename recording: {e}"))?;
  Ok(new_path.to_string_lossy().to_string())
}

#[tauri::command(async)]
pub fn audio_recorder_get_settings(state: tauri::State<AudioRecorderState>) -> Result<RecorderSettings, String> {
  state.store.get_settings().map_err(|e| e.to_string())
}

#[tauri::command(async)]
pub fn audio_recorder_save_settings(state: tauri::State<AudioRecorderState>, settings: RecorderSettings) -> Result<(), String> {
  state.store.save_settings(&settings).map_err(|e| e.to_string())
}

#[cfg(target_os = "windows")]
mod win {
  use super::*;
  use mp3lame_encoder::{Bitrate, Builder, DualPcm, FlushNoGap, MonoPcm};
  use std::fs::File;
  use std::io::{BufWriter, Write};
  use wasapi::{initialize_mta, get_default_device, Direction, SampleType, StreamMode};

  /// One capture "tick" worth of samples, deinterleaved to per-channel f32 —
  /// LAME's DualPcm input wants separate left/right slices, while WASAPI
  /// hands back interleaved bytes.
  struct Deinterleaved {
    left: Vec<f32>,
    right: Vec<f32>,
  }

  fn deinterleave_f32(bytes: &[u8], channels: usize) -> Deinterleaved {
    let sample_count = bytes.len() / 4 / channels.max(1);
    let mut left = Vec::with_capacity(sample_count);
    let mut right = Vec::with_capacity(sample_count);
    for frame in bytes.chunks_exact(4 * channels.max(1)) {
      let l = f32::from_ne_bytes([frame[0], frame[1], frame[2], frame[3]]);
      left.push(l);
      if channels >= 2 {
        let r = f32::from_ne_bytes([frame[4], frame[5], frame[6], frame[7]]);
        right.push(r);
      } else {
        right.push(l);
      }
    }
    Deinterleaved { left, right }
  }

  /// RMS level of this chunk in dBFS (0dBFS = full scale). Silence
  /// (empty/all-zero chunk) maps to a very negative floor rather than
  /// -infinity, so downstream comparisons stay well-defined.
  fn rms_dbfs(samples: &[f32]) -> f32 {
    if samples.is_empty() {
      return -120.0;
    }
    let sum_sq: f64 = samples.iter().map(|s| (*s as f64) * (*s as f64)).sum();
    let rms = (sum_sq / samples.len() as f64).sqrt();
    if rms <= 1e-9 {
      -120.0
    } else {
      20.0 * rms.log10() as f32
    }
  }

  pub fn run_capture_loop(app: &AppHandle, out_path: &PathBuf, stop_flag: Arc<AtomicBool>) -> Result<(), String> {
    initialize_mta().ok().map_err(|e| format!("Failed to initialize COM (MTA): {e:?}"))?;

    let device = get_default_device(&Direction::Render).map_err(|e| format!("No default output device: {e}"))?;
    let mut audio_client = device.get_iaudioclient().map_err(|e| format!("Failed to open audio client: {e}"))?;

    // Query the device's REAL mix format rather than assuming one — see
    // module doc comment. Loopback capture always hands back whatever the
    // render device is actually configured for.
    let mix_format = audio_client.get_mixformat().map_err(|e| format!("Failed to query device mix format: {e}"))?;
    let sample_rate = mix_format.get_samplespersec();
    let channels = mix_format.get_nchannels() as usize;
    if mix_format.get_subformat().map_err(|e| e.to_string())? as u8 != SampleType::Float as u8 {
      // Loopback mix format is float32 on effectively all modern Windows
      // systems (WASAPI's shared-mode engine mixes internally in float);
      // fail loudly rather than silently mis-decode an unexpected format.
      return Err("Unsupported audio format: expected 32-bit float PCM from the loopback device".to_string());
    }

    let (_def_time, min_time) = audio_client.get_device_period().map_err(|e| format!("Failed to query device period: {e}"))?;
    let mode = StreamMode::EventsShared { autoconvert: true, buffer_duration_hns: min_time };
    audio_client
      .initialize_client(&mix_format, &Direction::Capture, &mode)
      .map_err(|e| format!("Failed to initialize loopback capture: {e}"))?;

    let h_event = audio_client.set_get_eventhandle().map_err(|e| format!("Failed to get capture event handle: {e}"))?;
    let capture_client = audio_client.get_audiocaptureclient().map_err(|e| format!("Failed to get capture client: {e}"))?;

    // MP3 encoder, configured for the ACTUAL device sample rate/channel
    // count queried above (never hardcoded), high-quality VBR.
    let mut mp3_builder = Builder::new().ok_or_else(|| "Failed to create LAME encoder".to_string())?;
    mp3_builder.set_sample_rate(sample_rate).map_err(|e| format!("LAME: {e}"))?;
    mp3_builder.set_num_channels(channels.min(2) as u8).map_err(|e| format!("LAME: {e}"))?;
    mp3_builder.set_brate(Bitrate::Kbps320).map_err(|e| format!("LAME: {e}"))?;
    mp3_builder.set_vbr_mode(mp3lame_encoder::VbrMode::Mtrh).map_err(|e| format!("LAME: {e}"))?;
    mp3_builder.set_vbr_quality(VBR_QUALITY).map_err(|e| format!("LAME: {e}"))?;
    let mut encoder = mp3_builder.build().map_err(|e| format!("Failed to build LAME encoder: {e}"))?;

    let file = File::create(out_path).map_err(|e| format!("Failed to create output file: {e}"))?;
    let mut writer = BufWriter::new(file);

    // Byte deque the crate's own read_from_device_to_deque() API appends
    // whole captured packets into — the proven idiom from wasapi's own
    // examples (examples/record.rs), rather than a manual GetCurrentPadding
    // + fixed-size-buffer read which is easy to get subtly wrong around
    // partial frames.
    let mut sample_queue: std::collections::VecDeque<u8> = std::collections::VecDeque::new();
    let block_align = mix_format.get_blockalign() as usize;
    // One capture chunk's worth of frames to hand the encoder per
    // iteration — arbitrary but small enough to keep encode latency (and
    // thus level-meter/progress responsiveness) low.
    const CHUNK_FRAMES: usize = 4096;

    let mut mp3_out: Vec<u8> = Vec::with_capacity(64 * 1024);
    let started = Instant::now();
    let mut last_second_reported = 0u64;
    let mut last_level = -120.0f32;
    let mut silence_since: Option<Instant> = None;
    let mut stop_reason = StopReason::Manual;

    let _ = app.emit(EVENT_NAME, RecorderEvent::Started { path: out_path.to_string_lossy().to_string() });
    audio_client.start_stream().map_err(|e| format!("Failed to start capture stream: {e}"))?;

    'capture: loop {
      if stop_flag.load(Ordering::Relaxed) {
        break;
      }

      // 1s timeout: if the device produces no data at all for a full
      // second (e.g. the endpoint was unplugged/disabled mid-recording),
      // loop back around to re-check the stop flag rather than blocking
      // forever — the silence auto-stop logic below still applies to
      // whatever data DOES arrive. Even on a timeout (no new audio), the
      // elapsed-time tick below still needs to run — the displayed timer
      // must track real wall-clock recording time, not "time since audio
      // last arrived," otherwise a stall/underrun on the capture side
      // makes the on-screen timer visibly freeze despite recording still
      // actually running.
      let got_event = h_event.wait_for_event(1000).is_ok();
      if got_event {
        if let Err(e) = capture_client.read_from_device_to_deque(&mut sample_queue) {
          let _ = app.emit(EVENT_NAME, RecorderEvent::Error { message: format!("Capture read failed: {e}") });
          break;
        }
      }

      // Elapsed-time/progress tick — driven purely by wall-clock time via
      // `started.elapsed()`, independent of the inner encode loop below
      // (which only runs once enough audio has actually accumulated into
      // full CHUNK_FRAMES-sized chunks). Decoupling these is what fixes
      // the timer not ticking in lockstep with real recording duration.
      {
        let elapsed = started.elapsed().as_secs();
        if elapsed != last_second_reported {
          last_second_reported = elapsed;
          ELAPSED_SECONDS.store(elapsed, Ordering::Relaxed);
          let _ = app.emit(EVENT_NAME, RecorderEvent::Progress { elapsed_seconds: elapsed, level_dbfs: last_level });
        }
      }

      while sample_queue.len() >= block_align * CHUNK_FRAMES {
        let mut chunk = vec![0u8; block_align * CHUNK_FRAMES];
        for byte in chunk.iter_mut() {
          *byte = sample_queue.pop_front().unwrap();
        }
        let deinterleaved = deinterleave_f32(&chunk, channels);
        let level = rms_dbfs(&deinterleaved.left);

        let encode_result = if channels >= 2 {
          let input = DualPcm { left: &deinterleaved.left, right: &deinterleaved.right };
          encoder.encode_to_vec(input, &mut mp3_out)
        } else {
          encoder.encode_to_vec(MonoPcm(&deinterleaved.left), &mut mp3_out)
        };

        match encode_result {
          Ok(_) => {
            if !mp3_out.is_empty() {
              if let Err(e) = writer.write_all(&mp3_out) {
                let _ = app.emit(EVENT_NAME, RecorderEvent::Error { message: format!("Failed to write recording: {e}") });
                break 'capture;
              }
              // Flush after every chunk — the whole point of streaming
              // encode over buffer-then-encode: a crash/kill leaves
              // everything written so far as valid, playable MP3 frames
              // rather than losing an in-memory buffer entirely.
              let _ = writer.flush();
              mp3_out.clear();
            }
          }
          Err(e) => {
            let _ = app.emit(EVENT_NAME, RecorderEvent::Error { message: format!("MP3 encode failed: {e}") });
            break 'capture;
          }
        }

        // Silence auto-stop tracking.
        if level < SILENCE_THRESHOLD_DBFS {
          let since = silence_since.get_or_insert_with(Instant::now);
          if since.elapsed() >= SILENCE_TIMEOUT {
            stop_reason = StopReason::Silence;
            break 'capture;
          }
        } else {
          silence_since = None;
        }

        // Remembered for the wall-clock-driven progress tick above (which
        // runs once per outer-loop iteration, not per encoded chunk) so
        // the emitted level reflects the most recent real measurement
        // rather than being recomputed from stale/empty data.
        last_level = level;
      }
    }

    let _ = audio_client.stop_stream();

    // Final flush: encode any samples LAME has buffered internally (it
    // deliberately holds back partial frames until it has enough for a
    // full MP3 frame) so the file's tail isn't silently dropped.
    let mut flush_out = vec![std::mem::MaybeUninit::uninit(); 32 * 1024];
    if let Ok(n) = encoder.flush::<FlushNoGap>(&mut flush_out) {
      if n > 0 {
        // SAFETY: encoder.flush() guarantees the first `n` bytes of
        // flush_out are initialized.
        let bytes: &[u8] = unsafe { std::slice::from_raw_parts(flush_out.as_ptr() as *const u8, n) };
        let _ = writer.write_all(bytes);
      }
    }
    let _ = writer.flush();

    ELAPSED_SECONDS.store(started.elapsed().as_secs(), Ordering::Relaxed);
    let _ = app.emit(
      EVENT_NAME,
      RecorderEvent::Stopped { path: out_path.to_string_lossy().to_string(), reason: stop_reason },
    );

    Ok(())
  }
}

#[cfg(not(target_os = "windows"))]
mod win {
  use super::*;
  pub fn run_capture_loop(_app: &AppHandle, _out_path: &PathBuf, _stop_flag: Arc<AtomicBool>) -> Result<(), String> {
    Err("System audio recording is only supported on Windows".to_string())
  }
}
