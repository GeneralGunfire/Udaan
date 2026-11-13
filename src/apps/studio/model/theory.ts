/**
 * Music theory helpers — the layer that lets someone with no theory
 * knowledge still land on notes that work together.
 *
 * ## Why this exists as real logic, not a lookup table of presets
 * The spec's core promise is that a beginner can make a beat without
 * knowing theory. That only holds if the app can answer questions like
 * "which notes belong in this key", "what chord is this", and "what
 * would come next" for *any* key the user picks, not for a handful of
 * hardcoded ones. So scales and chords are computed from intervals.
 *
 * ## Pitch classes and octaves
 * A MIDI pitch is `octave * 12 + pitchClass`, where pitch class 0 is C.
 * Middle C (C4) is MIDI 60, which puts octave numbering at
 * `Math.floor(pitch / 12) - 1`. That -1 is the standard scientific pitch
 * notation offset and is the single most common off-by-one in this area,
 * so it lives in one function rather than being re-derived at call sites.
 */

import type { KeySignature, Pitch, ScaleName } from './project'

/** Note names, sharp spelling. Index is the pitch class. */
export const NOTE_NAMES = [
  'C',
  'C#',
  'D',
  'D#',
  'E',
  'F',
  'F#',
  'G',
  'G#',
  'A',
  'A#',
  'B',
] as const

/** Flat spelling, used when a key signature reads better with flats. */
export const NOTE_NAMES_FLAT = [
  'C',
  'Db',
  'D',
  'Eb',
  'E',
  'F',
  'Gb',
  'G',
  'Ab',
  'A',
  'Bb',
  'B',
] as const

/** Semitone offsets from the tonic for each supported scale. */
export const SCALE_INTERVALS: Record<ScaleName, readonly number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  naturalMinor: [0, 2, 3, 5, 7, 8, 10],
  harmonicMinor: [0, 2, 3, 5, 7, 8, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  pentatonicMajor: [0, 2, 4, 7, 9],
  pentatonicMinor: [0, 3, 5, 7, 10],
  blues: [0, 3, 5, 6, 7, 10],
  chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
}

/** Human labels for the scale picker. */
export const SCALE_LABELS: Record<ScaleName, string> = {
  major: 'Major',
  naturalMinor: 'Minor',
  harmonicMinor: 'Harmonic Minor',
  dorian: 'Dorian',
  mixolydian: 'Mixolydian',
  pentatonicMajor: 'Major Pentatonic',
  pentatonicMinor: 'Minor Pentatonic',
  blues: 'Blues',
  chromatic: 'Chromatic',
}

/** Pitch class (0-11) of a MIDI pitch. */
export function pitchClass(pitch: Pitch): number {
  return ((pitch % 12) + 12) % 12
}

/**
 * Octave number in scientific pitch notation, where middle C (MIDI 60)
 * is C4. The -1 offset is the convention, not an error.
 */
export function octaveOf(pitch: Pitch): number {
  return Math.floor(pitch / 12) - 1
}

/** "C4", "F#3" — the label shown on piano keys and in the note readout. */
export function noteName(pitch: Pitch, flats = false): string {
  const names = flats ? NOTE_NAMES_FLAT : NOTE_NAMES
  return `${names[pitchClass(pitch)]}${octaveOf(pitch)}`
}

/** True when a black key. Used for piano-roll and keyboard rendering. */
export function isBlackKey(pitch: Pitch): boolean {
  return [1, 3, 6, 8, 10].includes(pitchClass(pitch))
}

/** Every pitch class belonging to `key`, as a set for O(1) membership. */
export function scalePitchClasses(key: KeySignature): Set<number> {
  const out = new Set<number>()
  for (const interval of SCALE_INTERVALS[key.scale]) {
    out.add((key.root + interval) % 12)
  }
  return out
}

/** Whether a pitch is in the project's key — drives scale highlighting. */
export function isInScale(pitch: Pitch, key: KeySignature): boolean {
  return scalePitchClasses(key).has(pitchClass(pitch))
}

/**
 * Moves a pitch to the nearest note in the key.
 *
 * This is what "constrain to scale" does when drawing in the piano roll:
 * a beginner can draw anywhere and still land on something that fits.
 * Ties break upward, which keeps a rising line rising.
 */
export function snapToScale(pitch: Pitch, key: KeySignature): Pitch {
  const allowed = scalePitchClasses(key)
  if (allowed.has(pitchClass(pitch))) return pitch

  for (let distance = 1; distance <= 6; distance += 1) {
    if (allowed.has(pitchClass(pitch + distance))) return pitch + distance
    if (allowed.has(pitchClass(pitch - distance))) return pitch - distance
  }
  return pitch
}

/** Chord qualities the app can build and name. */
export type ChordQuality =
  | 'major'
  | 'minor'
  | 'diminished'
  | 'augmented'
  | 'major7'
  | 'minor7'
  | 'dominant7'
  | 'sus2'
  | 'sus4'

export const CHORD_INTERVALS: Record<ChordQuality, readonly number[]> = {
  major: [0, 4, 7],
  minor: [0, 3, 7],
  diminished: [0, 3, 6],
  augmented: [0, 4, 8],
  major7: [0, 4, 7, 11],
  minor7: [0, 3, 7, 10],
  dominant7: [0, 4, 7, 10],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
}

/** Suffix used when naming a chord: "Am", "Cmaj7", "Gsus4". */
export const CHORD_SUFFIX: Record<ChordQuality, string> = {
  major: '',
  minor: 'm',
  diminished: 'dim',
  augmented: 'aug',
  major7: 'maj7',
  minor7: 'm7',
  dominant7: '7',
  sus2: 'sus2',
  sus4: 'sus4',
}

export interface Chord {
  root: Pitch
  quality: ChordQuality
  /** Actual pitches, root position, starting at `root`. */
  pitches: Pitch[]
  /** Display name, e.g. "Am7". */
  name: string
}

export function buildChord(root: Pitch, quality: ChordQuality, flats = false): Chord {
  const pitches = CHORD_INTERVALS[quality].map((i) => root + i)
  const names = flats ? NOTE_NAMES_FLAT : NOTE_NAMES
  return {
    root,
    quality,
    pitches,
    name: `${names[pitchClass(root)]}${CHORD_SUFFIX[quality]}`,
  }
}

/**
 * The seven diatonic triads of a key, in scale order.
 *
 * This is what fills the chord pads: every chord returned is guaranteed
 * to fit the project key, so a user can click any pad and it will work.
 * Quality is derived from the scale's own intervals rather than assumed,
 * which is why minor keys correctly yield i, ii°, III, iv, v, VI, VII.
 */
export function diatonicTriads(key: KeySignature, octave = 4): Chord[] {
  const intervals = SCALE_INTERVALS[key.scale]
  // Pentatonic and blues scales have too few degrees to stack thirds
  // meaningfully; fall back to the parent seven-note scale so the chord
  // pads still offer something usable rather than nothing.
  const source =
    intervals.length >= 7
      ? intervals
      : SCALE_INTERVALS[key.scale === 'pentatonicMajor' ? 'major' : 'naturalMinor']

  const base = (octave + 1) * 12 + key.root
  const chords: Chord[] = []

  for (let degree = 0; degree < source.length; degree += 1) {
    const root = base + source[degree]
    // Stack thirds by stepping two scale degrees at a time, wrapping into
    // the next octave so the intervals stay correct across the boundary.
    const third = base + stepInScale(source, degree, 2)
    const fifth = base + stepInScale(source, degree, 4)

    const thirdInterval = third - root
    const fifthInterval = fifth - root

    let quality: ChordQuality = 'major'
    if (thirdInterval === 3 && fifthInterval === 6) quality = 'diminished'
    else if (thirdInterval === 3) quality = 'minor'
    else if (thirdInterval === 4 && fifthInterval === 8) quality = 'augmented'
    else quality = 'major'

    chords.push(buildChord(root, quality))
  }
  return chords
}

/** Interval `steps` scale degrees above `degree`, wrapping octaves. */
function stepInScale(intervals: readonly number[], degree: number, steps: number): number {
  const size = intervals.length
  const index = degree + steps
  const octaves = Math.floor(index / size)
  return intervals[((index % size) + size) % size] + octaves * 12
}

/** Roman-numeral labels, upper for major, lower for minor/diminished. */
export function romanNumeral(index: number, quality: ChordQuality): string {
  const numerals = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII']
  const numeral = numerals[index % 7]
  if (quality === 'minor' || quality === 'minor7') return numeral.toLowerCase()
  if (quality === 'diminished') return `${numeral.toLowerCase()}°`
  return numeral
}

/** A named progression, as scale-degree indices (0 = tonic). */
export interface Progression {
  id: string
  name: string
  /** Zero-based scale degrees. */
  degrees: number[]
  /** Where this progression is commonly heard, for the picker's subtitle. */
  hint: string
}

/**
 * Progressions offered by the chord helper. Chosen because each is
 * genuinely ubiquitous in popular music and sounds resolved on its own,
 * so a beginner clicking any of them gets something that works.
 */
export const PROGRESSIONS: Progression[] = [
  { id: 'pop', name: 'I - V - vi - IV', degrees: [0, 4, 5, 3], hint: 'Pop, everywhere' },
  { id: 'sad', name: 'vi - IV - I - V', degrees: [5, 3, 0, 4], hint: 'Emotional, anthemic' },
  { id: 'doowop', name: 'I - vi - IV - V', degrees: [0, 5, 3, 4], hint: 'Classic, doo-wop' },
  { id: 'andalusian', name: 'i - VII - VI - V', degrees: [0, 6, 5, 4], hint: 'Dramatic, flamenco' },
  { id: 'jazz', name: 'ii - V - I', degrees: [1, 4, 0], hint: 'Jazz turnaround' },
  { id: 'blues', name: 'I - IV - I - V', degrees: [0, 3, 0, 4], hint: 'Blues, rock' },
  { id: 'loop', name: 'i - VI - III - VII', degrees: [0, 5, 2, 6], hint: 'Hip-hop, lo-fi' },
]

/** Resolves a progression's degrees into actual chords in `key`. */
export function chordsForProgression(
  progression: Progression,
  key: KeySignature,
  octave = 4,
): Chord[] {
  const triads = diatonicTriads(key, octave)
  return progression.degrees.map((degree) => triads[degree % triads.length])
}

/**
 * Suggested BPM ranges per genre, shown next to the tempo field so a
 * beginner has a defensible starting point instead of guessing.
 */
export const GENRE_TEMPOS: { id: string; name: string; min: number; max: number }[] = [
  { id: 'hiphop', name: 'Hip-Hop', min: 85, max: 100 },
  { id: 'trap', name: 'Trap', min: 130, max: 150 },
  { id: 'lofi', name: 'Lo-fi', min: 70, max: 90 },
  { id: 'house', name: 'House', min: 120, max: 128 },
  { id: 'edm', name: 'EDM', min: 124, max: 132 },
  { id: 'dnb', name: 'Drum & Bass', min: 170, max: 175 },
  { id: 'pop', name: 'Pop', min: 100, max: 130 },
  { id: 'rock', name: 'Rock', min: 110, max: 140 },
  { id: 'ballad', name: 'Ballad', min: 60, max: 80 },
]

/** Formats a key for the transport bar: "A Minor", "C Major". */
export function formatKey(key: KeySignature): string {
  return `${NOTE_NAMES[key.root % 12]} ${SCALE_LABELS[key.scale]}`
}

/**
 * Generates a melody that fits `chords`, one note per beat.
 *
 * Rule-based rather than random: each note is drawn from the current
 * chord's own tones (so it is always consonant) and biased toward staying
 * near the previous note (so the line moves stepwise instead of leaping
 * about). That combination is what makes generated output sound
 * deliberate rather than arbitrary, and it gives the user an editable
 * starting point rather than a black box.
 */
export function generateMelody(
  chords: Chord[],
  beatsPerChord: number,
  key: KeySignature,
  seed = Date.now(),
): { pitch: Pitch; start: number; duration: number; velocity: number }[] {
  // Small deterministic PRNG so the same seed regenerates the same
  // melody — a user who likes what they heard can get it back.
  let state = seed >>> 0
  const random = () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0xffffffff
  }

  const notes: { pitch: Pitch; start: number; duration: number; velocity: number }[] = []
  let previous = chords[0]?.pitches[0] ?? 60

  chords.forEach((chord, chordIndex) => {
    for (let beat = 0; beat < beatsPerChord; beat += 1) {
      // Rests keep the line from sounding mechanical; skip the downbeat
      // so every chord change is still articulated.
      if (beat > 0 && random() < 0.25) continue

      // Candidates: chord tones across two octaves, so the melody can
      // move up or down without leaving the harmony.
      const candidates = [
        ...chord.pitches,
        ...chord.pitches.map((p) => p + 12),
        ...chord.pitches.map((p) => p - 12),
      ].filter((p) => p >= 48 && p <= 84)

      // Prefer the candidate nearest the previous note — this is what
      // produces stepwise motion instead of random leaps.
      candidates.sort((a, b) => Math.abs(a - previous) - Math.abs(b - previous))
      const pick = candidates[Math.min(candidates.length - 1, Math.floor(random() * 3))]

      const pitch = snapToScale(pick, key)
      previous = pitch

      notes.push({
        pitch,
        start: chordIndex * beatsPerChord + beat,
        duration: random() < 0.3 ? 2 : 1,
        velocity: 0.6 + random() * 0.3,
      })
    }
  })

  return notes
}
