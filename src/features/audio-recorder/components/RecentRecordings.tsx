import { useEffect, useState } from 'react'
import { downloadDir } from '@tauri-apps/api/path'
import { listDir, openWithSystem } from '@/integrations/file-explorer/client'
import type { FileEntry } from '@/integrations/file-explorer/types'

function size(bytes: number) {
  return bytes > 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.round(bytes / 1e3)} KB`
}

/** The latest MP3s in Downloads (where recordings are saved), newest first. */
export function RecentRecordings({ refreshKey }: { refreshKey: unknown }) {
  const [files, setFiles] = useState<FileEntry[]>([])
  useEffect(() => {
    void (async () => {
      const dir = await downloadDir()
      const entries = await listDir(dir).catch(() => [] as FileEntry[])
      setFiles(entries.filter((e) => !e.isDir && e.extension.toLowerCase() === 'mp3').sort((a, b) => b.modifiedMs - a.modifiedMs).slice(0, 8))
    })()
  }, [refreshKey])

  if (!files.length) return null
  return (
    <section className="w-full max-w-xl">
      <h3 className="mb-2 px-1 text-[12px] font-semibold uppercase tracking-[0.1em] text-[var(--color-text-tertiary)]">Recent recordings</h3>
      <div className="overflow-hidden rounded-[12px] border border-white/[0.07]">
        {files.map((f) => (
          <div key={f.path} className="flex items-center gap-3 border-b border-white/[0.05] px-4 py-2.5 last:border-b-0 hover:bg-white/[0.04]">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#e0484f]/15 text-[#ff6b72]">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
                <path d="M8 5.5v13l10.5-6.5Z" />
              </svg>
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13.5px] font-medium text-[var(--color-text-primary)]">{f.name.replace(/\.mp3$/i, '')}</p>
              <p className="text-[11.5px] text-[var(--color-text-tertiary)]">
                {new Date(f.modifiedMs).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} · {size(f.sizeBytes)}
              </p>
            </div>
            <button type="button" onClick={() => void openWithSystem(f.path)} className="rounded-[8px] bg-(--os-hover) px-3 py-1.5 text-[12px] font-medium text-[var(--color-text-primary)] hover:bg-white/[0.14]">
              Play
            </button>
          </div>
        ))}
      </div>
    </section>
  )
}
