import { useCallback, useState } from 'react'
import type { AudioTrack } from '@/integrations/audio-library'
import type { CuePoint, DeckId, DeckState } from '../lib/types'
import { formatTime } from '../hooks/useDjBoard'
import { Knob } from './Knob'
import { Fader } from './Fader'
import { PlayIcon, PauseIcon, EjectIcon, DiscIcon, PlusIcon } from '@/shared/icons'

interface DeckProps {
  id: DeckId
  state: DeckState
  onDropTrack: (track: AudioTrack) => void
  onTogglePlay: () => void
  onSeek: (seconds: number) => void
  onVolume: (v: number) => void
  onEqBand: (band: 'low' | 'mid' | 'high', v: number) => void
  onBass: (v: number) => void
  onTempoPercent: (v: number) => void
  onTapBpm: (bpm: number) => void
  onAddCue: () => void
  onJumpCue: (cue: CuePoint) => void
  onRemoveCue: (cueId: string) => void
}

/** Static/simplified waveform placeholder — real waveform peak analysis is future work. */
function StaticWaveform({ progress, hasTrack }: { progress: number; hasTrack: boolean }) {
  const bars = 64
  return (
    <div className="relative flex h-14 items-center gap-[2px] overflow-hidden rounded-md">
      {Array.from({ length: bars }).map((_, i) => {
        const seed = Math.sin(i * 12.9898) * 43758.5453
        const height = 18 + (Math.abs(seed % 1) * 82)
        const played = hasTrack && i / bars < progress
        return (
          <span
            key={i}
            className="flex-1 rounded-full transition-colors duration-150"
            style={{
              height: `${height}%`,
              backgroundColor: played
                ? 'var(--color-accent-creativity)'
                : 'var(--color-glass-bg-hover)',
            }}
          />
        )
      })}
      {!hasTrack && (
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-text-tertiary text-[10px]">No track loaded</span>
        </div>
      )}
    </div>
  )
}

export function Deck({
  id,
  state,
  onDropTrack,
  onTogglePlay,
  onSeek,
  onVolume,
  onEqBand,
  onBass,
  onTempoPercent,
  onTapBpm,
  onAddCue,
  onJumpCue,
  onRemoveCue,
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
      onDragOver={(e) => {
        e.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      className="glass-surface flex flex-col gap-3 rounded-xl p-4 transition-shadow duration-150"
      style={dragOver ? { boxShadow: `0 0 0 2px ${accent} inset` } : undefined}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span
            className="flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold text-white"
            style={{ background: accent }}
          >
            {id}
          </span>
          <div className="min-w-0">
            <p className="text-text-primary max-w-40 truncate text-[12px] font-medium">
              {state.isLoading ? 'Loading...' : (state.track?.fileName ?? 'Drop a track here')}
            </p>
            <p className="text-text-tertiary text-[10px] tabular-nums">
              {formatTime(state.currentTime)} / {formatTime(state.duration)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="text-right">
            <p className="text-text-primary text-[15px] leading-none font-semibold tabular-nums">
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

      <div
        onClick={(e) => {
          if (!state.duration) return
          const rect = e.currentTarget.getBoundingClientRect()
          const ratio = (e.clientX - rect.left) / rect.width
          onSeek(ratio * state.duration)
        }}
        className="cursor-pointer"
      >
        <StaticWaveform progress={progress} hasTrack={!!state.track} />
      </div>

      {/* Transport */}
      <div className="flex items-center justify-center gap-3">
        <button
          type="button"
          onClick={onTogglePlay}
          disabled={!state.track}
          aria-label={state.isPlaying ? 'Pause' : 'Play'}
          className="flex h-11 w-11 items-center justify-center rounded-full text-white transition-transform duration-150 hover:scale-105 active:scale-95 disabled:opacity-40"
          style={{ background: accent }}
        >
          {state.isPlaying ? <PauseIcon width={18} height={18} /> : <PlayIcon width={18} height={18} />}
        </button>
        <button
          type="button"
          onClick={onAddCue}
          disabled={!state.track}
          aria-label="Add cue point"
          className="text-text-secondary hover:text-text-primary hover:bg-glass-hover flex h-9 w-9 items-center justify-center rounded-full transition-colors duration-150 disabled:opacity-40"
        >
          <PlusIcon width={15} height={15} />
        </button>
        <button
          type="button"
          onClick={() => onDropTrack({ path: '', fileName: '', sizeBytes: 0 })}
          disabled
          aria-label="Eject"
          className="text-text-tertiary flex h-9 w-9 items-center justify-center rounded-full opacity-30"
          title="Eject (drop a new track to replace)"
        >
          <EjectIcon width={15} height={15} />
        </button>
      </div>

      {/* Cue points */}
      {state.cuePoints.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {state.cuePoints.map((cue) => (
            <div key={cue.id} className="group relative">
              <button
                type="button"
                onClick={() => onJumpCue(cue)}
                className="border-glass-border bg-glass hover:bg-glass-hover text-text-secondary rounded-full border px-2 py-0.5 text-[9.5px] tabular-nums transition-colors duration-150"
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

      {/* EQ + bass + tempo + volume */}
      <div className="flex items-center justify-between gap-2 pt-1">
        <div className="flex gap-3">
          <Knob label="High" value={state.eq.high} min={-24} max={24} bipolar onChange={(v) => onEqBand('high', v)} />
          <Knob label="Mid" value={state.eq.mid} min={-24} max={24} bipolar onChange={(v) => onEqBand('mid', v)} />
          <Knob label="Low" value={state.eq.low} min={-24} max={24} bipolar onChange={(v) => onEqBand('low', v)} />
          <Knob label="Bass" value={state.bass} min={-24} max={24} bipolar onChange={onBass} />
        </div>
        <div className="flex items-center gap-3">
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
  )
}
