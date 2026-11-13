import { synthesizeSpeech } from '@/integrations/local-model/client'
import type { Sentence } from './types'

export type PlaybackStatus = 'idle' | 'buffering' | 'playing' | 'paused' | 'ended' | 'error'

function mediaErrorCodeName(code: number): string {
  switch (code) {
    case MediaError.MEDIA_ERR_ABORTED:
      return 'MEDIA_ERR_ABORTED'
    case MediaError.MEDIA_ERR_NETWORK:
      return 'MEDIA_ERR_NETWORK'
    case MediaError.MEDIA_ERR_DECODE:
      return 'MEDIA_ERR_DECODE'
    case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
      return 'MEDIA_ERR_SRC_NOT_SUPPORTED'
    default:
      return `MEDIA_ERR_UNKNOWN(${code})`
  }
}

export interface PlaybackEngineCallbacks {
  onStatusChange: (status: PlaybackStatus) => void
  onSentenceChange: (index: number) => void
  onError: (message: string) => void
}

/**
 * Drives sentence-by-sentence playback: synthesizes a short lookahead
 * buffer of upcoming sentences via Piper (each call ~1.5-2.5s) while the
 * current one plays, so there's no audible gap between sentences and no
 * long upfront wait before the first one starts. Speed changes apply to
 * Piper's synthesis (native `--length_scale`) going forward — sentences
 * already synthesized at the old speed are ONLY invalidated if the queue
 * hasn't started playing them yet, so a mid-sentence speed change doesn't
 * jarringly resynthesize audio that's already partway through.
 */
export class PlaybackEngine {
  private sentences: Sentence[] = []
  private currentIndex = 0
  private voiceId: string
  private speed: number
  private volume: number

  private audioCache = new Map<number, ArrayBuffer>()
  private pendingSynthesis = new Set<number>()
  private audioEl: HTMLAudioElement | null = null
  private status: PlaybackStatus = 'idle'
  private destroyed = false
  private synthGeneration = 0
  private callbacks: PlaybackEngineCallbacks
  /** Serializes Piper calls to one at a time. Each call spawns its own
   * process and loads a ~60MB ONNX model independently — running several
   * concurrently (the original lookahead did up to 3) can exceed available
   * memory on a low-RAM machine, causing synthesis to hang or fail rather
   * than just being slower, which made playback look like it never starts
   * at all instead of just taking longer to buffer. */
  private synthQueue: Promise<void> = Promise.resolve()

  constructor(callbacks: PlaybackEngineCallbacks, voiceId: string, speed: number, volume: number) {
    this.callbacks = callbacks
    this.voiceId = voiceId
    this.speed = speed
    this.volume = volume
  }

  load(sentences: Sentence[], startIndex = 0) {
    this.sentences = sentences
    this.currentIndex = Math.min(Math.max(startIndex, 0), Math.max(sentences.length - 1, 0))
    this.audioCache.clear()
    this.pendingSynthesis.clear()
    this.synthGeneration += 1
  }

  async play() {
    if (this.sentences.length === 0) return
    this.setStatus('buffering')
    await this.ensureSynthesized(this.currentIndex)
    if (this.destroyed) return
    this.playCurrent()
  }

  pause() {
    this.audioEl?.pause()
    this.setStatus('paused')
  }

  async resume() {
    // After a playback error the element (if any) is left in place but its
    // source may be permanently unloadable — retry synthesis via play()
    // rather than re-calling .play() on a dead element, which would just
    // fail identically without ever re-synthesizing.
    if (this.audioEl && this.status !== 'error') {
      await this.audioEl.play()
      this.setStatus('playing')
    } else {
      this.teardownAudio()
      await this.play()
    }
  }

  stop() {
    this.teardownAudio()
    this.currentIndex = 0
    this.setStatus('idle')
    this.callbacks.onSentenceChange(0)
  }

  async skipToSentence(index: number) {
    const clamped = Math.min(Math.max(index, 0), this.sentences.length - 1)
    const wasPlaying = this.status === 'playing' || this.status === 'buffering'
    this.teardownAudio()
    this.currentIndex = clamped
    this.callbacks.onSentenceChange(clamped)
    if (wasPlaying) {
      await this.play()
    } else {
      this.setStatus('paused')
    }
  }

  async skipForwardSentence() {
    await this.skipToSentence(this.currentIndex + 1)
  }

  async skipBackSentence() {
    await this.skipToSentence(this.currentIndex - 1)
  }

  async skipForwardParagraph() {
    const currentParagraph = this.sentences[this.currentIndex]?.paragraphIndex ?? 0
    const nextIndex = this.sentences.findIndex(
      (s, i) => i > this.currentIndex && s.paragraphIndex > currentParagraph,
    )
    await this.skipToSentence(nextIndex === -1 ? this.sentences.length - 1 : nextIndex)
  }

  async skipBackParagraph() {
    const currentParagraph = this.sentences[this.currentIndex]?.paragraphIndex ?? 0
    // Jump to the start of the current paragraph if we're partway through
    // it; jump to the start of the PREVIOUS paragraph if we're already at
    // its first sentence — matches how "previous track" behaves on media
    // players once already a few seconds in.
    const startOfCurrent = this.sentences.findIndex((s) => s.paragraphIndex === currentParagraph)
    if (startOfCurrent < this.currentIndex) {
      await this.skipToSentence(startOfCurrent)
      return
    }
    const targetParagraph = Math.max(currentParagraph - 1, 0)
    const startOfPrev = this.sentences.findIndex((s) => s.paragraphIndex === targetParagraph)
    await this.skipToSentence(startOfPrev === -1 ? 0 : startOfPrev)
  }

  setVoice(voiceId: string) {
    if (this.voiceId === voiceId) return
    this.voiceId = voiceId
    this.invalidateUnplayedCache()
  }

  setSpeed(speed: number) {
    if (this.speed === speed) return
    this.speed = speed
    this.invalidateUnplayedCache()
  }

  setVolume(volume: number) {
    this.volume = volume
    if (this.audioEl) this.audioEl.volume = volume
  }

  get currentSentenceIndex() {
    return this.currentIndex
  }

  destroy() {
    this.destroyed = true
    this.teardownAudio()
  }

  // --- internals ---

  private invalidateUnplayedCache() {
    this.synthGeneration += 1
    for (const key of Array.from(this.audioCache.keys())) {
      if (key > this.currentIndex) this.audioCache.delete(key)
    }
    this.pendingSynthesis.clear()
    // Kick off re-synthesis of the (now-invalidated) lookahead at the new
    // voice/speed so playback doesn't stall waiting on it once the current
    // sentence finishes.
    void this.ensureSynthesized(this.currentIndex + 1)
  }

  private setStatus(status: PlaybackStatus) {
    this.status = status
    this.callbacks.onStatusChange(status)
  }

  private async synthesizeOne(index: number, generation: number): Promise<void> {
    if (this.audioCache.has(index) || this.pendingSynthesis.has(index)) return
    const sentence = this.sentences[index]
    if (!sentence) return

    this.pendingSynthesis.add(index)
    // Chain onto the shared queue rather than firing the Piper call
    // directly — see the field doc on `synthQueue` for why this can't run
    // concurrently with other sentences.
    const run = this.synthQueue.then(async () => {
      if (this.destroyed || generation !== this.synthGeneration) return
      try {
        const buffer = await synthesizeSpeech(sentence.text, this.voiceId, this.speed)
        if (this.destroyed || generation !== this.synthGeneration) return
        this.audioCache.set(index, buffer)
      } catch (err) {
        if (this.destroyed) return
        this.callbacks.onError(
          `Couldn't synthesize speech for a sentence: ${err instanceof Error ? err.message : String(err)}`,
        )
      } finally {
        this.pendingSynthesis.delete(index)
      }
    })
    // Swallow the error here so one failed synthesis doesn't break the
    // chain for everything queued after it — `run`'s own catch already
    // reported it via onError.
    this.synthQueue = run.catch(() => {})
    await run
  }

  private async ensureSynthesized(fromIndex: number): Promise<void> {
    const generation = this.synthGeneration
    const targets = [fromIndex, fromIndex + 1, fromIndex + 2].filter((i) => i >= 0 && i < this.sentences.length)
    // Synthesize the current sentence first and await it (playback can't
    // start without it); kick off the rest of the lookahead in the
    // background so it's ready by the time playback catches up, but they
    // still run one-at-a-time (see synthQueue) rather than in parallel.
    await this.synthesizeOne(fromIndex, generation)
    for (const i of targets.slice(1)) {
      void this.synthesizeOne(i, generation)
    }
  }

  private teardownAudio() {
    if (this.audioEl) {
      this.audioEl.pause()
      this.audioEl.onended = null
      this.audioEl.onerror = null
      this.audioEl.src = ''
      this.audioEl = null
    }
  }

  private playCurrent() {
    const buffer = this.audioCache.get(this.currentIndex)
    if (!buffer) {
      this.setStatus('error')
      this.callbacks.onError('Playback buffer underrun — the next sentence was not ready in time.')
      return
    }

    this.teardownAudio()
    const blob = new Blob([buffer], { type: 'audio/wav' })
    const url = URL.createObjectURL(blob)
    const audio = new Audio(url)
    audio.volume = this.volume
    this.audioEl = audio

    audio.onended = () => {
      URL.revokeObjectURL(url)
      this.advanceAfterSentence()
    }
    audio.onerror = () => {
      URL.revokeObjectURL(url)
      this.setStatus('error')
      // MediaError.code/message names the real cause (e.g. a blocked source
      // under CSP surfaces as MEDIA_ERR_SRC_NOT_SUPPORTED) instead of the
      // generic message this used to report regardless of what went wrong.
      const mediaError = audio.error
      const detail = mediaError
        ? `${mediaErrorCodeName(mediaError.code)}${mediaError.message ? `: ${mediaError.message}` : ''}`
        : 'unknown error'
      this.callbacks.onError(`Audio playback failed for this sentence (${detail}).`)
    }

    this.callbacks.onSentenceChange(this.currentIndex)
    this.setStatus('playing')
    audio.play().catch((err) => {
      // Autoplay rejection (e.g. NotAllowedError) or another play() failure
      // that onerror won't catch, since the element never started loading.
      this.setStatus('error')
      this.callbacks.onError(
        `Couldn't start playback for this sentence: ${err instanceof Error ? err.message : String(err)}`,
      )
    })

    // Top up the lookahead buffer for what comes after what we just queued.
    void this.ensureSynthesized(this.currentIndex + 1)
  }

  private advanceAfterSentence() {
    if (this.currentIndex >= this.sentences.length - 1) {
      this.setStatus('ended')
      return
    }
    this.currentIndex += 1
    void this.ensureSynthesized(this.currentIndex).then(() => {
      if (!this.destroyed && this.status !== 'paused' && this.status !== 'idle') {
        this.playCurrent()
      }
    })
  }
}
