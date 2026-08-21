import { useMemo, useState } from 'react'
import type { AssetEntry } from '@/integrations/asset-library'
import { SearchIcon, LayersIcon } from '@/shared/icons'
import { AddSourceButtons } from '@/shared/components/AddSourceButtons'

interface ClipLibraryProps {
  folderPath: string | null
  assets: AssetEntry[]
  loading: boolean
  onPickFolder: () => void
  onPickFiles: (multiple: boolean) => void
  onAddClip: (asset: AssetEntry) => void
}

function formatBytes(bytes: number): string {
  const mb = bytes / (1024 * 1024)
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${(bytes / 1024).toFixed(0)} KB`
}

/** Clip library — pulls from the same local asset library as the Image Editor, filtered to video files. */
export function ClipLibrary({
  folderPath,
  assets,
  loading,
  onPickFolder,
  onPickFiles,
  onAddClip,
}: ClipLibraryProps) {
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    if (!query.trim()) return assets
    const q = query.toLowerCase()
    return assets.filter((a) => a.fileName.toLowerCase().includes(q))
  }, [assets, query])

  return (
    <div className="glass-surface flex h-full flex-col rounded-xl p-3">
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <LayersIcon width={14} height={14} className="text-accent-creativity shrink-0" />
          <h2 className="text-text-primary text-[12.5px] font-semibold">Clips</h2>
        </div>
        <AddSourceButtons hasFolder={!!folderPath} onPickFolder={onPickFolder} onPickFiles={onPickFiles} />
      </div>

      {folderPath ? (
        <p className="text-text-tertiary mb-2 truncate text-[10px]" title={folderPath}>
          {folderPath}
        </p>
      ) : (
        <p className="text-text-tertiary mb-2 text-[10.5px] leading-relaxed">
          Add local video files (mp4/mov/webm/mkv/avi) individually, as a multi-select, or a whole
          folder.
        </p>
      )}

      {folderPath && (
        <div className="border-glass-border bg-glass mb-2 flex items-center gap-1.5 rounded-md border px-2 py-1.5">
          <SearchIcon width={11} height={11} className="text-text-tertiary shrink-0" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search clips..."
            className="text-text-primary placeholder:text-text-tertiary min-w-0 flex-1 bg-transparent text-[11px] outline-none"
          />
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <p className="text-text-tertiary p-2 text-[11px]">Scanning folder...</p>
        ) : folderPath && filtered.length === 0 ? (
          <p className="text-text-tertiary p-2 text-[11px]">
            No video files found{query ? ' matching your search' : ' in this folder'}.
          </p>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {filtered.map((asset) => (
              <li key={asset.path}>
                <button
                  type="button"
                  onClick={() => onAddClip(asset)}
                  className="group hover:bg-glass-hover flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-text-secondary group-hover:text-text-primary truncate text-[11px] font-medium">
                      {asset.fileName}
                    </p>
                    <p className="text-text-tertiary text-[9.5px]">{formatBytes(asset.sizeBytes)}</p>
                  </div>
                  <span className="text-accent-creativity text-[10px] font-semibold opacity-0 group-hover:opacity-100">
                    + Add
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
