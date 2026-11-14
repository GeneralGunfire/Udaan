/**
 * Companion to verify-dsp-inert.mjs.
 *
 * Inertness alone is a trap: an effect that is disconnected, throwing, or
 * silently broken passes the inert test perfectly. `DistortionEffect` did
 * exactly that — it threw "cannot assign curve twice" on every apply, was
 * swallowed by EffectChain's per-effect guard, and still reported a clean
 * inert render because a dead effect is certainly transparent.
 *
 * So this asserts the opposite direction: with a parameter pushed to a
 * meaningful value, each effect must measurably CHANGE the signal. Run
 * both and an effect has to be both silent at rest and alive when turned
 * up to pass.
 *
 * Run: node scripts/verify-dsp-active.mjs
 */
import { AudioContext as NodeAudioContext, OfflineAudioContext } from 'node-web-audio-api'

globalThis.OfflineAudioContext = OfflineAudioContext
globalThis.AudioContext = NodeAudioContext

const { createDeckChain, chainDefaults } = await import('../src/features/private-player/lib/dsp/chain.ts')

const SR = 44100
const LEN = SR * 2
const skip = Math.floor(SR * 0.3)

function buildNoise(ctx) {
  const buf = ctx.createBuffer(2, LEN, SR)
  let seed = 12345
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch)
    for (let i = 0; i < LEN; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      d[i] = (seed / 0x7fffffff) * 2 - 1
    }
  }
  return buf
}

async function render(overrides) {
  const ctx = new OfflineAudioContext(2, LEN, SR)
  const src = ctx.createBufferSource()
  src.buffer = buildNoise(ctx)
  const chain = createDeckChain(ctx)
  const values = { ...chainDefaults(chain), ...overrides }
  let threw = null
  const origError = console.error
  console.error = (...a) => {
    threw = a.join(' ')
  }
  chain.apply(values, 0)
  console.error = origError
  src.connect(chain.input)
  chain.output.connect(ctx.destination)
  src.start()
  const buf = await ctx.startRendering()
  return { buf, threw }
}

function rmsDiffDb(a, b) {
  let sumSq = 0
  let n = 0
  for (let ch = 0; ch < 2; ch++) {
    const x = a.getChannelData(ch)
    const y = b.getChannelData(ch)
    for (let i = skip; i < LEN; i++) {
      const d = x[i] - y[i]
      sumSq += d * d
      n++
    }
  }
  const rms = Math.sqrt(sumSq / n)
  return rms > 0 ? 20 * Math.log10(rms) : -Infinity
}

// Each case pushes one effect to an obviously-audible setting. The
// threshold is deliberately loose (-60 dBFS): this asks "did anything
// happen at all", not "does it sound correct", which no automated check
// can answer.
const CASES = [
  ['trim', { gain: 6 }],
  ['eq bass', { bass: 12 }],
  ['eq kill', { killBass: true }],
  ['enhancer', { enhancer: 80 }],
  ['muffle', { muffle: 80 }],
  ['filter sweep', { filterSweep: -70 }],
  ['drive', { drive: 70 }],
  ['bitcrush', { bitcrush: 80 }],
  ['flanger', { flangerDepth: 80 }],
  ['phaser', { phaserDepth: 80 }],
  ['echo', { echoAmount: 70 }],
  ['reverb', { reverbAmount: 70 }],
  ['gate', { gateDepth: 90 }],
]

const baseline = await render({})
if (baseline.threw) {
  console.error(`FAIL: baseline render logged an error: ${baseline.threw}`)
  process.exit(1)
}

let failures = 0
for (const [name, overrides] of CASES) {
  const { buf, threw } = await render(overrides)
  const db = rmsDiffDb(buf, baseline.buf)
  const alive = db > -60
  const status = threw ? 'THREW' : alive ? 'ok' : 'SILENT'
  console.log(`${status.padEnd(6)} ${name.padEnd(14)} ${db === -Infinity ? '-inf' : db.toFixed(1).padStart(7)} dBFS`)
  if (threw) {
    console.log(`       └─ ${threw}`)
    failures++
  } else if (!alive) {
    failures++
  }
}

if (failures > 0) {
  console.error(`\nFAIL: ${failures} effect(s) had no audible effect or threw`)
  process.exit(1)
}
console.log(`\nPASS: all ${CASES.length} effects measurably alter the signal when engaged`)
