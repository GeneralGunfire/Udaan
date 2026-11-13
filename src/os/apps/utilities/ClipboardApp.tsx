import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { invoke, convertFileSrc } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { SearchIcon, TrashIcon } from '@/shared/icons'

interface ClipItem {
  id: string
  kind: 'text' | 'image'
  text: string | null
  imagePath: string | null
  pinned: boolean
  at: number
}

type Filter = 'all' | 'text' | 'image' | 'pinned'

function ago(ms: number) {
  const m = Math.round((Date.now() - ms) / 60_000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  return h < 24 ? `${h} h ago` : new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

/** Clipboard: everything you have copied, searchable, pinnable, one click to copy again. */
export function ClipboardApp(_props: { onClose: () => void }) {
  const [items, setItems] = useState<ClipItem[]>([])
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [copied, setCopied] = useState<string | null>(null)

  useEffect(() => {
    const load = () => void invoke<ClipItem[]>('clip_history_list').then(setItems, () => {})
    load()
    const un = listen('clipboard://changed', load)
    return () => void un.then((f) => f())
  }, [])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return items
      .filter((i) => (filter === 'all' ? true : filter === 'pinned' ? i.pinned : i.kind === filter))
      .filter((i) => !q || (i.text ?? '').toLowerCase().includes(q))
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.at - a.at)
  }, [items, query, filter])

  const copy = async (i: ClipItem) => {
    await invoke('clip_history_copy', { id: i.id })
    setCopied(i.id)
    setTimeout(() => setCopied(null), 1300)
  }

  return (
    <div className="flex h-full flex-col bg-[var(--surface-base)] text-[var(--color-text-primary)]">
      <header className="flex shrink-0 items-center gap-3 px-6 pb-3 pt-5">
        <div className="flex-1">
          <h1 className="text-[22px] font-bold tracking-tight">Clipboard</h1>
          <p className="text-[12.5px] text-[var(--color-text-tertiary)]">Everything you copy is kept here — click any item to copy it again.</p>
        </div>
        <button
          type="button"
          onClick={() => window.confirm('Clear everything except pinned items?') && void invoke('clip_history_delete', { id: null })}
          className="h-9 rounded-[9px] px-3.5 text-[13px] font-medium text-[var(--color-text-secondary)] hover:bg-(--os-hover) hover:text-[var(--color-text-primary)]"
        >
          Clear history
        </button>
      </header>
      <div className="flex shrink-0 items-center gap-3 px-6 pb-4">
        <label className="flex h-10 flex-1 items-center gap-2 rounded-[10px] bg-white/[0.07] px-3 focus-within:bg-white/[0.1]">
          <SearchIcon width={15} height={15} className="text-[var(--color-text-tertiary)]" />
          <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search what you've copied" className="h-full flex-1 bg-transparent text-[14px] outline-none placeholder:text-[var(--color-text-tertiary)]" />
        </label>
        <div className="flex rounded-[10px] bg-white/[0.07] p-1 text-[12.5px] font-medium">
          {(['all', 'text', 'image', 'pinned'] as Filter[]).map((f) => (
            <button key={f} type="button" onClick={() => setFilter(f)} className={`relative rounded-[7px] px-3 py-1.5 capitalize ${filter === f ? 'text-[var(--color-text-primary)]' : 'text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]'}`}>
              {filter === f && <motion.span layoutId="clip-filter" className="absolute inset-0 rounded-[7px] bg-white/[0.14]" />}
              <span className="relative">{f === 'image' ? 'Images' : f}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
        {shown.length === 0 && <p className="mt-16 text-center text-[14px] text-[var(--color-text-tertiary)]">{items.length ? 'Nothing matches' : 'Copy something and it will appear here.'}</p>}
        <div className="grid grid-cols-2 gap-3">
          <AnimatePresence initial={false}>
            {shown.map((i) => (
              <motion.div
                key={i.id}
                layout
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96 }}
                onClick={() => void copy(i)}
                className={`group relative flex h-[130px] cursor-default flex-col overflow-hidden rounded-[14px] border bg-white/[0.04] p-3.5 transition-colors hover:bg-(--os-hover) ${i.pinned ? 'border-[#e8c547]/40' : 'border-white/[0.07]'}`}
              >
                {i.kind === 'image' && i.imagePath ? (
                  <img src={convertFileSrc(i.imagePath)} alt="" className="min-h-0 flex-1 rounded-[8px] object-contain" />
                ) : (
                  <p className="line-clamp-4 min-h-0 flex-1 whitespace-pre-wrap break-words font-mono text-[12.5px] leading-relaxed text-[var(--color-text-secondary)]">{i.text}</p>
                )}
                <div className="mt-2 flex items-center gap-2 text-[11px] text-[var(--color-text-tertiary)]">
                  <span>{ago(i.at)}</span>
                  {i.kind === 'text' && <span>· {i.text?.length} chars</span>}
                </div>
                <div className="absolute right-2 top-2 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                  <button
                    type="button"
                    title={i.pinned ? 'Unpin' : 'Pin'}
                    onClick={(e) => {
                      e.stopPropagation()
                      void invoke('clip_history_pin', { id: i.id, pinned: !i.pinned })
                    }}
                    className={`flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-[13px] ${i.pinned ? 'text-[#e8c547]' : 'text-[var(--color-text-secondary)]'}`}
                  >
                    ★
                  </button>
                  <button
                    type="button"
                    title="Delete"
                    onClick={(e) => {
                      e.stopPropagation()
                      void invoke('clip_history_delete', { id: i.id })
                    }}
                    className="flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-[var(--color-text-secondary)] hover:text-[#ff6b6b]"
                  >
                    <TrashIcon width={12} height={12} />
                  </button>
                </div>
                {i.pinned && <span className="absolute right-3 top-3 text-[12px] text-[#e8c547] group-hover:hidden">★</span>}
                <AnimatePresence>
                  {copied === i.id && (
                    <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 flex items-center justify-center bg-[var(--color-accent)]/85 text-[14px] font-semibold">
                      Copied
                    </motion.span>
                  )}
                </AnimatePresence>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </div>
    </div>
  )
}
