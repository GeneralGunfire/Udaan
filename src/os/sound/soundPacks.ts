/**
 * Sound packs.
 *
 * Two independent choices, both in Settings, Sound:
 *   - the NOTIFICATION sound (what plays when a notification arrives), and
 *   - the INTERACTION sounds (every other sound: opening apps, switching windows and the 3D switcher,
 *     toggles, locking, errors and so on).
 * Either can be set to Off. The default pack of each is the sound Udaan has always had; it lives in
 * sounds.ts, so a missing or unknown pack id can never leave the interface silent or broken.
 *
 * Packs are synthesised like the rest of the engine (no samples to ship). An interaction pack is generated
 * from one template of musical intervals, so every pack covers every event and a pack changes the
 * character of the interface without changing which sound means what.
 */
import type { SoundId } from './sounds'

export interface PackPartial {
  ratio: number
  gain: number
  at?: number
  dur?: number
  type?: OscillatorType
  glide?: number
}

export interface PackVoice {
  freq: number
  at: number
  dur: number
  gain: number
  partials: PackPartial[]
  click?: number
  space?: number
}

export interface PackInfo {
  id: string
  name: string
  description: string
}

/* ── Interaction packs ─────────────────────────────────────────── */

/** Every interaction event as intervals relative to a pack's base pitch (ratio 1 is the old `tap`, 1180 Hz). */
type Step = { r: number; at?: number; dur: number; g: number; click?: number; space?: number; glide?: number }
const TEMPLATE: Record<Exclude<SoundId, 'notify'>, Step[]> = {
  tap: [{ r: 1, dur: 0.07, g: 0.5, click: 0.3, space: 0.1 }],
  hover: [{ r: 1.78, dur: 0.03, g: 0.16, space: 0.05 }],
  toggle: [{ r: 0.83, dur: 0.06, g: 0.45, click: 0.4 }],
  switch: [{ r: 0.7, dur: 0.08, g: 0.45, click: 0.35 }],
  open: [
    { r: 0.53, dur: 0.12, g: 0.5, click: 0.2, space: 0.3 },
    { r: 0.79, at: 0.05, dur: 0.22, g: 0.44, space: 0.4 },
  ],
  close: [
    { r: 0.75, dur: 0.1, g: 0.44, space: 0.25 },
    { r: 0.47, at: 0.045, dur: 0.2, g: 0.4, space: 0.35 },
  ],
  pop: [{ r: 0.63, dur: 0.09, g: 0.52, click: 0.45, space: 0.2 }],
  success: [
    { r: 0.66, dur: 0.16, g: 0.52, space: 0.4 },
    { r: 0.89, at: 0.08, dur: 0.18, g: 0.5, space: 0.45 },
    { r: 1.12, at: 0.16, dur: 0.44, g: 0.46, space: 0.6 },
  ],
  unlock: [
    { r: 0.44, dur: 0.18, g: 0.5, space: 0.4 },
    { r: 0.56, at: 0.08, dur: 0.2, g: 0.48, space: 0.45 },
    { r: 0.66, at: 0.16, dur: 0.24, g: 0.46, space: 0.5 },
    { r: 0.89, at: 0.24, dur: 0.6, g: 0.44, space: 0.7 },
  ],
  lock: [
    { r: 0.56, dur: 0.14, g: 0.48, space: 0.3 },
    { r: 0.28, at: 0.09, dur: 0.4, g: 0.5, space: 0.5 },
  ],
  boot: [
    { r: 0.22, dur: 0.5, g: 0.44, space: 0.6 },
    { r: 0.33, at: 0.14, dur: 0.5, g: 0.42, space: 0.65 },
    { r: 0.44, at: 0.28, dur: 0.6, g: 0.44, space: 0.7 },
    { r: 0.66, at: 0.42, dur: 0.9, g: 0.4, space: 0.8 },
  ],
  error: [
    { r: 0.26, dur: 0.18, g: 0.52, click: 0.3 },
    { r: 0.25, at: 0.02, dur: 0.26, g: 0.46, space: 0.3 },
  ],
  delete: [
    { r: 0.37, dur: 0.1, g: 0.48, click: 0.35 },
    { r: 0.23, at: 0.07, dur: 0.24, g: 0.44, space: 0.35 },
  ],
  minimize: [{ r: 0.66, dur: 0.16, g: 0.42, glide: 0.45, space: 0.25 }],
  maximize: [{ r: 0.33, dur: 0.16, g: 0.42, glide: 2.1, space: 0.3 }],
  swoosh: [{ r: 0.19, dur: 0.24, g: 0.3, glide: 3.4, click: 0.5, space: 0.45 }],
  snap: [
    { r: 1.12, dur: 0.05, g: 0.46, click: 0.5 },
    { r: 0.84, at: 0.03, dur: 0.09, g: 0.4, space: 0.2 },
  ],
  drop: [{ r: 0.28, dur: 0.14, g: 0.5, click: 0.55, space: 0.3 }],
  screenshot: [
    { r: 2.03, dur: 0.035, g: 0.5, click: 0.8 },
    { r: 1.44, at: 0.055, dur: 0.05, g: 0.44, click: 0.7, space: 0.3 },
  ],
}

interface UiPackSpec extends PackInfo {
  /** Base pitch in Hz (the template's ratio 1). */
  base: number
  partials: PackPartial[]
  /** Multipliers on the template's loudness, length, click and reverb. */
  gain: number
  dur: number
  click: number
  space: number
  /** Events this pack leaves silent (a minimal pack does not need a hover tick). */
  silent?: SoundId[]
}

const SPECS: UiPackSpec[] = [
  {
    id: 'soft',
    name: 'Soft',
    description: 'Warm, rounded and low. Gentle enough to leave on all day.',
    base: 860,
    partials: [
      { ratio: 1, gain: 1 },
      { ratio: 2, gain: 0.22 },
      { ratio: 3, gain: 0.06, dur: 0.5 },
    ],
    gain: 0.8,
    dur: 1.25,
    click: 0.1,
    space: 1.1,
    silent: ['hover'],
  },
  {
    id: 'glass',
    name: 'Glass',
    description: 'Bright and clear, like a fingertip on a wine glass.',
    base: 1480,
    partials: [
      { ratio: 1, gain: 1 },
      { ratio: 2, gain: 0.55 },
      { ratio: 4, gain: 0.26 },
      { ratio: 6.1, gain: 0.14, dur: 0.45 },
    ],
    gain: 0.85,
    dur: 1,
    click: 0.5,
    space: 1.3,
  },
  {
    id: 'mechanical',
    name: 'Mechanical',
    description: 'Tactile switch and keyboard clicks. Short, dry and precise.',
    base: 1500,
    partials: [
      { ratio: 1, gain: 1, type: 'triangle' },
      { ratio: 2.7, gain: 0.3, dur: 0.3, type: 'triangle' },
      { ratio: 5.1, gain: 0.12, dur: 0.18 },
    ],
    gain: 0.95,
    dur: 0.7,
    click: 1.6,
    space: 0.05,
  },
  {
    id: 'digital',
    name: 'Digital',
    description: 'Crisp, clean electronic tones with a little edge.',
    base: 1320,
    partials: [
      { ratio: 1, gain: 1, type: 'triangle' },
      { ratio: 2, gain: 0.14, dur: 0.5, type: 'square' },
    ],
    gain: 0.75,
    dur: 0.85,
    click: 0.15,
    space: 0.1,
  },
  {
    id: 'minimal',
    name: 'Minimal',
    description: 'Almost silent. Only the sounds that matter, very quietly.',
    base: 1100,
    partials: [
      { ratio: 1, gain: 1 },
      { ratio: 2, gain: 0.18 },
    ],
    gain: 0.5,
    dur: 0.6,
    click: 0.2,
    space: 0.1,
    silent: ['hover', 'tap', 'toggle', 'pop', 'swoosh', 'drop', 'snap', 'minimize', 'maximize'],
  },
]

function buildUiPack(spec: UiPackSpec): Partial<Record<SoundId, PackVoice[]>> {
  const out: Partial<Record<SoundId, PackVoice[]>> = {}
  for (const id of Object.keys(TEMPLATE) as (keyof typeof TEMPLATE)[]) {
    if (spec.silent?.includes(id)) {
      out[id] = []
      continue
    }
    out[id] = TEMPLATE[id].map((s) => ({
      freq: spec.base * s.r,
      at: s.at ?? 0,
      dur: s.dur * spec.dur,
      gain: s.g * spec.gain,
      partials: s.glide ? spec.partials.map((p) => ({ ...p, glide: s.glide })) : spec.partials,
      click: s.click === undefined ? undefined : s.click * spec.click,
      space: s.space === undefined ? undefined : s.space * spec.space,
    }))
  }
  return out
}

export const UI_PACK_LIST: PackInfo[] = [
  { id: 'udaan', name: 'Udaan', description: 'The original: warm woodblock taps and bell tones.' },
  ...SPECS.map(({ id, name, description }) => ({ id, name, description })),
  { id: 'off', name: 'Off', description: 'No interaction sounds. Notifications are chosen separately.' },
]

const uiCache = new Map<string, Partial<Record<SoundId, PackVoice[]>>>()
/** Voices for an interaction pack, or undefined for the built-in default (sounds.ts owns it). */
export function uiPackVoices(pack: string, id: SoundId): PackVoice[] | undefined {
  const spec = SPECS.find((s) => s.id === pack)
  if (!spec) return undefined
  let built = uiCache.get(pack)
  if (!built) {
    built = buildUiPack(spec)
    uiCache.set(pack, built)
  }
  return built[id]
}

/* ── Notification packs ────────────────────────────────────────── */

const GLASS: PackPartial[] = [
  { ratio: 1, gain: 1 },
  { ratio: 2, gain: 0.6 },
  { ratio: 4, gain: 0.3 },
  { ratio: 6.1, gain: 0.16, dur: 0.45 },
]
const BELL: PackPartial[] = [
  { ratio: 1, gain: 1 },
  { ratio: 2, gain: 0.5 },
  { ratio: 3, gain: 0.25, dur: 0.6 },
  { ratio: 4.2, gain: 0.12, dur: 0.4 },
]
const MARIMBA: PackPartial[] = [
  { ratio: 1, gain: 1, type: 'triangle' },
  { ratio: 4, gain: 0.32, dur: 0.18 },
  { ratio: 9.2, gain: 0.08, dur: 0.08 },
]
const PLUCK: PackPartial[] = [
  { ratio: 1, gain: 1, type: 'triangle' },
  { ratio: 2, gain: 0.4, dur: 0.6 },
  { ratio: 3, gain: 0.18, dur: 0.35 },
]
const PURE: PackPartial[] = [
  { ratio: 1, gain: 1 },
  { ratio: 2, gain: 0.12, dur: 0.6 },
]

const NOTIFY_VOICES: Record<string, PackVoice[]> = {
  chime: [
    { freq: 1318.5, at: 0, dur: 0.5, gain: 0.5, partials: BELL, click: 0.15, space: 0.7 },
    { freq: 1046.5, at: 0.14, dur: 0.55, gain: 0.48, partials: BELL, space: 0.75 },
    { freq: 783.99, at: 0.28, dur: 0.9, gain: 0.46, partials: BELL, space: 0.8 },
  ],
  marimba: [
    { freq: 784, at: 0, dur: 0.22, gain: 0.62, partials: MARIMBA, click: 0.3, space: 0.25 },
    { freq: 1046.5, at: 0.11, dur: 0.3, gain: 0.58, partials: MARIMBA, space: 0.3 },
  ],
  droplet: [
    { freq: 520, at: 0, dur: 0.22, gain: 0.5, partials: [{ ratio: 1, gain: 1, glide: 2.6 }, { ratio: 2, gain: 0.18, glide: 2.6 }], click: 0.2, space: 0.7 },
    { freq: 1760, at: 0.14, dur: 0.5, gain: 0.22, partials: PURE, space: 0.9 },
  ],
  pulse: [
    { freq: 392, at: 0, dur: 0.28, gain: 0.58, partials: PURE, space: 0.5 },
    { freq: 392, at: 0.22, dur: 0.36, gain: 0.5, partials: PURE, space: 0.6 },
  ],
  bell: [{ freq: 880, at: 0, dur: 1.1, gain: 0.55, partials: BELL, click: 0.3, space: 0.8 }],
  harp: [
    { freq: 523.25, at: 0, dur: 0.5, gain: 0.5, partials: PLUCK, click: 0.1, space: 0.6 },
    { freq: 659.25, at: 0.08, dur: 0.5, gain: 0.48, partials: PLUCK, space: 0.6 },
    { freq: 783.99, at: 0.16, dur: 0.5, gain: 0.48, partials: PLUCK, space: 0.65 },
    { freq: 1046.5, at: 0.24, dur: 0.8, gain: 0.46, partials: PLUCK, space: 0.75 },
  ],
  knock: [
    { freq: 300, at: 0, dur: 0.1, gain: 0.6, partials: MARIMBA, click: 0.8, space: 0.15 },
    { freq: 280, at: 0.13, dur: 0.12, gain: 0.55, partials: MARIMBA, click: 0.7, space: 0.2 },
  ],
  crystal: [
    { freq: 1568, at: 0, dur: 0.4, gain: 0.5, partials: GLASS, click: 0.25, space: 0.7 },
    { freq: 2093, at: 0.09, dur: 0.6, gain: 0.4, partials: GLASS, space: 0.8 },
  ],
}

export const NOTIFY_PACK_LIST: PackInfo[] = [
  { id: 'glass', name: 'Udaan', description: 'The original: two bright glass notes.' },
  { id: 'chime', name: 'Chime', description: 'Three soft bells stepping down, with a long tail.' },
  { id: 'marimba', name: 'Marimba', description: 'Two quick, warm wooden notes.' },
  { id: 'droplet', name: 'Droplet', description: 'A single drop of water, rising.' },
  { id: 'pulse', name: 'Pulse', description: 'A calm double pulse. Easy to ignore, easy to notice.' },
  { id: 'bell', name: 'Bell', description: 'One clear bell strike.' },
  { id: 'harp', name: 'Harp', description: 'A quick plucked arpeggio, rising.' },
  { id: 'knock', name: 'Knock', description: 'Two soft knocks on wood.' },
  { id: 'crystal', name: 'Crystal', description: 'Very high, very light and clean.' },
  { id: 'off', name: 'Off', description: 'No notification sound.' },
]

/** Voices for a notification pack, or undefined for the built-in default (sounds.ts owns it). */
export function notifyPackVoices(pack: string): PackVoice[] | undefined {
  return NOTIFY_VOICES[pack]
}
