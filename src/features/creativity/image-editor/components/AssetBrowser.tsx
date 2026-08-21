import { useMemo, useState } from 'react'
import type { AssetEntry } from '@/integrations/asset-library'
import { SearchIcon, ImageIcon } from '@/shared/icons'
import { AddSourceButtons } from '@/shared/components/AddSourceButtons'

interface AssetBrowserProps {
  folderPath: string | null
  assets: AssetEntry[]
  loading: boolean
  selectedPaths: Set<string>
  onPickFolder: () => void
  onPickFiles: (multiple: boolean) => void
  onOpenAsset: (asset: AssetEntry) => void
  onToggleSelect: (path: string) => void
}

function formatBytes(bytes: number): string {
  const mb = bytes / (1024 * 1024)
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${(bytes / 1024).toFixed(0)} KB`
}

/** Local image asset browser — same folder-scan pattern as the DJ Board's TrackLibrary. */
export function AssetBrowser({
  folderPath,
  assets,
  loading,
  selectedPaths,
  onPickFolder,
  onPickFiles,
  onOpenAsset,
  onToggleSelect,
}: AssetBrowserProps) {
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
          <ImageIcon width={14} height={14} className="text-accent-creativity shrink-0" />
          <h2 className="text-text-primary text-[12.5px] font-semibold">Assets</h2>
        </div>
        <AddSourceButtons hasFolder={!!folderPath} onPickFolder={onPickFolder} onPickFiles={onPickFiles} />
      </div>

      {folderPath ? (
        <p className="text-text-tertiary mb-2 truncate text-[10px]" title={folderPath}>
          {folderPath}
        </p>
      ) : (
        <p className="text-text-tertiary mb-2 text-[10.5px] leading-relaxed">
          Add local images (png/jpg/gif/webp/bmp) individually, as a multi-select, or a whole
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
            placeholder="Search images..."
            className="text-text-primary placeholder:text-text-tertiary min-w-0 flex-1 bg-transparent text-[11px] outline-none"
          />
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <p className="text-text-tertiary p-2 text-[11px]">Scanning folder...</p>
        ) : folderPath && filtered.length === 0 ? (
          <p className="text-text-tertiary p-2 text-[11px]">
            No images found{query ? ' matching your search' : ' in this folder'}.
          </p>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {filtered.map((asset) => (
              <li key={asset.path}>
                <div className="group hover:bg-glass-hover flex items-center gap-2 rounded-md px-2 py-1.5">
                  <input
                    type="checkbox"
                    checked={selectedPaths.has(asset.path)}
                    onChange={() => onToggleSelect(asset.path)}
                    className="accent-accent-creativity shrink-0"
                    aria-label={`Select ${asset.fileName} for batch`}
                  />
                  <button
                    type="button"
                    onClick={() => onOpenAsset(asset)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <p className="text-text-secondary group-hover:text-text-primary truncate text-[11px] font-medium">
                      {asset.fileName}
                    </p>
                    <p className="text-text-tertiary text-[9.5px]">{formatBytes(asset.sizeBytes)}</p>
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
