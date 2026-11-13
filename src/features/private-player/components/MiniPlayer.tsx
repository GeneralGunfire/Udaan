import { PlayIcon, PauseIcon, SkipBackIcon, SkipForwardIcon, QueueIcon } from '@/shared/icons'
import { Scrubber } from './Scrubber'
import { VolumeControl } from './VolumeControl'
import { SoundBars } from './SoundBars'
import type { AudioTrack } from '../lib/types'

interface MiniPlayerProps {
  track: AudioTrack | null
  isPlaying: boolean
  currentTime: number
  duration: number
  volume: number
  analyser: AnalyserNode | null
  onTogglePlay: () => void
  onNext: () => void
  onPrev: () => void
  onSeek: (percent: number) => void
  onSetVolume: (v: number) => void
  onOpenNowPlaying: () => void
  onToggleQueue: () => void
}

/** Persistent docked bar, same role as the original's MiniPlayer — click
 * the track info to expand into the full now-playing view. */
export function MiniPlayer({
  track,
  isPlaying,
  currentTime,
  duration,
  volume,
  analyser,
  onTogglePlay,
  onNext,
  onPrev,
  onSeek,
  onSetVolume,
  onOpenNowPlaying,
  onToggleQueue,
}: MiniPlayerProps) {
  return (
    <div className="border-hairline flex items-center gap-4 border-t px-5 py-3" style={{ backgroundColor: 'var(--surface-base)' }}>
      <button
        type="button"
        onClick={onOpenNowPlaying}
        disabled={!track}
        title={track ? 'Open Now Playing' : undefined}
        className="hover:bg-surface-hover -mx-2 flex min-w-0 flex-1 items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors duration-150 disabled:cursor-default disabled:hover:bg-transparent"
      >
        <div className="min-w-0">
          <p className="text-text-primary truncate text-[13px] font-medium">{track?.title ?? 'Nothing playing'}</p>
          <p className="text-text-tertiary truncate text-[13px]">{track?.artist ?? 'Pick a track from the library'}</p>
        </div>
      </button>

      <div className="flex max-w-md flex-1 flex-col items-center gap-1.5">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onPrev}
            disabled={!track}
            aria-label="Previous track"
            className="text-text-secondary hover:text-text-primary hover:bg-surface-hover flex h-8 w-8 items-center justify-center rounded-full transition-colors disabled:opacity-30"
          >
            <SkipBackIcon width={17} height={17} />
          </button>
          <button
            type="button"
            onClick={onTogglePlay}
            disabled={!track}
            aria-label={isPlaying ? 'Pause' : 'Play'}
            className="bg-accent text-accent-contrast mx-1 flex h-9 w-9 items-center justify-center rounded-full shadow-[inset_0_1px_0_rgb(255_255_255/22%),var(--shadow-raised)] transition-transform active:scale-95 disabled:opacity-40"
          >
            {isPlaying ? <PauseIcon width={16} height={16} /> : <PlayIcon width={16} height={16} />}
          </button>
          <button
            type="button"
            onClick={onNext}
            disabled={!track}
            aria-label="Next track"
            className="text-text-secondary hover:text-text-primary hover:bg-surface-hover flex h-8 w-8 items-center justify-center rounded-full transition-colors disabled:opacity-30"
          >
            <SkipForwardIcon width={17} height={17} />
          </button>
        </div>
        <div className="w-full">
          <Scrubber currentTime={currentTime} duration={duration} onSeek={onSeek} />
        </div>
      </div>

      <div className="flex flex-1 items-center justify-end gap-3">
        <SoundBars analyser={analyser} isPlaying={isPlaying} barCount={14} className="hidden h-7 w-20 shrink-0 lg:block" />
        <VolumeControl volume={volume} onChange={onSetVolume} />
        <button
          type="button"
          onClick={onToggleQueue}
          aria-label="Queue"
          className="text-text-secondary hover:text-text-primary hover:bg-surface-hover flex h-8 w-8 items-center justify-center rounded-full transition-colors"
        >
          <QueueIcon width={17} height={17} />
        </button>
      </div>
    </div>
  )
}
