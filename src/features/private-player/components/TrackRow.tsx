import { PlayIcon, PauseIcon, HeartIcon, HeartFilledIcon } from '@/shared/icons'
import { SoundBars } from './SoundBars'
import { usePlayer } from '../lib/PlayerContext'
import { formatDuration, type AudioTrack } from '../lib/types'

interface TrackRowProps {
  track: AudioTrack
  isActive: boolean
  isPlaying: boolean
  onPlay: () => void
}

/** No cover art — matches the Private Player website's list rows, which
 * dropped cover thumbnails from every track row, not just the expanded
 * view. A small play-state indicator (a static play/pause glyph at rest,
 * live bars while this track is genuinely playing) replaces the old
 * cover-art hover overlay as the "this row is playing" cue. */
export function TrackRow({ track, isActive, isPlaying, onPlay }: TrackRowProps) {
  const player = usePlayer()
  const isFavorite = player.favorites.has(track.path)

  return (
    <div
      className={`group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-[var(--os-menu-item-hover)] ${
        isActive ? 'bg-[var(--os-menu-item-hover)]' : ''
      }`}
    >
      <button type="button" onClick={onPlay} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        <div className="flex h-5 w-5 shrink-0 items-center justify-center">
          {isActive && isPlaying ? (
            <SoundBars analyser={player.analyser} isPlaying barCount={3} className="h-3.5 w-3.5" />
          ) : isActive ? (
            <PauseIcon width={15} height={15} className="text-accent" />
          ) : (
            <PlayIcon
              width={15}
              height={15}
              className="text-text-tertiary opacity-0 transition-opacity group-hover:opacity-100"
            />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className={`truncate text-[13px] font-medium ${isActive ? 'text-accent' : 'text-text-primary'}`}>{track.title}</p>
          <p className="text-text-tertiary truncate text-[12px]">{track.artist}</p>
        </div>
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          player.toggleFavorite(track.path)
        }}
        className={`shrink-0 transition-opacity ${isFavorite ? 'text-accent opacity-100' : 'text-text-tertiary opacity-0 group-hover:opacity-100'}`}
      >
        {isFavorite ? <HeartFilledIcon width={14} height={14} /> : <HeartIcon width={14} height={14} />}
      </button>
      <span className="text-text-tertiary shrink-0 text-[13px] tabular-nums">{formatDuration(track.durationSeconds)}</span>
    </div>
  )
}
