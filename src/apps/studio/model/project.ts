/**
 * Studio's project data model — the full DAW document.
 *
 * ## Musical time, not frames
 * Everything here is stored in **beats**, never frames or seconds. A
 * project saved at 90bpm and reopened at 120bpm must keep its
 * arrangement; storing frames would freeze the music to one tempo, and
 * storing seconds would do the same in disguise. The engine client
 * converts beats to frames at the boundary (see integrations/studio).
 *
 * ## Why ids are strings and engine slots are numbers
 * The UI needs stable, collision-free ids that survive reordering and
 * serialization, which is what strings give. The audio thread needs to
 * index an array without hashing, which is what its numeric `slot` gives.
 * `Track.slot` is the mapping between the two, assigned once when a track
 * is created and never reused while the track lives.
 */

/** MIDI note number; 60 is middle C (C4). */
export type Pitch = number

/** Position or length in beats (quarter notes). */
export type Beats = number

export type TrackKind = 'instrument' | 'audio'

/** One note inside a clip, positioned relative to the clip's start. */
export interface Note {
  id: string
  pitch: Pitch
  /** Start in beats, relative to the clip. */
  start: Beats
  /** Length in beats; always greater than zero. */
  duration: Beats
  /** 0-1. */
  velocity: number
}

/** A MIDI clip: a bag of notes placed on the timeline. */
export interface MidiClip {
  id: string
  kind: 'midi'
  name: string
  /** Position on the timeline, in beats from the project start. */
  start: Beats
  /** Clip length; notes beyond this are not played. */
  length: Beats
  notes: Note[]
  /** Repeats for the clip's whole duration when true (drum patterns). */
  looped: boolean
  muted: boolean
  color?: string
}

/** An audio clip: a region of a recorded or imported file. */
export interface AudioClip {
  id: string
  kind: 'audio'
  name: string
  start: Beats
  length: Beats
  /** Absolute path to the audio file on disk. */
  path: string
  /** Offset into the source file, in beats, for trimmed clips. */
  offset: Beats
  /** Fade lengths in beats, applied at the clip edges. */
  fadeIn: Beats
  fadeOut: Beats
  gain: number
  muted: boolean
  color?: string
}

export type Clip = MidiClip | AudioClip

/**
 * One recording pass. Takes stack under a track so a performer can record
 * repeatedly and choose the best parts afterwards (see `compSegments`).
 */
export interface Take {
  id: string
  name: string
  path: string
  start: Beats
  length: Beats
  createdAt: number
}

/**
 * A slice of the comp: which take is heard over a given range. Built by
 * swiping across take lanes; the ranges are contiguous and non-
 * overlapping, so the comp reads as one performance.
 */
export interface CompSegment {
  takeId: string
  start: Beats
  end: Beats
}

/** An effect on a track's insert chain. */
export interface InsertEffect {
  id: string
  /** Which effect this is — 'eq', 'compressor', 'reverb', and so on. */
  type: string
  /** Parameter values, shape defined by the effect's own descriptor. */
  params: Record<string, number | boolean | string>
  bypassed: boolean
}

export interface Track {
  id: string
  /** Dense numeric index the audio engine uses. Stable for the track's life. */
  slot: number
  name: string
  kind: TrackKind
  /** Which instrument this track plays; only for kind 'instrument'. */
  instrumentId?: string
  /** Input device id for recording; only for kind 'audio'. */
  inputDeviceId?: string
  color: string
  clips: Clip[]
  takes: Take[]
  comp: CompSegment[]
  inserts: InsertEffect[]
  /** Linear gain. The UI shows dB; this is what the engine receives. */
  gain: number
  /** -1 (hard left) to 1 (hard right). */
  pan: number
  muted: boolean
  soloed: boolean
  armed: boolean
  monitoring: boolean
  /** Collapsed track rows show a compact header and a thin clip lane. */
  height: 'compact' | 'normal' | 'tall'
}

/** A named point on the timeline: Intro, Verse, Chorus. */
export interface Marker {
  id: string
  name: string
  position: Beats
  color?: string
}

/**
 * A row of clips launched together in Session view. Scenes are the
 * loop-based half of the workflow; the arrangement is the linear half.
 */
export interface Scene {
  id: string
  name: string
  /** Clip id per track id; a track with no entry stays silent. */
  clips: Record<string, string>
}

export type ScaleName =
  | 'major'
  | 'naturalMinor'
  | 'harmonicMinor'
  | 'dorian'
  | 'mixolydian'
  | 'pentatonicMajor'
  | 'pentatonicMinor'
  | 'blues'
  | 'chromatic'

/** The project's musical key, used for scale highlighting and helpers. */
export interface KeySignature {
  /** Tonic as a pitch class, 0 = C. */
  root: number
  scale: ScaleName
}

export interface TimeSignature {
  numerator: number
  denominator: number
}

export interface Project {
  id: string
  name: string
  bpm: number
  key: KeySignature
  timeSignature: TimeSignature
  tracks: Track[]
  markers: Marker[]
  scenes: Scene[]
  /** Loop region in beats; null when looping is off. */
  loop: { start: Beats; end: Beats } | null
  /** Master bus gain, linear. */
  masterGain: number
  masterInserts: InsertEffect[]
  createdAt: number
  updatedAt: number
}

/**
 * Bumped whenever the persisted shape changes incompatibly. A project
 * tagged with a newer version than this build understands is refused
 * rather than loaded partially — a half-understood arrangement is worse
 * than a clear "this project is from a newer version".
 */
export const PROJECT_SCHEMA_VERSION = 1

export interface PersistedProject {
  schemaVersion: number
  project: Project
}

// ---------------------------------------------------------------------
// Construction helpers
// ---------------------------------------------------------------------

let idCounter = 0

/** Collision-free id. Time-prefixed so ids sort roughly by creation. */
export function newId(prefix: string): string {
  idCounter += 1
  return `${prefix}_${Date.now().toString(36)}_${idCounter.toString(36)}`
}

/**
 * Track colours. The app's palette is closed (see src/styles/tokens.css),
 * so tracks cannot separate by hue the way a conventional DAW's do —
 * these eight walk the palette's own ramp instead, alternating between
 * its cool and warm halves so adjacent tracks stay distinguishable by
 * value and temperature against the gray surface ladder. Assigned
 * round-robin as tracks are added, so a new project is legible without
 * anyone picking colours by hand.
 */
export const TRACK_COLORS = [
  '#092241', // dark navy
  '#c5c6c4', // light concrete
  '#313851', // slate navy
  '#a4a49d', // warm stone
  '#c2cbd3', // pale slate
  '#3b3c34', // olive charcoal
  '#f6f3ed', // bone
  '#7a7b7d', // mid gray
] as const

export function colorForIndex(index: number): string {
  return TRACK_COLORS[index % TRACK_COLORS.length]
}

export function createTrack(params: {
  slot: number
  name: string
  kind: TrackKind
  instrumentId?: string
  colorIndex?: number
}): Track {
  return {
    id: newId('track'),
    slot: params.slot,
    name: params.name,
    kind: params.kind,
    instrumentId: params.instrumentId,
    color: colorForIndex(params.colorIndex ?? params.slot),
    clips: [],
    takes: [],
    comp: [],
    inserts: [],
    gain: 1,
    pan: 0,
    muted: false,
    soloed: false,
    armed: false,
    monitoring: false,
    height: 'normal',
  }
}

export function createMidiClip(params: {
  name: string
  start: Beats
  length: Beats
  looped?: boolean
}): MidiClip {
  return {
    id: newId('clip'),
    kind: 'midi',
    name: params.name,
    start: params.start,
    length: params.length,
    notes: [],
    looped: params.looped ?? false,
    muted: false,
  }
}

export function createProject(name = 'Untitled'): Project {
  const now = Date.now()
  return {
    id: newId('project'),
    name,
    bpm: 120,
    key: { root: 0, scale: 'major' },
    timeSignature: { numerator: 4, denominator: 4 },
    tracks: [],
    markers: [],
    scenes: [],
    loop: null,
    masterGain: 1,
    masterInserts: [],
    createdAt: now,
    updatedAt: now,
  }
}

// ---------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------

/** Length of one bar in beats, from the time signature. */
export function beatsPerBar(sig: TimeSignature): number {
  // A 6/8 bar is six eighth-notes = three quarter-note beats, so the
  // denominator matters: beats here are always quarter notes.
  return sig.numerator * (4 / sig.denominator)
}

/**
 * Where the project ends, in beats — the furthest edge of any clip.
 * Used to size the timeline and to bound an export.
 */
export function projectLength(project: Project): Beats {
  let end = 0
  for (const track of project.tracks) {
    for (const clip of track.clips) {
      end = Math.max(end, clip.start + clip.length)
    }
  }
  return end
}

/**
 * Resolves which tracks are audible, applying the global solo rule: if
 * anything is soloed, only soloed tracks play. Deciding this per track in
 * isolation is the classic bug that silences the soloed track too.
 */
export function audibleTrackIds(project: Project): Set<string> {
  const anySoloed = project.tracks.some((t) => t.soloed)
  const out = new Set<string>()
  for (const track of project.tracks) {
    if (!track.muted && (!anySoloed || track.soloed)) out.add(track.id)
  }
  return out
}

/** The next free engine slot. Never reuses a live track's slot. */
export function nextSlot(project: Project): number {
  const used = new Set(project.tracks.map((t) => t.slot))
  let slot = 0
  while (used.has(slot)) slot += 1
  return slot
}
