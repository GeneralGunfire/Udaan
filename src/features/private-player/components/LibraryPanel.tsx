import { useMemo, useState } from 'react'
import { FolderIcon, PlusIcon } from '@/shared/icons'
import { TrackRow } from './TrackRow'
import { usePaged } from '../hooks/usePaged'
import { usePlayer } from '../lib/PlayerContext'
import type { AudioTrack } from '../lib/types'

interface LibraryPanelProps {
  tracks: AudioTrack[]
  currentTrackPath: string | null
  isPlaying: boolean
  onPlayTrack: (index: number) => void
  onChooseFolder: () => void
  musicFolder: string | null
  onAddFiles: () => void
  importing: boolean
}

/** Plain library browsing, paginated 20-at-a-time ("Load more" — see
 * usePaged) rather than mounting every track's row/cover placeholder up
 * front, which was the direct cause of the library view's lag with a
 * ~200-track folder. Search lives on its own page now (SearchPanel),
 * matching the original app's separate Home/Search/Library pages instead
 * of one page doing both. */
export function LibraryPanel({
  tracks,
  currentTrackPath,
  isPlaying,
  onPlayTrack,
  onChooseFolder,
  musicFolder,
  onAddFiles,
  importing,
}: LibraryPanelProps) {
  const player = usePlayer()
  const [filter, setFilter] = useState<'all' | 'favorites'>('all')
  const filteredTracks = filter === 'favorites' ? tracks.filter((t) => player.favorites.has(t.path)) : tracks
  const { visible, hasMore, showMore, remaining } = usePaged(filteredTracks, 20)
  const indexByPath = useMemo(() => new Map(tracks.map((t, i) => [t.path, i])), [tracks])

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-6 pt-5 pb-4">
        <div>
          <h2 className="text-text-primary text-[17px] font-semibold tracking-tight">My Music</h2>
          <p className="text-text-tertiary text-xs">{filteredTracks.length} tracks</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onAddFiles}
            disabled={!musicFolder || importing}
            title="Add songs to your library"
            className="text-text-secondary hover:text-text-primary border-hairline shrink-0 rounded-lg border p-2 transition-colors disabled:opacity-40"
          >
            <PlusIcon width={16} height={16} />
          </button>
          <button
            type="button"
            onClick={onChooseFolder}
            title={musicFolder ?? 'Choose music folder'}
            className="text-text-secondary hover:text-text-primary border-hairline shrink-0 rounded-lg border p-2 transition-colors"
          >
            <FolderIcon width={16} height={16} />
          </button>
        </div>
      </div>
      {importing && <p className="text-text-tertiary px-6 pb-2 text-xs">Adding songs to your library…</p>}

      {tracks.length > 0 && (
        <div className="flex items-center gap-1.5 px-6 pb-3">
          {(['all', 'favorites'] as const).map((f) => {
            const active = filter === f
            return (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                aria-pressed={active}
                className={`rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors duration-150 ${
                  active
                    ? 'bg-accent text-accent-contrast shadow-[inset_0_1px_0_rgb(255_255_255/22%),var(--shadow-raised)]'
                    : 'bg-surface-hover text-text-tertiary hover:text-text-secondary'
                }`}
              >
                {f === 'all' ? 'All' : 'Liked Songs'}
              </button>
            )
          })}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        {tracks.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
            <FolderIcon width={36} height={36} className="text-text-tertiary" />
            <p className="text-text-secondary text-sm">No music folder selected</p>
            <button
              type="button"
              onClick={onChooseFolder}
              className="bg-accent hover:brightness-110 rounded-full px-5 py-2.5 text-sm font-medium text-white transition-colors"
            >
              Choose folder
            </button>
          </div>
        ) : filteredTracks.length === 0 ? (
          <p className="text-text-tertiary py-10 text-center text-sm">No liked songs yet.</p>
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
                className="text-text-secondary hover:text-text-primary hover:bg-[var(--os-menu-item-hover)] mt-1 w-full rounded-lg py-2.5 text-center text-sm font-medium transition-colors"
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
