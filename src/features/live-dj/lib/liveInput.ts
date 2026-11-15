import { Channel, invoke } from '@tauri-apps/api/core'
import { createDeckChain, DECK_DEFAULTS, type EffectChain, type ParamValues } from '@/features/private-player/lib/dsp'
import { ensureMasterBus } from '@/features/private-player/lib/audioGraph'

export interface AudioSource {
  pid: number
  exe: string
  name: string
  active: boolean
  peak: number
}

export interface LiveStats {
  fillMs: number
  underruns: number
  targetMs?: number
  looping: boolean
}

/** How loud the original app keeps playing while the board mixes it. The
 * original can't be silenced outright: the tap is captured after the app's
 * volume, so turning it down also scales the tap, and the tap has a small
 * fixed noise floor that the restoring gain raises with it. These levels are
 * the useful range: quieter hides the original better but adds more noise.
 * (Windows applies the value squared: 0.3 is about -21 dB, 0.55 about -10 dB.) */
export type SourceLevel = 'quiet' | 'soft' | 'full'
export const SOURCE_LEVELS: Record<SourceLevel, number> = { quiet: 0.3, soft: 0.55, full: 1 }

export type Latency = 'low' | 'balanced' | 'stable'
/** Jitter buffer per mode: the whole delay between the original app and
 * what you hear (capture ≈10 ms + this + output). */
const TARGET_MS: Record<Latency, number> = { low: 50, balanced: 90, stable: 150 }

const loadedModules = new WeakSet<AudioContext>()

/**
 * One live deck: another app's audio, pulled into the shared master bus
 * through the same effect chain the Music app's decks use.
 *
 *   Rust process-loopback tap → IPC → AudioWorklet → deck chain → master bus
 *
 * While live, the source app is turned down at Windows (so you hear only the
 * processed copy) and the stream is scaled back up here; both are undone on
 * stop, and Rust restores the source itself if this window dies.
 */
export class LiveInput {
  readonly ctx: AudioContext
  readonly chain: EffectChain
  readonly analyser: AnalyserNode
  readonly deckGain: GainNode
  private node: AudioWorkletNode | null = null
  private bypassed = false
  private pid: number | null = null
  onStats: (s: LiveStats) => void = () => {}

  private constructor(ctx: AudioContext, chain: EffectChain, analyser: AnalyserNode, deckGain: GainNode) {
    this.ctx = ctx
    this.chain = chain
    this.analyser = analyser
    this.deckGain = deckGain
  }

  /** Builds the graph up to (not including) the tap. */
  static create(): LiveInput | null {
    const bus = ensureMasterBus()
    if (!bus) return null
    const ctx = bus.ctx
    const chain = createDeckChain(ctx)
    chain.apply(DECK_DEFAULTS, ctx.currentTime)
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 2048
    analyser.smoothingTimeConstant = 0.7
    const deckGain = ctx.createGain()
    chain.output.connect(analyser)
    analyser.connect(deckGain)
    deckGain.connect(bus.input)
    return new LiveInput(ctx, chain, analyser, deckGain)
  }

  get live(): boolean {
    return this.pid !== null
  }

  async start(pid: number, opts: { level: SourceLevel; latency: Latency }): Promise<void> {
    await this.stop()
    await this.ctx.resume()
    if (!this.node) {
      // registerProcessor throws if the same module is added twice to one
      // context (React StrictMode mounts twice in development).
      if (!loadedModules.has(this.ctx)) {
        await this.ctx.audioWorklet.addModule('/live-capture-worklet.js')
        loadedModules.add(this.ctx)
      }
      this.node = new AudioWorkletNode(this.ctx, 'live-capture', { numberOfInputs: 0, outputChannelCount: [2] })
      this.node.port.onmessage = (e) => e.data?.type === 'stats' && this.onStats(e.data as LiveStats)
      this.route()
    }
    const node = this.node
    node.port.postMessage({ type: 'target', ms: TARGET_MS[opts.latency] })

    const channel = new Channel<ArrayBuffer>()
    channel.onmessage = (buf) => node.port.postMessage({ type: 'pcm', buf }, [buf])
    await invoke('live_audio_start', { pid, sampleRate: this.ctx.sampleRate, sourceLevel: SOURCE_LEVELS[opts.level], onAudio: channel })
    this.pid = pid
    // A worklet node that was connected in the same tick it was created is not always pulled by the
    // audio thread (measured: no frames until it was reconnected). Connect it again once the tap is live.
    this.route()
  }

  async stop(): Promise<void> {
    if (this.pid === null) return
    this.pid = null
    this.node?.port.postMessage({ type: 'loop-off' })
    await invoke('live_audio_stop').catch(() => {})
  }

  /** Changes how loud the original plays while live. The Rust capture loop
   * orders the volume change and the matching gain safely. */
  setLevel(level: SourceLevel) {
    void invoke('live_audio_set_level', { level: SOURCE_LEVELS[level] }).catch(() => {})
  }

  setTarget(latency: Latency) {
    this.node?.port.postMessage({ type: 'target', ms: TARGET_MS[latency] })
  }

  setLoop(frames: number | null) {
    if (frames === null) this.node?.port.postMessage({ type: 'loop-off' })
    else this.node?.port.postMessage({ type: 'loop', frames })
  }

  apply(values: ParamValues) {
    this.chain.apply(values, this.ctx.currentTime)
  }

  /** True bypass: the tap goes straight to the meter, skipping every effect. */
  setBypass(on: boolean) {
    this.bypassed = on
    this.route()
  }

  private route() {
    if (!this.node) return
    try {
      this.node.disconnect()
    } catch {
      // Not connected yet.
    }
    this.node.connect(this.bypassed ? this.analyser : this.chain.input)
  }

  async dispose(): Promise<void> {
    await this.stop()
    try {
      this.node?.disconnect()
      this.deckGain.disconnect()
    } catch {
      // Already disconnected.
    }
    this.chain.dispose()
  }
}
