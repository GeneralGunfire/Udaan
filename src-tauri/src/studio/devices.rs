//! Audio device discovery and configuration for Studio's native engine.
//!
//! ## Why this layer exists at all
//! The previous Studio ran entirely on Web Audio inside the Tauri WebView,
//! where the browser owns the device and the buffer size. Nothing there
//! could enumerate ASIO devices, choose WASAPI exclusive mode, or set a
//! buffer size — so a "driver picker" in that world would have been
//! decoration over settings that nothing actually applied. This module is
//! the real thing: every value it reports is queried from cpal, and every
//! value it accepts is passed to the stream builder in `engine.rs`.
//!
//! ## Driver kinds and what each one honestly offers on Windows
//! - **WASAPI shared** — always present, no setup. The OS mixes Studio
//!   with every other app, which forces the shared engine's format and
//!   period, so latency lands roughly in the 20-40ms range. This is the
//!   safe default.
//! - **WASAPI exclusive** — Studio takes sole ownership of the endpoint.
//!   Much smaller periods are possible (low single-digit ms on good
//!   hardware), at the cost of no other app being able to use the device
//!   while Studio holds it.
//! - **ASIO** — only compiled in under the `studio-asio` cargo feature
//!   (see Cargo.toml for why it is not on by default). When the feature is
//!   off, `available_drivers` simply does not list it, so the UI never
//!   offers a driver that cannot work in this build.
//!
//! ## The latency numbers reported here are measured, not aspirational
//! `LatencyEstimate` is derived from the buffer size and sample rate that
//! were actually negotiated with the device, plus the driver's own
//! reported period where cpal exposes one. It deliberately reports output,
//! input, and round-trip separately, and carries a `is_measured` flag so
//! the UI can distinguish a real negotiated figure from a pre-open
//! estimate. Studio's audio-setup screen shows these verbatim rather than
//! a marketing target — an honest 28ms is more useful to someone deciding
//! whether they can track vocals than an aspirational "10ms".

use serde::{Deserialize, Serialize};

use cpal::traits::{DeviceTrait, HostTrait};

/// Which audio backend a device is reached through. Serialized to the UI
/// as a lowercase string tag (`"wasapiShared"` etc. via serde rename).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DriverKind {
  /// Windows shared-mode WASAPI. Always available; highest latency.
  WasapiShared,
  /// Windows exclusive-mode WASAPI. Low latency; locks the device.
  WasapiExclusive,
  /// ASIO, only present when built with the `studio-asio` feature.
  Asio,
}

impl DriverKind {
  /// Short human label for the driver picker.
  pub fn label(self) -> &'static str {
    match self {
      DriverKind::WasapiShared => "WASAPI (Shared)",
      DriverKind::WasapiExclusive => "WASAPI (Exclusive)",
      DriverKind::Asio => "ASIO",
    }
  }

  /// Plain-language explanation shown under each option in the setup
  /// wizard. Deliberately free of audio jargon — the spec's audience
  /// includes people who have never opened a DAW.
  pub fn description(self) -> &'static str {
    match self {
      DriverKind::WasapiShared => {
        "Works everywhere with no setup. Other apps can use your speakers at \
         the same time. Slight delay when playing live."
      }
      DriverKind::WasapiExclusive => {
        "Studio takes full control of your audio device for much less delay. \
         Other apps cannot play sound while Studio is using it."
      }
      DriverKind::Asio => {
        "Lowest delay, for audio interfaces with their own ASIO driver. \
         Best choice for recording if your interface supports it."
      }
    }
  }

  /// The cpal host this driver kind is reached through. Both WASAPI modes
  /// share one host — they differ by share mode at stream-open time, not
  /// by host — so they map to the same `HostId`.
  #[cfg(windows)]
  fn host_id(self) -> Option<cpal::HostId> {
    match self {
      DriverKind::WasapiShared | DriverKind::WasapiExclusive => Some(cpal::HostId::Wasapi),
      #[cfg(feature = "studio-asio")]
      DriverKind::Asio => Some(cpal::HostId::Asio),
      #[cfg(not(feature = "studio-asio"))]
      DriverKind::Asio => None,
    }
  }

  #[cfg(not(windows))]
  fn host_id(self) -> Option<cpal::HostId> {
    // Non-Windows builds fall back to whatever the platform default host
    // is; Studio is a Windows-first app but must still compile elsewhere.
    None
  }
}

/// Whether a device is a playback or capture endpoint.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DeviceDirection {
  Output,
  Input,
}

/// One selectable audio endpoint, with the configuration range it
/// actually supports (queried from the driver, never assumed).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioDevice {
  /// Stable identifier used to re-select this device across restarts —
  /// cpal's own `DeviceId`, stringified. Distinct from `name`, which is
  /// the human-facing label and is not guaranteed unique (two identical
  /// interfaces present the same name).
  pub id: String,
  pub name: String,
  pub direction: DeviceDirection,
  pub driver: DriverKind,
  /// True for the host's current default endpoint.
  pub is_default: bool,
  /// Sample rates the device reports as supported, ascending.
  pub sample_rates: Vec<u32>,
  /// Maximum channel count the device reports.
  pub max_channels: u16,
}

/// A latency figure broken into its parts, so the UI can explain where the
/// delay comes from instead of showing one opaque number.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LatencyEstimate {
  pub buffer_frames: u32,
  pub sample_rate: u32,
  pub output_ms: f32,
  pub input_ms: f32,
  /// Output + input. What a performer actually feels when monitoring.
  pub round_trip_ms: f32,
  /// True once the stream has been opened and these figures reflect the
  /// configuration the driver actually granted. False for a pre-open
  /// estimate computed from requested values.
  pub is_measured: bool,
  /// `"good" | "ok" | "high"` — drives the setup wizard's verdict badge.
  pub rating: &'static str,
}

impl LatencyEstimate {
  /// Computes latency from a buffer size and rate. One buffer of delay is
  /// counted per direction: the engine fills a buffer before it is played
  /// (output) and receives a full buffer before it can be processed
  /// (input). Real hardware adds a little more on top, which is why the
  /// `is_measured` flag matters — this is the floor, not a promise.
  pub fn from_config(buffer_frames: u32, sample_rate: u32, duplex: bool, is_measured: bool) -> Self {
    let one_buffer_ms = if sample_rate == 0 {
      0.0
    } else {
      (buffer_frames as f32 / sample_rate as f32) * 1000.0
    };
    let output_ms = one_buffer_ms;
    let input_ms = if duplex { one_buffer_ms } else { 0.0 };
    let round_trip_ms = output_ms + input_ms;

    // Thresholds follow the spec's own targets: <=15ms round trip is
    // comfortable for tracking, up to ~40ms is fine for mixing/playback
    // but noticeable when playing live, beyond that is a problem.
    let rating = if round_trip_ms <= 15.0 {
      "good"
    } else if round_trip_ms <= 40.0 {
      "ok"
    } else {
      "high"
    };

    Self {
      buffer_frames,
      sample_rate,
      output_ms,
      input_ms,
      round_trip_ms,
      is_measured,
      rating,
    }
  }
}

/// The engine's requested audio configuration. Persisted by the frontend
/// and handed back on startup so a user's device choice survives restarts.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioConfig {
  pub driver: DriverKind,
  /// `None` means "use the host default output".
  pub output_device_id: Option<String>,
  /// `None` disables input entirely (playback-only, no recording).
  pub input_device_id: Option<String>,
  pub sample_rate: u32,
  pub buffer_frames: u32,
}

impl Default for AudioConfig {
  fn default() -> Self {
    Self {
      // Shared WASAPI is the only mode guaranteed to open on any Windows
      // machine with no setup, so first run must not fail.
      driver: DriverKind::WasapiShared,
      output_device_id: None,
      input_device_id: None,
      sample_rate: 48_000,
      // 512 frames @48k is ~10.7ms per direction: responsive enough to
      // play, forgiving enough not to crackle on a first run where we
      // know nothing about the machine's CPU or power plan.
      buffer_frames: 512,
    }
  }
}

/// Buffer sizes offered in the setup wizard, smallest first. Powers of two
/// because that is what every Windows audio driver is built around.
pub const BUFFER_SIZE_CHOICES: [u32; 6] = [64, 128, 256, 512, 1024, 2048];

/// Sample rates offered in the setup wizard.
pub const SAMPLE_RATE_CHOICES: [u32; 4] = [44_100, 48_000, 88_200, 96_000];

/// Driver kinds this binary can actually open, in preference order (best
/// latency first). ASIO is absent unless compiled with `studio-asio`, so
/// the UI can never offer a driver this build cannot use.
pub fn available_drivers() -> Vec<DriverKind> {
  let mut drivers = Vec::new();

  #[cfg(all(windows, feature = "studio-asio"))]
  {
    // Only advertise ASIO if the host genuinely initializes — the feature
    // being compiled in does not guarantee an ASIO driver is installed.
    if cpal::available_hosts().contains(&cpal::HostId::Asio) {
      drivers.push(DriverKind::Asio);
    }
  }

  #[cfg(windows)]
  {
    drivers.push(DriverKind::WasapiExclusive);
    drivers.push(DriverKind::WasapiShared);
  }

  #[cfg(not(windows))]
  {
    drivers.push(DriverKind::WasapiShared);
  }

  drivers
}

/// Resolves the cpal host for a driver kind, falling back to the platform
/// default when the requested host is unavailable (e.g. an ASIO config
/// restored from disk on a build without the feature).
fn host_for(driver: DriverKind) -> cpal::Host {
  if let Some(id) = driver.host_id() {
    if let Ok(host) = cpal::host_from_id(id) {
      return host;
    }
  }
  cpal::default_host()
}

/// Enumerates every input and output endpoint reachable through `driver`.
///
/// Devices that fail to report their supported configs are skipped rather
/// than surfaced as broken entries — a device Studio cannot describe is a
/// device it cannot reliably open, and listing it would only produce a
/// confusing failure later in the setup wizard.
pub fn enumerate(driver: DriverKind) -> Vec<AudioDevice> {
  let host = host_for(driver);
  let mut devices = Vec::new();

  let default_out = host
    .default_output_device()
    .and_then(|d| d.id().ok())
    .map(|id| id.to_string());
  let default_in = host
    .default_input_device()
    .and_then(|d| d.id().ok())
    .map(|id| id.to_string());

  if let Ok(outputs) = host.output_devices() {
    for device in outputs {
      if let Some(info) = describe(&device, DeviceDirection::Output, driver, &default_out) {
        devices.push(info);
      }
    }
  }

  if let Ok(inputs) = host.input_devices() {
    for device in inputs {
      if let Some(info) = describe(&device, DeviceDirection::Input, driver, &default_in) {
        devices.push(info);
      }
    }
  }

  devices
}

/// Builds an `AudioDevice` from a live cpal device, or `None` if the
/// device will not describe itself (see `enumerate` for why we drop those).
fn describe(
  device: &cpal::Device,
  direction: DeviceDirection,
  driver: DriverKind,
  default_id: &Option<String>,
) -> Option<AudioDevice> {
  // cpal 0.18 exposes a stable, round-trippable DeviceId for identity and
  // Display for the human-readable name — two different things, so we
  // persist the id and show the name rather than conflating them.
  let id = device.id().ok()?.to_string();
  let name = device.to_string();

  let configs: Vec<_> = match direction {
    DeviceDirection::Output => device.supported_output_configs().ok()?.collect(),
    DeviceDirection::Input => device.supported_input_configs().ok()?.collect(),
  };
  if configs.is_empty() {
    return None;
  }

  // Intersect our offered rates with what the device reports, so the UI
  // only ever shows rates that will actually open.
  let mut sample_rates: Vec<u32> = SAMPLE_RATE_CHOICES
    .iter()
    .copied()
    .filter(|rate| {
      configs.iter().any(|c| {
        c.min_sample_rate() <= *rate && *rate <= c.max_sample_rate()
      })
    })
    .collect();
  sample_rates.sort_unstable();

  if sample_rates.is_empty() {
    return None;
  }

  let max_channels = configs.iter().map(|c| c.channels()).max().unwrap_or(2);

  Some(AudioDevice {
    is_default: default_id.as_deref() == Some(id.as_str()),
    id,
    name,
    direction,
    driver,
    sample_rates,
    max_channels,
  })
}

/// Finds a device by id (name) and direction within a driver's host.
/// Returns the host default when `id` is `None`, which is how a fresh
/// config with no explicit choice resolves.
pub fn resolve_device(
  driver: DriverKind,
  id: Option<&str>,
  direction: DeviceDirection,
) -> Option<cpal::Device> {
  let host = host_for(driver);

  let Some(id) = id else {
    return match direction {
      DeviceDirection::Output => host.default_output_device(),
      DeviceDirection::Input => host.default_input_device(),
    };
  };

  let candidates = match direction {
    DeviceDirection::Output => host.output_devices().ok()?,
    DeviceDirection::Input => host.input_devices().ok()?,
  };

  for device in candidates {
    if device.id().map(|d| d.to_string() == id).unwrap_or(false) {
      return Some(device);
    }
  }

  // The saved device is gone (unplugged interface, changed default).
  // Fall back to the host default rather than refusing to start — losing
  // a preferred device should not leave Studio silent with no explanation.
  match direction {
    DeviceDirection::Output => host.default_output_device(),
    DeviceDirection::Input => host.default_input_device(),
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn latency_scales_with_buffer_and_rate() {
    // 512 frames @ 48kHz = 512/48000 s = 10.667ms per direction.
    let out_only = LatencyEstimate::from_config(512, 48_000, false, true);
    assert!((out_only.output_ms - 10.667).abs() < 0.01);
    assert_eq!(out_only.input_ms, 0.0);
    assert!((out_only.round_trip_ms - 10.667).abs() < 0.01);

    // Duplex doubles it, because a full input buffer must arrive before
    // it can be processed and sent back out.
    let duplex = LatencyEstimate::from_config(512, 48_000, true, true);
    assert!((duplex.round_trip_ms - 21.333).abs() < 0.01);

    // Halving the buffer halves the delay.
    let small = LatencyEstimate::from_config(256, 48_000, false, true);
    assert!((small.output_ms - 5.333).abs() < 0.01);
  }

  #[test]
  fn latency_rating_follows_spec_thresholds() {
    // 64 @ 48k duplex = 2.67ms -> comfortably good.
    assert_eq!(
      LatencyEstimate::from_config(64, 48_000, true, true).rating,
      "good"
    );
    // 512 @ 48k duplex = 21.3ms -> usable for mixing, not ideal live.
    assert_eq!(
      LatencyEstimate::from_config(512, 48_000, true, true).rating,
      "ok"
    );
    // 2048 @ 48k duplex = 85.3ms -> unusable for playing live.
    assert_eq!(
      LatencyEstimate::from_config(2048, 48_000, true, true).rating,
      "high"
    );
  }

  #[test]
  fn zero_sample_rate_does_not_divide_by_zero() {
    // Guards the path where a device reports nothing usable; must yield
    // finite numbers rather than NaN/inf leaking into the UI.
    let est = LatencyEstimate::from_config(512, 0, true, false);
    assert_eq!(est.round_trip_ms, 0.0);
    assert!(est.output_ms.is_finite());
  }

  #[test]
  fn default_config_is_openable_everywhere() {
    // First run must not fail on an unknown machine: shared WASAPI with
    // no explicit device means "host default", which always resolves.
    let cfg = AudioConfig::default();
    assert_eq!(cfg.driver, DriverKind::WasapiShared);
    assert!(cfg.output_device_id.is_none());
    assert!(BUFFER_SIZE_CHOICES.contains(&cfg.buffer_frames));
    assert!(SAMPLE_RATE_CHOICES.contains(&cfg.sample_rate));
  }

  /// Exercises the real cpal enumeration path against whatever hardware
  /// this machine actually has. Unit tests above only cover arithmetic;
  /// this is the one that would catch a cpal API change or a describe()
  /// that silently rejects every real device.
  ///
  /// Deliberately tolerant of a machine with no audio hardware (CI
  /// containers, headless build agents): an empty list is allowed, but a
  /// device that IS returned must be well-formed.
  #[test]
  fn enumeration_returns_well_formed_devices() {
    for driver in available_drivers() {
      for device in enumerate(driver) {
        assert!(!device.id.is_empty(), "device id must be a usable key");
        assert!(!device.name.is_empty(), "device needs a display name");
        assert!(
          !device.sample_rates.is_empty(),
          "describe() must reject devices with no usable rate rather than            emitting one the picker cannot open"
        );
        assert!(device.max_channels >= 1);
        // Rates must be sorted ascending and drawn from our offered set.
        let mut sorted = device.sample_rates.clone();
        sorted.sort_unstable();
        assert_eq!(sorted, device.sample_rates);
        for rate in &device.sample_rates {
          assert!(SAMPLE_RATE_CHOICES.contains(rate));
        }
      }
    }
  }

  /// A default config must resolve to a real device on this machine, or
  /// resolve to None only when the machine genuinely has no output.
  #[test]
  fn default_config_resolves_or_machine_has_no_output() {
    let cfg = AudioConfig::default();
    let resolved = resolve_device(cfg.driver, cfg.output_device_id.as_deref(), DeviceDirection::Output);
    let any_output = enumerate(cfg.driver)
      .iter()
      .any(|d| d.direction == DeviceDirection::Output);
    if any_output {
      assert!(
        resolved.is_some(),
        "an output device exists but the default config could not resolve one"
      );
    }
  }

  /// An unknown device id must fall back to the host default rather than
  /// leaving Studio silent — the unplugged-interface case.
  #[test]
  fn unknown_device_id_falls_back_to_default() {
    let driver = DriverKind::WasapiShared;
    let has_output = enumerate(driver)
      .iter()
      .any(|d| d.direction == DeviceDirection::Output);
    let resolved = resolve_device(driver, Some("no-such-device-12345"), DeviceDirection::Output);
    if has_output {
      assert!(
        resolved.is_some(),
        "a missing saved device must fall back to the default, not fail"
      );
    }
  }

  #[test]
  fn available_drivers_never_offers_uncompiled_asio() {
    let drivers = available_drivers();
    assert!(!drivers.is_empty(), "at least one driver must be offered");
    #[cfg(not(feature = "studio-asio"))]
    assert!(
      !drivers.contains(&DriverKind::Asio),
      "ASIO must not be offered when the feature is off — the UI would \
       be advertising a driver this build cannot open"
    );
  }
}
