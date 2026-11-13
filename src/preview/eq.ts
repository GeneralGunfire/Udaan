/**
 * Dev-only. A browser version of the sound modes in src-tauri/src/sound_fx.rs, so
 * they can be heard in the preview page. The curves mirror the Rust ones; real
 * Equalizer APO will sound very close, not byte-identical.
 */
type Kind = 'PK' | 'LS' | 'HS' | 'HP'
type Band = [Kind, number, number, number] // kind, Hz, dB, Q

const PRESETS: Record<string, Band[]> = {
  music: [['LS', 90, 2.5, 0.7], ['PK', 350, -1.5, 1], ['PK', 3200, 1.5, 1], ['HS', 9000, 2, 0.7]],
  cinematic: [['HP', 25, 0, 0.7], ['LS', 70, 4.5, 0.7], ['PK', 450, -1.5, 1], ['PK', 3400, 2, 0.9], ['HS', 10000, 2.5, 0.7]],
  bass: [['HP', 25, 0, 0.7], ['LS', 100, 6, 0.7], ['PK', 55, 3, 1]],
  vocal: [['HP', 90, 0, 0.7], ['PK', 250, -2, 1], ['PK', 2500, 3, 1.2], ['PK', 4500, 1.5, 1.5]],
  night: [['LS', 120, -4, 0.7], ['HS', 8000, -3, 0.7]],
  clarity: [['HS', 6000, 4, 0.7], ['PK', 3000, 1.5, 1]],
}

export interface EqRequest {
  preset: string
  strength?: number
  custom?: { bass: number; voice: number; treble: number }
}

function bandsFor(req: EqRequest): Band[] {
  if (req.preset === 'custom' && req.custom) {
    const c = (g: number) => Math.max(-8, Math.min(8, g))
    const out: Band[] = []
    if (Math.abs(req.custom.bass) > 0.05) out.push(['LS', 100, c(req.custom.bass), 0.7])
    if (Math.abs(req.custom.voice) > 0.05) out.push(['PK', 2500, c(req.custom.voice), 0.9])
    if (Math.abs(req.custom.treble) > 0.05) out.push(['HS', 8000, c(req.custom.treble), 0.7])
    return out
  }
  const k = req.strength ?? 1
  return (PRESETS[req.preset] ?? []).map(([kind, f, g, q]) => [kind, f, g * k, q] as Band)
}

/** The same headroom rule as Rust: cut by the biggest boost plus half the next. */
function preampDb(bands: Band[]): number {
  const boosts = bands.map((b) => b[2]).filter((g) => g > 0).sort((a, b) => b - a)
  if (!bands.length) return 0
  return -Math.min(12, (boosts[0] ?? 0) + (boosts[1] ?? 0) * 0.5 + 0.5)
}

const TYPES: Record<Kind, BiquadFilterType> = { PK: 'peaking', LS: 'lowshelf', HS: 'highshelf', HP: 'highpass' }

/** Plays a media element through the chosen mode and a spectrum analyser. */
export class PreviewAudio {
  readonly ctx = new AudioContext()
  readonly analyser: AnalyserNode
  private readonly preamp: GainNode
  private filters: BiquadFilterNode[] = []
  private readonly source: MediaElementAudioSourceNode

  readonly element: HTMLAudioElement

  constructor(element: HTMLAudioElement) {
    this.element = element
    this.source = this.ctx.createMediaElementSource(element)
    this.preamp = this.ctx.createGain()
    this.analyser = this.ctx.createAnalyser()
    this.analyser.fftSize = 2048
    this.analyser.smoothingTimeConstant = 0.6
    this.analyser.minDecibels = -100
    this.analyser.maxDecibels = 0
    this.source.connect(this.preamp)
    this.preamp.connect(this.analyser)
    this.analyser.connect(this.ctx.destination)
  }

  /** Switches the mode; an empty or unknown preset is a plain, untouched signal. */
  apply(req: EqRequest) {
    const bands = bandsFor(req)
    this.preamp.disconnect()
    this.filters.forEach((f) => f.disconnect())
    this.filters = bands.map(([kind, f, g, q]) => {
      const node = this.ctx.createBiquadFilter()
      node.type = TYPES[kind]
      node.frequency.value = f
      node.gain.value = g
      node.Q.value = q
      return node
    })
    this.preamp.gain.value = Math.pow(10, preampDb(bands) / 20)
    let tail: AudioNode = this.preamp
    for (const f of this.filters) {
      tail.connect(f)
      tail = f
    }
    tail.connect(this.analyser)
  }

  /** 64 log-spaced bands from 35 Hz to 16 kHz, 0-255, scaled like the real edge-light analysis. */
  spectrum(): number[] {
    const data = new Float32Array(this.analyser.frequencyBinCount)
    this.analyser.getFloatFrequencyData(data)
    const binHz = this.ctx.sampleRate / this.analyser.fftSize
    return Array.from({ length: 64 }, (_, b) => {
      const lo = 35 * Math.pow(16000 / 35, b / 64)
      const hi = 35 * Math.pow(16000 / 35, (b + 1) / 64)
      const from = Math.max(1, Math.floor(lo / binHz))
      const to = Math.max(from + 1, Math.ceil(hi / binHz))
      let peak = -Infinity
      for (let i = from; i < to && i < data.length; i++) peak = Math.max(peak, data[i])
      const level = Math.max(0, Math.min(1, (peak + 84) / 72))
      return Math.round(level * 255)
    })
  }
}
