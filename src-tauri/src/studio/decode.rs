//! Audio file decoding and resampling, run entirely off the audio thread.
//!
//! ## Why decoding lives here and not near playback
//! Decoding is unbounded work: it reads files, allocates, and can take
//! tens of milliseconds. None of that may happen on the audio thread (see
//! `messages.rs`). So every sample is decoded here first, on a normal
//! thread, and only the finished `SampleData` — a plain block of f32 PCM —
//! is handed over as an `Arc`. The audio thread's involvement is a pointer
//! move.
//!
//! ## Planar (per-channel) storage is deliberate
//! Symphonia can hand decoded audio back either interleaved (L,R,L,R...)
//! or planar (all of L, then all of R); this module always asks for
//! planar via `copy_to_vecs_planar`. The voice renderer reads a fractional
//! position through one channel at a time, so interleaved storage would
//! stride over the other channel's samples and waste most of every cache
//! line. Choosing planar at decode time costs nothing extra — symphonia
//! converts either way — and saves that stride on every rendered sample
//! of every voice.
//!
//! ## Resampling policy
//! Samples are NOT resampled at load time. The voice renderer already
//! reads at a fractional rate to transpose pitch, so folding sample-rate
//! conversion into that same read (see `pitch_ratio_for`) is free, whereas
//! resampling here would be a second, lossy pass. `resample_linear` exists
//! for the one case that genuinely needs it — rendering an offline export
//! at a rate different from the source — and is not on the playback path.

use std::fs::File;
use std::path::Path;
use std::sync::Arc;

use symphonia::core::codecs::audio::AudioDecoderOptions;
use symphonia::core::formats::probe::Hint;
use symphonia::core::formats::{FormatOptions, TrackType};
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;

use crate::studio::messages::SampleData;

/// Refuses to load anything longer than this. A sampler instrument note is
/// seconds long; a multi-minute file here means the caller has confused a
/// sample with a song, and decoding it whole would blow memory for no
/// benefit. Imported song-length audio takes the streaming path instead.
const MAX_SAMPLE_SECONDS: f64 = 120.0;

/// Decodes an audio file into interleaved-free, per-channel f32 PCM.
///
/// Returns an error string meant for display: a sample that will not load
/// is something the user can act on (wrong file, corrupt download), so the
/// message says which file and why.
pub fn decode_file(path: &Path) -> Result<Arc<SampleData>, String> {
  let file = File::open(path)
    .map_err(|e| format!("Could not open \"{}\": {e}", path.display()))?;

  let stream = MediaSourceStream::new(Box::new(file), Default::default());

  // Give symphonia the file extension as a hint; it still sniffs content,
  // so a mislabelled file is handled, this only speeds up the common case.
  let mut hint = Hint::new();
  if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
    hint.with_extension(ext);
  }

  // symphonia 0.6's `probe` both sniffs the container and returns a ready
  // FormatReader, so there is no separate "probed.format" step.
  let mut format = symphonia::default::get_probe()
    .probe(&hint, stream, FormatOptions::default(), MetadataOptions::default())
    .map_err(|e| format!("\"{}\" is not an audio file this app can read: {e}", path.display()))?;

  let track = format
    .default_track(TrackType::Audio)
    .or_else(|| format.tracks().iter().find(|t| {
      t.codec_params.as_ref().map(|p| p.is_audio()).unwrap_or(false)
    }))
    .ok_or_else(|| format!("\"{}\" contains no playable audio track.", path.display()))?;

  let track_id = track.id;
  let num_frames = track.num_frames;
  let params = track
    .codec_params
    .as_ref()
    .and_then(|p| p.audio())
    .cloned()
    .ok_or_else(|| format!("\"{}\" has no readable audio settings.", path.display()))?;

  let source_rate = params
    .sample_rate
    .ok_or_else(|| format!("\"{}\" does not declare a sample rate.", path.display()))?;

  // Reject absurdly long files before decoding rather than after.
  if let Some(frames) = num_frames {
    if source_rate > 0 && (frames as f64 / source_rate as f64) > MAX_SAMPLE_SECONDS {
      return Err(format!(
        "\"{}\" is longer than {MAX_SAMPLE_SECONDS:.0} seconds, which is too long to load as an instrument sample.",
        path.display()
      ));
    }
  }

  let mut decoder = symphonia::default::get_codecs()
    .make_audio_decoder(&params, &AudioDecoderOptions::default())
    .map_err(|e| format!("No decoder available for \"{}\": {e}", path.display()))?;

  let mut channels: Vec<Vec<f32>> = Vec::new();
  // Reused across packets so the per-packet planar copy does not allocate
  // a fresh Vec-of-Vecs every time.
  let mut planes: Vec<Vec<f32>> = Vec::new();

  loop {
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
      Err(e) => return Err(format!("Error reading \"{}\": {e}", path.display())),
    };

    if packet.track_id != track_id {
      continue;
    }

    match decoder.decode(&packet) {
      Ok(decoded) => {
        // copy_to_vecs_planar does the de-interleaving described in the
        // module docs, and converts to f32 whatever the codec's native
        // sample format was.
        decoded.copy_to_vecs_planar::<f32>(&mut planes);
        if channels.len() < planes.len() {
          channels.resize(planes.len(), Vec::new());
        }
        for (dst, src) in channels.iter_mut().zip(planes.iter()) {
          dst.extend_from_slice(src);
        }
      }
      // A single corrupt packet should not fail the whole load — skip it
      // and keep the audio either side of it, which is what every media
      // player does.
      Err(symphonia::core::errors::Error::DecodeError(_)) => continue,
      Err(e) => return Err(format!("Error decoding \"{}\": {e}", path.display())),
    }
  }

  if channels.is_empty() || channels[0].is_empty() {
    return Err(format!("\"{}\" decoded to no audio.", path.display()));
  }

  let frames = channels[0].len();
  // Guard against a ragged final packet leaving channels of differing
  // lengths, which would make the renderer read past the end of one.
  for ch in channels.iter_mut() {
    ch.resize(frames, 0.0);
  }

  Ok(Arc::new(SampleData { channels, sample_rate: source_rate, frames }))
}

/// Linear-interpolating resampler, used only for offline export where the
/// target rate differs from the source. Not on the playback path — see the
/// module docs for why playback folds rate conversion into pitch instead.
pub fn resample_linear(input: &[f32], from_rate: u32, to_rate: u32) -> Vec<f32> {
  if from_rate == to_rate || from_rate == 0 || to_rate == 0 || input.is_empty() {
    return input.to_vec();
  }
  let ratio = from_rate as f64 / to_rate as f64;
  let out_len = ((input.len() as f64) / ratio).floor() as usize;
  let mut out = Vec::with_capacity(out_len);
  for i in 0..out_len {
    let src = i as f64 * ratio;
    let idx = src as usize;
    if idx + 1 >= input.len() {
      out.push(input[input.len() - 1]);
    } else {
      let frac = (src - idx as f64) as f32;
      out.push(input[idx] + (input[idx + 1] - input[idx]) * frac);
    }
  }
  out
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn resample_is_identity_at_matching_rates() {
    let input = vec![0.0, 0.5, 1.0, 0.5, 0.0];
    let out = resample_linear(&input, 48_000, 48_000);
    assert_eq!(out, input);
  }

  #[test]
  fn downsampling_halves_the_length() {
    let input: Vec<f32> = (0..100).map(|i| i as f32).collect();
    let out = resample_linear(&input, 48_000, 24_000);
    assert_eq!(out.len(), 50);
    // Every other sample, so out[1] should be about input[2].
    assert!((out[1] - 2.0).abs() < 1e-3);
  }

  #[test]
  fn upsampling_doubles_the_length_and_interpolates() {
    let input = vec![0.0f32, 1.0];
    let out = resample_linear(&input, 24_000, 48_000);
    assert_eq!(out.len(), 4);
    // Midpoint between 0 and 1 must be interpolated, not repeated.
    assert!((out[1] - 0.5).abs() < 1e-5, "got {}", out[1]);
  }

  #[test]
  fn resample_handles_degenerate_input() {
    assert!(resample_linear(&[], 48_000, 44_100).is_empty());
    assert_eq!(resample_linear(&[1.0], 0, 44_100), vec![1.0]);
    assert_eq!(resample_linear(&[1.0], 48_000, 0), vec![1.0]);
  }

  #[test]
  fn missing_file_reports_a_useful_error() {
    let err = decode_file(Path::new("no-such-file-xyz.wav")).unwrap_err();
    assert!(
      err.contains("no-such-file-xyz.wav"),
      "the error must name the file so the user knows which one failed: {err}"
    );
  }

  #[test]
  fn non_audio_file_is_rejected_cleanly() {
    // Must return an Err, never panic, on garbage input.
    let dir = std::env::temp_dir().join("udaan-studio-decode-test");
    let _ = std::fs::create_dir_all(&dir);
    let path = dir.join("not-audio.wav");
    std::fs::write(&path, b"this is definitely not a wav file").unwrap();

    let result = decode_file(&path);
    assert!(result.is_err(), "garbage input must be rejected, not decoded");

    let _ = std::fs::remove_file(&path);
  }

  /// Round-trips a real WAV through hound and back through the decoder,
  /// proving the whole decode path — probe, codec, plane copy, and
  /// integer-to-float conversion — actually works on a genuine file
  /// rather than only on synthetic buffers.
  #[test]
  fn decodes_a_real_wav_file_correctly() {
    let dir = std::env::temp_dir().join("udaan-studio-decode-test");
    let _ = std::fs::create_dir_all(&dir);
    let path = dir.join("tone.wav");

    // Write a 1kHz sine at 48kHz, 16-bit mono.
    let spec = hound::WavSpec {
      channels: 1,
      sample_rate: 48_000,
      bits_per_sample: 16,
      sample_format: hound::SampleFormat::Int,
    };
    {
      let mut writer = hound::WavWriter::create(&path, spec).unwrap();
      for i in 0..4800 {
        let t = i as f32 / 48_000.0;
        let v = (t * 1000.0 * std::f32::consts::TAU).sin();
        writer.write_sample((v * i16::MAX as f32) as i16).unwrap();
      }
      writer.finalize().unwrap();
    }

    let decoded = decode_file(&path).expect("a valid wav must decode");
    assert_eq!(decoded.sample_rate, 48_000);
    assert_eq!(decoded.channel_count(), 1);
    assert_eq!(decoded.frames, 4800, "all frames must be recovered");

    // The signal must survive: a sine has real energy and stays in range.
    let peak = decoded.channels[0].iter().fold(0.0f32, |a, s| a.max(s.abs()));
    assert!(peak > 0.9, "decoded peak {peak} lost amplitude");
    assert!(peak <= 1.0, "decoded peak {peak} exceeded full scale");

    let _ = std::fs::remove_file(&path);
  }

  /// Stereo must come back de-interleaved, with the channels kept
  /// distinct — the bug this catches is L and R being swapped or merged.
  #[test]
  fn decodes_stereo_into_separate_channels() {
    let dir = std::env::temp_dir().join("udaan-studio-decode-test");
    let _ = std::fs::create_dir_all(&dir);
    let path = dir.join("stereo.wav");

    let spec = hound::WavSpec {
      channels: 2,
      sample_rate: 44_100,
      bits_per_sample: 16,
      sample_format: hound::SampleFormat::Int,
    };
    {
      let mut writer = hound::WavWriter::create(&path, spec).unwrap();
      // Left at full scale, right at silence — unmistakable if swapped
      // or summed.
      for _ in 0..1000 {
        writer.write_sample(i16::MAX / 2).unwrap();
        writer.write_sample(0i16).unwrap();
      }
      writer.finalize().unwrap();
    }

    let decoded = decode_file(&path).expect("stereo wav must decode");
    assert_eq!(decoded.channel_count(), 2);
    assert_eq!(decoded.sample_rate, 44_100);
    assert_eq!(decoded.frames, 1000);

    let left_peak = decoded.channels[0].iter().fold(0.0f32, |a, s| a.max(s.abs()));
    let right_peak = decoded.channels[1].iter().fold(0.0f32, |a, s| a.max(s.abs()));
    assert!(left_peak > 0.4, "left channel lost its signal");
    assert!(right_peak < 0.01, "right channel must stay silent, got {right_peak}");

    let _ = std::fs::remove_file(&path);
  }

  #[test]
  fn all_channels_have_equal_length() {
    // A ragged final packet must not leave one channel shorter, which
    // would make the renderer read past its end.
    let dir = std::env::temp_dir().join("udaan-studio-decode-test");
    let _ = std::fs::create_dir_all(&dir);
    let path = dir.join("ragged.wav");

    let spec = hound::WavSpec {
      channels: 2,
      sample_rate: 48_000,
      bits_per_sample: 16,
      sample_format: hound::SampleFormat::Int,
    };
    {
      let mut writer = hound::WavWriter::create(&path, spec).unwrap();
      for i in 0..3333 {
        writer.write_sample((i % 100) as i16 * 100).unwrap();
        writer.write_sample((i % 70) as i16 * 100).unwrap();
      }
      writer.finalize().unwrap();
    }

    let decoded = decode_file(&path).unwrap();
    let len = decoded.channels[0].len();
    for ch in &decoded.channels {
      assert_eq!(ch.len(), len, "channels must be equal length");
    }
    assert_eq!(decoded.frames, len);

    let _ = std::fs::remove_file(&path);
  }
}
