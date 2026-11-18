import { useSyncExternalStore } from 'react'

/**
 * Listen to the news. A queue of stories read aloud with the system voice (Windows' own, offline).
 * Each story is cut into sentences-sized pieces, because some speech engines stall on one long
 * utterance. Pause, skip, speed and stop all work; a stale callback after a skip is ignored.
 */

export interface AudioState {
  active: boolean
  playing: boolean
  index: number
  total: number
  title: string
  label: string
  rate: number
}

interface Item {
  title: string
  text: string
}

let queue: Item[] = []
let gen = 0
let st: AudioState = { active: false, playing: false, index: 0, total: 0, title: '', label: '', rate: 1 }
const subs = new Set<() => void>()
const set = (p: Partial<AudioState>) => {
  st = { ...st, ...p }
  subs.forEach((s) => s())
}

function chunks(text: string): string[] {
  const parts = text.replace(/\s+/g, ' ').match(/[^.!?]+[.!?]+(\s|$)|[^.!?]+$/g) ?? [text]
  const out: string[] = []
  let cur = ''
  for (const p of parts) {
    if ((cur + p).length > 240 && cur) (out.push(cur.trim()), (cur = p))
    else cur += p
  }
  if (cur.trim()) out.push(cur.trim())
  return out
}

function speakStory(i: number) {
  const my = ++gen
  speechSynthesis.cancel()
  if (i >= queue.length) return stop()
  const it = queue[i]
  set({ active: true, playing: true, index: i, title: it.title })
  const pieces = [it.title + '.', ...chunks(it.text)]
  let n = 0
  const next = () => {
    if (my !== gen) return
    if (n >= pieces.length) return speakStory(i + 1)
    const u = new SpeechSynthesisUtterance(pieces[n++])
    u.rate = st.rate
    u.onend = next
    u.onerror = (e) => {
      // "canceled" and "interrupted" are our own skips; anything else, move on to the next piece.
      if (my === gen && e.error !== 'canceled' && e.error !== 'interrupted') next()
    }
    speechSynthesis.speak(u)
  }
  next()
}

function stop() {
  gen++
  speechSynthesis.cancel()
  queue = []
  set({ active: false, playing: false, index: 0, total: 0, title: '', label: '' })
}

export const audio = {
  play(items: Item[], label: string) {
    const list = items.filter((x) => x.title.trim())
    if (!list.length) return
    queue = list
    set({ total: list.length, label })
    speakStory(0)
  },
  toggle() {
    if (!st.active) return
    if (st.playing) (speechSynthesis.pause(), set({ playing: false }))
    else (speechSynthesis.resume(), set({ playing: true }))
  },
  next: () => st.active && speakStory(Math.min(st.index + 1, queue.length)),
  prev: () => st.active && speakStory(Math.max(0, st.index - 1)),
  stop,
  setRate(r: number) {
    set({ rate: r })
    if (st.active) speakStory(st.index)
  },
}

export const useAudio = () =>
  useSyncExternalStore(
    (cb) => (subs.add(cb), () => void subs.delete(cb)),
    () => st,
  )
