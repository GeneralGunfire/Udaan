/**
 * Verifies the core contract of the DSP layer: with every parameter at its
 * documented neutral value, a full deck chain must be INAUDIBLE — not
 * "subtle", but sample-for-sample transparent within floating-point noise.
 *
 * This is the invariant two shipped bugs violated (a parked bandpass
 * filtering all playback, a compressor defaulting to on), so it is worth
 * a real render rather than a code review. Renders pink-ish test noise
 * through the chain in an OfflineAudioContext and compares against the
 * same signal undelayed.
 *
 * Run: node scripts/verify-dsp-inert.mjs
 */
import { AudioContext as NodeAudioContext, OfflineAudioContext } from 'node-web-audio-api'

globalThis.OfflineAudioContext = OfflineAudioContext
globalThis.AudioContext = NodeAudioContext

const { createDeckChain, chainDefaults } = await import('../src/features/private-player/lib/dsp/chain.ts')

const SR = 44100
const LEN = SR * 2

function buildNoise(ctx) {
  const buf = ctx.createBuffer(2, LEN, SR)
  let seed = 12345
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch)
    for (let i = 0; i < LEN; i++) {
      // Deterministic LCG so the two renders see identical input.
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      d[i] = (seed / 0x7fffffff) * 2 - 1
    }
  }
  return buf
}

async function renderThroughChain() {
  const ctx = new OfflineAudioContext(2, LEN, SR)
  const src = ctx.createBufferSource()
  src.buffer = buildNoise(ctx)
  const chain = createDeckChain(ctx)
  chain.apply(chainDefaults(chain), 0)
  src.connect(chain.input)
  chain.output.connect(ctx.destination)
  src.start()
  return ctx.startRendering()
}

async function renderDirect() {
  const ctx = new OfflineAudioContext(2, LEN, SR)
  const src = ctx.createBufferSource()
  src.buffer = buildNoise(ctx)
  src.connect(ctx.destination)
  src.start()
  return ctx.startRendering()
}

const [processed, direct] = await Promise.all([renderThroughChain(), renderDirect()])

let maxDiff = 0
let sumSq = 0
let n = 0
// Skip the first 100ms: parameter ramps and any latency settle there, and
// a transient at t=0 is not what this test is about.
const skip = Math.floor(SR * 0.1)
for (let ch = 0; ch < 2; ch++) {
  const a = processed.getChannelData(ch)
  const b = direct.getChannelData(ch)
  for (let i = skip; i < LEN; i++) {
    const d = Math.abs(a[i] - b[i])
    if (d > maxDiff) maxDiff = d
    sumSq += d * d
    n++
  }
}
const rms = Math.sqrt(sumSq / n)
const rmsDb = rms > 0 ? 20 * Math.log10(rms) : -Infinity

console.log(`max sample difference : ${maxDiff.toExponential(3)}`)
console.log(`rms difference        : ${rms.toExponential(3)}  (${rmsDb.toFixed(1)} dBFS)`)

// -80 dBFS is roughly 14-bit noise floor: inaudible against music by a
// wide margin, while still tight enough to catch a filter that is
// actually doing something.
const THRESHOLD_DB = -80
if (rmsDb > THRESHOLD_DB) {
  console.error(`\nFAIL: chain is NOT inert at defaults (${rmsDb.toFixed(1)} dBFS > ${THRESHOLD_DB} dBFS)`)
  process.exit(1)
}
console.log(`\nPASS: chain is inert at defaults (below ${THRESHOLD_DB} dBFS)`)
