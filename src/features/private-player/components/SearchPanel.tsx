import { useMemo, useState } from 'react'
import { SearchIcon } from '@/shared/icons'
import { TrackRow } from './TrackRow'
import { usePaged } from '../hooks/usePaged'
import type { AudioTrack } from '../lib/types'

interface SearchPanelProps {
  tracks: AudioTrack[]
  currentTrackPath: string | null
  isPlaying: boolean
  onPlayTrack: (index: number) => void
}

/** Its own page, matching the original app's dedicated Search route rather
 * than a search box bolted onto the library list. Same substring/
 * case-insensitive match across title/artist/album, still paginated 20 at
 * a time since a broad query can match most of the library. */
export function SearchPanel({ tracks, currentTrackPath, isPlaying, onPlayTrack }: SearchPanelProps) {
  const [query, setQuery] = useState('')
  const indexByPath = useMemo(() => new Map(tracks.map((t, i) => [t.path, i])), [tracks])

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    return tracks.filter(
      (t) => t.title.toLowerCase().includes(q) || t.artist.toLowerCase().includes(q) || t.album.toLowerCase().includes(q),
    )
  }, [tracks, query])

  const { visible, hasMore, showMore, remaining } = usePaged(results, 20)

  return (
    <div className="flex h-full flex-col">
      <div className="px-6 pt-5 pb-4">
        <h2 className="text-text-primary mb-4 text-[17px] font-semibold tracking-tight">Search</h2>
        <div className="border-hairline flex items-center gap-2 rounded-lg border px-3 py-2">
          <SearchIcon width={16} height={16} className="text-text-tertiary" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search title, artist, album…"
            className="text-text-primary placeholder:text-text-tertiary w-full bg-transparent text-sm outline-none"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        {query.trim() === '' ? (
          <p className="text-text-tertiary px-3 py-6 text-center text-sm">Start typing to search your library.</p>
        ) : results.length === 0 ? (
          <p className="text-text-tertiary px-3 py-6 text-center text-sm">No matches for "{query}"</p>
        ) : (
          <>
            {visible.map((track) => (
              <TrackRow
                key={track.path}
                track={track}
                isActive={track.path === currentTrackPath}
                isPlaying={isPlaying}
                onPlay={() => onPlayTrack(indexByPath.get(track.path) ?? 0)}
              />
            ))}
            {hasMore && (
              <button
                type="button"
                onClick={showMore}
                className="text-text-secondary hover:text-text-primary hover:bg-(--os-hover) mt-1 w-full rounded-lg py-2.5 text-center text-sm font-medium transition-colors"
              >
                Load {Math.min(20, remaining)} more
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}
