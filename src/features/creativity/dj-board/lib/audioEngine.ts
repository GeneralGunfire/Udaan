/**
 * Real Web Audio engine for one deck. Playback, gain, crossfader, and the
 * 3-band EQ + dedicated bass control are genuine DSP via native
 * AudioNodes — cheap on any hardware, no external engine needed.
 *
 * The effects rack (reverb/delay/filter/flanger) is intentionally a MOCK
 * layer: state is tracked and exposed for the UI, but no audio node graph
 * is built for them yet. Real DSP there (convolution reverb impulse
 * responses, feedback delay lines, etc.) is heavier and its cost profile
 * depends on hardware the task explicitly flagged as needing direct user
 * input before choosing an approach. See `EffectsRack` TODOs below.
 */

export type EffectKind = 'reverb' | 'delay' | 'filter' | 'flanger'

export interface EffectState {
  enabled: boolean
  /** 0-1 generic wet/mix amount — meaning depends on effect, UI-only until real DSP lands. */
  amount: number
}

export type EffectsRackState = Record<EffectKind, EffectState>

export function defaultEffectsRack(): EffectsRackState {
  return {
    reverb: { enabled: false, amount: 0.3 },
    delay: { enabled: false, amount: 0.3 },
    filter: { enabled: false, amount: 0.5 },
    flanger: { enabled: false, amount: 0.3 },
  }
}

export interface EqState {
  /** dB, typically -24..+24, 0 = flat. */
  low: number
  mid: number
  high: number
}

export function defaultEq(): EqState {
  return { low: 0, mid: 0, high: 0 }
}

let sharedContext: AudioContext | null = null

function getAudioContext(): AudioContext {
  if (!sharedContext) {
    sharedContext = new AudioContext()
  }
  return sharedContext
}

/**
 * One deck's real audio graph:
 *   source -> lowShelf -> mid(peaking) -> highShelf -> bassBoost(lowshelf) -> gain -> deckOut
 * `deckOut` is exposed so the crossfader (owned by the mixer, not the deck)
 * can patch each deck's output into the correct crossfade gain stage.
 */
export class DeckAudioEngine {
  readonly context: AudioContext
  private buffer: AudioBuffer | null = null
  private source: AudioBufferSourceNode | null = null
  private readonly lowShelf: BiquadFilterNode
  private readonly midPeak: BiquadFilterNode
  private readonly highShelf: BiquadFilterNode
  private readonly bassBoost: BiquadFilterNode
  private readonly gainNode: GainNode
  readonly output: GainNode

  private startedAtContextTime = 0
  private startedAtOffset = 0
  private playing = false

  constructor() {
    this.context = getAudioContext()
    this.lowShelf = this.context.createBiquadFilter()
    this.lowShelf.type = 'lowshelf'
    this.lowShelf.frequency.value = 320

    this.midPeak = this.context.createBiquadFilter()
    this.midPeak.type = 'peaking'
    this.midPeak.frequency.value = 1000
    this.midPeak.Q.value = 0.9

    this.highShelf = this.context.createBiquadFilter()
    this.highShelf.type = 'highshelf'
    this.highShelf.frequency.value = 3200

    /** Dedicated bass control — separate from the low-EQ band, centered lower (sub-bass emphasis). */
    this.bassBoost = this.context.createBiquadFilter()
    this.bassBoost.type = 'lowshelf'
    this.bassBoost.frequency.value = 100
    this.bassBoost.gain.value = 0

    this.gainNode = this.context.createGain()
    this.output = this.context.createGain()

    this.lowShelf.connect(this.midPeak)
    this.midPeak.connect(this.highShelf)
    this.highShelf.connect(this.bassBoost)
    this.bassBoost.connect(this.gainNode)
    this.gainNode.connect(this.output)
  }

  async loadBuffer(bytes: Uint8Array): Promise<number> {
    this.stop()
    const arrayBuffer = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer
    this.buffer = await this.context.decodeAudioData(arrayBuffer)
    return this.buffer.duration
  }

  play(fromSeconds?: number) {
    if (!this.buffer) return
    if (this.playing) this.stopSourceOnly()

    const offset = fromSeconds ?? this.currentTime()
    const src = this.context.createBufferSource()
    src.buffer = this.buffer
    src.connect(this.lowShelf)
    src.start(0, Math.max(0, offset))

    this.source = src
    this.startedAtContextTime = this.context.currentTime
    this.startedAtOffset = Math.max(0, offset)
    this.playing = true

    src.onended = () => {
      if (this.source === src) this.playing = false
    }
  }

  pause() {
    if (!this.playing) return
    this.startedAtOffset = this.currentTime()
    this.stopSourceOnly()
    this.playing = false
  }

  stop() {
    this.stopSourceOnly()
    this.playing = false
    this.startedAtOffset = 0
  }

  private stopSourceOnly() {
    if (this.source) {
      this.source.onended = null
      try {
        this.source.stop()
      } catch {
        // already stopped — fine
      }
      this.source.disconnect()
      this.source = null
    }
  }

  seek(seconds: number) {
    const clamped = Math.max(0, Math.min(seconds, this.duration()))
    this.startedAtOffset = clamped
    this.startedAtContextTime = this.context.currentTime
    if (this.playing) this.play(clamped)
  }

  currentTime(): number {
    if (!this.playing) return this.startedAtOffset
    return this.startedAtOffset + (this.context.currentTime - this.startedAtContextTime)
  }

  duration(): number {
    return this.buffer?.duration ?? 0
  }

  isPlaying(): boolean {
    return this.playing
  }

  setEq(eq: EqState) {
    this.lowShelf.gain.value = eq.low
    this.midPeak.gain.value = eq.mid
    this.highShelf.gain.value = eq.high
  }

  /** -1..1 conceptually maps to attenuation only (0..1) — bass is a boost/cut knob, not a kill switch. */
  setBass(db: number) {
    this.bassBoost.gain.value = db
  }

  setVolume(v: number) {
    this.gainNode.gain.value = Math.max(0, Math.min(1, v))
  }

  dispose() {
    this.stop()
    this.output.disconnect()
  }
}

/**
 * Mixer: owns the crossfader and patches both decks' outputs to master.
 * Equal-power crossfade curve (real DSP, cheap: two Math.cos/sin lookups).
 */
export class MixerEngine {
  readonly context: AudioContext
  private readonly deckAGain: GainNode
  private readonly deckBGain: GainNode
  readonly master: GainNode

  constructor() {
    this.context = getAudioContext()
    this.deckAGain = this.context.createGain()
    this.deckBGain = this.context.createGain()
    this.master = this.context.createGain()
    this.deckAGain.connect(this.master)
    this.deckBGain.connect(this.master)
    this.master.connect(this.context.destination)
    this.setCrossfade(0)
  }

  connectDeckA(deckOutput: GainNode) {
    deckOutput.connect(this.deckAGain)
  }

  connectDeckB(deckOutput: GainNode) {
    deckOutput.connect(this.deckBGain)
  }

  /** position: -1 = full deck A, 0 = center, 1 = full deck B. Equal-power law. */
  setCrossfade(position: number) {
    const clamped = Math.max(-1, Math.min(1, position))
    const angle = ((clamped + 1) / 2) * (Math.PI / 2)
    this.deckAGain.gain.value = Math.cos(angle)
    this.deckBGain.gain.value = Math.sin(angle)
  }

  setMasterVolume(v: number) {
    this.master.gain.value = Math.max(0, Math.min(1.5, v))
  }

  async resume() {
    if (this.context.state === 'suspended') await this.context.resume()
  }
}
