import { useMemo, useState } from 'react'
import type { AudioTrack } from '@/integrations/audio-library'
import { FolderIcon, SearchIcon, WaveformIcon } from '@/shared/icons'

interface TrackLibraryProps {
  folderPath: string | null
  tracks: AudioTrack[]
  loading: boolean
  onPickFolder: () => void
  onDragTrackStart: (track: AudioTrack) => void
  onLoadToDeck: (deck: 'A' | 'B', track: AudioTrack) => void
}

function formatBytes(bytes: number): string {
  const mb = bytes / (1024 * 1024)
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${(bytes / 1024).toFixed(0)} KB`
}

/** Local track library — browse/search a user-chosen folder, drag tracks onto a deck. */
export function TrackLibrary({
  folderPath,
  tracks,
  loading,
  onPickFolder,
  onDragTrackStart,
  onLoadToDeck,
}: TrackLibraryProps) {
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    if (!query.trim()) return tracks
    const q = query.toLowerCase()
    return tracks.filter((t) => t.fileName.toLowerCase().includes(q))
  }, [tracks, query])

  return (
    <div className="glass-surface flex h-full flex-col rounded-xl p-3">
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <WaveformIcon width={14} height={14} className="text-accent-creativity shrink-0" />
          <h2 className="text-text-primary text-[12.5px] font-semibold">Library</h2>
        </div>
        <button
          type="button"
          onClick={onPickFolder}
          className="text-text-secondary hover:text-text-primary hover:bg-glass-hover flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[10.5px] font-medium transition-colors duration-150"
        >
          <FolderIcon width={11} height={11} />
          {folderPath ? 'Change' : 'Pick folder'}
        </button>
      </div>

      {folderPath ? (
        <p className="text-text-tertiary mb-2 truncate text-[10px]" title={folderPath}>
          {folderPath}
        </p>
      ) : (
        <p className="text-text-tertiary mb-2 text-[10.5px] leading-relaxed">
          Pick a folder of local audio files (mp3/wav/ogg/flac/m4a/aac) to build your library.
        </p>
      )}

      {folderPath && (
        <div className="border-glass-border bg-glass mb-2 flex items-center gap-1.5 rounded-md border px-2 py-1.5">
          <SearchIcon width={11} height={11} className="text-text-tertiary shrink-0" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search tracks..."
            className="text-text-primary placeholder:text-text-tertiary min-w-0 flex-1 bg-transparent text-[11px] outline-none"
          />
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <p className="text-text-tertiary p-2 text-[11px]">Scanning folder...</p>
        ) : folderPath && filtered.length === 0 ? (
          <p className="text-text-tertiary p-2 text-[11px]">
            No audio files found{query ? ' matching your search' : ' in this folder'}.
          </p>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {filtered.map((track) => (
              <li key={track.path}>
                <div
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData('application/x-dj-track', track.path)
                    onDragTrackStart(track)
                  }}
                  className="group hover:bg-glass-hover flex cursor-grab items-center gap-2 rounded-md px-2 py-1.5 active:cursor-grabbing"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-text-secondary group-hover:text-text-primary truncate text-[11px] font-medium">
                      {track.fileName}
                    </p>
                    <p className="text-text-tertiary text-[9.5px]">{formatBytes(track.sizeBytes)}</p>
                  </div>
                  <div className="flex shrink-0 gap-1 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
                    <button
                      type="button"
                      onClick={() => onLoadToDeck('A', track)}
                      title="Load to Deck A"
                      className="text-accent-creativity hover:bg-glass border-glass-border rounded border px-1.5 py-0.5 text-[9.5px] font-semibold"
                    >
                      A
                    </button>
                    <button
                      type="button"
                      onClick={() => onLoadToDeck('B', track)}
                      title="Load to Deck B"
                      className="text-accent-creativity hover:bg-glass border-glass-border rounded border px-1.5 py-0.5 text-[9.5px] font-semibold"
                    >
                      B
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
