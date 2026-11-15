import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { openWithSystem, readTextPreview } from '@/integrations/file-explorer/client'
import { Button } from '@/os/ui/controls'
import { useImageThumbnail } from '../hooks/useImageThumbnail'
import { fileKind, formatFileSize, formatModified } from '../lib/fileKind'
import { iconForKind } from '../lib/iconForKind'
import type { FileEntry } from '@/integrations/file-explorer/types'

/**
 * The DETAILS PANE: what is selected, at a glance, without opening anything.
 *
 *   nothing selected   a summary of the folder (items, total size, types)
 *   one file           a real preview (picture, text, or its icon) plus its facts and quick actions
 *   one folder         what is inside, with its total size worked out on demand
 *   several            how many, how big in total, and what kinds
 */
function Facts({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[12px]">
      {rows.map(([k, v]) => (
        <div key={k} className="col-span-2 grid grid-cols-subgrid">
          <dt className="text-(--u-ink-3)">{k}</dt>
          <dd className="min-w-0 break-words text-right text-(--u-ink-2)">{v}</dd>
        </div>
      ))}
    </dl>
  )
}

function useFolderSize(path: string | null) {
  const [size, setSize] = useState<{ bytes: number; files: number; capped: boolean } | null>(null)
  useEffect(() => {
    setSize(null)
    if (!path) return
    let off = false
    void invoke<{ bytes: number; files: number; capped: boolean }>('file_explorer_dir_size', { path }).then((r) => !off && setSize(r), () => {})
    return () => {
      off = true
    }
  }, [path])
  return size
}

function OneFile({ entry }: { entry: FileEntry }) {
  const kind = fileKind(entry.extension, entry.isDir)
  const image = useImageThumbnail(kind === 'image' ? entry.path : null)
  const [text, setText] = useState<string | null>(null)
  const size = useFolderSize(entry.isDir ? entry.path : null)
  useEffect(() => {
    setText(null)
    if (kind === 'text') void readTextPreview(entry.path).then(setText, () => setText(null))
  }, [entry.path, kind])
  const Icon = iconForKind(kind)
  return (
    <div className="flex flex-col gap-4">
      <div className="flex aspect-[4/3] w-full items-center justify-center overflow-hidden rounded-[12px] bg-(--u-wash-hover) shadow-[inset_0_0_0_1px_var(--u-edge)]">
        {image ? (
          <img src={image} alt="" className="h-full w-full object-contain" />
        ) : text !== null ? (
          <pre className="h-full w-full overflow-hidden whitespace-pre-wrap p-3 text-[10.5px] leading-snug text-(--u-ink-2)">{text.slice(0, 900)}</pre>
        ) : (
          <Icon width={56} height={56} className="text-(--u-ink-3)" />
        )}
      </div>
      <div>
        <p className="break-words text-[14px] font-semibold leading-snug">{entry.name}</p>
        <p className="mt-0.5 text-[12px] text-(--u-ink-3)">{entry.isDir ? 'Folder' : `${(entry.extension || 'file').toUpperCase()} file`}</p>
      </div>
      <Facts
        rows={[
          ['Size', entry.isDir ? (size ? `${formatFileSize(size.bytes)}${size.capped ? '+' : ''} in ${size.files}${size.capped ? '+' : ''} files` : 'Working it out…') : formatFileSize(entry.sizeBytes)],
          ['Modified', formatModified(entry.modifiedMs)],
          ['Created', formatModified(entry.createdMs)],
          ['Where', entry.path.replace(/[\\/][^\\/]+$/, '')],
        ]}
      />
      {!entry.isDir && (
        <div className="flex gap-2">
          <Button variant="primary" className="flex-1" onClick={() => void openWithSystem(entry.path)}>
            Open
          </Button>
          <Button variant="tinted" className="flex-1" onClick={() => void navigator.clipboard.writeText(entry.path)}>
            Copy path
          </Button>
        </div>
      )}
    </div>
  )
}

export function PreviewPane({ selected, all, folderPath }: { selected: FileEntry[]; all: FileEntry[]; folderPath: string }) {
  const folderSize = useFolderSize(selected.length === 0 ? folderPath : null)
  if (selected.length === 1) return <OneFile entry={selected[0]} />
  const list = selected.length ? selected : all
  const bytes = list.reduce((n, e) => n + (e.isDir ? 0 : e.sizeBytes), 0)
  const kinds = new Map<string, number>()
  for (const e of list) kinds.set(fileKind(e.extension, e.isDir), (kinds.get(fileKind(e.extension, e.isDir)) ?? 0) + 1)
  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="text-[14px] font-semibold">{selected.length ? `${selected.length} items selected` : folderPath.split(/[\\/]/).filter(Boolean).pop() || folderPath}</p>
        <p className="mt-0.5 text-[12px] text-(--u-ink-3)">{selected.length ? 'Selected' : 'This folder'}</p>
      </div>
      <Facts
        rows={[
          ['Items', String(list.length)],
          ['Files total', formatFileSize(bytes)],
          ...(selected.length === 0 && folderSize ? ([['Including subfolders', `${formatFileSize(folderSize.bytes)}${folderSize.capped ? '+' : ''}`]] as [string, string][]) : []),
          ...[...kinds.entries()].map(([k, n]) => [k === 'folder' ? 'Folders' : k === 'other' ? 'Other files' : `${k[0].toUpperCase()}${k.slice(1)}s`, String(n)] as [string, string]),
        ]}
      />
    </div>
  )
}
