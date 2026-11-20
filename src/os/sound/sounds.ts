/**
 * Udaan's UI sound engine.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE SPEAKER-CUTOFF PROBLEM, AND WHY THIS ENGINE IS BUILT THE WAY IT IS
 * ─────────────────────────────────────────────────────────────────────────
 * Most powered speakers and many laptop amplifiers have auto-standby: if the
 * signal stays below a threshold for a few seconds they mute the output
 * stage to save power, and take 200–800ms to come back when signal returns.
 *
 * The previous engine triggered this constantly. Every sound was a bare sine
 * at gain ~0.05 (-26dBFS), which is below most standby thresholds, and
 * between sounds the output was digital silence. So the amplifier slept
 * between every interaction and clipped the front of the next sound while
 * waking — which is heard as "quiet sounds don't play, and the ones that do
 * are cut off at the start".
 *
 * Three changes fix it properly:
 *
 *   1. A KEEP-ALIVE TONE. An inaudible signal (18Hz, far below hearing, at
 *      -45dBFS) runs continuously whenever sounds are enabled. It is enough
 *      signal to hold the amplifier's standby detector open, and it cannot
 *      be heard on any speaker. This is the single fix for the cutoff.
 *   2. REAL LOUDNESS. Sounds are synthesized with harmonics and run through
 *      soft-knee compression into a limiter, targeting around -14dBFS
 *      integrated — roughly broadcast loudness. A compressed, harmonically
 *      rich sound is *perceived* as much louder than a sine of the same
 *      peak level, so this is loud and clear without ever clipping.
 *   3. A PRE-ROLL. Each sound starts with ~15ms of near-silent signal before
 *      its attack, so if an amplifier is waking, it eats the pre-roll rather
 *      than the transient.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY SYNTHESIS, NOT SAMPLES
 * ─────────────────────────────────────────────────────────────────────────
 * Synthesized sounds cost no download, never arrive late, and can be varied
 * per event — the same `tap` is pitched slightly differently each time, so a
 * fast sequence of clicks sounds like a sequence rather than one sound
 * stuttering. That variation is what makes an interface sound alive instead
 * of like a looping alert.
 *
 * Every sound is built from the same four-part model:
 *   body      the fundamental and its harmonics
 *   click     a very short noise transient for attack definition
 *   shimmer   high partials that decay fast, giving "sparkle"
 *   space     a short reverb tail, so sounds sit in a room
 */
import { getPref, onPrefChanged } from '@/os/kernel/prefs'
import { notifyPackVoices, uiPackVoices } from './soundPacks'
import { createEqualizer } from './equalizer'

export type SoundId =
  | 'tap' | 'open' | 'close' | 'notify' | 'unlock' | 'lock' | 'error'
  | 'switch' | 'minimize' | 'maximize' | 'snap' | 'screenshot' | 'delete' | 'hover'
  | 'success' | 'drop' | 'pop' | 'swoosh' | 'toggle' | 'boot'

/* ------------------------------------------------------------------ */
/*  GRAPH                                                              */
/* ------------------------------------------------------------------ */

interface Engine {
  ctx: AudioContext
  /** Everything plays into here. */
  bus: GainNode
  /** Soft-knee compression, so quiet detail is lifted toward the peaks. */
  comp: DynamicsCompressorNode
  /** Brick-wall safety, so nothing can ever clip the output. */
  limiter: DynamicsCompressorNode
  /** Shared reverb send — one convolver for every sound. */
  verb: ConvolverNode
  verbSend: GainNode
  /** The inaudible tone that stops speakers entering standby. */
  keepAlive: OscillatorNode | null
}

let engine: Engine | null = null
let enabledCache: boolean | null = null
let volumeCache = 1

function build(): Engine {
  const ctx = new AudioContext({ latencyHint: 'interactive' })

  // ── Output chain: bus → compressor → limiter → out ──
  const limiter = ctx.createDynamicsCompressor()
  limiter.threshold.value = -1.5
  limiter.knee.value = 0
  limiter.ratio.value = 20
  limiter.attack.value = 0.001
  limiter.release.value = 0.08
  limiter.connect(ctx.destination)

  // Soft-knee compression is what makes these sounds carry. It lifts the
  // body of each sound toward its peak, so the perceived loudness is far
  // higher than the peak level suggests — the same trick mastering uses.
  const comp = ctx.createDynamicsCompressor()
  comp.threshold.value = -24
  comp.knee.value = 12
  comp.ratio.value = 3.5
  comp.attack.value = 0.003
  comp.release.value = 0.15
  comp.connect(limiter)

  const bus = ctx.createGain()
  bus.gain.value = 1
  // UI sounds run through the system sound mode too, so a Night or Clarity
  // setting shapes the whole interface rather than only music. The chain
  // follows the saved mode by itself.
  const equalizer = createEqualizer(ctx)
  bus.connect(equalizer.input)
  equalizer.output.connect(comp)

  // ── Reverb: a short, bright room ──
  const verb = ctx.createConvolver()
  verb.buffer = impulse(ctx, 0.9, 2.6)
  const verbSend = ctx.createGain()
  verbSend.gain.value = 0.22
  verbSend.connect(verb)
  verb.connect(comp)

  return { ctx, bus, comp, limiter, verb, verbSend, keepAlive: null }
}

/**
 * A synthetic impulse response: exponentially decaying noise, darker as it
 * decays (high frequencies are absorbed first in any real room). Cheaper
 * and smaller than shipping an IR file, and indistinguishable at this
 * length.
 */
function impulse(ctx: AudioContext, seconds: number, decay: number): AudioBuffer {
  const rate = ctx.sampleRate
  const length = Math.floor(rate * seconds)
  const buf = ctx.createBuffer(2, length, rate)
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch)
    for (let i = 0; i < length; i++) {
      const t = i / length
      // Slight per-channel decorrelation gives a stereo image.
      const noise = Math.random() * 2 - 1
      data[i] = noise * (1 - t) ** decay * (ch === 0 ? 1 : 0.92)
    }
  }
  return buf
}

function audio(): Engine {
  engine ??= build()
  if (engine.ctx.state === 'suspended') void engine.ctx.resume()
  return engine
}

/* ------------------------------------------------------------------ */
/*  KEEP-ALIVE                                                         */
/* ------------------------------------------------------------------ */

/**
 * Holds the speaker's auto-standby detector open.
 *
 * 18Hz is below the hearing threshold of every listener and below the
 * passband of every speaker, so nothing is audible — but it is real signal
 * on the wire, which is all a standby detector measures. -45dBFS is loud
 * enough to be detected and far too quiet to move a woofer audibly.
 *
 * Without this, a powered speaker mutes between interactions and clips the
 * attack of whatever plays next.
 */
function startKeepAlive(e: Engine) {
  if (e.keepAlive) return
  const osc = e.ctx.createOscillator()
  const g = e.ctx.createGain()
  osc.frequency.value = 18
  g.gain.value = 0.0056 // ≈ -45dBFS
  // Bypasses the compressor: it must never duck, and must never be ducked.
  osc.connect(g).connect(e.ctx.destination)
  osc.start()
  e.keepAlive = osc
}

function stopKeepAlive(e: Engine) {
  e.keepAlive?.stop()
  e.keepAlive = null
}

/* ------------------------------------------------------------------ */
/*  VOICE                                                              */
/* ------------------------------------------------------------------ */

interface Partial {
  /** Multiple of the fundamental. 1 = fundamental, 2 = octave, 3 = fifth above that. */
  ratio: number
  gain: number
  /** Seconds from the note's start. */
  at?: number
  dur?: number
  type?: OscillatorType
  /** Pitch glide to this multiple of the fundamental over the note. */
  glide?: number
}

interface Voice {
  freq: number
  at: number
  dur: number
  gain: number
  partials: Partial[]
  /** Noise transient at the attack — gives a click definition without a sample. */
  click?: number
  /** How much of this voice goes to the reverb. */
  space?: number
}

const PRE_ROLL = 0.015

/** Harmonic recipes. A pure sine has no presence; harmonics are what carry. */
const BELL: Partial[] = [
  { ratio: 1, gain: 1 },
  { ratio: 2, gain: 0.5 },
  { ratio: 3, gain: 0.25, dur: 0.6 },
  { ratio: 4.2, gain: 0.12, dur: 0.4 },
]
const SOFT: Partial[] = [
  { ratio: 1, gain: 1 },
  { ratio: 2, gain: 0.3 },
  { ratio: 3, gain: 0.1, dur: 0.5 },
]
const WOOD: Partial[] = [
  { ratio: 1, gain: 1, type: 'triangle' },
  { ratio: 2.7, gain: 0.35, dur: 0.35, type: 'triangle' },
  { ratio: 5.1, gain: 0.14, dur: 0.2 },
]
const GLASS: Partial[] = [
  { ratio: 1, gain: 1 },
  { ratio: 2, gain: 0.6 },
  { ratio: 4, gain: 0.3 },
  { ratio: 6.1, gain: 0.16, dur: 0.45 },
  { ratio: 8.3, gain: 0.08, dur: 0.3 },
]

const SOUNDS: Record<SoundId, Voice[]> = {
  // Short, bright, barely there — but with a click transient so it reads as
  // a physical contact rather than a beep.
  tap: [{ freq: 1180, at: 0, dur: 0.07, gain: 0.5, partials: SOFT, click: 0.3, space: 0.1 }],
  hover: [{ freq: 2100, at: 0, dur: 0.03, gain: 0.16, partials: SOFT, space: 0.05 }],
  toggle: [{ freq: 980, at: 0, dur: 0.06, gain: 0.45, partials: WOOD, click: 0.4 }],
  switch: [{ freq: 820, at: 0, dur: 0.08, gain: 0.45, partials: WOOD, click: 0.35 }],

  // Rising pair: something arrived.
  open: [
    { freq: 620, at: 0, dur: 0.12, gain: 0.5, partials: BELL, click: 0.2, space: 0.3 },
    { freq: 930, at: 0.05, dur: 0.22, gain: 0.44, partials: BELL, space: 0.4 },
  ],
  // Falling pair: something left.
  close: [
    { freq: 880, at: 0, dur: 0.1, gain: 0.44, partials: SOFT, space: 0.25 },
    { freq: 554, at: 0.045, dur: 0.2, gain: 0.4, partials: SOFT, space: 0.35 },
  ],
  pop: [{ freq: 740, at: 0, dur: 0.09, gain: 0.52, partials: WOOD, click: 0.45, space: 0.2 }],

  // A proper notification: a bell with real harmonics and a long tail.
  notify: [
    { freq: 1046.5, at: 0, dur: 0.3, gain: 0.6, partials: GLASS, click: 0.25, space: 0.55 },
    { freq: 1568, at: 0.1, dur: 0.5, gain: 0.5, partials: GLASS, space: 0.65 },
  ],
  success: [
    { freq: 783.99, at: 0, dur: 0.16, gain: 0.52, partials: BELL, space: 0.4 },
    { freq: 1046.5, at: 0.08, dur: 0.18, gain: 0.5, partials: BELL, space: 0.45 },
    { freq: 1318.5, at: 0.16, dur: 0.44, gain: 0.46, partials: GLASS, space: 0.6 },
  ],

  // A full triad, so unlocking feels like a resolution rather than a beep.
  unlock: [
    { freq: 523.25, at: 0, dur: 0.18, gain: 0.5, partials: BELL, space: 0.4 },
    { freq: 659.25, at: 0.08, dur: 0.2, gain: 0.48, partials: BELL, space: 0.45 },
    { freq: 783.99, at: 0.16, dur: 0.24, gain: 0.46, partials: BELL, space: 0.5 },
    { freq: 1046.5, at: 0.24, dur: 0.6, gain: 0.44, partials: GLASS, space: 0.7 },
  ],
  lock: [
    { freq: 659.25, at: 0, dur: 0.14, gain: 0.48, partials: SOFT, space: 0.3 },
    { freq: 329.63, at: 0.09, dur: 0.4, gain: 0.5, partials: BELL, space: 0.5 },
  ],
  boot: [
    { freq: 261.63, at: 0, dur: 0.5, gain: 0.44, partials: BELL, space: 0.6 },
    { freq: 392, at: 0.14, dur: 0.5, gain: 0.42, partials: BELL, space: 0.65 },
    { freq: 523.25, at: 0.28, dur: 0.6, gain: 0.44, partials: GLASS, space: 0.7 },
    { freq: 783.99, at: 0.42, dur: 0.9, gain: 0.4, partials: GLASS, space: 0.8 },
  ],

  // A minor second, the most reliably "wrong"-sounding interval there is.
  error: [
    { freq: 311.13, at: 0, dur: 0.18, gain: 0.52, partials: WOOD, click: 0.3 },
    { freq: 293.66, at: 0.02, dur: 0.26, gain: 0.46, partials: WOOD, space: 0.3 },
  ],
  delete: [
    { freq: 440, at: 0, dur: 0.1, gain: 0.48, partials: WOOD, click: 0.35 },
    { freq: 277.18, at: 0.07, dur: 0.24, gain: 0.44, partials: WOOD, space: 0.35 },
  ],

  // Pitch glides: the sound itself moves in the direction the window moves.
  minimize: [{ freq: 784, at: 0, dur: 0.16, gain: 0.42, partials: [{ ratio: 1, gain: 1, glide: 0.45 }, { ratio: 2, gain: 0.3, glide: 0.45 }], space: 0.25 }],
  maximize: [{ freq: 392, at: 0, dur: 0.16, gain: 0.42, partials: [{ ratio: 1, gain: 1, glide: 2.1 }, { ratio: 2, gain: 0.3, glide: 2.1 }], space: 0.3 }],
  swoosh: [{ freq: 220, at: 0, dur: 0.24, gain: 0.3, partials: [{ ratio: 1, gain: 1, glide: 3.4 }], click: 0.5, space: 0.45 }],

  snap: [
    { freq: 1320, at: 0, dur: 0.05, gain: 0.46, partials: WOOD, click: 0.5 },
    { freq: 990, at: 0.03, dur: 0.09, gain: 0.4, partials: WOOD, space: 0.2 },
  ],
  drop: [{ freq: 330, at: 0, dur: 0.14, gain: 0.5, partials: WOOD, click: 0.55, space: 0.3 }],

  // A real shutter: two mechanical clicks, not a chime.
  screenshot: [
    { freq: 2400, at: 0, dur: 0.035, gain: 0.5, partials: WOOD, click: 0.8 },
    { freq: 1700, at: 0.055, dur: 0.05, gain: 0.44, partials: WOOD, click: 0.7, space: 0.3 },
  ],
}

/* ------------------------------------------------------------------ */
/*  PLAYBACK                                                           */
/* ------------------------------------------------------------------ */

/** Short noise burst for attack definition. Cached per context. */
let noiseBuffer: AudioBuffer | null = null
function noise(ctx: AudioContext): AudioBuffer {
  if (noiseBuffer && noiseBuffer.sampleRate === ctx.sampleRate) return noiseBuffer
  const length = Math.floor(ctx.sampleRate * 0.02)
  const buf = ctx.createBuffer(1, length, ctx.sampleRate)
  const d = buf.getChannelData(0)
  for (let i = 0; i < length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 3
  noiseBuffer = buf
  return buf
}

/** Tracks repeated plays so a fast sequence detunes instead of stuttering. */
const lastPlayed = new Map<SoundId, { at: number; n: number }>()

/** The chosen sound packs (Settings, Sound). Kept in step with the saved choice from every window. */
let uiPackCache: string | null = null
let notifyPackCache: string | null = null
let watching = false
function watchPrefs() {
  if (watching) return
  watching = true
  try {
    void onPrefChanged((k, v) => {
      if (k === 'sound.uiPack') uiPackCache = String(v)
      else if (k === 'sound.notifyPack') notifyPackCache = String(v)
      else if (k === 'sounds.enabled') enabledCache = Boolean(v)
    }).catch(() => {})
  } catch {
    // Outside the desktop there is nothing to listen to; the cached choice simply stays.
  }
}

/**
 * Plays one interface sound. `opts` previews a pack without saving it (Settings uses this).
 * The notification sound follows the notification pack; every other sound follows the interaction pack.
 */
export async function playSound(id: SoundId, opts?: { ui?: string; notify?: string }) {
  watchPrefs()
  enabledCache ??= await getPref('sounds.enabled')
  if (!enabledCache) return

  const isNotify = id === 'notify'
  let pack: string
  if (isNotify) pack = opts?.notify ?? (notifyPackCache ??= await getPref('sound.notifyPack'))
  else pack = opts?.ui ?? (uiPackCache ??= await getPref('sound.uiPack'))
  if (pack === 'off') return

  // A pack the engine does not know (or the default pack) falls back to the built-in sound, never to silence.
  const voices: Voice[] | undefined = (isNotify ? notifyPackVoices(pack) : uiPackVoices(pack, id)) ?? SOUNDS[id]
  if (!voices || voices.length === 0) return

  const e = audio()
  startKeepAlive(e)
  const ctx = e.ctx

  // Repeated taps within 300ms step up in pitch slightly, so a burst of
  // clicks reads as a sequence of distinct events rather than one sound
  // retriggering. Resets once the burst ends.
  const now = ctx.currentTime
  const prev = lastPlayed.get(id)
  const run = prev && now - prev.at < 0.3 ? Math.min(prev.n + 1, 5) : 0
  lastPlayed.set(id, { at: now, n: run })
  // Up to a whole tone over five repeats, plus a touch of randomness so it
  // never sounds like a scale being played.
  const detune = 2 ** ((run * 2 + (Math.random() - 0.5)) / 24)

  const t0 = now + 0.005 + PRE_ROLL

  for (const v of voices) {
    const voiceGain = ctx.createGain()
    voiceGain.gain.value = v.gain * volumeCache
    voiceGain.connect(e.bus)
    if (v.space) {
      const send = ctx.createGain()
      send.gain.value = v.space
      voiceGain.connect(send).connect(e.verbSend)
    }

    const base = v.freq * detune
    const start = t0 + v.at

    // ── Attack transient ──
    if (v.click) {
      const src = ctx.createBufferSource()
      src.buffer = noise(ctx)
      const hp = ctx.createBiquadFilter()
      hp.type = 'bandpass'
      hp.frequency.value = base * 2.5
      hp.Q.value = 0.8
      const cg = ctx.createGain()
      cg.gain.value = v.click * 0.5
      src.connect(hp).connect(cg).connect(voiceGain)
      src.start(start)
    }

    // ── Harmonic body ──
    for (const p of v.partials) {
      const osc = ctx.createOscillator()
      const g = ctx.createGain()
      osc.type = p.type ?? 'sine'
      const freq = base * p.ratio
      const at = start + (p.at ?? 0)
      const dur = v.dur * (p.dur ?? 1)

      osc.frequency.setValueAtTime(freq, at)
      if (p.glide) {
        // Exponential, because pitch is perceived logarithmically — a
        // linear glide sounds like it slows down at the top.
        osc.frequency.exponentialRampToValueAtTime(freq * p.glide, at + dur)
      }

      // Attack is 6ms: fast enough to feel immediate, slow enough that no
      // speaker produces a click from the discontinuity.
      g.gain.setValueAtTime(0.0001, at)
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, p.gain), at + 0.006)
      g.gain.exponentialRampToValueAtTime(0.0001, at + dur)

      osc.connect(g).connect(voiceGain)
      osc.start(at)
      osc.stop(at + dur + 0.02)
    }
  }
}

/* ------------------------------------------------------------------ */
/*  SETTINGS                                                           */
/* ------------------------------------------------------------------ */

/** Settings calls this so a toggle takes effect without a restart. */
export function setSoundsEnabled(on: boolean) {
  enabledCache = on
  if (!engine) return
  if (on) startKeepAlive(engine)
  else stopKeepAlive(engine)
}

/** 0–1. Scales every sound; the keep-alive tone is unaffected by design. */
export function setSoundVolume(level: number) {
  volumeCache = Math.max(0, Math.min(1, level))
}

/**
 * Starts the audio engine on the first user gesture.
 *
 * Browsers refuse to start an AudioContext without one, and a context
 * created-then-blocked produces no sound at all until something resumes it.
 * Calling this from the shell's first click means the keep-alive tone is
 * already holding the speakers open before the first UI sound plays.
 */
export async function primeAudio() {
  enabledCache ??= await getPref('sounds.enabled')
  if (!enabledCache) return
  startKeepAlive(audio())
}
