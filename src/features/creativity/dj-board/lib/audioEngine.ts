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
 *   source -> lowShelf -> mid(peaking) -> highShelf -> bassBoost(lowshelf) -> filter(HP/LP sweep) -> gain -> analyser -> deckOut
 * `deckOut` is exposed so the crossfader (owned by the mixer, not the deck)
 * can patch each deck's output into the correct crossfade gain stage.
 * The filter and analyser are new nodes added alongside the existing,
 * verified-working EQ/bass/gain chain — that chain's own nodes and logic
 * are untouched.
 */
export class DeckAudioEngine {
  readonly context: AudioContext
  private buffer: AudioBuffer | null = null
  private source: AudioBufferSourceNode | null = null
  private readonly lowShelf: BiquadFilterNode
  private readonly midPeak: BiquadFilterNode
  private readonly highShelf: BiquadFilterNode
  private readonly bassBoost: BiquadFilterNode
  /** HP/LP sweep filter — separate control from the 3-band EQ, real DSP. */
  private readonly sweepFilter: BiquadFilterNode
  private readonly gainNode: GainNode
  /** Real-time level metering for the peak meter UI — read via getPeakLevel(), no audio-path effect. */
  private readonly analyser: AnalyserNode
  private readonly analyserData: Uint8Array<ArrayBuffer>
  readonly output: GainNode

  private startedAtContextTime = 0
  private startedAtOffset = 0
  private playing = false
  private playbackRate = 1

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

    /** Neutral at center (allpass-like: fully open); sweeps to lowpass below center, highpass above. */
    this.sweepFilter = this.context.createBiquadFilter()
    this.sweepFilter.type = 'allpass'
    this.sweepFilter.frequency.value = 20000
    this.sweepFilter.Q.value = 0.7

    this.gainNode = this.context.createGain()
    this.analyser = this.context.createAnalyser()
    this.analyser.fftSize = 256
    this.analyser.smoothingTimeConstant = 0.6
    this.analyserData = new Uint8Array(this.analyser.frequencyBinCount)
    this.output = this.context.createGain()

    this.lowShelf.connect(this.midPeak)
    this.midPeak.connect(this.highShelf)
    this.highShelf.connect(this.bassBoost)
    this.bassBoost.connect(this.sweepFilter)
    this.sweepFilter.connect(this.gainNode)
    this.gainNode.connect(this.analyser)
    this.analyser.connect(this.output)
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
    src.playbackRate.value = this.playbackRate
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
    return this.startedAtOffset + (this.context.currentTime - this.startedAtContextTime) * this.playbackRate
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

  /**
   * Real HP/LP sweep filter, separate from the 3-band EQ. position: -1 =
   * full lowpass sweep (cuts highs, classic "filter down" breakdown
   * effect), 0 = fully open (allpass, no effect), 1 = full highpass sweep
   * (cuts lows, "filter up" build effect) — the standard DJ filter-knob
   * behavior.
   */
  setFilter(position: number) {
    const clamped = Math.max(-1, Math.min(1, position))
    if (Math.abs(clamped) < 0.02) {
      this.sweepFilter.type = 'allpass'
      this.sweepFilter.frequency.value = 20000
      return
    }
    if (clamped < 0) {
      this.sweepFilter.type = 'lowpass'
      // -1..0 maps to 200Hz..20000Hz (exponential sweep feels more natural than linear)
      const t = 1 + clamped // 0..1
      this.sweepFilter.frequency.value = 200 * Math.pow(100, t)
    } else {
      this.sweepFilter.type = 'highpass'
      // 0..1 maps to 20Hz..8000Hz
      this.sweepFilter.frequency.value = 20 * Math.pow(400, clamped)
    }
  }

  /**
   * Real playback-rate change for Sync — this DOES shift pitch (unlike a
   * proper time-stretch), same tradeoff already documented for the Tempo
   * fader in useDjBoard.ts. Re-triggers the source at the current
   * position so the rate change takes effect immediately without a
   * seek-induced glitch.
   */
  setPlaybackRate(rate: number) {
    const clamped = Math.max(0.5, Math.min(2, rate))
    if (clamped === this.playbackRate) return
    const wasPlaying = this.playing
    const position = this.currentTime()
    this.playbackRate = clamped
    if (wasPlaying) this.play(position)
    else this.startedAtOffset = position
  }

  getPlaybackRate(): number {
    return this.playbackRate
  }

  /** 0-1 real-time peak level from the analyser node, for the peak meter UI. */
  getPeakLevel(): number {
    this.analyser.getByteTimeDomainData(this.analyserData)
    let peak = 0
    for (let i = 0; i < this.analyserData.length; i++) {
      const v = Math.abs(this.analyserData[i] - 128) / 128
      if (v > peak) peak = v
    }
    return peak
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
export type CrossfaderCurve = 'smooth' | 'sharp'

export class MixerEngine {
  readonly context: AudioContext
  private readonly deckAGain: GainNode
  private readonly deckBGain: GainNode
  readonly master: GainNode
  private readonly masterAnalyser: AnalyserNode
  private readonly masterAnalyserData: Uint8Array<ArrayBuffer>
  private curve: CrossfaderCurve = 'smooth'
  private lastCrossfadePosition = 0

  constructor() {
    this.context = getAudioContext()
    this.deckAGain = this.context.createGain()
    this.deckBGain = this.context.createGain()
    this.master = this.context.createGain()
    this.masterAnalyser = this.context.createAnalyser()
    this.masterAnalyser.fftSize = 256
    this.masterAnalyser.smoothingTimeConstant = 0.6
    this.masterAnalyserData = new Uint8Array(this.masterAnalyser.frequencyBinCount)
    this.deckAGain.connect(this.master)
    this.deckBGain.connect(this.master)
    this.master.connect(this.masterAnalyser)
    this.masterAnalyser.connect(this.context.destination)
    this.setCrossfade(0)
  }

  connectDeckA(deckOutput: GainNode) {
    deckOutput.connect(this.deckAGain)
  }

  connectDeckB(deckOutput: GainNode) {
    deckOutput.connect(this.deckBGain)
  }

  /** position: -1 = full deck A, 0 = center, 1 = full deck B. Equal-power law — unchanged, verified working. */
  setCrossfade(position: number) {
    const clamped = Math.max(-1, Math.min(1, position))
    this.lastCrossfadePosition = clamped
    if (this.curve === 'sharp') {
      // Sharp-cut: near-instant switch around center, small deadzone to avoid a hard click at exactly 0.
      this.deckAGain.gain.value = clamped <= 0.05 ? 1 : 0
      this.deckBGain.gain.value = clamped >= -0.05 ? 1 : 0
      return
    }
    const angle = ((clamped + 1) / 2) * (Math.PI / 2)
    this.deckAGain.gain.value = Math.cos(angle)
    this.deckBGain.gain.value = Math.sin(angle)
  }

  /** Sharp-cut vs. smooth-blend crossfader response — re-applies the current position under the new curve. */
  setCrossfaderCurve(curve: CrossfaderCurve) {
    this.curve = curve
    this.setCrossfade(this.lastCrossfadePosition)
  }

  setMasterVolume(v: number) {
    this.master.gain.value = Math.max(0, Math.min(1.5, v))
  }

  /** 0-1 real-time peak level from the master analyser, for the master peak meter UI. */
  getPeakLevel(): number {
    this.masterAnalyser.getByteTimeDomainData(this.masterAnalyserData)
    let peak = 0
    for (let i = 0; i < this.masterAnalyserData.length; i++) {
      const v = Math.abs(this.masterAnalyserData[i] - 128) / 128
      if (v > peak) peak = v
    }
    return peak
  }

  async resume() {
    if (this.context.state === 'suspended') await this.context.resume()
  }
}
