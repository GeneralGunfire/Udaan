import { useMemo, useState } from 'react'
import { PlusIcon, SearchIcon, WindowCloseIcon } from '@/shared/icons'
import { useLibrary } from '../lib/PlayerContext'
import type { AudioTrack } from '../lib/types'

interface DeckBTrackPickerProps {
  onPick: (track: AudioTrack) => void
  onClose: () => void
}

/**
 * A compact, searchable track list for loading Deck B — deliberately not
 * a full second LibraryPanel (folders/import/pagination chrome). Deck B
 * only ever needs "find a track, load it," so this is a lightweight
 * overlay: a search box plus a scrollable result list, pulling from the
 * same already-loaded `useLibrary()` tracks every other view in Private
 * Player shares (no separate fetch/scan).
 */
export function DeckBTrackPicker({ onPick, onClose }: DeckBTrackPickerProps) {
  const library = useLibrary()
  const [query, setQuery] = useState('')

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return library.tracks.slice(0, 40)
    return library.tracks
      .filter(
        (t) => t.title.toLowerCase().includes(q) || t.artist.toLowerCase().includes(q) || t.album.toLowerCase().includes(q),
      )
      .slice(0, 40)
  }, [library.tracks, query])

  return (
    <div
      className="border-hairline absolute top-full right-0 z-30 mt-2 flex h-80 w-72 flex-col overflow-hidden rounded-xl border"
      style={{ background: 'var(--surface-raised)', boxShadow: 'var(--shadow-panel)' }}
    >
      <div className="border-hairline flex items-center gap-2 border-b px-3 py-2.5">
        <SearchIcon width={13} height={13} className="text-text-tertiary shrink-0" />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search Deck B track…"
          className="text-text-primary placeholder:text-text-tertiary w-full bg-transparent text-xs outline-none"
        />
        <button type="button" onClick={onClose} className="text-text-tertiary hover:text-text-primary shrink-0">
          <WindowCloseIcon width={13} height={13} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-1.5">
        {results.length === 0 && <p className="text-text-tertiary px-3 py-6 text-center text-xs">No matching tracks.</p>}
        {results.map((track) => (
          <button
            key={track.path}
            type="button"
            onClick={() => onPick(track)}
            className="hover:bg-surface-overlay flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors"
          >
            <div className="min-w-0 flex-1">
              <p className="text-text-primary truncate text-xs font-medium">{track.title}</p>
              <p className="text-text-tertiary truncate text-2xs">{track.artist}</p>
            </div>
            <PlusIcon width={13} height={13} className="text-text-tertiary shrink-0" />
          </button>
        ))}
      </div>
    </div>
  )
}
