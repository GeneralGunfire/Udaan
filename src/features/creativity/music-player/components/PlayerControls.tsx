import type { AudioTrack } from '@/integrations/audio-library'
import type { RepeatMode } from '../hooks/useAudioPlayer'
import { PlayIcon, PauseIcon, DiscIcon } from '@/shared/icons'

interface PlayerControlsProps {
  track: AudioTrack | null
  isPlaying: boolean
  isLoading: boolean
  currentTime: number
  duration: number
  volume: number
  shuffle: boolean
  repeat: RepeatMode
  onTogglePlay: () => void
  onNext: () => void
  onPrev: () => void
  onSeek: (seconds: number) => void
  onVolume: (v: number) => void
  onToggleShuffle: () => void
  onCycleRepeat: () => void
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

export function PlayerControls({
  track,
  isPlaying,
  isLoading,
  currentTime,
  duration,
  volume,
  shuffle,
  repeat,
  onTogglePlay,
  onNext,
  onPrev,
  onSeek,
  onVolume,
  onToggleShuffle,
  onCycleRepeat,
}: PlayerControlsProps) {
  return (
    <div className="glass-surface flex flex-col gap-3 rounded-xl p-4">
      <div className="flex items-center gap-3">
        <div
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-white"
          style={{ background: 'var(--gradient-brand)' }}
        >
          <DiscIcon width={20} height={20} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-text-primary truncate text-[12.5px] font-medium">
            {isLoading ? 'Loading...' : (track?.fileName ?? 'No track selected')}
          </p>
          <p className="text-text-tertiary text-[10px] tabular-nums">
            {formatTime(currentTime)} / {formatTime(duration)}
          </p>
        </div>
      </div>

      <input
        type="range"
        aria-label="Seek"
        min={0}
        max={duration || 0}
        step={0.1}
        value={Math.min(currentTime, duration || 0)}
        onChange={(e) => onSeek(Number(e.target.value))}
        disabled={!track}
        className="dj-fader-horizontal w-full disabled:opacity-40"
      />

      <div className="flex items-center justify-center gap-4">
        <button
          type="button"
          onClick={onToggleShuffle}
          aria-pressed={shuffle}
          title="Shuffle"
          className={`text-[11px] font-semibold transition-colors duration-150 ${
            shuffle ? 'text-accent-creativity' : 'text-text-tertiary hover:text-text-secondary'
          }`}
        >
          SHUF
        </button>
        <button
          type="button"
          onClick={onPrev}
          disabled={!track}
          aria-label="Previous track"
          className="text-text-secondary hover:text-text-primary disabled:opacity-40"
        >
          <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor">
            <path d="M6 4v12h2V4H6zm10 0L8 10l8 6V4z" />
          </svg>
        </button>
        <button
          type="button"
          onClick={onTogglePlay}
          disabled={!track && isLoading === false}
          aria-label={isPlaying ? 'Pause' : 'Play'}
          className="flex h-11 w-11 items-center justify-center rounded-full text-white transition-transform duration-150 hover:scale-105 active:scale-95"
          style={{ background: 'var(--gradient-brand)' }}
        >
          {isPlaying ? <PauseIcon width={18} height={18} /> : <PlayIcon width={18} height={18} />}
        </button>
        <button
          type="button"
          onClick={onNext}
          disabled={!track}
          aria-label="Next track"
          className="text-text-secondary hover:text-text-primary disabled:opacity-40"
        >
          <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor">
            <path d="M14 4v12h-2V4h2zM4 4l8 6-8 6V4z" />
          </svg>
        </button>
        <button
          type="button"
          onClick={onCycleRepeat}
          title="Repeat"
          className={`text-[11px] font-semibold transition-colors duration-150 ${
            repeat !== 'off' ? 'text-accent-creativity' : 'text-text-tertiary hover:text-text-secondary'
          }`}
        >
          {repeat === 'one' ? 'REP 1' : 'REP'}
        </button>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-text-tertiary text-[9.5px] font-medium tracking-wide uppercase">Vol</span>
        <input
          type="range"
          aria-label="Volume"
          min={0}
          max={1}
          step={0.01}
          value={volume}
          onChange={(e) => onVolume(Number(e.target.value))}
          className="dj-fader-horizontal w-full"
        />
      </div>
    </div>
  )
}
