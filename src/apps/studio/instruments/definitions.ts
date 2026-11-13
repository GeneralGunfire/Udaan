/**
 * Instrument definitions for the native engine.
 *
 * ## What changed from the Tone.js version
 * The old instruments were runtime objects that owned Tone.Sampler nodes
 * and streamed samples from a CDN on every note. The native engine cannot
 * do either: it needs local file paths, decoded ahead of time, and it
 * plays samples by index rather than by object. So an instrument is now
 * pure *data* — which sample files it needs, and which MIDI pitch each one
 * was recorded at. Loading turns that into engine sample slots
 * (see `instrumentLoader.ts`); playing is then just "trigger slot N".
 *
 * ## Why multisampling matters here
 * A sampler pitch-shifts one recording to cover neighbouring notes. Shift
 * too far and it stops sounding like the instrument — a piano stretched
 * an octave sounds like a cartoon. So each instrument lists several
 * recordings across its range, and `sampleForPitch` picks the nearest
 * root, keeping every note within a few semitones of a real recording.
 */

/** One recorded sample and the pitch it was played at. */
export interface SampleDef {
  /** Cache key and relative path, e.g. "piano/C4.mp3". */
  key: string
  /** Absolute URL to fetch from on first use. */
  url: string
  /** MIDI pitch this file was recorded at, used for pitch shifting. */
  rootPitch: number
}

export type InstrumentFamily = 'keys' | 'bass' | 'guitar' | 'strings' | 'drums' | 'tuned'

export interface InstrumentDef {
  id: string
  name: string
  family: InstrumentFamily
  /** Short line shown under the name in the browser. */
  description: string
  /** Playable range for on-screen keyboards, as MIDI pitches. */
  range: { low: number; high: number }
  samples: SampleDef[]
  /**
   * Fixed-pitch instruments (drum kits) map each sample to one MIDI note
   * rather than pitch-shifting across a range. The step sequencer and
   * drum editor use this to label rows.
   */
  drumMap?: { pitch: number; name: string; sampleKey: string }[]
}

const TONEJS = 'https://raw.githubusercontent.com/nbrosowsky/tonejs-instruments/master/samples/'
const SALAMANDER = 'https://tonejs.github.io/audio/salamander/'
const TR808 = 'https://raw.githubusercontent.com/smpldsnds/drum-machines/main/TR-808/'

/** MIDI pitch from a note name like "C4" or "Ds3" (sharp written as 's'). */
function pitchOf(note: string): number {
  const match = /^([A-G])(s|#)?(-?\d+)$/.exec(note)
  if (!match) throw new Error(`Bad note name: ${note}`)
  const [, letter, sharp, octave] = match
  const base: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }
  return (Number(octave) + 1) * 12 + base[letter] + (sharp ? 1 : 0)
}

/**
 * Builds sample definitions from a folder and a list of note names.
 * The file naming convention ("Ds3.mp3" for D#3) is shared by every
 * tonejs-instruments set, so one helper covers nearly all of them.
 */
function samplesFrom(
  folder: string,
  baseUrl: string,
  notes: string[],
  extension = 'mp3',
): SampleDef[] {
  return notes.map((note) => ({
    key: `${folder}/${note}.${extension}`,
    url: `${baseUrl}${note}.${extension}`,
    rootPitch: pitchOf(note),
  }))
}

// Note sets are deliberately spread roughly a third apart: close enough
// that no note is pitch-shifted more than about three semitones, sparse
// enough that an instrument is a handful of megabytes rather than tens.
const PIANO_NOTES = ['C1', 'Ds1', 'Fs1', 'A1', 'C2', 'Ds2', 'Fs2', 'A2', 'C3', 'Ds3', 'Fs3', 'A3', 'C4', 'Ds4', 'Fs4', 'A4', 'C5', 'Ds5', 'Fs5', 'A5', 'C6']
const BASS_NOTES = ['As1', 'Cs2', 'E2', 'G2', 'As2', 'Cs3', 'E3', 'G3', 'As3', 'Cs4', 'E4']
const GUITAR_NOTES = ['Cs2', 'Fs2', 'Ds3', 'A3', 'Cs4', 'Fs4', 'Ds5', 'A5']
const ORGAN_NOTES = ['C1', 'Ds1', 'Fs1', 'A1', 'C2', 'Ds2', 'Fs2', 'A2', 'C3', 'Ds3', 'Fs3', 'A3', 'C4', 'Ds4', 'Fs4', 'A4', 'C5']
const STRING_NOTES = ['C4', 'E4', 'G4', 'C5', 'E5', 'G5', 'C6']
const HARP_NOTES = ['C3', 'F3', 'A3', 'C4', 'F4', 'A4', 'C5', 'F5']
const XYLO_NOTES = ['C4', 'G4', 'C5', 'G5', 'C6', 'G6', 'C7']
const HARMONIUM_NOTES = ['C2', 'Ds2', 'Fs2', 'A2', 'C3', 'Ds3', 'Fs3', 'A3', 'C4', 'Ds4', 'Fs4', 'A4']

const DRUM_SOUNDS: { id: string; name: string; file: string; pitch: number }[] = [
  { id: 'kick', name: 'Kick', file: 'kick/bd0000.ogg', pitch: 36 },
  { id: 'snare', name: 'Snare', file: 'snare/sd0000.ogg', pitch: 38 },
  { id: 'closedHat', name: 'Closed Hat', file: 'hihat-close/ch.ogg', pitch: 42 },
  { id: 'openHat', name: 'Open Hat', file: 'hihat-open/oh00.ogg', pitch: 46 },
  { id: 'clap', name: 'Clap', file: 'clap/cp.ogg', pitch: 39 },
  { id: 'rimshot', name: 'Rim', file: 'rimshot/rs.ogg', pitch: 37 },
  { id: 'lowTom', name: 'Low Tom', file: 'tom-low/lt00.ogg', pitch: 45 },
  { id: 'midTom', name: 'Mid Tom', file: 'tom-mid/mt00.ogg', pitch: 47 },
  { id: 'cymbal', name: 'Cymbal', file: 'cymbal/cy0000.ogg', pitch: 49 },
  { id: 'cowbell', name: 'Cowbell', file: 'cowbell/cb.ogg', pitch: 56 },
]

export const INSTRUMENTS: InstrumentDef[] = [
  {
    id: 'piano',
    name: 'Grand Piano',
    family: 'keys',
    description: 'Warm acoustic grand, the default for chords and melody',
    range: { low: 21, high: 108 },
    samples: samplesFrom('piano', SALAMANDER, PIANO_NOTES),
  },
  {
    id: 'organ',
    name: 'Organ',
    family: 'keys',
    description: 'Sustained electric organ, good for pads and stabs',
    range: { low: 24, high: 96 },
    samples: samplesFrom('organ', `${TONEJS}organ/`, ORGAN_NOTES),
  },
  {
    id: 'harmonium',
    name: 'Harmonium',
    family: 'keys',
    description: 'Reedy, breathy sustain with a folk character',
    range: { low: 36, high: 84 },
    samples: samplesFrom('harmonium', `${TONEJS}harmonium/`, HARMONIUM_NOTES),
  },
  {
    id: 'bass',
    name: 'Electric Bass',
    family: 'bass',
    description: 'Fingered electric bass for low-end foundation',
    range: { low: 28, high: 67 },
    samples: samplesFrom('bass-electric', `${TONEJS}bass-electric/`, BASS_NOTES),
  },
  {
    id: 'guitar-electric',
    name: 'Electric Guitar',
    family: 'guitar',
    description: 'Clean electric, ready for amp and effects',
    range: { low: 40, high: 88 },
    samples: samplesFrom('guitar-electric', `${TONEJS}guitar-electric/`, GUITAR_NOTES),
  },
  {
    id: 'guitar-nylon',
    name: 'Nylon Guitar',
    family: 'guitar',
    description: 'Soft classical nylon strings',
    range: { low: 40, high: 88 },
    samples: samplesFrom('guitar-nylon', `${TONEJS}guitar-nylon/`, GUITAR_NOTES),
  },
  {
    id: 'strings',
    name: 'Strings',
    family: 'strings',
    description: 'Bowed violin section for swells and pads',
    range: { low: 55, high: 96 },
    samples: samplesFrom('violin', `${TONEJS}violin/`, STRING_NOTES),
  },
  {
    id: 'harp',
    name: 'Harp',
    family: 'tuned',
    description: 'Plucked harp, bright and decaying',
    range: { low: 36, high: 84 },
    samples: samplesFrom('harp', `${TONEJS}harp/`, HARP_NOTES),
  },
  {
    id: 'xylophone',
    name: 'Xylophone',
    family: 'tuned',
    description: 'Struck wooden bars, short and percussive',
    range: { low: 60, high: 96 },
    samples: samplesFrom('xylophone', `${TONEJS}xylophone/`, XYLO_NOTES),
  },
  {
    id: 'drums',
    name: 'Drum Machine',
    family: 'drums',
    description: 'TR-808 kit for the step sequencer',
    range: { low: 36, high: 56 },
    samples: DRUM_SOUNDS.map((d) => ({
      key: `tr808/${d.id}.ogg`,
      url: `${TR808}${d.file}`,
      // A drum sample is never pitch-shifted, so its root is its own note.
      rootPitch: d.pitch,
    })),
    drumMap: DRUM_SOUNDS.map((d) => ({
      pitch: d.pitch,
      name: d.name,
      sampleKey: `tr808/${d.id}.ogg`,
    })),
  },
]

export function instrumentById(id: string): InstrumentDef | undefined {
  return INSTRUMENTS.find((i) => i.id === id)
}

/**
 * Picks the sample whose recorded pitch is nearest `pitch`.
 *
 * This is the whole point of multisampling: playing C5 from a C5
 * recording sounds like the instrument, while stretching a C1 recording
 * up four octaves does not.
 */
export function sampleForPitch(def: InstrumentDef, pitch: number): SampleDef | undefined {
  if (def.samples.length === 0) return undefined

  // Fixed-pitch kits map one sample per note; a "nearest" match would
  // silently play a snare when a kick was asked for.
  if (def.drumMap) {
    const entry = def.drumMap.find((d) => d.pitch === pitch)
    return entry ? def.samples.find((s) => s.key === entry.sampleKey) : undefined
  }

  let best = def.samples[0]
  let bestDistance = Math.abs(best.rootPitch - pitch)
  for (const sample of def.samples) {
    const distance = Math.abs(sample.rootPitch - pitch)
    if (distance < bestDistance) {
      best = sample
      bestDistance = distance
    }
  }
  return best
}

/** Instruments grouped for the browser's category list. */
export const FAMILY_LABELS: Record<InstrumentFamily, string> = {
  keys: 'Keys',
  bass: 'Bass',
  guitar: 'Guitar',
  strings: 'Strings',
  drums: 'Drums',
  tuned: 'Tuned Percussion',
}
