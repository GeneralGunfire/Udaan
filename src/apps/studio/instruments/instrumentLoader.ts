import * as engine from '@/integrations/studio/client'
import { instrumentById, sampleForPitch, type InstrumentDef, type SampleDef } from './definitions'

/**
 * Turns instrument *definitions* into engine sample slots.
 *
 * The engine plays samples by integer index into a fixed pool — it has no
 * concept of "piano" or "C4". This module owns the mapping between the
 * two: it downloads and decodes an instrument's files, records which slot
 * each one landed in, and answers "which slot plays this pitch".
 *
 * ## Why slots are allocated globally rather than per track
 * Two tracks using the same piano should share one set of decoded
 * buffers. A multisampled piano is tens of megabytes; loading it twice
 * because it appears on two tracks would double memory for nothing. Slots
 * are therefore keyed by the sample's cache key, not by the track.
 *
 * ## Why loading is idempotent and deduplicated
 * `ensureInstrument` can be called from several places at once — adding a
 * track, loading a project with four instrument tracks, switching an
 * instrument back to one used earlier. Without in-flight deduplication,
 * the same instrument would be downloaded and decoded several times
 * concurrently, each writing over the other's slot assignments. Promises
 * are cached by instrument id so concurrent callers await one load.
 */

/** Slot assignments by sample cache key. Survives for the session. */
const slotByKey = new Map<string, number>()

/** In-flight or completed loads, by instrument id. */
const loading = new Map<string, Promise<LoadedInstrument>>()

/** Next free index in the engine's sample pool. */
let nextSlot = 0

export interface LoadedInstrument {
  def: InstrumentDef
  /** Sample slot per cache key, for pitch lookup. */
  slots: Map<string, number>
}

const loaded = new Map<string, LoadedInstrument>()

export interface LoadProgress {
  /** Files finished, out of `total`. */
  done: number
  total: number
  /** True while files are being fetched over the network rather than
   * read from the local cache — the only phase worth showing a bar for. */
  downloading: boolean
}

/**
 * Ensures every sample an instrument needs is on disk and decoded into
 * the engine's pool. Safe to call repeatedly; later calls resolve
 * immediately from cache.
 *
 * `onProgress` is optional and reports coarse file counts rather than
 * bytes: the underlying command reports per-file completion, and a byte
 * total would require a HEAD request per file for a bar that is visible
 * for a couple of seconds on first use only.
 */
export function ensureInstrument(
  instrumentId: string,
  onProgress?: (progress: LoadProgress) => void,
): Promise<LoadedInstrument> {
  const existing = loading.get(instrumentId)
  if (existing) return existing

  const def = instrumentById(instrumentId)
  if (!def) {
    return Promise.reject(new Error(`Unknown instrument: ${instrumentId}`))
  }

  const task = loadDefinition(def, onProgress)
  loading.set(instrumentId, task)
  // A failed load must not poison the cache — the network may be back on
  // the next attempt, and leaving a rejected promise cached would make
  // every later call fail without retrying.
  task.catch(() => loading.delete(instrumentId))
  return task
}

async function loadDefinition(
  def: InstrumentDef,
  onProgress?: (progress: LoadProgress) => void,
): Promise<LoadedInstrument> {
  const total = def.samples.length
  onProgress?.({ done: 0, total, downloading: true })

  // One round trip for the whole instrument rather than per file: the
  // backend can fetch in parallel and skip anything already cached, and
  // it tells us which files it actually had to download.
  const results = await engine.ensureSamples(
    def.samples.map((s) => ({ key: s.key, url: s.url })),
  )

  const pathByKey = new Map(results.map((r) => [r.key, r.path]))
  const anyDownloaded = results.some((r) => r.downloaded)
  onProgress?.({ done: 0, total, downloading: anyDownloaded })

  const slots = new Map<string, number>()
  let done = 0

  for (const sample of def.samples) {
    const cached = slotByKey.get(sample.key)
    if (cached !== undefined) {
      slots.set(sample.key, cached)
      done += 1
      onProgress?.({ done, total, downloading: false })
      continue
    }

    const path = pathByKey.get(sample.key)
    if (!path) {
      // One missing file should not fail the whole instrument — the
      // remaining samples still cover most of the range, and
      // `slotForPitch` falls back to the nearest loaded root.
      console.error(`Studio: no local path for sample "${sample.key}"`)
      continue
    }

    const slot = nextSlot
    nextSlot += 1
    try {
      await engine.loadSample(slot, path)
      slotByKey.set(sample.key, slot)
      slots.set(sample.key, slot)
    } catch (err) {
      // Give the slot back so a decode failure does not leak indices.
      nextSlot -= 1
      console.error(`Studio: failed to decode "${sample.key}":`, err)
    }
    done += 1
    onProgress?.({ done, total, downloading: false })
  }

  if (slots.size === 0) {
    throw new Error(`Could not load any samples for ${def.name}.`)
  }

  const result: LoadedInstrument = { def, slots }
  loaded.set(def.id, result)
  return result
}

/**
 * The engine sample slot that should play `pitch` on this instrument, or
 * null when the instrument is not loaded yet.
 *
 * Falls back to the nearest *loaded* sample rather than the nearest
 * defined one: if a file failed to decode, pitch-shifting a neighbour
 * further than intended is still far better than silence on that note.
 */
export function slotForPitch(instrumentId: string, pitch: number): number | null {
  const inst = loaded.get(instrumentId)
  if (!inst) return null

  const ideal = sampleForPitch(inst.def, pitch)
  if (ideal) {
    const slot = inst.slots.get(ideal.key)
    if (slot !== undefined) return slot
  }

  let best: { sample: SampleDef; distance: number } | null = null
  for (const sample of inst.def.samples) {
    if (!inst.slots.has(sample.key)) continue
    const distance = Math.abs(sample.rootPitch - pitch)
    if (!best || distance < best.distance) best = { sample, distance }
  }
  return best ? (inst.slots.get(best.sample.key) ?? null) : null
}

/** Whether an instrument's samples are decoded and ready to play. */
export function isInstrumentLoaded(instrumentId: string): boolean {
  return loaded.has(instrumentId)
}

/**
 * The pitch a sample slot was recorded at, so the engine can compute the
 * playback ratio. Returns null for an unknown slot.
 */
export function rootPitchForSlot(instrumentId: string, slot: number): number | null {
  const inst = loaded.get(instrumentId)
  if (!inst) return null
  for (const [key, value] of inst.slots) {
    if (value !== slot) continue
    const sample = inst.def.samples.find((s) => s.key === key)
    return sample ? sample.rootPitch : null
  }
  return null
}
