/**
 * Udaan's UI sounds, synthesized with Web Audio: short, soft, pitched
 * tones (no sample files). Kept quiet and brief so they confirm an action
 * without drawing attention. Honours the `sounds.enabled` preference.
 */
import { getPref } from '@/os/kernel/prefs'

export type SoundId = 'tap' | 'open' | 'close' | 'notify' | 'unlock' | 'lock' | 'error' | 'switch' | 'minimize' | 'maximize' | 'snap' | 'screenshot' | 'delete' | 'hover'

let ctx: AudioContext | null = null
let enabledCache: boolean | null = null

function audio() {
  ctx ??= new AudioContext()
  if (ctx.state === 'suspended') void ctx.resume()
  return ctx
}

interface Note {
  freq: number
  at: number
  dur: number
  gain: number
  type?: OscillatorType
}

const SOUNDS: Record<SoundId, Note[]> = {
  tap: [{ freq: 1320, at: 0, dur: 0.05, gain: 0.05 }],
  switch: [{ freq: 880, at: 0, dur: 0.06, gain: 0.05 }],
  open: [
    { freq: 660, at: 0, dur: 0.09, gain: 0.05 },
    { freq: 990, at: 0.045, dur: 0.12, gain: 0.045 },
  ],
  close: [
    { freq: 880, at: 0, dur: 0.08, gain: 0.045 },
    { freq: 587, at: 0.04, dur: 0.12, gain: 0.04 },
  ],
  notify: [
    { freq: 1046.5, at: 0, dur: 0.16, gain: 0.07 },
    { freq: 1568, at: 0.09, dur: 0.28, gain: 0.06 },
  ],
  unlock: [
    { freq: 523.25, at: 0, dur: 0.12, gain: 0.06 },
    { freq: 659.25, at: 0.07, dur: 0.12, gain: 0.06 },
    { freq: 1046.5, at: 0.14, dur: 0.3, gain: 0.05 },
  ],
  lock: [
    { freq: 784, at: 0, dur: 0.1, gain: 0.06 },
    { freq: 392, at: 0.08, dur: 0.22, gain: 0.06 },
  ],
  error: [
    { freq: 311, at: 0, dur: 0.12, gain: 0.07, type: 'triangle' },
    { freq: 233, at: 0.1, dur: 0.18, gain: 0.07, type: 'triangle' },
  ],
  minimize: [
    { freq: 784, at: 0, dur: 0.06, gain: 0.04 },
    { freq: 523, at: 0.03, dur: 0.1, gain: 0.035 },
  ],
  maximize: [
    { freq: 523, at: 0, dur: 0.06, gain: 0.04 },
    { freq: 784, at: 0.03, dur: 0.1, gain: 0.04 },
  ],
  snap: [
    { freq: 1100, at: 0, dur: 0.04, gain: 0.04 },
    { freq: 880, at: 0.025, dur: 0.06, gain: 0.035 },
  ],
  screenshot: [
    { freq: 1568, at: 0, dur: 0.08, gain: 0.06 },
    { freq: 2093, at: 0.04, dur: 0.06, gain: 0.04 },
    { freq: 1568, at: 0.08, dur: 0.12, gain: 0.03 },
  ],
  delete: [
    { freq: 440, at: 0, dur: 0.08, gain: 0.05, type: 'triangle' },
    { freq: 330, at: 0.06, dur: 0.14, gain: 0.04, type: 'triangle' },
  ],
  hover: [{ freq: 1800, at: 0, dur: 0.025, gain: 0.015 }],
}

export async function playSound(id: SoundId) {
  enabledCache ??= await getPref('sounds.enabled')
  if (!enabledCache) return
  const ac = audio()
  const t0 = ac.currentTime + 0.005
  const master = ac.createGain()
  master.gain.value = 1
  master.connect(ac.destination)
  for (const n of SOUNDS[id]) {
    const osc = ac.createOscillator()
    const g = ac.createGain()
    osc.type = n.type ?? 'sine'
    osc.frequency.value = n.freq
    // Soft attack, exponential decay: no clicks.
    g.gain.setValueAtTime(0.0001, t0 + n.at)
    g.gain.exponentialRampToValueAtTime(n.gain, t0 + n.at + 0.008)
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + n.at + n.dur)
    osc.connect(g).connect(master)
    osc.start(t0 + n.at)
    osc.stop(t0 + n.at + n.dur + 0.02)
  }
}

/** Settings calls this so a toggle takes effect without a restart. */
export function setSoundsEnabled(on: boolean) {
  enabledCache = on
}
