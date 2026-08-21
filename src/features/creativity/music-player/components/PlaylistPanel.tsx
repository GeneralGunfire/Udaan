import { useMemo, useState } from 'react'
import type { AudioTrack } from '@/integrations/audio-library'
import { SearchIcon, WaveformIcon } from '@/shared/icons'
import { AddSourceButtons } from '@/shared/components/AddSourceButtons'

interface PlaylistPanelProps {
  folderPath: string | null
  tracks: AudioTrack[]
  loading: boolean
  currentIndex: number | null
  isPlaying: boolean
  onPickFolder: () => void
  onPickFiles: (multiple: boolean) => void
  onSelectTrack: (index: number) => void
}

function formatBytes(bytes: number): string {
  const mb = bytes / (1024 * 1024)
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${(bytes / 1024).toFixed(0)} KB`
}

/** Playlist — real local folder scan, no hardcoded track list. Whatever's in the chosen folder is the whole library. */
export function PlaylistPanel({
  folderPath,
  tracks,
  loading,
  currentIndex,
  isPlaying,
  onPickFolder,
  onPickFiles,
  onSelectTrack,
}: PlaylistPanelProps) {
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    if (!query.trim()) return tracks.map((t, i) => ({ track: t, index: i }))
    const q = query.toLowerCase()
    return tracks
      .map((t, i) => ({ track: t, index: i }))
      .filter(({ track }) => track.fileName.toLowerCase().includes(q))
  }, [tracks, query])

  return (
    <div className="glass-surface flex h-full flex-col rounded-xl p-3">
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <WaveformIcon width={14} height={14} className="text-accent-creativity shrink-0" />
          <h2 className="text-text-primary text-[12.5px] font-semibold">Playlist</h2>
        </div>
        <AddSourceButtons hasFolder={!!folderPath} onPickFolder={onPickFolder} onPickFiles={onPickFiles} />
      </div>

      {folderPath ? (
        <p className="text-text-tertiary mb-2 truncate text-[10px]" title={folderPath}>
          {folderPath}
        </p>
      ) : (
        <p className="text-text-tertiary mb-2 text-[10.5px] leading-relaxed">
          Add local audio files (mp3/wav/ogg/flac/m4a/aac) individually, as a multi-select, or a
          whole folder.
        </p>
      )}

      {folderPath && (
        <div className="border-glass-border bg-glass mb-2 flex items-center gap-1.5 rounded-md border px-2 py-1.5">
          <SearchIcon width={11} height={11} className="text-text-tertiary shrink-0" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search playlist..."
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
            {filtered.map(({ track, index }) => {
              const active = index === currentIndex
              return (
                <li key={track.path}>
                  <button
                    type="button"
                    onClick={() => onSelectTrack(index)}
                    className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors duration-150 ${
                      active ? 'bg-glass-hover' : 'hover:bg-glass-hover'
                    }`}
                  >
                    <span
                      className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                        active && isPlaying ? 'bg-accent-creativity' : 'bg-transparent'
                      }`}
                    />
                    <div className="min-w-0 flex-1">
                      <p
                        className={`truncate text-[11px] font-medium ${
                          active ? 'text-accent-creativity' : 'text-text-secondary'
                        }`}
                      >
                        {track.fileName}
                      </p>
                      <p className="text-text-tertiary text-[9.5px]">{formatBytes(track.sizeBytes)}</p>
                    </div>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
