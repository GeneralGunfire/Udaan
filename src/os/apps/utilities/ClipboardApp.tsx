import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { invoke, convertFileSrc } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { launchApp } from '@/integrations/installed-apps/client'
import { Button, Segmented } from '@/os/ui/controls'
import { cn } from '@/shared/lib/cn'
import { SearchIcon, TrashIcon } from '@/shared/icons'

interface ClipItem {
  id: string
  kind: 'text' | 'image'
  text: string | null
  imagePath: string | null
  pinned: boolean
  at: number
}

type Filter = 'all' | 'text' | 'link' | 'image' | 'pinned'
type Flavour = 'image' | 'link' | 'colour' | 'code' | 'number' | 'text'

/* ── what kind of thing was copied ──────────────────────────────────── */

function flavourOf(i: ClipItem): Flavour {
  if (i.kind === 'image') return 'image'
  const t = (i.text ?? '').trim()
  if (/^(https?:\/\/|www\.)\S+$/i.test(t)) return 'link'
  if (/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(t) || /^(rgb|hsl)a?\([^)]+\)$/i.test(t)) return 'colour'
  if (/^-?[\d\s,.]+%?$/.test(t) && /\d/.test(t) && t.length < 24) return 'number'
  if (/[{};]\s*$|=>|^\s*(const|let|var|function|import|class|def|SELECT|<\w+)/m.test(t) && t.includes('\n')) return 'code'
  return 'text'
}

const FLAVOUR_LABEL: Record<Flavour, string> = { image: 'Image', link: 'Link', colour: 'Colour', code: 'Code', number: 'Number', text: 'Text' }

function Glyph({ flavour, className }: { flavour: Flavour; className?: string }) {
  const p = { viewBox: '0 0 24 24', width: 15, height: 15, fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, className }
  switch (flavour) {
    case 'image':
      return (
        <svg {...p}>
          <rect x="3" y="4" width="18" height="16" rx="2.5" />
          <circle cx="9" cy="10" r="1.6" />
          <path d="m4 18 5-5 4 4 3-3 4 4" />
        </svg>
      )
    case 'link':
      return (
        <svg {...p}>
          <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
          <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
        </svg>
      )
    case 'colour':
      return (
        <svg {...p}>
          <path d="M12 3c4.5 4.2 7 7.2 7 10.5a7 7 0 0 1-14 0C5 10.2 7.5 7.2 12 3Z" />
        </svg>
      )
    case 'code':
      return (
        <svg {...p}>
          <path d="m8 7-5 5 5 5M16 7l5 5-5 5M14 4l-4 16" />
        </svg>
      )
    case 'number':
      return (
        <svg {...p}>
          <path d="M5 9h14M5 15h14M10 4 8 20M16 4l-2 16" />
        </svg>
      )
    default:
      return (
        <svg {...p}>
          <path d="M5 6h14M5 12h14M5 18h9" />
        </svg>
      )
  }
}

function dayLabel(ms: number): string {
  const d = new Date(ms)
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const days = Math.round((startOf(new Date()) - startOf(d)) / 86_400_000)
  return days <= 0 ? 'Today' : days === 1 ? 'Yesterday' : days < 7 ? d.toLocaleDateString(undefined, { weekday: 'long' }) : d.toLocaleDateString(undefined, { day: 'numeric', month: 'long' })
}

function clock(ms: number) {
  return new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

const oneLine = (t: string) => t.replace(/\s+/g, ' ').trim().slice(0, 140)

/** Ways to reshape text before copying it again. */
const TRANSFORMS: { label: string; run: (t: string) => string; when?: (t: string) => boolean }[] = [
  { label: 'Trim', run: (t) => t.trim().replace(/[ \t]+$/gm, '') },
  { label: 'UPPER', run: (t) => t.toUpperCase() },
  { label: 'lower', run: (t) => t.toLowerCase() },
  { label: 'Title Case', run: (t) => t.toLowerCase().replace(/(^|\s)\S/g, (m) => m.toUpperCase()) },
  { label: 'One line', run: (t) => t.replace(/\s+/g, ' ').trim(), when: (t) => t.includes('\n') },
  { label: 'Sort lines', run: (t) => t.split('\n').sort((a, b) => a.localeCompare(b)).join('\n'), when: (t) => t.includes('\n') },
  { label: 'Unique lines', run: (t) => [...new Set(t.split('\n'))].join('\n'), when: (t) => t.includes('\n') },
  {
    label: 'Format JSON',
    run: (t) => JSON.stringify(JSON.parse(t), null, 2),
    when: (t) => {
      try {
        JSON.parse(t)
        return /^[\[{]/.test(t.trim())
      } catch {
        return false
      }
    },
  },
]

/** Clipboard: everything you have copied, found fast, previewed in full, reshaped and copied again. */
export function ClipboardApp(_props: { onClose: () => void }) {
  const [items, setItems] = useState<ClipItem[]>([])
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [selected, setSelected] = useState<string | null>(null)
  const [flash, setFlash] = useState<string | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const load = () => void invoke<ClipItem[]>('clip_history_list').then(setItems, () => {})
    load()
    const un = listen('clipboard://changed', load)
    return () => void un.then((f) => f())
  }, [])

  const say = (t: string) => {
    setFlash(t)
    setTimeout(() => setFlash((f) => (f === t ? null : f)), 1400)
  }

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return items
      .filter((i) => {
        const f = flavourOf(i)
        return filter === 'all' ? true : filter === 'pinned' ? i.pinned : filter === 'image' ? i.kind === 'image' : filter === 'link' ? f === 'link' : i.kind === 'text'
      })
      .filter((i) => !q || (i.text ?? '').toLowerCase().includes(q))
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.at - a.at)
  }, [items, query, filter])

  const groups = useMemo(() => {
    const out: { label: string; items: ClipItem[] }[] = []
    for (const i of shown) {
      const label = i.pinned ? 'Pinned' : dayLabel(i.at)
      const g = out.find((x) => x.label === label)
      if (g) g.items.push(i)
      else out.push({ label, items: [i] })
    }
    return out
  }, [shown])

  // Keep a valid selection: the first item when nothing (or something gone) is selected.
  useEffect(() => {
    if (!shown.length) return setSelected(null)
    if (!selected || !shown.some((i) => i.id === selected)) setSelected(shown[0].id)
  }, [shown, selected])

  const current = shown.find((i) => i.id === selected) ?? null
  const counts = useMemo(() => ({ all: items.length, text: items.filter((i) => i.kind === 'text').length, link: items.filter((i) => flavourOf(i) === 'link').length, image: items.filter((i) => i.kind === 'image').length, pinned: items.filter((i) => i.pinned).length }), [items])

  const copy = useCallback(
    async (i: ClipItem) => {
      await invoke('clip_history_copy', { id: i.id })
      say('Copied')
    },
    [],
  )
  const remove = (i: ClipItem) => void invoke('clip_history_delete', { id: i.id })

  // Up/Down move through the list, Enter copies, Delete removes, "/" jumps to search.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.tagName === 'INPUT'
      if (e.key === '/' && !typing) return (e.preventDefault(), searchRef.current?.focus())
      if (typing && e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
      const idx = shown.findIndex((i) => i.id === selected)
      if (e.key === 'ArrowDown') (e.preventDefault(), shown[idx + 1] && setSelected(shown[idx + 1].id))
      else if (e.key === 'ArrowUp') (e.preventDefault(), shown[idx - 1] && setSelected(shown[idx - 1].id))
      else if (e.key === 'Enter' && current && !typing) void copy(current)
      else if (e.key === 'Delete' && current && !typing) remove(current)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [shown, selected, current, copy])

  const writeText = async (t: string, note: string) => {
    await navigator.clipboard.writeText(t).catch(() => {})
    say(note)
  }

  const flavour = current ? flavourOf(current) : null
  const text = current?.text ?? ''
  const link = flavour === 'link' ? (/^https?:/i.test(text.trim()) ? text.trim() : `https://${text.trim()}`) : null

  const lab = (t: string, n: number) => (
    <span>
      {t} {n > 0 && <span className="opacity-55">{n}</span>}
    </span>
  )
  const filters: { value: Filter; label: ReactNode }[] = [
    { value: 'all', label: 'All' },
    { value: 'text', label: lab('Text', counts.text) },
    { value: 'link', label: lab('Links', counts.link) },
    { value: 'image', label: lab('Images', counts.image) },
    { value: 'pinned', label: lab('Pinned', counts.pinned) },
  ]

  return (
    <div className="flex h-full bg-(--u-bg) text-(--u-ink)">
      <aside className="flex w-[360px] shrink-0 flex-col border-r border-(--u-edge)">
        <div className="flex items-center gap-2 px-4 pb-2 pt-4">
          <div className="flex-1">
            <h1 className="text-[19px] font-semibold tracking-tight">Clipboard</h1>
            <p className="text-[11.5px] text-(--u-ink-3)">{items.length ? `${items.length} items kept` : 'Nothing yet'}</p>
          </div>
          <Button size="sm" disabled={!items.length} title="Clear everything except pinned items" onClick={() => window.confirm('Clear everything except pinned items?') && void invoke('clip_history_delete', { id: null })}>
            Clear
          </Button>
        </div>
        <label className="u-search mx-4 mb-2 h-9">
          <SearchIcon width={14} height={14} />
          <input ref={searchRef} autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search what you copied   ( / )" />
        </label>
        <div className="mx-4 mb-2 overflow-x-auto">
          <Segmented<Filter> value={filter} options={filters} onChange={setFilter} />
        </div>
        <div className="u-scroll min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          {shown.length === 0 && <p className="px-3 py-10 text-center text-[12.5px] text-(--u-ink-3)">{items.length ? 'Nothing matches' : 'Copy something and it appears here.'}</p>}
          {groups.map((g) => (
            <div key={g.label} className="mb-1">
              <p className="u-label px-3 pb-1 pt-2">{g.label}</p>
              {g.items.map((i) => {
                const f = flavourOf(i)
                return (
                  <button key={i.id} type="button" data-selected={i.id === selected || undefined} onClick={() => setSelected(i.id)} onDoubleClick={() => void copy(i)} className="u-row mb-0.5 h-auto items-start gap-2.5 px-3 py-2 text-left">
                    <span className="mt-0.5 flex h-[26px] w-[26px] shrink-0 items-center justify-center overflow-hidden rounded-[7px] bg-(--u-wash-on) text-(--u-ink-2)">
                      {f === 'image' && i.imagePath ? <img src={convertFileSrc(i.imagePath)} alt="" className="h-full w-full object-cover" /> : f === 'colour' ? <span className="h-full w-full" style={{ background: (i.text ?? '').trim() }} /> : <Glyph flavour={f} />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12.5px]">{i.kind === 'image' ? 'Image' : oneLine(i.text ?? '') || '(blank)'}</span>
                      <span className="block text-[11px] text-(--u-ink-3)">
                        {FLAVOUR_LABEL[f]} · {clock(i.at)}
                        {i.kind === 'text' && ` · ${(i.text ?? '').length} chars`}
                      </span>
                    </span>
                    {i.pinned && <span className="mt-1 text-[11px] text-(--u-accent)">★</span>}
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        {current && flavour ? (
          <>
            <header className="flex h-12 shrink-0 items-center gap-2 border-b border-(--u-edge) px-5">
              <span className="flex items-center gap-1.5 rounded-full bg-(--u-wash-on) px-2.5 py-1 text-[11.5px] font-medium text-(--u-ink-2)">
                <Glyph flavour={flavour} /> {FLAVOUR_LABEL[flavour]}
              </span>
              <span className="text-[12px] text-(--u-ink-3)">
                {dayLabel(current.at)}, {clock(current.at)}
              </span>
              <span className="flex-1" />
              {flash && <span className="text-[12px] text-(--u-ok)">{flash}</span>}
              <Button size="sm" aria-pressed={current.pinned} className={current.pinned ? 'text-(--u-accent)' : ''} onClick={() => void invoke('clip_history_pin', { id: current.id, pinned: !current.pinned })}>
                {current.pinned ? '★ Pinned' : '☆ Pin'}
              </Button>
              {link && (
                <Button size="sm" onClick={() => void launchApp(link).catch(() => {})}>
                  Open link
                </Button>
              )}
              <Button size="sm" variant="primary" onClick={() => void copy(current)}>
                Copy
              </Button>
              <Button size="sm" icon title="Delete" className="hover:text-(--u-danger)" onClick={() => remove(current)}>
                <TrashIcon width={14} height={14} />
              </Button>
            </header>

            <div className="u-scroll min-h-0 flex-1 overflow-y-auto p-6">
              {current.kind === 'image' && current.imagePath ? (
                <div className="flex h-full items-center justify-center rounded-[12px] bg-(--u-wash-on) p-4">
                  <img src={convertFileSrc(current.imagePath)} alt="" className="max-h-full max-w-full rounded-[8px] object-contain" />
                </div>
              ) : flavour === 'colour' ? (
                <div className="flex flex-col gap-4">
                  <div className="h-40 rounded-[14px] shadow-[inset_0_0_0_1px_var(--u-edge)]" style={{ background: text.trim() }} />
                  <p className="select-text font-mono text-[18px]">{text.trim()}</p>
                </div>
              ) : (
                <pre className={cn('select-text whitespace-pre-wrap break-words font-sans text-[14px] leading-[1.65]', (flavour === 'code' || flavour === 'number') && 'font-mono text-[13px]')}>{text}</pre>
              )}
            </div>

            {current.kind === 'text' && (
              <footer className="flex shrink-0 flex-wrap items-center gap-1.5 border-t border-(--u-edge) px-5 py-3">
                <span className="mr-1 text-[11.5px] text-(--u-ink-3)">Copy as</span>
                {TRANSFORMS.filter((t) => !t.when || t.when(text)).map((t) => (
                  <Button
                    key={t.label}
                    size="sm"
                    onClick={() => {
                      try {
                        void writeText(t.run(text), `Copied: ${t.label}`)
                      } catch {
                        say('Could not do that to this text')
                      }
                    }}
                  >
                    {t.label}
                  </Button>
                ))}
                <span className="flex-1" />
                <span className="text-[11.5px] tabular-nums text-(--u-ink-3)">
                  {text.length} chars · {text.trim() ? text.trim().split(/\s+/).length : 0} words · {text.split('\n').length} lines
                </span>
              </footer>
            )}
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
            <p className="text-[15px] font-semibold">{items.length ? 'Select something to preview it' : 'Your clipboard history is empty'}</p>
            <p className="max-w-[320px] text-[12.5px] text-(--u-ink-3)">Everything you copy is kept here: text, links, colours and pictures. Double-click an item to copy it again.</p>
          </div>
        )}
      </main>
    </div>
  )
}
