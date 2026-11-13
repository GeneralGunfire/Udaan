import { createStemChain, type EffectChain, type ParamValues } from './dsp'

/**
 * Four-stem playback for a deck: vocals, drums, bass, and everything else.
 *
 * The separation model itself is deferred (see `stemStatus` below) — what
 * exists here is the whole playback side, so that when separated files
 * appear this is already the thing that plays them. That ordering is
 * deliberate: the hard part of stems in a DJ context is not running the
 * model, it is keeping four sources sample-aligned under a crossfader
 * while each carries its own EQ and sends. Building that against real
 * audio (four copies of the same file, which trivially proves alignment)
 * is more reliable than building it later against model output where an
 * alignment bug and a model bug look identical.
 *
 * ALIGNMENT: all four stems play from one `AudioBufferSourceNode.start()`
 * call each, scheduled at the *same* explicit context time rather than
 * "now". Starting them in a loop without a shared start time drifts them
 * by however long the loop took — inaudible as latency, but catastrophic
 * as phase between four copies of the same music. This only works because
 * both decks now share one AudioContext (lib/audioGraph.ts); with the two
 * contexts the decks used to have, there was no common clock to schedule
 * against at all.
 */

export const STEM_NAMES = ['vocals', 'drums', 'bass', 'other'] as const
export type StemName = (typeof STEM_NAMES)[number]

export const STEM_LABELS: Record<StemName, string> = {
  vocals: 'Vocals',
  drums: 'Drums',
  bass: 'Bass',
  other: 'Music',
}

export interface StemLane {
  name: StemName
  source: AudioBufferSourceNode | null
  chain: EffectChain
  gain: GainNode
  values: ParamValues
  muted: boolean
  soloed: boolean
}

export interface StemPlayer {
  lanes: Map<StemName, StemLane>
  output: GainNode
  /** Context time the stems were scheduled to start, so playback position
   * can be derived as `ctx.currentTime - startedAt`. */
  startedAt: number | null
  dispose(): void
}

/**
 * Builds the four-lane graph. Each lane gets its own effect chain (a
 * lighter one than the deck rack — see `createStemChain`) and its own
 * gain, all summing into one output that replaces the deck's normal
 * source when stems are engaged.
 */
export function createStemPlayer(ctx: AudioContext): StemPlayer {
  const output = ctx.createGain()
  const lanes = new Map<StemName, StemLane>()

  for (const name of STEM_NAMES) {
    const chain = createStemChain(ctx)
    const gain = ctx.createGain()
    gain.gain.value = 1
    chain.output.connect(gain)
    gain.connect(output)
    lanes.set(name, {
      name,
      source: null,
      chain,
      gain,
      values: {},
      muted: false,
      soloed: false,
    })
  }

  return {
    lanes,
    output,
    startedAt: null,
    dispose() {
      for (const lane of lanes.values()) {
        try {
          lane.source?.stop()
          lane.source?.disconnect()
          lane.chain.dispose()
          lane.gain.disconnect()
        } catch {
          // Already stopped or disconnected.
        }
      }
      try {
        output.disconnect()
      } catch {
        // Already disconnected.
      }
    },
  }
}

/**
 * Loads four decoded buffers and schedules them to start together.
 *
 * `offsetSeconds` seeks all four to the same point, so engaging stems
 * mid-track resumes where the deck already was rather than restarting.
 * The small `lookahead` gives the scheduler time to arm all four before
 * the start time passes — without it, a slow frame between the first and
 * last `start()` call means the first stem has already begun playing when
 * the last is scheduled, and it plays late by exactly that gap.
 */
export function startStems(
  ctx: AudioContext,
  player: StemPlayer,
  buffers: Partial<Record<StemName, AudioBuffer>>,
  offsetSeconds = 0,
  lookahead = 0.06,
): void {
  stopStems(player)
  const startTime = ctx.currentTime + lookahead

  for (const name of STEM_NAMES) {
    const buffer = buffers[name]
    const lane = player.lanes.get(name)
    if (!buffer || !lane) continue
    const source = ctx.createBufferSource()
    source.buffer = buffer
    source.connect(lane.chain.input)
    source.start(startTime, Math.min(offsetSeconds, buffer.duration))
    lane.source = source
  }

  player.startedAt = startTime - offsetSeconds
}

export function stopStems(player: StemPlayer): void {
  for (const lane of player.lanes.values()) {
    try {
      lane.source?.stop()
      lane.source?.disconnect()
    } catch {
      // Not started, or already stopped.
    }
    lane.source = null
  }
  player.startedAt = null
}

/**
 * Applies mute/solo across all four lanes.
 *
 * Solo is resolved globally rather than per lane because it is inherently
 * a statement about the others: soloing vocals means muting everything
 * else, so a lane cannot decide its own gain without knowing whether any
 * lane anywhere is soloed. Handling it per lane is the classic way solo
 * ends up doing nothing when two lanes are soloed at once.
 */
export function applyStemMix(ctx: AudioContext, player: StemPlayer, now = ctx.currentTime): void {
  const anySoloed = [...player.lanes.values()].some((l) => l.soloed)
  for (const lane of player.lanes.values()) {
    const audible = anySoloed ? lane.soloed : !lane.muted
    lane.gain.gain.setTargetAtTime(audible ? 1 : 0, now, 0.02)
  }
}
