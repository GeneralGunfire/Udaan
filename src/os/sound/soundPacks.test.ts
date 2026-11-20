import { describe, expect, it } from 'vitest'
import { NOTIFY_PACK_LIST, UI_PACK_LIST, notifyPackVoices, uiPackVoices } from './soundPacks'
import type { SoundId } from './sounds'

const IDS: SoundId[] = [
  'tap', 'open', 'close', 'unlock', 'lock', 'error', 'switch', 'minimize', 'maximize', 'snap', 'screenshot',
  'delete', 'hover', 'success', 'drop', 'pop', 'swoosh', 'toggle', 'boot',
]

describe('interaction packs', () => {
  const packs = UI_PACK_LIST.filter((p) => p.id !== 'udaan' && p.id !== 'off')
  it('has several packs besides the default and Off', () => {
    expect(packs.length).toBeGreaterThanOrEqual(4)
  })
  it.each(packs.map((p) => p.id))('%s covers every event with sane voices', (pack) => {
    for (const id of IDS) {
      const voices = uiPackVoices(pack, id)
      expect(voices, `${pack}/${id}`).toBeDefined()
      for (const v of voices ?? []) {
        expect(Number.isFinite(v.freq) && v.freq > 20 && v.freq < 12000).toBe(true)
        expect(v.dur).toBeGreaterThan(0)
        expect(v.gain).toBeGreaterThan(0)
        expect(v.gain).toBeLessThanOrEqual(1)
        expect(v.partials.length).toBeGreaterThan(0)
      }
    }
  })
  it('leaves the default pack to the built-in sounds', () => {
    expect(uiPackVoices('udaan', 'tap')).toBeUndefined()
    expect(uiPackVoices('nonsense', 'tap')).toBeUndefined()
  })
})

describe('notification packs', () => {
  const packs = NOTIFY_PACK_LIST.filter((p) => p.id !== 'glass' && p.id !== 'off')
  it.each(packs.map((p) => p.id))('%s has voices', (pack) => {
    const voices = notifyPackVoices(pack)
    expect(voices?.length).toBeGreaterThan(0)
    for (const v of voices ?? []) {
      expect(v.freq).toBeGreaterThan(20)
      expect(v.gain).toBeLessThanOrEqual(1)
    }
  })
  it('leaves the default and unknown ids to the built-in sound', () => {
    expect(notifyPackVoices('glass')).toBeUndefined()
    expect(notifyPackVoices('nonsense')).toBeUndefined()
  })
})
