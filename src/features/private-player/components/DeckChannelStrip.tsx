import { PlayIcon, PauseIcon } from '@/shared/icons'
import { Waveform } from './Waveform'
import { LevelMeter } from './LevelMeter'
import { EffectRack } from './EffectRack'
import { formatDuration } from '../lib/types'
import type { ParamSpec, ParamValues } from '../lib/dsp'
import type { AudioTrack } from '../lib/types'

/** The minimal surface both Deck A (the app-wide shared PlayerEngine) and
 * Deck B (useDeckB, an independent second engine) satisfy — lets this one
 * channel strip drive either deck without knowing which. */
export interface DeckLike {
  track: AudioTrack | null
  isPlaying: boolean
  currentTime: number
  duration: number
  analyser: AnalyserNode | null
  djEffects: ParamValues
  setDjEffects: (patch: ParamValues) => void
  togglePlay: () => void
  seek: (fractionalPercent: number) => void
}

interface DeckChannelStripProps {
  deck: DeckLike
  /** Every parameter this deck's chain exposes — the rack renders itself
   * from this rather than from hardcoded knob markup. */
  specs: ParamSpec[]
  /** "A" tints blue, "B" cyan — the same two colours the crossfader uses,
   * so which deck is which reads consistently across the panel. */
  side: 'A' | 'B'
  /** Chrome specific to one deck (Deck A's hot cues and transport, Deck
   * B's track picker), rendered under the transport. */
  extra?: React.ReactNode
  spinning?: boolean
  /** Tempo, once analysis has run. Shown beside the track title because a
   * BPM you cannot see while mixing is a BPM you do not have. */
  bpm?: number | null
  /** Camelot key notation (e.g. "8A"), once analysed. */
  musicalKey?: string | null
}

/**
 * One full DJ channel strip.
 *
 * Restructured from a single flat row of [EQ box] [platter] [FX box] into
 * a clear vertical hierarchy: identity and transport on top, then the
 * rack beneath. The old layout gave a 10-knob wall equal visual weight to
 * the track you are actually mixing, which is what made the board feel
 * cluttered and directionless — the thing you look at most often was the
 * same size as the thing you touch least.
 */
export function DeckChannelStrip({
  deck,
  specs,
  side,
  extra,
  spinning = true,
  bpm = null,
  musicalKey = null,
}: DeckChannelStripProps) {
  const { track } = deck
  const accentVar = side === 'A' ? 'var(--color-brand-blue)' : 'var(--color-brand-cyan)'
  const loaded = Boolean(track)

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-3">
      {/* Identity: which deck, what is on it, and its mix-critical facts. */}
      <div className="flex items-center gap-3">
        <div className="relative shrink-0">
          <div
            className={`border-hairline relative flex h-16 w-16 items-center justify-center rounded-full border-4 ${
              spinning && deck.isPlaying ? 'animate-spin-slow' : ''
            }`}
            style={{ backgroundColor: 'var(--surface-canvas)', animationDuration: '3s' }}
          >
            <div className="absolute inset-1.5 rounded-full border border-white/5" />
            <div
              className="absolute h-1.5 w-1.5 rounded-full bg-black"
              style={{ boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.15)' }}
            />
          </div>
          <span
            className="absolute -top-0.5 -left-0.5 flex h-4 w-4 items-center justify-center rounded-full text-3xs font-bold text-white"
            style={{ backgroundColor: accentVar }}
          >
            {side}
          </span>
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-text-primary truncate text-sm font-medium" title={track?.title}>
            {track?.title ?? 'No track loaded'}
          </p>
          <p className="text-text-tertiary truncate text-2xs" title={track?.artist}>
            {track?.artist ?? '—'}
          </p>
          <div className="mt-1 flex items-center gap-1.5">
            {bpm !== null && <Tag>{Math.round(bpm)} BPM</Tag>}
            {musicalKey && <Tag>{musicalKey}</Tag>}
            {loaded && (
              <span className="text-text-tertiary text-2xs-alt tabular-nums">
                {formatDuration(deck.currentTime)} / {formatDuration(deck.duration)}
              </span>
            )}
          </div>
        </div>

        <button
          type="button"
          onClick={deck.togglePlay}
          disabled={!loaded}
          aria-label={deck.isPlaying ? `Pause deck ${side}` : `Play deck ${side}`}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white transition-opacity hover:opacity-90 disabled:opacity-30"
          style={{ backgroundColor: accentVar }}
        >
          {deck.isPlaying ? <PauseIcon width={17} height={17} /> : <PlayIcon width={17} height={17} />}
        </button>
      </div>

      {/* Waveform: full width, because scrubbing and reading the upcoming
          shape of a track is a primary action, not a detail. */}
      <div className="flex items-center gap-2">
        <div className="h-10 min-w-0 flex-1">
          <Waveform
            currentTime={deck.currentTime}
            duration={deck.duration}
            onSeek={deck.seek}
            seed={track?.path ?? 'none'}
          />
        </div>
        <LevelMeter analyser={deck.analyser} isPlaying={deck.isPlaying} />
      </div>

      {extra}

      <div
        className="border-hairline rounded-2xl border p-3"
        style={{ backgroundColor: 'var(--surface-raised)' }}
      >
        <EffectRack specs={specs} values={deck.djEffects} onChange={deck.setDjEffects} />
      </div>
    </div>
  )
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="bg-white/8 text-text-secondary rounded px-1.5 py-0.5 text-2xs-alt font-medium tabular-nums">
      {children}
    </span>
  )
}
