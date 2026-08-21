/**
 * Real Web Audio engine for one deck. Playback, gain, crossfader, the
 * 3-band EQ + dedicated bass control, the HP/LP filter sweep, and the
 * effects rack (reverb/delay/filter/flanger) are all genuine DSP via
 * native AudioNodes — cheap on any hardware, no external engine needed.
 *
 * Effects are wired as a "hold to apply" momentary send, GarageBand-
 * Live-Loops-style: engage(kind) ramps the wet mix up over ~15ms
 * (audible instantly, no click), release(kind) ramps it back to 0 —
 * not a toggle. The `amount` control is intensity, applied continuously
 * while held: filter cutoff sweep depth, delay feedback/mix, flanger
 * depth, reverb wet mix.
 */

export type EffectKind = 'reverb' | 'delay' | 'filter' | 'flanger'

export interface EffectState {
  /** True only while the control is actively held down. */
  engaged: boolean
  /** 0-1 intensity — meaning depends on effect (see each effect's setup below). */
  amount: number
}

export type EffectsRackState = Record<EffectKind, EffectState>

export function defaultEffectsRack(): EffectsRackState {
  return {
    reverb: { engaged: false, amount: 0.5 },
    delay: { engaged: false, amount: 0.4 },
    filter: { engaged: false, amount: 0.6 },
    flanger: { engaged: false, amount: 0.5 },
  }
}

/** Synthesizes a decaying-noise impulse response for convolution reverb — no external audio file needed. */
function buildReverbImpulse(context: BaseAudioContext, seconds: number, decay: number): AudioBuffer {
  const rate = context.sampleRate
  const length = Math.max(1, Math.floor(rate * seconds))
  const impulse = context.createBuffer(2, length, rate)
  for (let channel = 0; channel < 2; channel++) {
    const data = impulse.getChannelData(channel)
    for (let i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay)
    }
  }
  return impulse
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
 *                                                                                                        \-> [4 parallel effect sends] -> deckOut
 * `deckOut` is exposed so the crossfader (owned by the mixer, not the deck)
 * can patch each deck's output into the correct crossfade gain stage.
 * The filter, analyser, and effect sends are new nodes added alongside
 * the existing, verified-working EQ/bass/gain chain — that chain's own
 * nodes and logic are untouched.
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

  // --- Effects rack: real parallel sends, tapped after the main chain. ---
  /** Effect reverb: convolver + wet gain, fed from a tap after gainNode. */
  private readonly reverbConvolver: ConvolverNode
  private readonly reverbWet: GainNode
  /** Effect delay: real feedback delay line (DelayNode -> feedback gain -> back into itself). */
  private readonly delayNode: DelayNode
  private readonly delayFeedback: GainNode
  private readonly delayWet: GainNode
  /** Effect filter: a second, dedicated lowpass sweep (independent of the main HP/LP knob) for the hold-to-apply "filter down" effect. */
  private readonly effectFilterNode: BiquadFilterNode
  private readonly effectFilterWet: GainNode
  /** Effect flanger: short modulated delay + LFO on delayTime, classic flanger topology. */
  private readonly flangerDelay: DelayNode
  private readonly flangerLfo: OscillatorNode
  private readonly flangerLfoGain: GainNode
  private readonly flangerFeedback: GainNode
  private readonly flangerWet: GainNode
  private readonly effectsTap: GainNode

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

    // Effects tap — fed from the same post-EQ signal as the dry path, so
    // effects apply to what's actually playing (post EQ/bass/filter),
    // mixed back into `output` at a controllable wet gain.
    this.effectsTap = this.context.createGain()
    this.analyser.connect(this.effectsTap)

    this.reverbConvolver = this.context.createConvolver()
    this.reverbConvolver.buffer = buildReverbImpulse(this.context, 2.2, 2.5)
    this.reverbWet = this.context.createGain()
    this.reverbWet.gain.value = 0
    this.effectsTap.connect(this.reverbConvolver)
    this.reverbConvolver.connect(this.reverbWet)
    this.reverbWet.connect(this.output)

    this.delayNode = this.context.createDelay(1.5)
    this.delayNode.delayTime.value = 0.3
    this.delayFeedback = this.context.createGain()
    this.delayFeedback.gain.value = 0.35
    this.delayWet = this.context.createGain()
    this.delayWet.gain.value = 0
    this.effectsTap.connect(this.delayNode)
    this.delayNode.connect(this.delayFeedback)
    this.delayFeedback.connect(this.delayNode)
    this.delayNode.connect(this.delayWet)
    this.delayWet.connect(this.output)

    this.effectFilterNode = this.context.createBiquadFilter()
    this.effectFilterNode.type = 'lowpass'
    this.effectFilterNode.frequency.value = 20000
    this.effectFilterNode.Q.value = 4
    this.effectFilterWet = this.context.createGain()
    this.effectFilterWet.gain.value = 0
    this.effectsTap.connect(this.effectFilterNode)
    this.effectFilterNode.connect(this.effectFilterWet)
    this.effectFilterWet.connect(this.output)

    this.flangerDelay = this.context.createDelay(0.05)
    this.flangerDelay.delayTime.value = 0.005
    this.flangerLfo = this.context.createOscillator()
    this.flangerLfo.type = 'sine'
    this.flangerLfo.frequency.value = 0.3
    this.flangerLfoGain = this.context.createGain()
    this.flangerLfoGain.gain.value = 0.003
    this.flangerFeedback = this.context.createGain()
    this.flangerFeedback.gain.value = 0.4
    this.flangerWet = this.context.createGain()
    this.flangerWet.gain.value = 0
    this.flangerLfo.connect(this.flangerLfoGain)
    this.flangerLfoGain.connect(this.flangerDelay.delayTime)
    this.flangerLfo.start()
    this.effectsTap.connect(this.flangerDelay)
    this.flangerDelay.connect(this.flangerFeedback)
    this.flangerFeedback.connect(this.flangerDelay)
    this.flangerDelay.connect(this.flangerWet)
    this.flangerWet.connect(this.output)
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

  private wetGainFor(kind: EffectKind): GainNode {
    switch (kind) {
      case 'reverb':
        return this.reverbWet
      case 'delay':
        return this.delayWet
      case 'filter':
        return this.effectFilterWet
      case 'flanger':
        return this.flangerWet
    }
  }

  /** Applies the 0-1 intensity to whatever DSP parameter each effect actually controls (not just wet mix). */
  private applyEffectAmount(kind: EffectKind, amount: number) {
    const clamped = Math.max(0, Math.min(1, amount))
    if (kind === 'filter') {
      // Higher intensity = more aggressive lowpass sweep (classic filter-down build/breakdown).
      this.effectFilterNode.frequency.value = 12000 * Math.pow(0.01, clamped)
    } else if (kind === 'delay') {
      // Higher intensity = longer delay time + more feedback repeats.
      this.delayNode.delayTime.value = 0.08 + clamped * 0.5
      this.delayFeedback.gain.value = 0.15 + clamped * 0.55
    } else if (kind === 'flanger') {
      // Higher intensity = deeper sweep + faster LFO.
      this.flangerLfoGain.gain.value = 0.001 + clamped * 0.006
      this.flangerLfo.frequency.value = 0.15 + clamped * 1.2
      this.flangerFeedback.gain.value = 0.2 + clamped * 0.5
    }
    // Reverb's "amount" is just wet mix, handled in engage()/release() via the target level.
  }

  /**
   * GarageBand-style hold-to-apply: ramps the effect's wet gain up to a
   * level derived from `amount` over ~15ms (fast enough to feel instant,
   * slow enough to avoid a click), and applies the amount to whatever
   * parameter that effect actually sweeps/modulates. Call again with a
   * new amount while held to update intensity live (e.g. dragging a
   * scroll/intensity control while the effect is engaged).
   */
  engageEffect(kind: EffectKind, amount: number) {
    this.applyEffectAmount(kind, amount)
    const wet = this.wetGainFor(kind)
    const targetLevel = kind === 'reverb' ? 0.15 + amount * 0.55 : 0.7 + amount * 0.3
    wet.gain.cancelScheduledValues(this.context.currentTime)
    wet.gain.setTargetAtTime(targetLevel, this.context.currentTime, 0.008)
  }

  /** Releases a held effect — ramps wet gain back to 0, same smooth-ramp approach as engage. */
  releaseEffect(kind: EffectKind) {
    const wet = this.wetGainFor(kind)
    wet.gain.cancelScheduledValues(this.context.currentTime)
    wet.gain.setTargetAtTime(0, this.context.currentTime, 0.02)
  }

  dispose() {
    this.stop()
    try {
      this.flangerLfo.stop()
    } catch {
      // already stopped — fine
    }
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
