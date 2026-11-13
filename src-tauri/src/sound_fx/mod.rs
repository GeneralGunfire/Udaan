//! Sound care for the whole PC.
//!
//! ─────────────────────────────────────────────────────────────────────────
//! WHY THERE IS NO LONGER AN EQUALIZER APO DEPENDENCY
//! ─────────────────────────────────────────────────────────────────────────
//! Udaan used to shape system audio by writing config files for Equalizer
//! APO, a third-party driver the user had to download, install with admin
//! rights, assign to each output device, and reboot for. That was a bad
//! bargain in every direction:
//!
//!   * It did not work unless the user completed a five-step install that
//!     Udaan could not verify or perform, so most of the Sound panel was
//!     dead UI pointing at a feature that was not there.
//!   * It wrote into another program's config directory under Program
//!     Files, which needs elevation and silently failed without it.
//!   * Removing Udaan left those files behind.
//!   * A driver in the system audio path can break *all* audio on the
//!     machine, not just Udaan's.
//!
//! What remains here is what Udaan can own outright: the speaker keep-awake
//! (see `keepalive`), which needs no driver and no permissions, and the
//! per-device volume/mute controls that live in `shell::media`.
//!
//! EQ now belongs to whatever is producing the audio. Udaan's own player and
//! DJ board apply it in their Web Audio graph, where it is sample-accurate,
//! needs no install, and cannot affect any other program on the system.
//! Shaping *other* applications' output is deliberately out of scope: doing
//! it properly requires a kernel-mode APO, and doing it improperly requires
//! asking the user to install one.

pub mod keepalive;

use serde::{Deserialize, Serialize};

/// A parametric EQ band, in the form every audio engine understands.
///
/// This is the shared vocabulary between the Rust side (which stores the
/// user's choice) and whatever actually renders audio. Nothing here touches
/// the system audio path; it is a description of a curve.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Band {
  pub kind: BandKind,
  /// Centre frequency for a peak, corner frequency for a shelf or pass.
  pub frequency: f32,
  pub gain_db: f32,
  pub q: f32,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum BandKind {
  Peak,
  LowShelf,
  HighShelf,
  HighPass,
}

/// The built-in sound modes.
///
/// Conservative on purpose: nothing boosts more than ~6 dB, and
/// `preamp_db` returns the matching cut so a mode can never clip. Clipping
/// is what people describe as "it sounds like static".
pub fn preset_bands(id: &str) -> Option<Vec<Band>> {
  use BandKind::*;
  let b = |kind, frequency, gain_db, q| Band { kind, frequency, gain_db, q };
  Some(match id {
    "flat" => vec![],
    // A gentle "smile": fuller low end, less box in the lower mids, clearer
    // vocals and some air.
    "music" => vec![b(LowShelf, 90.0, 2.5, 0.7), b(Peak, 350.0, -1.5, 1.0), b(Peak, 3200.0, 1.5, 1.0), b(HighShelf, 9000.0, 2.0, 0.7)],
    // Weight under the dialogue, presence so speech stays clear over
    // effects, air on top. Subsonic rumble filtered out.
    "cinematic" => vec![b(HighPass, 25.0, 0.0, 0.7), b(LowShelf, 70.0, 4.5, 0.7), b(Peak, 450.0, -1.5, 1.0), b(Peak, 3400.0, 2.0, 0.9), b(HighShelf, 10000.0, 2.5, 0.7)],
    "bass" => vec![b(HighPass, 25.0, 0.0, 0.7), b(LowShelf, 100.0, 6.0, 0.7), b(Peak, 55.0, 3.0, 1.0)],
    // Speech first: roll off the low end, take out mud, lift the
    // intelligibility band.
    "vocal" => vec![b(HighPass, 90.0, 0.0, 0.7), b(Peak, 250.0, -2.0, 1.0), b(Peak, 2500.0, 3.0, 1.2), b(Peak, 4500.0, 1.5, 1.5)],
    "night" => vec![b(LowShelf, 120.0, -4.0, 0.7), b(HighShelf, 8000.0, -3.0, 0.7)],
    "clarity" => vec![b(HighShelf, 6000.0, 4.0, 0.7), b(Peak, 3000.0, 1.5, 1.0)],
    _ => return None,
  })
}

/// Bass / voice / treble, as three bands. Each is clamped to ±8 dB.
pub fn custom_bands(bass: f32, voice: f32, treble: f32) -> Vec<Band> {
  let c = |g: f32| g.clamp(-8.0, 8.0);
  let mut bands = Vec::new();
  if bass.abs() > 0.05 {
    bands.push(Band { kind: BandKind::LowShelf, frequency: 100.0, gain_db: c(bass), q: 0.7 });
  }
  if voice.abs() > 0.05 {
    bands.push(Band { kind: BandKind::Peak, frequency: 2500.0, gain_db: c(voice), q: 0.9 });
  }
  if treble.abs() > 0.05 {
    bands.push(Band { kind: BandKind::HighShelf, frequency: 8000.0, gain_db: c(treble), q: 0.7 });
  }
  bands
}

/// The level cut needed so a set of bands cannot clip.
///
/// The biggest boost plus half the next: overlapping filters sum, but never
/// fully, so subtracting every boost would leave the result far too quiet.
pub fn preamp_db(bands: &[Band]) -> f32 {
  let mut boosts: Vec<f32> = bands.iter().map(|b| b.gain_db).filter(|g| *g > 0.0).collect();
  boosts.sort_by(|a, b| b.partial_cmp(a).unwrap_or(std::cmp::Ordering::Equal));
  let headroom = boosts.first().copied().unwrap_or(0.0) + boosts.get(1).copied().unwrap_or(0.0) * 0.5;
  -(headroom + 0.5).min(12.0)
}

/// The curve for a saved mode, ready for an audio engine to apply.
///
/// `strength` scales every gain, so one preset covers "a touch" through to
/// "definitely on" without a separate curve per level.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Curve {
  pub bands: Vec<Band>,
  pub preamp_db: f32,
}

#[tauri::command]
pub fn sound_fx_curve(preset: String, strength: f32, bass: f32, voice: f32, treble: f32) -> Result<Curve, String> {
  let bands = if preset == "custom" {
    custom_bands(bass, voice, treble)
  } else {
    let base = preset_bands(&preset).ok_or_else(|| format!("unknown preset {preset}"))?;
    let s = strength.clamp(0.0, 1.5);
    base.into_iter().map(|b| Band { gain_db: b.gain_db * s, ..b }).collect()
  };
  let preamp_db = preamp_db(&bands);
  Ok(Curve { bands, preamp_db })
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn every_preset_resolves_and_leaves_headroom() {
    for id in ["flat", "music", "cinematic", "bass", "vocal", "night", "clarity"] {
      for strength in [0.5, 1.0, 1.5] {
        let curve = sound_fx_curve(id.into(), strength, 0.0, 0.0, 0.0).unwrap();
        let max_boost = curve.bands.iter().map(|b| b.gain_db).fold(0.0f32, f32::max);
        assert!(
          -curve.preamp_db >= max_boost,
          "{id}: preamp {} does not cover boost {max_boost}",
          curve.preamp_db
        );
        assert!(curve.preamp_db <= 0.0, "{id}: preamp must never boost");
      }
    }
  }

  #[test]
  fn flat_is_genuinely_flat() {
    let curve = sound_fx_curve("flat".into(), 1.0, 0.0, 0.0, 0.0).unwrap();
    assert!(curve.bands.is_empty());
    assert_eq!(curve.preamp_db, -0.5);
  }

  #[test]
  fn custom_clamps_and_skips_untouched_bands() {
    let none = sound_fx_curve("custom".into(), 1.0, 0.0, 0.0, 0.0).unwrap();
    assert!(none.bands.is_empty());

    let all = sound_fx_curve("custom".into(), 1.0, 40.0, 8.0, -3.0).unwrap();
    assert_eq!(all.bands.len(), 3);
    // Out-of-range input is clamped, not passed through.
    assert_eq!(all.bands[0].gain_db, 8.0);
    assert!(all.preamp_db <= -8.0, "preamp {} leaves no headroom", all.preamp_db);
  }

  #[test]
  fn unknown_preset_is_rejected() {
    assert!(sound_fx_curve("nope".into(), 1.0, 0.0, 0.0, 0.0).is_err());
  }
}
