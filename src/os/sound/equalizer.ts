import { invoke } from '@tauri-apps/api/core'
import { getPref } from '@/os/kernel/prefs'

/**
 * Udaan's system EQ.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHAT CHANGED AND WHY
 * ─────────────────────────────────────────────────────────────────────────
 * This used to write config files for Equalizer APO, a third-party kernel
 * driver. That meant the feature only worked if the user downloaded it,
 * installed it with admin rights, assigned it to each output device and
 * rebooted — a five-step process Udaan could neither perform nor verify. In
 * practice the sound modes did nothing, because the driver was usually not
 * there, and when it was, writing into its config under Program Files
 * failed silently without elevation.
 *
 * Now the EQ is real DSP in Udaan's own Web Audio graph. It applies the
 * instant you pick a mode, needs no install, no admin and no reboot, and
 * cannot break any other program's audio.
 *
 * The trade is honest and worth stating: this shapes audio Udaan plays —
 * the music player, the DJ board, video in the TV app, UI sounds. It does
 * not reach Spotify or a browser, because doing that genuinely requires a
 * kernel-mode APO. Shaping everything badly was worse than shaping Udaan's
 * own audio well.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * HOW TO USE IT
 * ─────────────────────────────────────────────────────────────────────────
 * Any audio graph calls `connectEqualizer(ctx, source)` once and connects
 * the returned node onward. The chain then follows the saved mode for the
 * lifetime of the app, including changes made in the Sound panel, with no
 * further work from the caller.
 */

export interface Band {
  kind: 'peak' | 'lowshelf' | 'highshelf' | 'highpass'
  frequency: number
  gainDb: number
  q: number
}

export interface Curve {
  bands: Band[]
  /** Level cut that keeps the boosted curve from clipping. Always ≤ 0. */
  preampDb: number
}

const FLAT: Curve = { bands: [], preampDb: 0 }

/** Web Audio's filter names differ from ours only in spelling. */
const FILTER_TYPE: Record<Band['kind'], BiquadFilterType> = {
  peak: 'peaking',
  lowshelf: 'lowshelf',
  highshelf: 'highshelf',
  highpass: 'highpass',
}

/* ------------------------------------------------------------------ */
/*  CURRENT CURVE                                                      */
/* ------------------------------------------------------------------ */

let current: Curve = FLAT
let loaded: Promise<Curve> | null = null
const listeners = new Set<(c: Curve) => void>()

/** The curve for the saved mode, from Rust (which owns the preset tables). */
async function fetchCurve(): Promise<Curve> {
  try {
    const [preset, strength, customRaw] = await Promise.all([getPref('sound.preset'), getPref('sound.strength'), getPref('sound.custom')])
    let bass = 0
    let voice = 0
    let treble = 0
    try {
      const c = JSON.parse(customRaw) as Partial<{ bass: number; voice: number; treble: number }>
      bass = Number(c.bass) || 0
      voice = Number(c.voice) || 0
      treble = Number(c.treble) || 0
    } catch {
      // A corrupt custom setting is flat, not a failure.
    }
    return await invoke<Curve>('sound_fx_curve', { preset, strength, bass, voice, treble })
  } catch {
    return FLAT
  }
}

/** The active curve, loading it on first use. */
export function equalizerCurve(): Promise<Curve> {
  loaded ??= fetchCurve().then((c) => {
    current = c
    return c
  })
  return loaded
}

/**
 * Re-reads the saved mode and retunes every live chain.
 *
 * Called by the Sound panel on every change, which is why a mode is audible
 * the moment you pick it rather than after a restart.
 */
export async function refreshEqualizer(): Promise<Curve> {
  const next = await fetchCurve()
  current = next
  loaded = Promise.resolve(next)
  listeners.forEach((fn) => fn(next))
  return next
}

/* ------------------------------------------------------------------ */
/*  GRAPH                                                              */
/* ------------------------------------------------------------------ */

/**
 * A live EQ chain: a preamp, a bank of biquads, and an output node.
 *
 * The bank is rebuilt when the band *count* changes and retuned in place
 * when only values change. Retuning is important: a filter carries internal
 * state (the last two samples), and replacing the node mid-playback drops
 * that state, which is heard as a click.
 */
export interface EqualizerChain {
  /** Connect the source into this. */
  input: AudioNode
  /** Connect this onward to the destination. */
  output: AudioNode
  /** Stops following preference changes and releases the nodes. */
  dispose(): void
}

const RAMP = 0.05

/**
 * Builds an EQ chain in `ctx` and keeps it following the user's sound mode.
 *
 * Every parameter change ramps over 50ms rather than jumping. A biquad whose
 * coefficients change instantly produces a transient — a click or a soft
 * thump — because the filter's state no longer matches its new shape.
 */
export function createEqualizer(ctx: AudioContext): EqualizerChain {
  const input = ctx.createGain()
  const output = ctx.createGain()
  let filters: BiquadFilterNode[] = []

  const rewire = (curve: Curve) => {
    // Preamp: the cut that stops a boosted curve clipping.
    input.gain.setTargetAtTime(10 ** (curve.preampDb / 20), ctx.currentTime, RAMP)

    const sameShape =
      filters.length === curve.bands.length && filters.every((f, i) => f.type === FILTER_TYPE[curve.bands[i].kind])

    if (sameShape) {
      // Retune in place, preserving each filter's state so nothing clicks.
      curve.bands.forEach((b, i) => {
        const f = filters[i]
        f.frequency.setTargetAtTime(b.frequency, ctx.currentTime, RAMP)
        f.Q.setTargetAtTime(b.q, ctx.currentTime, RAMP)
        f.gain.setTargetAtTime(b.gainDb, ctx.currentTime, RAMP)
      })
      return
    }

    // The shape changed, so the bank has to be rebuilt.
    input.disconnect()
    filters.forEach((f) => f.disconnect())

    filters = curve.bands.map((b) => {
      const f = ctx.createBiquadFilter()
      f.type = FILTER_TYPE[b.kind]
      f.frequency.value = b.frequency
      f.Q.value = b.q
      // A high-pass has no gain parameter; setting it is harmless but
      // meaningless, so skip it for clarity.
      if (b.kind !== 'highpass') f.gain.value = b.gainDb
      return f
    })

    // input → f0 → f1 → … → output
    let node: AudioNode = input
    for (const f of filters) {
      node.connect(f)
      node = f
    }
    node.connect(output)
  }

  rewire(current)
  void equalizerCurve().then(rewire)
  listeners.add(rewire)

  return {
    input,
    output,
    dispose() {
      listeners.delete(rewire)
      input.disconnect()
      filters.forEach((f) => f.disconnect())
      output.disconnect()
    },
  }
}

/**
 * Convenience: inserts an EQ between `source` and the context destination.
 *
 * Returns the chain so the caller can dispose it, and so anything that
 * needs to sit after the EQ (a meter, a limiter) can connect to its output
 * instead of the destination.
 */
export function connectEqualizer(ctx: AudioContext, source: AudioNode, destination: AudioNode = ctx.destination): EqualizerChain {
  const chain = createEqualizer(ctx)
  source.connect(chain.input)
  chain.output.connect(destination)
  return chain
}

/* ------------------------------------------------------------------ */
/*  ANALYSIS                                                           */
/* ------------------------------------------------------------------ */

/**
 * The curve's frequency response, for drawing it.
 *
 * Uses the real biquad maths rather than interpolating between the band
 * centres, so what the Sound panel draws is what the filters actually do —
 * including the overlap between neighbouring bands, which a naive plot
 * misses entirely.
 *
 * Returns `points` gains in dB, log-spaced from 20Hz to 20kHz.
 */
export function curveResponse(curve: Curve, points = 96, sampleRate = 48000): { hz: number; db: number }[] {
  const out: { hz: number; db: number }[] = []
  for (let i = 0; i < points; i++) {
    // Log spacing: linear spacing wastes most of the plot above 10kHz,
    // where almost nothing happens.
    const hz = 20 * (20000 / 20) ** (i / (points - 1))
    let db = curve.preampDb
    for (const b of curve.bands) db += bandGainAt(b, hz, sampleRate)
    out.push({ hz, db })
  }
  return out
}

/** One band's gain at one frequency, from the RBJ cookbook formulas. */
function bandGainAt(band: Band, hz: number, sampleRate: number): number {
  const w = (2 * Math.PI * hz) / sampleRate
  const w0 = (2 * Math.PI * band.frequency) / sampleRate
  const cosw = Math.cos(w)
  const sinw0 = Math.sin(w0)
  const cosw0 = Math.cos(w0)
  const A = 10 ** (band.gainDb / 40)
  const alpha = sinw0 / (2 * band.q)

  let b0: number, b1: number, b2: number, a0: number, a1: number, a2: number

  switch (band.kind) {
    case 'peak':
      b0 = 1 + alpha * A
      b1 = -2 * cosw0
      b2 = 1 - alpha * A
      a0 = 1 + alpha / A
      a1 = -2 * cosw0
      a2 = 1 - alpha / A
      break
    case 'lowshelf': {
      const s = 2 * Math.sqrt(A) * alpha
      b0 = A * (A + 1 - (A - 1) * cosw0 + s)
      b1 = 2 * A * (A - 1 - (A + 1) * cosw0)
      b2 = A * (A + 1 - (A - 1) * cosw0 - s)
      a0 = A + 1 + (A - 1) * cosw0 + s
      a1 = -2 * (A - 1 + (A + 1) * cosw0)
      a2 = A + 1 + (A - 1) * cosw0 - s
      break
    }
    case 'highshelf': {
      const s = 2 * Math.sqrt(A) * alpha
      b0 = A * (A + 1 + (A - 1) * cosw0 + s)
      b1 = -2 * A * (A - 1 + (A + 1) * cosw0)
      b2 = A * (A + 1 + (A - 1) * cosw0 - s)
      a0 = A + 1 - (A - 1) * cosw0 + s
      a1 = 2 * (A - 1 - (A + 1) * cosw0)
      a2 = A + 1 - (A - 1) * cosw0 - s
      break
    }
    case 'highpass':
      b0 = (1 + cosw0) / 2
      b1 = -(1 + cosw0)
      b2 = (1 + cosw0) / 2
      a0 = 1 + alpha
      a1 = -2 * cosw0
      a2 = 1 - alpha
      break
  }

  // |H(e^jw)| for a biquad, evaluated without complex arithmetic.
  const cos2w = Math.cos(2 * w)
  const sinw = Math.sin(w)
  const sin2w = Math.sin(2 * w)
  const numRe = b0 + b1 * cosw + b2 * cos2w
  const numIm = -(b1 * sinw + b2 * sin2w)
  const denRe = a0 + a1 * cosw + a2 * cos2w
  const denIm = -(a1 * sinw + a2 * sin2w)
  const mag = Math.sqrt((numRe * numRe + numIm * numIm) / (denRe * denRe + denIm * denIm))
  return 20 * Math.log10(Math.max(mag, 1e-6))
}
