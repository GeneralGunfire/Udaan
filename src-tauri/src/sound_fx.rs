//! Sound care for the whole PC.
//!
//! 1. Speaker keep-awake. Many speakers, soundbars, USB DACs and Bluetooth
//!    links go to sleep (or close a noise gate) when they are fed silence or a
//!    very quiet passage, and then take a moment to wake, or only wake once the
//!    signal gets loud. That is the "quiet parts are silent, then it suddenly
//!    switches on" effect, and it happens at any volume. Playing a constant,
//!    inaudible signal on the default output keeps the whole chain awake.
//!
//! 2. System-wide EQ presets through Equalizer APO, when it is installed. That
//!    is the only clean way to shape every app's sound on Windows without a
//!    driver of our own: it runs inside the audio engine, adds no delay (so
//!    films stay in sync) and cannot feed back. Udaan only writes a small
//!    config file; it never touches the audio path itself.

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use serde::Serialize;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;

// ---------------------------------------------------------------------------
// Speaker keep-awake
// ---------------------------------------------------------------------------

/// Peak level of the keep-awake signal for each strength (linear amplitude):
/// 1 ≈ -64 dBFS, 2 ≈ -56 dBFS, 3 ≈ -48 dBFS. All are below what speakers
/// reproduce audibly in a normal room; use the lowest that keeps yours awake.
fn amplitude(level: u8) -> f32 {
  match level {
    1 => 0.0006,
    3 => 0.004,
    _ => 0.0016,
  }
}

static KEEPALIVE_TX: Mutex<Option<mpsc::Sender<Option<f32>>>> = Mutex::new(None);

fn default_output_id() -> Option<String> {
  cpal::default_host().default_output_device().and_then(|d| d.id().ok()).map(|id| id.to_string())
}

fn open_stream(amp: f32, broken: &Arc<AtomicBool>) -> Option<cpal::Stream> {
  let host = cpal::default_host();
  let dev = host.default_output_device()?;
  let cfg = dev.default_output_config().ok()?;
  let rate = cfg.sample_rate() as f32;
  let channels = (cfg.channels() as usize).max(1);
  let mut t = 0f32;
  let mut seed = 0x1234_5678u32;
  let failed = Arc::clone(broken);
  let stream = dev
    .build_output_stream(
      cfg.config(),
      move |data: &mut [f32], _| {
        for frame in data.chunks_mut(channels) {
          // A 45 Hz tone plus a trace of noise: the tone keeps analogue
          // signal-sensing awake, the noise keeps digital "all zeros" detectors
          // from ever seeing silence.
          seed ^= seed << 13;
          seed ^= seed >> 17;
          seed ^= seed << 5;
          let noise = (seed as f32 / u32::MAX as f32) * 2.0 - 1.0;
          let v = (t * 45.0 * std::f32::consts::TAU / rate).sin() * amp + noise * amp * 0.25;
          t += 1.0;
          if t >= rate {
            t -= rate; // 45 whole cycles per second: the phase stays continuous
          }
          frame.iter_mut().for_each(|s| *s = v);
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
fn keepalive_loop(rx: mpsc::Receiver<Option<f32>>) {
  let broken = Arc::new(AtomicBool::new(false));
  let mut want: Option<f32> = None;
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
    let Some(amp) = want else {
      live = None;
      continue;
    };
    let current = default_output_id();
    let stale = broken.swap(false, Ordering::Relaxed) || live.as_ref().map(|(_, id)| *id != current).unwrap_or(true);
    if stale {
      live = None;
      live = open_stream(amp, &broken).map(|s| (s, current));
    }
  }
}

/// Turns the keep-awake signal on or off. `level` is 1 (lowest) to 3.
#[tauri::command]
pub fn speaker_keepalive_set(enabled: bool, level: u8) {
  let amp = enabled.then(|| amplitude(level));
  let mut guard = KEEPALIVE_TX.lock().unwrap();
  if guard.is_none() {
    let (tx, rx) = mpsc::channel();
    if std::thread::Builder::new().name("udaan-speaker-keepalive".into()).spawn(move || keepalive_loop(rx)).is_err() {
      return;
    }
    *guard = Some(tx);
  }
  if let Some(tx) = guard.as_ref() {
    let _ = tx.send(amp);
  }
}

// ---------------------------------------------------------------------------
// System-wide presets (Equalizer APO)
// ---------------------------------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FxStatus {
  pub installed: bool,
  pub path: Option<String>,
  /// The preset currently written for Equalizer APO, if any.
  pub preset: Option<String>,
}

const FILE: &str = "udaan-sound.txt";
const INCLUDE: &str = "Include: udaan-sound.txt";

fn apo_config_dir() -> Option<PathBuf> {
  ["ProgramFiles", "ProgramW6432", "ProgramFiles(x86)"]
    .iter()
    .filter_map(|k| std::env::var_os(k))
    .map(|p| PathBuf::from(p).join("EqualizerAPO").join("config"))
    .find(|p| p.join("config.txt").exists())
}

#[derive(Clone, Copy)]
enum Kind {
  Peak,
  LowShelf,
  HighShelf,
  HighPass,
}

/// (kind, centre/corner Hz, gain dB, Q)
type Band = (Kind, f32, f32, f32);

/// The curves. Conservative on purpose: nothing boosts more than ~6 dB, and a
/// matching preamp cut is applied so the result cannot clip (clipping is what
/// sounds like static).
fn preset_bands(id: &str) -> Option<Vec<Band>> {
  use Kind::*;
  Some(match id {
    // A gentle "smile": fuller low end, a little less box in the lower mids,
    // clearer vocals and some air.
    "music" => vec![(LowShelf, 90.0, 2.5, 0.7), (Peak, 350.0, -1.5, 1.0), (Peak, 3200.0, 1.5, 1.0), (HighShelf, 9000.0, 2.0, 0.7)],
    // Weight under the dialogue, a touch of presence so speech stays clear
    // over effects, and air on top. Subsonic rumble is filtered out.
    "cinematic" => vec![(HighPass, 25.0, 0.0, 0.7), (LowShelf, 70.0, 4.5, 0.7), (Peak, 450.0, -1.5, 1.0), (Peak, 3400.0, 2.0, 0.9), (HighShelf, 10000.0, 2.5, 0.7)],
    "bass" => vec![(HighPass, 25.0, 0.0, 0.7), (LowShelf, 100.0, 6.0, 0.7), (Peak, 55.0, 3.0, 1.0)],
    // Speech first: roll off the low end, take mud out, lift the
    // intelligibility band.
    "vocal" => vec![(HighPass, 90.0, 0.0, 0.7), (Peak, 250.0, -2.0, 1.0), (Peak, 2500.0, 3.0, 1.2), (Peak, 4500.0, 1.5, 1.5)],
    // Softer low and high ends for late-night listening.
    "night" => vec![(LowShelf, 120.0, -4.0, 0.7), (HighShelf, 8000.0, -3.0, 0.7)],
    "clarity" => vec![(HighShelf, 6000.0, 4.0, 0.7), (Peak, 3000.0, 1.5, 1.0)],
    _ => return None,
  })
}

/// Turns bands into an Equalizer APO file. Cuts the level by the biggest
/// boost (plus half the next) so overlapping boosts can't clip: clipping is
/// what sounds like static.
fn render_bands(label: &str, bands: Vec<Band>) -> String {
  let mut out = format!("# udaan-preset: {label}\n# Written by Udaan. Delete this file or choose Flat to remove it.\n");
  if bands.is_empty() {
    return out;
  }
  let mut boosts: Vec<f32> = bands.iter().map(|b| b.2).filter(|g| *g > 0.0).collect();
  boosts.sort_by(|a, b| b.partial_cmp(a).unwrap_or(std::cmp::Ordering::Equal));
  let headroom = boosts.first().copied().unwrap_or(0.0) + boosts.get(1).copied().unwrap_or(0.0) * 0.5;
  out.push_str(&format!("Preamp: {:.1} dB\n", -(headroom + 0.5).min(12.0)));
  for (kind, fc, gain, q) in bands {
    match kind {
      Kind::Peak => out.push_str(&format!("Filter: ON PK Fc {fc:.0} Hz Gain {gain:.1} dB Q {q:.2}\n")),
      Kind::LowShelf => out.push_str(&format!("Filter: ON LS Fc {fc:.0} Hz Gain {gain:.1} dB Q {q:.2}\n")),
      Kind::HighShelf => out.push_str(&format!("Filter: ON HS Fc {fc:.0} Hz Gain {gain:.1} dB Q {q:.2}\n")),
      Kind::HighPass => out.push_str(&format!("Filter: ON HPQ Fc {fc:.0} Hz Q {q:.2}\n")),
    }
  }
  out
}

fn render(id: &str, strength: f32) -> Result<String, String> {
  let bands = preset_bands(id).ok_or_else(|| format!("unknown preset {id}"))?;
  let scaled: Vec<Band> = bands.into_iter().map(|(k, f, g, q)| (k, f, g * strength, q)).collect();
  Ok(render_bands(id, scaled))
}

/// Three simple controls: bass (low shelf), voice (the speech band) and treble
/// (high shelf), each clamped to +/-8 dB.
fn render_custom(bass: f32, voice: f32, treble: f32) -> String {
  let c = |g: f32| g.clamp(-8.0, 8.0);
  let mut bands: Vec<Band> = Vec::new();
  if bass.abs() > 0.05 {
    bands.push((Kind::LowShelf, 100.0, c(bass), 0.7));
  }
  if voice.abs() > 0.05 {
    bands.push((Kind::Peak, 2500.0, c(voice), 0.9));
  }
  if treble.abs() > 0.05 {
    bands.push((Kind::HighShelf, 8000.0, c(treble), 0.7));
  }
  render_bands("custom", bands)
}

fn io_error(e: std::io::Error) -> String {
  if e.kind() == std::io::ErrorKind::PermissionDenied {
    "no-access".into()
  } else {
    e.to_string()
  }
}

#[tauri::command]
pub fn sound_fx_status() -> FxStatus {
  let dir = apo_config_dir();
  let preset = dir
    .as_ref()
    .and_then(|d| std::fs::read_to_string(d.join(FILE)).ok())
    .and_then(|t| t.lines().find_map(|l| l.strip_prefix("# udaan-preset:").map(|s| s.trim().to_string())));
  FxStatus { installed: dir.is_some(), path: dir.map(|d| d.display().to_string()), preset }
}

fn install_config(body: String) -> Result<(), String> {
  let dir = apo_config_dir().ok_or_else(|| "not-installed".to_string())?;
  std::fs::write(dir.join(FILE), body).map_err(io_error)?;
  // Make sure the main config pulls our file in (once; existing lines are kept).
  let main = dir.join("config.txt");
  let existing = std::fs::read_to_string(&main).map_err(io_error)?;
  if !existing.lines().any(|l| l.trim().eq_ignore_ascii_case(INCLUDE)) {
    let sep = if existing.ends_with('\n') || existing.is_empty() { "" } else { "\r\n" };
    std::fs::write(&main, format!("{existing}{sep}{INCLUDE}\r\n")).map_err(io_error)?;
  }
  Ok(())
}

/// Writes the preset for Equalizer APO. `preset` is "flat" to clear it;
/// `strength` scales every gain (0.0 – 1.5).
#[tauri::command]
pub fn sound_fx_apply(preset: String, strength: f32) -> Result<(), String> {
  let body = if preset == "flat" { "# udaan-preset: flat\n".to_string() } else { render(&preset, strength.clamp(0.0, 1.5))? };
  install_config(body)
}

/// The manual mode: bass, voice and treble in dB.
#[tauri::command]
pub fn sound_fx_apply_custom(bass: f32, voice: f32, treble: f32) -> Result<(), String> {
  install_config(render_custom(bass, voice, treble))
}

const INSTALLER_URL: &str = "https://sourceforge.net/projects/equalizerapo/files/1.4.2/EqualizerAPO-x64-1.4.2.exe/download";

/// Downloads the official Equalizer APO installer into Downloads and returns
/// its path; the caller opens it so Windows shows its normal installer and
/// permission prompt.
#[tauri::command]
pub async fn sound_fx_download_installer() -> Result<String, String> {
  let dir = std::env::var_os("USERPROFILE").map(|p| PathBuf::from(p).join("Downloads")).filter(|p| p.exists()).unwrap_or_else(std::env::temp_dir);
  let target = dir.join("EqualizerAPO-x64-1.4.2.exe");
  let client = reqwest::Client::builder().timeout(Duration::from_secs(240)).user_agent("curl/8.5.0").build().map_err(|e| e.to_string())?;
  let fail = |e: reqwest::Error| format!("download-failed: {e}");
  let bytes = client.get(INSTALLER_URL).send().await.map_err(fail)?.error_for_status().map_err(fail)?.bytes().await.map_err(fail)?;
  // The right file is a ~12 MB Windows program; anything else (an HTML page, a
  // truncated download) is refused rather than run.
  if bytes.len() < 5_000_000 || bytes.len() > 40_000_000 || bytes[..2] != *b"MZ" {
    return Err("download-failed: what came back wasn't the installer".into());
  }
  std::fs::write(&target, &bytes).map_err(io_error)?;
  Ok(target.display().to_string())
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn every_preset_renders_with_headroom_and_valid_lines() {
    for id in ["music", "cinematic", "bass", "vocal", "night", "clarity"] {
      for strength in [0.5, 1.0, 1.5] {
        let text = render(id, strength).unwrap();
        let preamp: f32 = text.lines().find_map(|l| l.strip_prefix("Preamp: ")).unwrap().trim_end_matches(" dB").parse().unwrap();
        assert!(preamp <= -0.5 && preamp >= -12.0, "{id}: preamp {preamp}");
        let max_boost = text
          .lines()
          .filter_map(|l| l.split(" Gain ").nth(1))
          .filter_map(|r| r.split(' ').next()?.parse::<f32>().ok())
          .fold(0.0f32, f32::max);
        assert!(-preamp >= max_boost, "{id}: preamp {preamp} does not cover boost {max_boost}");
        assert!(text.lines().filter(|l| l.starts_with("Filter: ON ")).count() >= 2);
      }
    }
  }

  #[test]
  fn custom_mode_keeps_headroom_and_skips_untouched_bands() {
    let flat = render_custom(0.0, 0.0, 0.0);
    assert!(!flat.contains("Filter:") && !flat.contains("Preamp:"));
    let text = render_custom(8.0, 8.0, -3.0);
    let preamp: f32 = text.lines().find_map(|l| l.strip_prefix("Preamp: ")).unwrap().trim_end_matches(" dB").parse().unwrap();
    assert!(preamp <= -8.0, "preamp {preamp} leaves no headroom for +8 dB");
    assert_eq!(text.lines().filter(|l| l.starts_with("Filter: ON ")).count(), 3);
    // Out-of-range input is clamped, not passed through.
    assert!(render_custom(40.0, 0.0, 0.0).contains("Gain 8.0 dB"));
  }

  #[test]
  fn unknown_preset_is_rejected() {
    assert!(render("nope", 1.0).is_err());
  }

  #[test]
  fn keepalive_amplitudes_stay_inaudible() {
    for level in 1..=3u8 {
      let db = 20.0 * amplitude(level).log10();
      assert!(db < -45.0, "level {level} is {db} dBFS");
    }
  }
}
