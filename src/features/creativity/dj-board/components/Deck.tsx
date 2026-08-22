import { useCallback, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import type { AudioTrack } from '@/integrations/audio-library'
import type { CuePoint, DeckId, DeckState } from '../lib/types'
import { formatTime } from '../hooks/useDjBoard'
import { Knob } from './Knob'
import { Fader } from './Fader'
import { PeakMeter } from './PeakMeter'
import { HotCues } from './HotCues'
import { LoopControls } from './LoopControls'
import { PlayIcon, PauseIcon, DiscIcon, PlusIcon, SyncIcon, MuffleIcon, BassKillIcon, EchoOutIcon } from '@/shared/icons'

interface DeckProps {
  id: DeckId
  state: DeckState
  peakLevel: number
  onDropTrack: (track: AudioTrack) => void
  onTogglePlay: () => void
  onSeek: (seconds: number) => void
  onVolume: (v: number) => void
  onEqBand: (band: 'low' | 'mid' | 'high', v: number) => void
  onBass: (v: number) => void
  onFilter: (v: number) => void
  onTempoPercent: (v: number) => void
  onTapBpm: (bpm: number) => void
  onSync: () => void
  onAddCue: () => void
  onJumpCue: (cue: CuePoint) => void
  onRemoveCue: (cueId: string) => void
  onSetHotCue: (slot: number) => void
  onTriggerHotCue: (slot: number) => void
  onClearHotCue: (slot: number) => void
  onSetLoopBeats: (beats: 4 | 8 | 16) => void
  onToggleLoop: () => void
  onToggleMuffle: () => void
  onToggleBassKill: () => void
  onTriggerEchoOut: () => void
}

/** Static/simplified waveform placeholder — real waveform peak analysis is future work. */
function StaticWaveform({ progress, hasTrack, accent }: { progress: number; hasTrack: boolean; accent: string }) {
  const bars = 90
  return (
    <div className="relative flex h-24 items-center gap-[2px] overflow-hidden rounded-lg">
      {Array.from({ length: bars }).map((_, i) => {
        const seed = Math.sin(i * 12.9898) * 43758.5453
        const height = 14 + Math.abs(seed % 1) * 86
        const played = hasTrack && i / bars < progress
        return (
          <span
            key={i}
            className="flex-1 rounded-full transition-colors duration-150"
            style={{
              height: `${height}%`,
              backgroundColor: played ? accent : 'var(--color-glass-bg-hover)',
            }}
          />
        )
      })}
      {!hasTrack && (
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-text-tertiary text-[11px]">No track loaded — drop one here</span>
        </div>
      )}
    </div>
  )
}

/**
 * Deck — redesigned layout hierarchy (see NOTES.md for the full before/
 * after): waveform is the dominant visual anchor at the top; transport
 * (play, freeform cue, hot cues, loop) forms one clearly-bordered cluster
 * directly under it; the EQ/bass/filter/tempo/volume mixer cluster is a
 * visually separate, smaller, subordinate panel below that, marked with
 * its own header and a divider — not one flat row mixing three different
 * control types together like the old layout did.
 */
export function Deck({
  id,
  state,
  peakLevel,
  onDropTrack,
  onTogglePlay,
  onSeek,
  onVolume,
  onEqBand,
  onBass,
  onFilter,
  onTempoPercent,
  onTapBpm,
  onSync,
  onAddCue,
  onJumpCue,
  onRemoveCue,
  onSetHotCue,
  onTriggerHotCue,
  onClearHotCue,
  onSetLoopBeats,
  onToggleLoop,
  onToggleMuffle,
  onToggleBassKill,
  onTriggerEchoOut,
}: DeckProps) {
  const [dragOver, setDragOver] = useState(false)
  const [tapTimes, setTapTimes] = useState<number[]>([])

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault()
      setDragOver(false)
      const path = e.dataTransfer.getData('application/x-dj-track')
      if (path) onDropTrack({ path, fileName: path.split(/[\\/]/).pop() ?? path, sizeBytes: 0 })
    },
    [onDropTrack],
  )

  const handleTapTempo = useCallback(() => {
    const now = performance.now()
    const recent = [...tapTimes, now].filter((t) => now - t < 4000).slice(-4)
    setTapTimes(recent)
    if (recent.length >= 2) {
      const intervals = recent.slice(1).map((t, i) => t - recent[i])
      const avgMs = intervals.reduce((a, b) => a + b, 0) / intervals.length
      const bpm = Math.round(60000 / avgMs)
      if (Number.isFinite(bpm) && bpm > 0) onTapBpm(bpm)
    }
  }, [tapTimes, onTapBpm])

  const progress = state.duration > 0 ? state.currentTime / state.duration : 0
  // Deck-local accent — deliberately not the shared Creativity-category purple
  // token (that's app-wide sidebar/editor branding); Deck B gets its own
  // color so the two decks read as a classic blue-vs-green two-deck pair.
  const accent = id === 'A' ? 'var(--color-brand-cyan)' : '#4ade80'

  return (
    <div
      data-deck={id}
      onDragOver={(e) => {
        e.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      className="glass-surface flex flex-col gap-2.5 rounded-xl p-3"
      style={{
        boxShadow: dragOver
          ? `0 0 0 2px ${accent} inset, var(--shadow-panel)`
          : `0 0 0 1px color-mix(in srgb, ${accent} 25%, transparent) inset`,
        transition: 'box-shadow 200ms var(--ease-standard)',
      }}
    >
      {/* Header: identity + track + BPM */}
      <div className="flex min-w-0 items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[12px] font-bold text-white"
            style={{ background: accent }}
          >
            {id}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-text-primary truncate text-[12.5px] font-medium">
              {state.isLoading ? 'Loading...' : (state.track?.fileName ?? 'Drop a track here')}
            </p>
            <p className="text-text-tertiary text-[10px] tabular-nums">
              {formatTime(state.currentTime)} / {formatTime(state.duration)}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <motion.button
            type="button"
            onClick={onSync}
            disabled={!state.bpm}
            title="Sync tempo to the other deck's BPM"
            whileHover={state.bpm ? { scale: 1.1, rotate: 15 } : undefined}
            whileTap={state.bpm ? { scale: 0.9 } : undefined}
            transition={{ type: 'spring', stiffness: 500, damping: 28 }}
            className="text-text-tertiary hover:text-text-primary hover:bg-glass-hover flex h-7 w-7 items-center justify-center rounded-full transition-colors duration-150 disabled:opacity-30"
          >
            <SyncIcon width={13} height={13} />
          </motion.button>
          <div className="text-right">
            <p className="text-text-primary text-[16px] leading-none font-semibold tabular-nums">
              {state.bpm ?? '--'}
            </p>
            <button
              type="button"
              onClick={handleTapTempo}
              className="text-text-tertiary hover:text-text-secondary text-[9px] font-medium tracking-wide uppercase"
            >
              Tap BPM
            </button>
          </div>
        </div>
      </div>

      {/* 1. Waveform — dominant visual element */}
      <div className="flex items-stretch gap-1.5">
        <PeakMeter level={peakLevel} accent={accent} />
        <div
          onClick={(e) => {
            if (!state.duration) return
            const rect = e.currentTarget.getBoundingClientRect()
            const ratio = (e.clientX - rect.left) / rect.width
            onSeek(ratio * state.duration)
          }}
          className="min-w-0 flex-1 cursor-pointer"
        >
          <StaticWaveform progress={progress} hasTrack={!!state.track} accent={accent} />
        </div>
      </div>

      {/* 2. Transport cluster — play, freeform cue, hot cues, loop. Bordered, clearly grouped. */}
      <div className="border-glass-border flex flex-col gap-2 rounded-lg border p-2.5" style={{ borderColor: `color-mix(in srgb, ${accent} 30%, var(--color-glass-border))` }}>
        <div className="flex items-center justify-center gap-4">
          <motion.button
            type="button"
            onClick={onTogglePlay}
            disabled={!state.track}
            aria-label={state.isPlaying ? 'Pause' : 'Play'}
            whileHover={state.track ? { scale: 1.08 } : undefined}
            whileTap={state.track ? { scale: 0.92 } : undefined}
            animate={state.isPlaying ? { boxShadow: `0 0 0 6px color-mix(in srgb, ${accent} 18%, transparent)` } : { boxShadow: '0 0 0 0px transparent' }}
            transition={{ type: 'spring', stiffness: 450, damping: 26 }}
            className="flex h-14 w-14 items-center justify-center rounded-full text-white disabled:opacity-40"
            style={{ background: accent }}
          >
            <AnimatePresence mode="wait" initial={false}>
              <motion.span
                key={state.isPlaying ? 'pause' : 'play'}
                initial={{ opacity: 0, scale: 0.6 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.6 }}
                transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                className="flex"
              >
                {state.isPlaying ? <PauseIcon width={22} height={22} /> : <PlayIcon width={22} height={22} />}
              </motion.span>
            </AnimatePresence>
          </motion.button>
          <motion.button
            type="button"
            onClick={onAddCue}
            disabled={!state.track}
            aria-label="Add freeform cue point"
            title="Add freeform cue point at current position"
            whileHover={state.track ? { scale: 1.1 } : undefined}
            whileTap={state.track ? { scale: 0.9, rotate: 90 } : undefined}
            transition={{ type: 'spring', stiffness: 500, damping: 26 }}
            className="text-text-secondary hover:text-text-primary hover:bg-glass-hover flex h-11 w-11 items-center justify-center rounded-full transition-colors duration-150 disabled:opacity-40"
          >
            <PlusIcon width={18} height={18} />
          </motion.button>
        </div>

        {state.cuePoints.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {state.cuePoints.map((cue) => (
              <div key={cue.id} className="group relative">
                <button
                  type="button"
                  onClick={() => onJumpCue(cue)}
                  className="border-glass-border bg-glass hover:bg-glass-hover text-text-secondary rounded-full border px-2 py-0.5 text-[9.5px] tabular-nums transition-colors duration-100"
                >
                  <DiscIcon width={8} height={8} className="mr-1 inline" />
                  {cue.label}
                </button>
                <button
                  type="button"
                  onClick={() => onRemoveCue(cue.id)}
                  aria-label="Remove cue"
                  className="text-text-tertiary hover:text-danger absolute -top-1.5 -right-1.5 hidden h-3.5 w-3.5 items-center justify-center rounded-full bg-black/40 text-[8px] group-hover:flex"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        <HotCues
          hotCues={state.hotCues}
          accent={accent}
          onTrigger={onTriggerHotCue}
          onSet={onSetHotCue}
          onClear={onClearHotCue}
        />

        <LoopControls loop={state.loop} accent={accent} onSetBeats={onSetLoopBeats} onToggle={onToggleLoop} />
      </div>

      {/* Deck effects — real click-to-toggle Muffle/Bass Kill, real one-shot Echo Out. Distinct from the hold-to-apply rack below. */}
      <div className="flex items-center gap-1.5">
        <motion.button
          type="button"
          onClick={onToggleMuffle}
          disabled={!state.track}
          aria-pressed={state.muffled}
          title="Muffle — click to toggle a real lowpass over the track"
          whileHover={state.track ? { scale: 1.04 } : undefined}
          whileTap={state.track ? { scale: 0.96 } : undefined}
          animate={{ background: state.muffled ? accent : 'var(--color-glass-bg-hover)' }}
          transition={{ type: 'spring', stiffness: 450, damping: 30 }}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 text-[10px] font-semibold disabled:opacity-40"
          style={{ color: state.muffled ? '#fff' : 'var(--color-text-secondary)' }}
        >
          <MuffleIcon width={12} height={12} />
          Muffle
        </motion.button>
        <motion.button
          type="button"
          onClick={onToggleBassKill}
          disabled={!state.track}
          aria-pressed={state.bassKilled}
          title="Bass Kill — click to instantly mute the low band"
          whileHover={state.track ? { scale: 1.04 } : undefined}
          whileTap={state.track ? { scale: 0.96 } : undefined}
          animate={{ background: state.bassKilled ? 'var(--color-danger)' : 'var(--color-glass-bg-hover)' }}
          transition={{ type: 'spring', stiffness: 450, damping: 30 }}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 text-[10px] font-semibold disabled:opacity-40"
          style={{ color: state.bassKilled ? '#fff' : 'var(--color-text-secondary)' }}
        >
          <BassKillIcon width={12} height={12} />
          Bass Kill
        </motion.button>
        <motion.button
          type="button"
          onClick={onTriggerEchoOut}
          disabled={!state.track}
          title="Echo Out — one-shot fading repeat"
          whileHover={state.track ? { scale: 1.04 } : undefined}
          whileTap={state.track ? { scale: 0.9 } : undefined}
          transition={{ type: 'spring', stiffness: 500, damping: 26 }}
          className="bg-glass-bg-hover text-text-secondary flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 text-[10px] font-semibold disabled:opacity-40"
        >
          <EchoOutIcon width={12} height={12} />
          Echo Out
        </motion.button>
      </div>

      {/* 3. Mixer cluster — EQ / bass / filter / tempo / volume. Smaller, subordinate, own header + divider. */}
      <div className="border-glass-border rounded-lg border p-2.5">
        <p className="text-text-tertiary mb-2 text-[9px] font-medium tracking-wide uppercase">Mixer</p>
        <div className="flex items-center justify-between gap-2">
          <div className="flex gap-2.5">
            <Knob label="High" value={state.eq.high} min={-24} max={24} bipolar size={32} onChange={(v) => onEqBand('high', v)} />
            <Knob label="Mid" value={state.eq.mid} min={-24} max={24} bipolar size={32} onChange={(v) => onEqBand('mid', v)} />
            <Knob label="Low" value={state.eq.low} min={-24} max={24} bipolar size={32} onChange={(v) => onEqBand('low', v)} />
            <Knob label="Bass" value={state.bass} min={-24} max={24} bipolar size={32} onChange={onBass} />
            <Knob label="Filter" value={state.filter} min={-1} max={1} bipolar size={32} onChange={onFilter} />
          </div>
          <div className="flex items-center gap-2.5">
            <div className="flex flex-col items-center gap-1">
              <Fader
                label="Tempo"
                value={state.tempoPercent}
                min={-8}
                max={8}
                step={0.1}
                onChange={onTempoPercent}
                orientation="horizontal"
              />
              <span className="text-text-tertiary text-[9px] tabular-nums">
                {state.tempoPercent > 0 ? '+' : ''}
                {state.tempoPercent.toFixed(1)}%
              </span>
            </div>
            <Fader label="Vol" value={state.volume} min={0} max={1} onChange={onVolume} />
          </div>
        </div>
      </div>
    </div>
  )
}
