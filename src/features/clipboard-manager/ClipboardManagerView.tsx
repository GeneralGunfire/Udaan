import { useMemo, useState } from 'react'
import { GlassPanel } from '@/shared/components/GlassPanel'
import { ClipboardIcon, SearchIcon, TrashIcon } from '@/shared/icons'
import { useClipboardHistory } from './hooks/useClipboardHistory'
import { CLIPBOARD_SHORTCUT_LABEL } from './hooks/useClipboardShortcut'
import type { ClipboardEntry } from '@/integrations/clipboard-manager'

function formatTimestamp(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/**
 * Real clipboard history — a background Rust thread polls the OS clipboard (text + images) and
 * persists new entries to a local sqlite DB, pruned to the last 500 entries or 30 days,
 * whichever is smaller. Clicking an item re-copies it to the system clipboard.
 */
export function ClipboardManagerView() {
  const { entries, loading, remove, clear, restore } = useClipboardHistory()
  const [query, setQuery] = useState('')
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return entries
    return entries.filter((e) => e.preview.toLowerCase().includes(q))
  }, [entries, query])

  async function handleRestore(entry: ClipboardEntry) {
    await restore(entry)
    setCopiedId(entry.id)
    setTimeout(() => setCopiedId((id) => (id === entry.id ? null : id)), 1500)
  }

  return (
    <div className="flex w-full max-w-2xl flex-col gap-4 overflow-y-auto py-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ClipboardIcon width={16} height={16} className="text-brand-teal" />
          <h1 className="font-display text-text-primary text-[16px] font-semibold">
            Clipboard Manager
          </h1>
        </div>
        {entries.length > 0 && (
          <button
            type="button"
            onClick={() => clear()}
            className="text-text-tertiary hover:text-red-400 flex items-center gap-1 text-[11.5px] transition-colors duration-150"
          >
            <TrashIcon width={12} height={12} />
            Clear all
          </button>
        )}
      </div>

      <p className="text-text-tertiary text-[11px]">
        Press <span className="text-text-secondary font-medium">{CLIPBOARD_SHORTCUT_LABEL}</span>{' '}
        anywhere to jump here.
      </p>

      <div className="glass-surface flex items-center gap-2 rounded-lg px-3 py-2">
        <SearchIcon width={14} height={14} className="text-text-tertiary shrink-0" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search clipboard history…"
          className="text-text-primary placeholder:text-text-tertiary min-w-0 flex-1 bg-transparent text-[12.5px] outline-none"
        />
      </div>

      {loading ? (
        <GlassPanel>
          <p className="text-text-secondary text-[12.5px]">Loading history…</p>
        </GlassPanel>
      ) : filtered.length === 0 ? (
        <GlassPanel>
          <p className="text-text-secondary text-[12.5px]">
            {entries.length === 0
              ? 'No clipboard activity yet. Copy some text or an image and it will show up here.'
              : 'No entries match your search.'}
          </p>
        </GlassPanel>
      ) : (
        <div className="flex flex-col gap-2">
          {filtered.map((entry) => (
            <GlassPanel
              key={entry.id}
              className="flex items-start justify-between gap-3 cursor-pointer transition-colors duration-150 hover:bg-glass-hover"
            >
              <button
                type="button"
                onClick={() => handleRestore(entry)}
                className="flex min-w-0 flex-1 items-start gap-3 text-left"
              >
                {entry.kind === 'image' ? (
                  <img
                    src={entry.content}
                    alt=""
                    className="h-12 w-12 shrink-0 rounded-md border border-glass-border object-cover"
                  />
                ) : null}
                <div className="min-w-0">
                  <p className="text-text-primary truncate text-[12.5px] font-medium">
                    {copiedId === entry.id ? 'Copied to clipboard' : entry.preview}
                  </p>
                  <p className="text-text-tertiary mt-0.5 text-[11px]">
                    {entry.kind === 'image' ? 'Image' : 'Text'} · {formatTimestamp(entry.createdAt)}
                  </p>
                </div>
              </button>
              <button
                type="button"
                onClick={() => remove(entry.id)}
                aria-label="Delete entry"
                className="text-text-tertiary hover:text-red-400 shrink-0 transition-colors duration-150"
              >
                <TrashIcon width={13} height={13} />
              </button>
            </GlassPanel>
          ))}
        </div>
      )}
    </div>
  )
}
