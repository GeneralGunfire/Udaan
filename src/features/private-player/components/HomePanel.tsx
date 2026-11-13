import { useMemo, useState } from 'react'
import { PlayIcon, HeartIcon } from '@/shared/icons'
import { TrackRow } from './TrackRow'
import { usePlayer } from '../lib/PlayerContext'
import type { AudioTrack } from '../lib/types'

interface HomePanelProps {
  tracks: AudioTrack[]
  currentTrackPath: string | null
  isPlaying: boolean
  onPlayTrack: (index: number) => void
  onPlayQueue: (tracks: AudioTrack[], startIndex: number) => void
}

type HomeFilter = 'all' | 'favorites' | 'recent'

const FILTERS: { value: HomeFilter; label: string }[] = [
  { value: 'all', label: 'All songs' },
  { value: 'favorites', label: 'Favorites' },
  { value: 'recent', label: 'Recently added' },
]

/**
 * Home feed — matches the Private Player website's own Home: a plain
 * "Your music" title (no time-of-day greeting; that plus the filter
 * pills and card-heavy featured block were called out directly as
 * making this feel like a generic app template) and underlined tab
 * filters instead of three same-weight pill buttons.
 */
export function HomePanel({ tracks, currentTrackPath, isPlaying, onPlayTrack, onPlayQueue }: HomePanelProps) {
  const player = usePlayer()
  const [filter, setFilter] = useState<HomeFilter>('all')
  const indexByPath = useMemo(() => new Map(tracks.map((t, i) => [t.path, i])), [tracks])
  const favoriteTracks = useMemo(() => tracks.filter((t) => player.favorites.has(t.path)), [tracks, player.favorites])
  const recentTracks = useMemo(() => [...tracks].slice(-30).reverse(), [tracks])

  const visibleTracks = filter === 'favorites' ? favoriteTracks : filter === 'recent' ? recentTracks : tracks

  return (
    <div className="flex h-full flex-col overflow-y-auto px-6 py-6">
      <div className="mb-6 flex items-baseline justify-between">
        <h1 className="text-text-primary text-[17px] font-semibold tracking-tight">Your music</h1>
        <p className="text-text-tertiary text-xs">{tracks.length} songs</p>
      </div>

      <div className="mb-5 flex items-center gap-5 border-b border-hairline">
        {FILTERS.map((f) => {
          const active = filter === f.value
          return (
            <button
              key={f.value}
              type="button"
              onClick={() => setFilter(f.value)}
              aria-pressed={active}
              className={`-mb-px border-b-2 pb-2.5 text-[11px] font-semibold tracking-[0.08em] uppercase transition-colors ${
                active
                  ? 'text-text-primary border-accent'
                  : 'text-text-tertiary hover:text-text-secondary border-transparent'
              }`}
            >
              {f.label}
            </button>
          )
        })}
        {favoriteTracks.length > 0 && filter === 'all' && (
          <button
            type="button"
            onClick={() => onPlayQueue(favoriteTracks, 0)}
            className="text-text-tertiary hover:text-text-primary ml-auto -mb-px flex items-center gap-1.5 pb-2.5 text-[13px] transition-colors"
          >
            <PlayIcon width={12} height={12} />
            Play favorites
          </button>
        )}
      </div>

      {visibleTracks.length > 0 ? (
        <div className="flex flex-col">
          {visibleTracks.map((track) => (
            <TrackRow
              key={track.path}
              track={track}
              isActive={track.path === currentTrackPath}
              isPlaying={isPlaying}
              onPlay={() => onPlayTrack(indexByPath.get(track.path) ?? 0)}
            />
          ))}
        </div>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
          <HeartIcon width={32} height={32} className="text-text-tertiary" />
          <p className="text-text-secondary text-sm">No favorites yet</p>
          <p className="text-text-tertiary max-w-xs text-xs">
            Tap the heart on any track in Library or Search to pin it here for quick play.
          </p>
        </div>
      )}
    </div>
  )
}
