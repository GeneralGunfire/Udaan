import { useCallback, useState } from 'react'
import type { AudioTrack } from '@/integrations/audio-library'
import type { CuePoint, DeckId, DeckState } from '../lib/types'
import { formatTime } from '../hooks/useDjBoard'
import { Knob } from './Knob'
import { Fader } from './Fader'
import { PeakMeter } from './PeakMeter'
import { HotCues } from './HotCues'
import { LoopControls } from './LoopControls'
import { PlayIcon, PauseIcon, DiscIcon, PlusIcon, SyncIcon } from '@/shared/icons'

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
  const accent = id === 'A' ? 'var(--color-brand-cyan)' : 'var(--color-accent-creativity)'

  return (
    <div
      data-deck={id}
      onDragOver={(e) => {
        e.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      className="glass-surface flex flex-col gap-2.5 rounded-xl p-3 transition-shadow duration-150"
      style={{
        boxShadow: dragOver ? `0 0 0 2px ${accent} inset` : `0 0 0 1px color-mix(in srgb, ${accent} 25%, transparent) inset`,
      }}
    >
      {/* Header: identity + track + BPM */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[12px] font-bold text-white"
            style={{ background: accent }}
          >
            {id}
          </span>
          <div className="min-w-0">
            <p className="text-text-primary max-w-44 truncate text-[12.5px] font-medium">
              {state.isLoading ? 'Loading...' : (state.track?.fileName ?? 'Drop a track here')}
            </p>
            <p className="text-text-tertiary text-[10px] tabular-nums">
              {formatTime(state.currentTime)} / {formatTime(state.duration)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onSync}
            disabled={!state.bpm}
            title="Sync tempo to the other deck's BPM"
            className="text-text-tertiary hover:text-text-primary hover:bg-glass-hover flex h-7 w-7 items-center justify-center rounded-full transition-colors duration-100 disabled:opacity-30"
          >
            <SyncIcon width={13} height={13} />
          </button>
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
          <button
            type="button"
            onClick={onTogglePlay}
            disabled={!state.track}
            aria-label={state.isPlaying ? 'Pause' : 'Play'}
            className="flex h-14 w-14 items-center justify-center rounded-full text-white transition-transform duration-100 hover:scale-105 active:scale-95 disabled:opacity-40"
            style={{ background: accent }}
          >
            {state.isPlaying ? <PauseIcon width={22} height={22} /> : <PlayIcon width={22} height={22} />}
          </button>
          <button
            type="button"
            onClick={onAddCue}
            disabled={!state.track}
            aria-label="Add freeform cue point"
            title="Add freeform cue point at current position"
            className="text-text-secondary hover:text-text-primary hover:bg-glass-hover flex h-11 w-11 items-center justify-center rounded-full transition-colors duration-100 disabled:opacity-40"
          >
            <PlusIcon width={18} height={18} />
          </button>
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
