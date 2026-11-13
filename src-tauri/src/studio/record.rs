//! Audio input capture and WAV writing.
//!
//! ## Why capture is a separate stream, not part of the output callback
//! cpal gives input and output as independent streams, each with its own
//! callback on its own thread. Even on one physical interface the two
//! clocks are only nominally identical — over minutes they drift. So
//! capture writes into its own ring buffer, and the writer thread drains
//! it to disk. Trying to do capture inside the output callback would
//! couple two independently-clocked devices and produce periodic glitches.
//!
//! ## Why disk writes never happen on the capture callback
//! Same rule as playback: the capture callback is real-time. `write()` can
//! block for milliseconds when the OS flushes, which would drop input
//! frames. The callback therefore only pushes into a lock-free queue, and
//! a normal thread does the file I/O.
//!
//! ## Crash safety
//! The WAV header stores the data length, so a file whose writer died mid
//! recording has a header claiming more data than exists. `finalize`
//! rewrites the header, and the writer flushes periodically so an
//! interrupted take still yields a file with everything captured up to
//! that point — the same crash-safety reasoning the system-audio recorder
//! module applies to its MP3 output.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;

use cpal::traits::{DeviceTrait, StreamTrait};
use cpal::{Stream, StreamConfig};

use crate::studio::devices::{self, AudioConfig, DeviceDirection};

/// How many frames the capture ring buffer holds before the writer must
/// have drained it. About a second at 48kHz stereo, which is generous
/// headroom against a slow disk flush without wasting memory.
const CAPTURE_RING_FRAMES: usize = 48_000;

/// A live input capture writing to a WAV file.
pub struct Capture {
  _stream: Stream,
  stop: Arc<AtomicBool>,
  /// Frames captured so far, readable by the UI for a recording timer.
  frames: Arc<AtomicU64>,
  /// Peak input level since last read, for the level meter during
  /// recording. Stored as bits because f32 has no atomic type.
  peak_bits: Arc<AtomicU64>,
  path: PathBuf,
  writer: Option<std::thread::JoinHandle<Result<(), String>>>,
  sample_rate: u32,
  channels: u16,
}

// Same reasoning as EngineHandle: the cpal Stream is not Send on every
// platform, and this is only ever driven from serialized command threads.
unsafe impl Send for Capture {}

impl Capture {
  /// Opens the input device from `config` and begins writing to `path`.
  ///
  /// Errors are phrased for display: a failed input open is almost always
  /// something the user can fix (no microphone, another app holding the
  /// device, permissions).
  pub fn start(config: &AudioConfig, path: &Path) -> Result<Self, String> {
    let device = devices::resolve_device(
      config.driver,
      config.input_device_id.as_deref(),
      DeviceDirection::Input,
    )
    .ok_or_else(|| {
      "No microphone or audio input was found. Connect one, then try recording again."
        .to_string()
    })?;

    let default_config = device
      .default_input_config()
      .map_err(|e| format!("Could not read the input device's settings: {e}"))?;

    // Capture in whatever channel count the device offers, up to stereo.
    let channels = default_config.channels().min(2).max(1);
    let stream_config = StreamConfig {
      channels,
      sample_rate: config.sample_rate,
      buffer_size: cpal::BufferSize::Fixed(config.buffer_frames),
    };

    let spec = hound::WavSpec {
      channels,
      sample_rate: config.sample_rate,
      bits_per_sample: 32,
      sample_format: hound::SampleFormat::Float,
    };
    let mut wav = hound::WavWriter::create(path, spec)
      .map_err(|e| format!("Could not create the recording file: {e}"))?;

    let (mut tx, mut rx) =
      rtrb::RingBuffer::<f32>::new(CAPTURE_RING_FRAMES * channels as usize);

    let stop = Arc::new(AtomicBool::new(false));
    let frames = Arc::new(AtomicU64::new(0));
    let peak_bits = Arc::new(AtomicU64::new(0));

    let stop_writer = Arc::clone(&stop);
    let frames_cb = Arc::clone(&frames);
    let peak_cb = Arc::clone(&peak_bits);
    let ch = channels as u64;

    let stream = device
      .build_input_stream(
        stream_config,
        move |input: &[f32], _: &cpal::InputCallbackInfo| {
          // Real-time: push only, never write to disk, never allocate.
          let mut peak = 0.0f32;
          for s in input {
            let a = s.abs();
            if a > peak {
              peak = a;
            }
            // A full ring means the writer thread has stalled. Dropping
            // is the only real-time-safe response; the frame counter
            // still advances so the gap is visible rather than silent.
            let _ = tx.push(*s);
          }
          frames_cb.fetch_add(input.len() as u64 / ch.max(1), Ordering::Relaxed);

          // Publish the peak by max-ing into the shared slot.
          let bits = peak.to_bits() as u64;
          let _ = peak_cb.fetch_update(Ordering::Relaxed, Ordering::Relaxed, |cur| {
            let cur_f = f32::from_bits(cur as u32);
            if peak > cur_f {
              Some(bits)
            } else {
              None
            }
          });
        },
        move |err| {
          log::error!("Studio input stream error: {err}");
        },
        None,
      )
      .map_err(|e| {
        format!(
          "Could not open the input device at {} Hz: {e}. Try a different \
           sample rate in Audio Settings.",
          config.sample_rate
        )
      })?;

    stream
      .play()
      .map_err(|e| format!("Could not start recording: {e}"))?;

    // Writer thread: the only place that touches the filesystem.
    let writer = std::thread::spawn(move || -> Result<(), String> {
      loop {
        let mut wrote_any = false;
        while let Ok(sample) = rx.pop() {
          wav
            .write_sample(sample)
            .map_err(|e| format!("Error writing the recording: {e}"))?;
          wrote_any = true;
        }

        if stop_writer.load(Ordering::Relaxed) {
          // Drain whatever arrived between the stop flag and this check
          // so the tail of the take is not lost.
          while let Ok(sample) = rx.pop() {
            wav
              .write_sample(sample)
              .map_err(|e| format!("Error writing the recording: {e}"))?;
          }
          break;
        }

        if !wrote_any {
          // Nothing to do; yield rather than spinning a core.
          std::thread::sleep(std::time::Duration::from_millis(5));
        } else {
          // Flush periodically so a crash leaves a playable file rather
          // than one with a stale header.
          wav
            .flush()
            .map_err(|e| format!("Error flushing the recording: {e}"))?;
        }
      }

      wav
        .finalize()
        .map_err(|e| format!("Error finalizing the recording: {e}"))?;
      Ok(())
    });

    Ok(Self {
      _stream: stream,
      stop,
      frames,
      peak_bits,
      path: path.to_path_buf(),
      writer: Some(writer),
      sample_rate: config.sample_rate,
      channels,
    })
  }

  /// Frames captured so far — drives the recording timer.
  pub fn frames_captured(&self) -> u64 {
    self.frames.load(Ordering::Relaxed)
  }

  /// Seconds captured so far.
  pub fn seconds_captured(&self) -> f64 {
    if self.sample_rate == 0 {
      return 0.0;
    }
    self.frames_captured() as f64 / self.sample_rate as f64
  }

  /// Reads and clears the input peak, for the level meter.
  pub fn take_peak(&self) -> f32 {
    let bits = self.peak_bits.swap(0, Ordering::Relaxed);
    f32::from_bits(bits as u32)
  }

  pub fn channels(&self) -> u16 {
    self.channels
  }

  pub fn path(&self) -> &Path {
    &self.path
  }

  /// Stops capture and finalizes the file, returning its path.
  pub fn finish(mut self) -> Result<PathBuf, String> {
    self.stop.store(true, Ordering::Relaxed);
    if let Some(handle) = self.writer.take() {
      handle
        .join()
        .map_err(|_| "The recording writer thread stopped unexpectedly.".to_string())??;
    }
    Ok(self.path.clone())
  }
}

/// Writes interleaved stereo f32 PCM to a 24-bit WAV — the format the
/// spec names for exports. 24-bit is chosen over 32-bit float because it
/// is what every other DAW and distributor expects for delivery, and over
/// 16-bit because it keeps headroom for later mastering.
pub fn write_wav_24(path: &Path, interleaved: &[f32], sample_rate: u32, channels: u16) -> Result<(), String> {
  let spec = hound::WavSpec {
    channels,
    sample_rate,
    bits_per_sample: 24,
    sample_format: hound::SampleFormat::Int,
  };
  let mut writer = hound::WavWriter::create(path, spec)
    .map_err(|e| format!("Could not create \"{}\": {e}", path.display()))?;

  // 24-bit signed range. Clamping before scaling avoids wrapping a
  // sample that exceeded full scale into a loud opposite-polarity spike.
  const MAX_24: f32 = 8_388_607.0;
  for sample in interleaved {
    let clamped = sample.clamp(-1.0, 1.0);
    let v = (clamped * MAX_24) as i32;
    writer
      .write_sample(v)
      .map_err(|e| format!("Error writing \"{}\": {e}", path.display()))?;
  }

  writer
    .finalize()
    .map_err(|e| format!("Error finalizing \"{}\": {e}", path.display()))?;
  Ok(())
}

#[cfg(test)]
mod tests {
  use super::*;

  fn temp_dir() -> PathBuf {
    let dir = std::env::temp_dir().join("udaan-studio-record-test");
    let _ = std::fs::create_dir_all(&dir);
    dir
  }

  #[test]
  fn writes_a_readable_24bit_wav() {
    let path = temp_dir().join("out24.wav");
    let samples: Vec<f32> = (0..2000)
      .map(|i| ((i as f32 / 48_000.0) * 440.0 * std::f32::consts::TAU).sin())
      .collect();

    write_wav_24(&path, &samples, 48_000, 1).expect("write must succeed");

    let reader = hound::WavReader::open(&path).expect("output must be a readable wav");
    let spec = reader.spec();
    assert_eq!(spec.bits_per_sample, 24);
    assert_eq!(spec.sample_rate, 48_000);
    assert_eq!(spec.channels, 1);
    assert_eq!(reader.len() as usize, samples.len());

    let _ = std::fs::remove_file(&path);
  }

  #[test]
  fn export_preserves_signal_amplitude() {
    // A round trip must come back at essentially the same level; a
    // scaling bug here would make every export quiet or clipped.
    let path = temp_dir().join("amp.wav");
    let samples = vec![0.5f32; 512];
    write_wav_24(&path, &samples, 48_000, 1).unwrap();

    let mut reader = hound::WavReader::open(&path).unwrap();
    let first: i32 = reader.samples::<i32>().next().unwrap().unwrap();
    let recovered = first as f32 / 8_388_607.0;
    assert!(
      (recovered - 0.5).abs() < 1e-3,
      "expected ~0.5 back, got {recovered}"
    );

    let _ = std::fs::remove_file(&path);
  }

  #[test]
  fn out_of_range_samples_clamp_rather_than_wrap() {
    // Without the clamp, +1.5 wraps to a large negative value — a loud
    // click instead of mild clipping.
    let path = temp_dir().join("clip.wav");
    write_wav_24(&path, &[1.5, -1.5], 48_000, 1).unwrap();

    let mut reader = hound::WavReader::open(&path).unwrap();
    let vals: Vec<i32> = reader.samples::<i32>().map(|s| s.unwrap()).collect();
    assert!(vals[0] > 0, "positive overshoot must stay positive");
    assert!(vals[1] < 0, "negative overshoot must stay negative");
    assert!(vals[0] <= 8_388_607);
    assert!(vals[1] >= -8_388_608);

    let _ = std::fs::remove_file(&path);
  }

  #[test]
  fn stereo_export_interleaves_correctly() {
    let path = temp_dir().join("stereo-out.wav");
    // L=1.0, R=0.0 repeated.
    let samples: Vec<f32> = (0..200)
      .flat_map(|_| [0.8f32, 0.0f32])
      .collect();
    write_wav_24(&path, &samples, 44_100, 2).unwrap();

    let mut reader = hound::WavReader::open(&path).unwrap();
    assert_eq!(reader.spec().channels, 2);
    let vals: Vec<i32> = reader.samples::<i32>().map(|s| s.unwrap()).collect();
    assert!(vals[0].abs() > 1000, "left must carry signal");
    assert_eq!(vals[1], 0, "right must be silent");

    let _ = std::fs::remove_file(&path);
  }

  #[test]
  fn empty_export_still_produces_a_valid_file() {
    // Exporting an empty selection must not produce a corrupt header.
    let path = temp_dir().join("empty.wav");
    write_wav_24(&path, &[], 48_000, 2).unwrap();
    let reader = hound::WavReader::open(&path).expect("empty wav must still be valid");
    assert_eq!(reader.len(), 0);
    let _ = std::fs::remove_file(&path);
  }

  #[test]
  fn unwritable_path_reports_a_useful_error() {
    let err = write_wav_24(
      Path::new("Z:/definitely/not/a/real/path/out.wav"),
      &[0.0],
      48_000,
      1,
    )
    .unwrap_err();
    assert!(!err.is_empty());
  }
}
