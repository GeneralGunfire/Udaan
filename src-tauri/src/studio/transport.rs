//! The transport: playhead position, looping, and note scheduling.
//!
//! ## Why the playhead is an integer frame counter
//! Every DAW that tracks position in seconds-as-float eventually drifts,
//! because repeatedly adding `block_size / sample_rate` accumulates
//! rounding error. Counting whole frames cannot drift: the playhead after
//! N blocks is exactly the number of frames rendered. Musical time (bars,
//! beats) is derived from that integer on demand, never accumulated
//! alongside it.
//!
//! ## Why scheduling looks at a window, not "the current frame"
//! The audio callback renders a block of frames at once (say 512). A note
//! starting anywhere inside that block must be triggered during it, and
//! ideally at its exact offset rather than quantized to the block start.
//! So the scheduler asks "which notes start within [position, position +
//! block_len)?" and reports each with its offset into the block. Missing
//! this is what makes a naive sequencer sound loose — every note quantized
//! to the block grid, which at 512 frames is ~11ms of jitter.
//!
//! ## Looping wraps mid-block
//! When the loop end falls inside the current block, the block is split:
//! render up to the loop point, jump the playhead to the loop start, then
//! render the remainder. Handling this only at block boundaries would make
//! the loop length audibly snap to the buffer size.

use crate::studio::messages::{FramePos, ScheduledNote};

/// Playhead and loop state. Owned by the audio thread.
#[derive(Debug, Clone)]
pub struct Transport {
  /// Current playhead, in frames from the timeline start.
  position: FramePos,
  playing: bool,
  /// Inclusive start, exclusive end. `None` means no looping.
  loop_region: Option<(FramePos, FramePos)>,
  /// Frames per beat at the current tempo, used only for the metronome.
  frames_per_beat: f64,
  metronome: bool,
}

impl Transport {
  pub fn new() -> Self {
    Self {
      position: 0,
      playing: false,
      loop_region: None,
      // 120bpm at 48kHz = 24000 frames per beat. Replaced by the UI's
      // computed value as soon as a project loads.
      frames_per_beat: 24_000.0,
      metronome: false,
    }
  }

  pub fn position(&self) -> FramePos {
    self.position
  }

  pub fn is_playing(&self) -> bool {
    self.playing
  }

  pub fn metronome_enabled(&self) -> bool {
    self.metronome
  }

  pub fn set_metronome(&mut self, on: bool) {
    self.metronome = on;
  }

  pub fn set_frames_per_beat(&mut self, fpb: f64) {
    // Guard against a zero/negative tempo reaching the beat math and
    // producing an infinite or NaN beat index.
    if fpb.is_finite() && fpb > 0.0 {
      self.frames_per_beat = fpb;
    }
  }

  pub fn play(&mut self) {
    self.playing = true;
  }

  pub fn stop(&mut self) {
    self.playing = false;
  }

  pub fn stop_and_rewind(&mut self) {
    self.playing = false;
    self.position = 0;
  }

  pub fn seek(&mut self, pos: FramePos) {
    self.position = pos;
  }

  pub fn set_loop(&mut self, region: Option<(FramePos, FramePos)>) {
    // An inverted or empty region would trap the playhead, so reject it
    // rather than storing something that cannot be advanced past.
    self.loop_region = match region {
      Some((start, end)) if end > start => Some((start, end)),
      _ => None,
    };
  }

  pub fn loop_region(&self) -> Option<(FramePos, FramePos)> {
    self.loop_region
  }

  /// How many frames may be rendered before the playhead must either
  /// wrap to the loop start or simply continue. Returns the number of
  /// frames available and whether a loop wrap follows them.
  ///
  /// This is what lets a loop end land mid-block instead of snapping to
  /// the buffer size.
  pub fn frames_until_wrap(&self, block_frames: u64) -> (u64, bool) {
    let Some((start, end)) = self.loop_region else {
      return (block_frames, false);
    };
    // Only wrap if the playhead is actually inside the region; a playhead
    // before the loop start plays in normally.
    if self.position < start || self.position >= end {
      return (block_frames, false);
    }
    let remaining = end - self.position;
    if remaining <= block_frames {
      (remaining, true)
    } else {
      (block_frames, false)
    }
  }

  /// Advances the playhead by `frames`, wrapping to the loop start if
  /// `wrap` is set. Only advances while playing.
  pub fn advance(&mut self, frames: u64, wrap: bool) {
    if !self.playing {
      return;
    }
    self.position += frames;
    if wrap {
      if let Some((start, _)) = self.loop_region {
        self.position = start;
      }
    }
  }

  /// Beat index at the current playhead, used to decide metronome clicks.
  pub fn beat_at(&self, pos: FramePos) -> u64 {
    (pos as f64 / self.frames_per_beat) as u64
  }

  /// Finds metronome click positions inside `[position, position+frames)`,
  /// reported as offsets into the block. Written into `out` to avoid
  /// allocating in the callback.
  pub fn clicks_in_block(&self, frames: u64, out: &mut Vec<u64>) {
    out.clear();
    if !self.metronome || !self.playing || self.frames_per_beat <= 0.0 {
      return;
    }
    let start = self.position;
    let end = start + frames;
    // First beat boundary at or after `start`.
    let first_beat = (start as f64 / self.frames_per_beat).ceil() as u64;
    let mut beat = first_beat;
    loop {
      let beat_frame = (beat as f64 * self.frames_per_beat).round() as u64;
      if beat_frame >= end {
        break;
      }
      if beat_frame >= start {
        out.push(beat_frame - start);
      }
      beat += 1;
    }
  }
}

impl Default for Transport {
  fn default() -> Self {
    Self::new()
  }
}

/// A note that must be triggered during the current block, with its
/// sample-accurate offset from the block start.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct DueNote {
  pub note: ScheduledNote,
  /// Frames from the start of this block.
  pub offset: u64,
}

/// Collects notes starting inside `[from, from + frames)`.
///
/// `notes` must be sorted by `start`; the engine guarantees that when it
/// installs them, which lets this scan stop early instead of walking the
/// whole list every block. Results are written into `out` rather than
/// returned, so no allocation happens on the audio thread.
pub fn notes_due(notes: &[ScheduledNote], from: FramePos, frames: u64, out: &mut Vec<DueNote>) {
  out.clear();
  if frames == 0 {
    return;
  }
  let end = from + frames;
  for note in notes {
    if note.start >= end {
      // Sorted input means everything after this is also in the future.
      break;
    }
    if note.start >= from {
      out.push(DueNote { note: *note, offset: note.start - from });
    }
  }
}

/// Finds notes whose `end` falls inside the block, so the engine knows
/// when to release them. Same sorted-scan contract as `notes_due` does
/// not apply here (notes are sorted by start, not end), so this scans the
/// full slice — acceptable because clip note counts are small and the
/// comparison is a single integer test.
pub fn notes_ending(notes: &[ScheduledNote], from: FramePos, frames: u64, out: &mut Vec<DueNote>) {
  out.clear();
  if frames == 0 {
    return;
  }
  let end = from + frames;
  for note in notes {
    if note.end >= from && note.end < end {
      out.push(DueNote { note: *note, offset: note.end - from });
    }
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  fn note(start: FramePos, end: FramePos, pitch: u8) -> ScheduledNote {
    ScheduledNote { start, end, pitch, velocity: 1.0, sample: 0 }
  }

  #[test]
  fn stopped_transport_does_not_advance() {
    let mut t = Transport::new();
    t.advance(512, false);
    assert_eq!(t.position(), 0, "a stopped transport must hold position");
  }

  #[test]
  fn playing_transport_advances_exactly() {
    let mut t = Transport::new();
    t.play();
    for _ in 0..100 {
      t.advance(512, false);
    }
    // Integer counting means this is exact, with no accumulated drift.
    assert_eq!(t.position(), 51_200);
  }

  #[test]
  fn stop_holds_position_but_rewind_resets() {
    let mut t = Transport::new();
    t.play();
    t.advance(1000, false);
    t.stop();
    assert_eq!(t.position(), 1000, "stop must not lose the position");
    t.stop_and_rewind();
    assert_eq!(t.position(), 0);
  }

  #[test]
  fn loop_wraps_mid_block_not_at_block_boundary() {
    // Loop ends 100 frames into a 512-frame block: the transport must
    // report only 100 frames available, then wrap. Snapping to 512 would
    // make every loop length a multiple of the buffer size.
    let mut t = Transport::new();
    t.play();
    t.set_loop(Some((0, 1000)));
    t.seek(900);

    let (avail, wrap) = t.frames_until_wrap(512);
    assert_eq!(avail, 100);
    assert!(wrap);

    t.advance(avail, wrap);
    assert_eq!(t.position(), 0, "must wrap to the loop start");
  }

  #[test]
  fn no_wrap_when_block_fits_inside_the_loop() {
    let mut t = Transport::new();
    t.play();
    t.set_loop(Some((0, 10_000)));
    t.seek(0);
    let (avail, wrap) = t.frames_until_wrap(512);
    assert_eq!(avail, 512);
    assert!(!wrap);
  }

  #[test]
  fn playhead_before_loop_start_plays_in_normally() {
    // Pressing play from before the loop region should not teleport the
    // playhead into it.
    let mut t = Transport::new();
    t.play();
    t.set_loop(Some((5000, 6000)));
    t.seek(0);
    let (avail, wrap) = t.frames_until_wrap(512);
    assert_eq!(avail, 512);
    assert!(!wrap);
  }

  #[test]
  fn inverted_or_empty_loop_is_rejected() {
    // An end <= start would trap the playhead forever.
    let mut t = Transport::new();
    t.set_loop(Some((1000, 1000)));
    assert!(t.loop_region().is_none());
    t.set_loop(Some((2000, 1000)));
    assert!(t.loop_region().is_none());
  }

  #[test]
  fn notes_due_reports_sample_accurate_offsets() {
    // The whole point of the window scan: a note 300 frames into the
    // block must report offset 300, not 0.
    let notes = vec![note(0, 100, 60), note(300, 400, 62), note(9000, 9100, 64)];
    let mut out = Vec::new();
    notes_due(&notes, 0, 512, &mut out);

    assert_eq!(out.len(), 2);
    assert_eq!(out[0].offset, 0);
    assert_eq!(out[1].offset, 300);
    assert_eq!(out[1].note.pitch, 62);
  }

  #[test]
  fn notes_due_excludes_the_window_end_exclusively() {
    // A note exactly at the block end belongs to the NEXT block; counting
    // it twice would double-trigger it.
    let notes = vec![note(512, 600, 60)];
    let mut out = Vec::new();
    notes_due(&notes, 0, 512, &mut out);
    assert!(out.is_empty(), "note at the exclusive end must not fire yet");

    notes_due(&notes, 512, 512, &mut out);
    assert_eq!(out.len(), 1, "it must fire in the following block");
    assert_eq!(out[0].offset, 0);
  }

  #[test]
  fn every_note_fires_exactly_once_across_consecutive_blocks() {
    // Walk a timeline in blocks and count triggers — the regression that
    // matters most, since a missed or doubled note is immediately audible.
    let notes: Vec<_> = (0..50).map(|i| note(i * 137, i * 137 + 50, 60)).collect();
    let mut fired = 0;
    let mut out = Vec::new();
    let mut pos = 0u64;
    while pos < 50 * 137 + 200 {
      notes_due(&notes, pos, 512, &mut out);
      fired += out.len();
      pos += 512;
    }
    assert_eq!(fired, 50, "each note must trigger exactly once");
  }

  #[test]
  fn notes_ending_finds_releases_in_window() {
    let notes = vec![note(0, 100, 60), note(0, 700, 62)];
    let mut out = Vec::new();
    notes_ending(&notes, 0, 512, &mut out);
    assert_eq!(out.len(), 1);
    assert_eq!(out[0].note.pitch, 60);
    assert_eq!(out[0].offset, 100);
  }

  #[test]
  fn zero_length_block_yields_nothing() {
    let notes = vec![note(0, 100, 60)];
    let mut out = Vec::new();
    notes_due(&notes, 0, 0, &mut out);
    assert!(out.is_empty());
    notes_ending(&notes, 0, 0, &mut out);
    assert!(out.is_empty());
  }

  #[test]
  fn metronome_clicks_land_on_beat_boundaries() {
    let mut t = Transport::new();
    t.play();
    t.set_metronome(true);
    t.set_frames_per_beat(1000.0);
    t.seek(0);

    let mut clicks = Vec::new();
    t.clicks_in_block(2500, &mut clicks);
    // Beats at 0, 1000, 2000 fall inside [0, 2500).
    assert_eq!(clicks, vec![0, 1000, 2000]);
  }

  #[test]
  fn metronome_is_silent_when_disabled_or_stopped() {
    let mut t = Transport::new();
    t.set_frames_per_beat(1000.0);
    let mut clicks = Vec::new();

    // Playing but metronome off.
    t.play();
    t.clicks_in_block(4000, &mut clicks);
    assert!(clicks.is_empty());

    // Metronome on but transport stopped.
    t.set_metronome(true);
    t.stop();
    t.clicks_in_block(4000, &mut clicks);
    assert!(clicks.is_empty(), "a stopped transport must not click");
  }

  #[test]
  fn clicks_do_not_double_across_block_boundaries() {
    let mut t = Transport::new();
    t.play();
    t.set_metronome(true);
    t.set_frames_per_beat(1000.0);

    let mut total = 0;
    let mut clicks = Vec::new();
    for _ in 0..10 {
      t.clicks_in_block(512, &mut clicks);
      total += clicks.len();
      t.advance(512, false);
    }
    // 5120 frames at 1000 frames/beat spans beats 0..5 inclusive = 6.
    assert_eq!(total, 6, "each beat must click exactly once");
  }

  #[test]
  fn invalid_tempo_is_ignored() {
    // A zero or NaN tempo would make the beat index infinite.
    let mut t = Transport::new();
    t.set_frames_per_beat(1000.0);
    t.set_frames_per_beat(0.0);
    t.set_frames_per_beat(f64::NAN);
    assert_eq!(t.beat_at(2000), 2, "tempo must remain the last valid value");
  }
}
