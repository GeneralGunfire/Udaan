import { cn } from '@/shared/lib/cn'
import { Button } from '@/os/ui/controls'

export type KindFilter = 'all' | 'folder' | 'image' | 'text' | 'video' | 'audio' | 'pdf'

const FILTERS: { id: KindFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'folder', label: 'Folders' },
  { id: 'image', label: 'Images' },
  { id: 'text', label: 'Documents' },
  { id: 'pdf', label: 'PDF' },
  { id: 'video', label: 'Video' },
  { id: 'audio', label: 'Audio' },
]

/** A thin strip under the toolbar: filter by kind, count what is shown, toggle the details pane. */
export function FilesSubBar({ filter, onFilter, shown, total, selectedCount, paneOpen, onTogglePane }: { filter: KindFilter; onFilter: (f: KindFilter) => void; shown: number; total: number; selectedCount: number; paneOpen: boolean; onTogglePane: () => void }) {
  return (
    <div className="flex h-10 shrink-0 items-center gap-1.5 border-b border-(--u-edge) px-3">
      {FILTERS.map((f) => (
        <Button key={f.id} size="sm" pill variant={filter === f.id ? 'primary' : 'ghost'} aria-pressed={filter === f.id} onClick={() => onFilter(f.id)}>
          {f.label}
        </Button>
      ))}
      <span className="flex-1" />
      <span className={cn('text-[11.5px] tabular-nums text-(--u-ink-3)')}>{selectedCount ? `${selectedCount} of ${shown} selected` : filter === 'all' ? `${total} items` : `${shown} of ${total} items`}</span>
      <Button size="sm" variant={paneOpen ? 'tinted' : 'ghost'} aria-pressed={paneOpen} onClick={onTogglePane} title="Details pane">
        Details
      </Button>
    </div>
  )
}
