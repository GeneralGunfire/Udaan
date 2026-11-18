import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { convertFileSrc, invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { launchApp } from '@/integrations/installed-apps/client'
import { useShellMenu } from '@/os/ui/useShellMenu'
import { Button, Segmented, Switch } from '@/os/ui/controls'
import { cn } from '@/shared/lib/cn'

interface ClipItem {
  id: string
  kind: 'text' | 'image'
  text: string | null
  imagePath: string | null
  pinned: boolean
  at: number
  /** "Card number", "API key"... when the text looks like a secret. */
  sensitive?: string | null
  expiresAt?: number | null
}
interface Snippet {
  id: string
  title: string
  text: string
  createdMs: number
}
interface Options {
  skipSensitive: boolean
  expireSecs: number
}

type Filter = 'all' | 'text' | 'link' | 'image' | 'code' | 'pinned' | 'secret' | 'snippets'
type Flavour = 'image' | 'link' | 'colour' | 'code' | 'number' | 'text'

/* ── what was copied ─────────────────────────────────────────────── */

function flavourOf(i: ClipItem): Flavour {
  if (i.kind === 'image') return 'image'
  const t = (i.text ?? '').trim()
  if (/^(https?:\/\/|www\.)\S+$/i.test(t)) return 'link'
  if (/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(t) || /^(rgb|hsl)a?\([^)]+\)$/i.test(t)) return 'colour'
  if (/^-?[\d\s,.]+%?$/.test(t) && /\d/.test(t) && t.length < 24) return 'number'
  if (/[{};]\s*$|=>|^\s*(const|let|var|function|import|class|def|SELECT|<\w+)/m.test(t) && t.includes('\n')) return 'code'
  return 'text'
}
const LABEL: Record<Flavour, string> = { image: 'Image', link: 'Link', colour: 'Colour', code: 'Code', number: 'Number', text: 'Text' }

function Ico({ d, size = 15, className }: { d: string; size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" className={cn('shrink-0', className)} aria-hidden>
      <path d={d} />
    </svg>
  )
}
const P = {
  text: 'M3 4.5h10M3 8h10M3 11.5h6',
  link: 'M6.5 9.5l3-3M7 4.5l.8-.8a2.5 2.5 0 0 1 3.5 3.5l-.8.8M9 11.5l-.8.8a2.5 2.5 0 0 1-3.5-3.5l.8-.8',
  image: 'M2.5 3h11v10h-11zM2.5 11l3.5-3.5 3 3 2-2 2.5 2.5M10.5 6.2h.01',
  code: 'M6 4.5 2.5 8 6 11.5M10 4.5 13.5 8 10 11.5',
  colour: 'M8 2.5c2.6 2.6 4 4.4 4 6.3a4 4 0 0 1-8 0c0-1.9 1.4-3.7 4-6.3Z',
  number: 'M5.5 3 4.5 13M11.5 3l-1 10M3 6h10M3 10h10',
  pin: 'M6 2.5h4l-.5 4 2 2v1.5h-7V8.5l2-2zM8 10v3.5',
  search: 'M7 12A5 5 0 1 0 7 2a5 5 0 0 0 0 10ZM10.6 10.6 14 14',
  copy: 'M5.5 5.5h8v8h-8zM10.5 5.5v-3h-8v8h3',
  trash: 'M2.5 4.5h11M6 4.5V3h4v1.5M4 4.5l.7 9h6.6l.7-9',
  shield: 'M8 1.8 13 3.6v4.1c0 3-2 5.2-5 6.5-3-1.3-5-3.5-5-6.5V3.6z',
  eye: 'M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8ZM8 9.8a1.8 1.8 0 1 0 0-3.6 1.8 1.8 0 0 0 0 3.6Z',
  plus: 'M8 3v10M3 8h10',
  bolt: 'M9 1.8 3.5 9H8l-1 5.2L12.5 7H8z',
  note: 'M3 2.5h10v11H3zM5.5 6h5M5.5 8.5h5M5.5 11h3',
  scan: 'M2.5 5.5v-3h3M10.5 2.5h3v3M13.5 10.5v3h-3M5.5 13.5h-3v-3M5 8h6',
  list: 'M3 4h10M3 8h10M3 12h10',
}
const FLAVOUR_ICON: Record<Flavour, string> = { text: P.text, link: P.link, image: P.image, code: P.code, colour: P.colour, number: P.number }

const dayLabel = (ms: number) => {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  if (ms >= start) return 'Today'
  if (ms >= start - 86_400_000) return 'Yesterday'
  if (ms >= start - 6 * 86_400_000) return new Date(ms).toLocaleDateString(undefined, { weekday: 'long' })
  return new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })
}
const timeOf = (ms: number) => new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })

/* ── transforms on text ──────────────────────────────────────────── */

const TRANSFORMS: [string, (t: string) => string][] = [
  ['UPPERCASE', (t) => t.toUpperCase()],
  ['lowercase', (t) => t.toLowerCase()],
  ['Title Case', (t) => t.toLowerCase().replace(/(^|[\s_-])(\p{L})/gu, (_, a, b) => a + b.toUpperCase())],
  ['Trim spaces on each line', (t) => t.split('\n').map((l) => l.trim()).join('\n').trim()],
  ['Remove line breaks', (t) => t.replace(/\s*\n+\s*/g, ' ').trim()],
  ['Sort lines A to Z', (t) => t.split('\n').sort((a, b) => a.localeCompare(b)).join('\n')],
  ['Remove duplicate lines', (t) => [...new Set(t.split('\n'))].join('\n')],
  ['Format JSON', (t) => JSON.stringify(JSON.parse(t), null, 2)],
  ['URL decode', (t) => decodeURIComponent(t)],
  ['URL encode', (t) => encodeURIComponent(t)],
  ['Base64 encode', (t) => btoa(unescape(encodeURIComponent(t)))],
  ['Base64 decode', (t) => decodeURIComponent(escape(atob(t.trim())))],
]

const expand = (t: string) => t.replace(/\{date\}/g, new Date().toLocaleDateString()).replace(/\{time\}/g, new Date().toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })).replace(/\{day\}/g, new Date().toLocaleDateString(undefined, { weekday: 'long' }))

const uid = () => (crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)).replace(/[^a-zA-Z0-9-]/g, '')

/**
 * CLIPBOARD. Everything you copy, searchable and kept in order; the things you reuse saved as snippets.
 * Passwords, card numbers and keys are spotted when they are copied: they are masked here, can be set to
 * clear themselves after a while, or never kept at all. Images can have their text read out (offline).
 *   Up / Down choose    Enter copies    P pins    Delete removes    / searches
 */
export function ClipboardApp(_props: { onClose: () => void }) {
  const [items, setItems] = useState<ClipItem[]>([])
  const [snippets, setSnippets] = useState<Snippet[]>([])
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [selId, setSelId] = useState<string | null>(null)
  const [revealed, setRevealed] = useState<Set<string>>(new Set())
  const [options, setOptionsState] = useState<Options>({ skipSensitive: false, expireSecs: 0 })
  const [optionsOpen, setOptionsOpen] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [ocr, setOcr] = useState<{ id: string; text: string | null; error?: string } | null>(null)
  const [editing, setEditing] = useState<Snippet | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const openMenu = useShellMenu()

  const say = useCallback((t: string) => {
    setToast(t)
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 2600)
  }, [])

  const load = useCallback(() => void invoke<ClipItem[]>('clip_history_list').then(setItems, () => {}), [])
  useEffect(() => {
    load()
    void invoke<Options>('clip_get_options').then(setOptionsState, () => {})
    void invoke<string>('clip_snippets_get').then((raw) => {
      try {
        setSnippets(raw ? (JSON.parse(raw) as Snippet[]) : [])
      } catch {
        setSnippets([])
      }
    }, () => {})
    const a = listen('clipboard://changed', load)
    const b = listen<string | null>('clipboard://skipped', (e) => say(`Didn’t keep it: it looks like a ${(e.payload ?? 'secret').toLowerCase()}`))
    return () => {
      void a.then((f) => f())
      void b.then((f) => f())
    }
  }, [load, say])

  const saveSnippets = (next: Snippet[]) => {
    setSnippets(next)
    void invoke('clip_snippets_set', { json: JSON.stringify(next) }).catch(() => say('Couldn’t save the snippets'))
  }
  const setOptions = (o: Options) => {
    setOptionsState(o)
    void invoke('clip_set_options', { skipSensitive: o.skipSensitive, expireSecs: o.expireSecs })
  }

  /* ── what is shown ─────────────────────────────────────────────── */

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: items.length, text: 0, link: 0, image: 0, code: 0, pinned: 0, secret: 0 }
    for (const i of items) {
      const f = flavourOf(i)
      if (f === 'link') c.link++
      else if (f === 'image') c.image++
      else if (f === 'code') c.code++
      else c.text++
      if (i.pinned) c.pinned++
      if (i.sensitive) c.secret++
    }
    return c
  }, [items])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return items.filter((i) => {
      const f = flavourOf(i)
      if (filter === 'pinned' && !i.pinned) return false
      if (filter === 'secret' && !i.sensitive) return false
      if (filter === 'image' && f !== 'image') return false
      if (filter === 'link' && f !== 'link') return false
      if (filter === 'code' && f !== 'code') return false
      if (filter === 'text' && (f === 'image' || f === 'link' || f === 'code')) return false
      // Secrets are not searchable by their content: searching must not reveal them.
      if (q && (i.sensitive || !(i.text ?? '').toLowerCase().includes(q))) return false
      return true
    })
  }, [items, filter, query])

  const groups = useMemo(() => {
    const pinned = shown.filter((i) => i.pinned)
    const rest = shown.filter((i) => !i.pinned)
    const out: { label: string; list: ClipItem[] }[] = []
    if (pinned.length && filter !== 'pinned') out.push({ label: 'Pinned', list: pinned })
    for (const i of filter === 'pinned' ? shown : rest) {
      const l = dayLabel(i.at)
      const last = out[out.length - 1]
      if (last && last.label === l) last.list.push(i)
      else out.push({ label: l, list: [i] })
    }
    return out
  }, [shown, filter])
  const flat = useMemo(() => groups.flatMap((g) => g.list), [groups])
  const sel = items.find((i) => i.id === selId) ?? null

  useEffect(() => {
    if (filter !== 'snippets' && flat.length && !flat.some((i) => i.id === selId)) setSelId(flat[0].id)
  }, [flat, selId, filter])
  useEffect(() => setOcr(null), [selId])

  /* ── actions ───────────────────────────────────────────────────── */

  const copy = useCallback(
    async (i: ClipItem) => {
      try {
        await invoke('clip_history_copy', { id: i.id })
        say(i.sensitive ? 'Copied. It will be cleared from here soon.' : 'Copied')
      } catch {
        say('Couldn’t copy that')
      }
    },
    [say],
  )
  const pin = (i: ClipItem) => void invoke('clip_history_pin', { id: i.id, pinned: !i.pinned })
  const remove = (i: ClipItem) => void invoke('clip_history_delete', { id: i.id })
  const copyText = async (t: string, msg = 'Copied') => {
    try {
      await navigator.clipboard.writeText(t)
      say(msg)
    } catch {
      say('Couldn’t copy that')
    }
  }
  const runOcr = async (i: ClipItem) => {
    setOcr({ id: i.id, text: null })
    try {
      const t = await invoke<string>('clip_ocr', { id: i.id })
      setOcr({ id: i.id, text: t.trim() })
    } catch (e) {
      setOcr({ id: i.id, text: null, error: typeof e === 'string' ? e : 'Couldn’t read the text.' })
    }
  }
  const transformMenu = (e: React.MouseEvent, i: ClipItem) =>
    openMenu(e, TRANSFORMS.map(([label, fn]) => ({
      label,
      onSelect: () => {
        try {
          void copyText(fn(i.text ?? ''), `Copied as “${label}”`)
        } catch {
          say(`Couldn’t apply “${label}” to this text`)
        }
      },
    })))

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      const typing = t.tagName === 'INPUT' || t.tagName === 'TEXTAREA'
      if (e.key === '/' && !typing) return void (e.preventDefault(), searchRef.current?.focus())
      if (typing || filter === 'snippets') return
      const i = flat.findIndex((x) => x.id === selId)
      if (e.key === 'ArrowDown') (e.preventDefault(), flat[i + 1] && setSelId(flat[i + 1].id))
      else if (e.key === 'ArrowUp') (e.preventDefault(), flat[i - 1] && setSelId(flat[i - 1].id))
      else if (e.key === 'Enter' && sel) (e.preventDefault(), void copy(sel))
      else if (e.key.toLowerCase() === 'p' && sel) pin(sel)
      else if (e.key === 'Delete' && sel) (remove(sel), flat[i + 1] ? setSelId(flat[i + 1].id) : flat[i - 1] && setSelId(flat[i - 1].id))
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [flat, selId, sel, copy, filter])

  const FILTERS: [Filter, string, string][] = [
    ['all', 'All', P.list],
    ['text', 'Text', P.text],
    ['link', 'Links', P.link],
    ['image', 'Images', P.image],
    ['code', 'Code', P.code],
    ['pinned', 'Pinned', P.pin],
    ['secret', 'Sensitive', P.shield],
    ['snippets', 'Snippets', P.bolt],
  ]

  const masked = (i: ClipItem) => !!i.sensitive && !revealed.has(i.id)

  return (
    <div className="relative flex h-full text-(--u-ink)">
      <nav className="flex w-[190px] shrink-0 flex-col gap-0.5 border-r border-(--u-edge) px-2.5 py-4">
        <h1 className="px-2.5 pb-3 text-[18px] font-semibold tracking-tight">Clipboard</h1>
        {FILTERS.map(([id, label, icon]) => (
          <button key={id} type="button" onClick={() => setFilter(id)} className={cn('flex h-[32px] items-center gap-2.5 rounded-[8px] px-2.5 text-left text-[13px]', filter === id ? 'bg-(--u-wash-on) font-medium' : 'text-(--u-ink-2) hover:bg-(--u-wash-hover) hover:text-(--u-ink)')}>
            <Ico d={icon} size={14} />
            <span className="flex-1">{label}</span>
            <span className="text-[11px] tabular-nums text-(--u-ink-3)">{id === 'snippets' ? snippets.length || '' : counts[id] || ''}</span>
          </button>
        ))}
        <button type="button" onClick={() => setOptionsOpen(true)} className="mt-auto flex h-[32px] items-center gap-2.5 rounded-[8px] px-2.5 text-left text-[13px] text-(--u-ink-2) hover:bg-(--u-wash-hover) hover:text-(--u-ink)">
          <Ico d={P.shield} size={14} /> Privacy
          {(options.skipSensitive || options.expireSecs > 0) && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-(--u-accent)" />}
        </button>
      </nav>

      {filter === 'snippets' ? (
        <SnippetsPane snippets={snippets} editing={editing} setEditing={setEditing} onSave={saveSnippets} onCopy={(s) => void copyText(expand(s.text), 'Snippet copied')} />
      ) : (
        <>
          <section className="flex w-[380px] shrink-0 flex-col border-r border-(--u-edge)">
            <header className="flex items-center gap-2 border-b border-(--u-edge) px-3 py-3">
              <label className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-[8px] bg-(--u-wash-hover) px-2.5 shadow-[inset_0_0_0_1px_var(--u-edge)] focus-within:shadow-[inset_0_0_0_1.5px_var(--u-accent)]">
                <Ico d={P.search} size={13} className="text-(--u-ink-3)" />
                <input ref={searchRef} value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && (setQuery(''), e.currentTarget.blur())} placeholder="Search what you copied  ( / )" className="min-w-0 flex-1 bg-transparent text-[12.5px] outline-none placeholder:text-(--u-ink-3)" />
              </label>
              <Button size="sm" variant="ghost" disabled={!items.some((i) => !i.pinned)} onClick={() => void invoke('clip_history_delete', { id: null })} title="Clear everything that isn't pinned">
                Clear
              </Button>
            </header>
            <div className="u-scroll min-h-0 flex-1 overflow-y-auto px-2 pb-3">
              {flat.length === 0 && (
                <p className="px-4 pt-16 text-center text-[13px] leading-relaxed text-(--u-ink-3)">{items.length === 0 ? 'Anything you copy appears here, newest first.' : query ? 'Nothing matches.' : 'Nothing in this view.'}</p>
              )}
              {groups.map((g) => (
                <div key={g.label}>
                  <p className="px-2.5 pb-1 pt-3 text-[11px] font-semibold text-(--u-ink-3)">{g.label}</p>
                  {g.list.map((i) => {
                    const f = flavourOf(i)
                    return (
                      <button key={i.id} type="button" onClick={() => setSelId(i.id)} onDoubleClick={() => void copy(i)} className={cn('mb-px flex w-full items-center gap-3 rounded-[9px] px-2.5 py-2 text-left', selId === i.id ? 'bg-(--u-wash-on)' : 'hover:bg-(--u-wash-hover)')}>
                        {f === 'image' && i.imagePath ? <img src={convertFileSrc(i.imagePath)} alt="" className="h-9 w-12 shrink-0 rounded-[5px] object-cover" /> : <Ico d={i.sensitive ? P.shield : FLAVOUR_ICON[f]} className={cn('text-(--u-ink-3)', i.sensitive && 'text-[#d9a13b]')} />}
                        <span className="min-w-0 flex-1">
                          <span className={cn('line-clamp-2 break-all text-[12.5px] leading-snug', masked(i) && 'tracking-widest text-(--u-ink-3)')}>
                            {i.sensitive ? (masked(i) ? `•••••••• ${i.sensitive}` : (i.text ?? '')) : f === 'image' ? 'Image' : (i.text ?? '').trim().slice(0, 200)}
                          </span>
                          <span className="text-[11px] text-(--u-ink-3)">
                            {timeOf(i.at)} · {i.sensitive ?? LABEL[f]}
                            {i.expiresAt ? ` · clears in ${Math.max(1, Math.round((i.expiresAt - Date.now()) / 60_000))} min` : ''}
                          </span>
                        </span>
                        {i.pinned && <Ico d={P.pin} size={12} className="text-(--u-accent)" />}
                      </button>
                    )
                  })}
                </div>
              ))}
            </div>
          </section>

          <section className="flex min-w-0 flex-1 flex-col">
            {!sel ? (
              <p className="m-auto text-[13px] text-(--u-ink-3)">Select something to see it here.</p>
            ) : (
              <>
                <header className="flex items-center gap-1.5 border-b border-(--u-edge) px-4 py-3">
                  <Button variant="accent" size="sm" onClick={() => void copy(sel)}>
                    <Ico d={P.copy} size={13} /> Copy
                  </Button>
                  <Button size="sm" variant="tinted" onClick={() => pin(sel)}>
                    <Ico d={P.pin} size={13} /> {sel.pinned ? 'Unpin' : 'Pin'}
                  </Button>
                  {sel.kind === 'text' && !sel.sensitive && (
                    <>
                      <Button size="sm" variant="tinted" onClick={(e) => transformMenu(e, sel)} title="Copy it changed: upper case, JSON, Base64...">
                        <Ico d={P.bolt} size={13} /> Copy as…
                      </Button>
                      <Button size="sm" variant="tinted" onClick={() => (saveSnippets([{ id: uid(), title: (sel.text ?? '').trim().split('\n')[0].slice(0, 40) || 'Snippet', text: sel.text ?? '', createdMs: Date.now() }, ...snippets]), say('Saved as a snippet'))}>
                        <Ico d={P.note} size={13} /> Save as snippet
                      </Button>
                    </>
                  )}
                  {sel.kind === 'image' && (
                    <Button size="sm" variant="tinted" disabled={ocr?.id === sel.id && ocr.text === null && !ocr.error} onClick={() => void runOcr(sel)} title="Read the text in this picture">
                      <Ico d={P.scan} size={13} /> {ocr?.id === sel.id && ocr.text === null && !ocr.error ? 'Reading…' : 'Extract text'}
                    </Button>
                  )}
                  <span className="flex-1" />
                  <Button icon size="sm" aria-label="Delete" title="Delete (Del)" onClick={() => remove(sel)} className="hover:text-(--u-danger)">
                    <Ico d={P.trash} size={14} />
                  </Button>
                </header>
                <div className="u-scroll min-h-0 flex-1 overflow-y-auto p-5">
                  {sel.sensitive && (
                    <div className="mb-4 flex items-center gap-3 rounded-[10px] bg-[color-mix(in_srgb,#d9a13b_13%,transparent)] px-4 py-2.5 text-[12.5px] text-(--u-ink-2)">
                      <Ico d={P.shield} size={15} className="text-[#d9a13b]" />
                      <span className="flex-1">This looks like a {sel.sensitive.toLowerCase()}, so it is hidden.</span>
                      <button type="button" onClick={() => setRevealed((r) => { const n = new Set(r); if (n.has(sel.id)) n.delete(sel.id); else n.add(sel.id); return n })} className="flex items-center gap-1.5 font-medium text-(--u-ink) hover:underline">
                        <Ico d={P.eye} size={14} /> {revealed.has(sel.id) ? 'Hide' : 'Show'}
                      </button>
                    </div>
                  )}
                  {sel.kind === 'image' && sel.imagePath ? (
                    <>
                      <img src={convertFileSrc(sel.imagePath)} alt="" className="max-h-[60vh] max-w-full rounded-[10px] bg-(--u-wash-hover) object-contain" />
                      {ocr?.id === sel.id && (ocr.error ? <p className="mt-4 text-[12.5px] text-(--u-danger)">{ocr.error}</p> : ocr.text !== null && (
                        <div className="mt-4 rounded-[12px] bg-(--u-wash-hover) p-4 shadow-[inset_0_0_0_1px_var(--u-edge)]">
                          <div className="mb-2 flex items-center justify-between">
                            <span className="text-[12px] font-semibold text-(--u-ink-3)">Text in the image</span>
                            {ocr.text && <Button size="sm" variant="tinted" onClick={() => void copyText(ocr.text!, 'Text copied')}>Copy text</Button>}
                          </div>
                          <p className="select-text whitespace-pre-wrap text-[13.5px] leading-relaxed">{ocr.text || 'No text was found in this picture.'}</p>
                        </div>
                      ))}
                    </>
                  ) : masked(sel) ? (
                    <p className="select-none text-[20px] tracking-[0.3em] text-(--u-ink-3)">••••••••••••</p>
                  ) : flavourOf(sel) === 'colour' ? (
                    <div className="flex items-center gap-4">
                      <span className="h-16 w-16 rounded-[12px] shadow-[inset_0_0_0_1px_var(--u-edge)]" style={{ background: (sel.text ?? '').trim() }} />
                      <p className="select-text font-mono text-[15px]">{(sel.text ?? '').trim()}</p>
                    </div>
                  ) : flavourOf(sel) === 'link' ? (
                    <button type="button" onClick={() => void launchApp((sel.text ?? '').trim()).catch(() => {})} className="select-text break-all text-left text-[14px] text-(--u-accent) underline decoration-[0.5px] underline-offset-2">
                      {(sel.text ?? '').trim()}
                    </button>
                  ) : (
                    <pre className={cn('select-text whitespace-pre-wrap break-words text-[13.5px] leading-relaxed', flavourOf(sel) === 'code' && 'rounded-[10px] bg-(--u-wash-hover) p-4 font-mono text-[12.5px]')}>{sel.text}</pre>
                  )}
                </div>
                <footer className="flex shrink-0 gap-4 border-t border-(--u-edge) px-5 py-2.5 text-[11.5px] text-(--u-ink-3)">
                  <span>{new Date(sel.at).toLocaleString()}</span>
                  <span>{sel.kind === 'image' ? 'Image' : `${(sel.text ?? '').length.toLocaleString()} characters · ${((sel.text ?? '').trim().split(/\s+/).filter(Boolean).length).toLocaleString()} words`}</span>
                </footer>
              </>
            )}
          </section>
        </>
      )}

      {optionsOpen && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/45 p-6" onPointerDown={(e) => e.target === e.currentTarget && setOptionsOpen(false)}>
          <div className="w-[440px] max-w-full rounded-[14px] bg-(--u-m-solid) p-5 shadow-[inset_0_0_0_1px_var(--u-edge)]">
            <h2 className="text-[15px] font-semibold">Privacy</h2>
            <p className="mt-1 text-[12.5px] leading-relaxed text-(--u-ink-3)">Clipboard spots card numbers, private keys, login tokens, API keys and passwords the moment they are copied.</p>
            <label className="mt-5 flex items-center gap-4">
              <span className="flex-1">
                <span className="block text-[13px] font-medium">Never keep them</span>
                <span className="block text-[12px] text-(--u-ink-3)">They still paste normally; they just aren’t saved here.</span>
              </span>
              <Switch checked={options.skipSensitive} onChange={(v) => setOptions({ ...options, skipSensitive: v })} label="Never keep sensitive items" />
            </label>
            <div className={cn('mt-5', options.skipSensitive && 'opacity-40')}>
              <span className="block text-[13px] font-medium">Clear them after</span>
              <div className="mt-2">
                <Segmented
                  value={String(options.expireSecs)}
                  onChange={(v) => setOptions({ ...options, expireSecs: Number(v) })}
                  options={[{ value: '0', label: 'Never' }, { value: '60', label: '1 min' }, { value: '600', label: '10 min' }, { value: '3600', label: '1 hour' }]}
                />
              </div>
            </div>
            <div className="mt-6 flex justify-end">
              <Button variant="accent" onClick={() => setOptionsOpen(false)}>
                Done
              </Button>
            </div>
          </div>
        </div>
      )}
      {toast && <div className="pointer-events-none absolute bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-[10px] bg-(--u-m-solid-hi) px-4 py-2 text-[12.5px] shadow-[inset_0_0_0_1px_var(--u-edge)]">{toast}</div>}
    </div>
  )
}

/* ── snippets ────────────────────────────────────────────────────── */

function SnippetsPane({ snippets, editing, setEditing, onSave, onCopy }: { snippets: Snippet[]; editing: Snippet | null; setEditing: (s: Snippet | null) => void; onSave: (l: Snippet[]) => void; onCopy: (s: Snippet) => void }) {
  const cur = editing && (snippets.find((s) => s.id === editing.id) ?? editing)
  const upsert = (s: Snippet) => onSave(snippets.some((x) => x.id === s.id) ? snippets.map((x) => (x.id === s.id ? s : x)) : [s, ...snippets])
  return (
    <>
      <section className="flex w-[300px] shrink-0 flex-col border-r border-(--u-edge)">
        <header className="flex items-center justify-between border-b border-(--u-edge) px-4 py-3">
          <span className="text-[13px] font-semibold">Snippets</span>
          <Button size="sm" variant="tinted" onClick={() => setEditing({ id: uid(), title: '', text: '', createdMs: Date.now() })}>
            <Ico d={P.plus} size={13} /> New
          </Button>
        </header>
        <div className="u-scroll min-h-0 flex-1 overflow-y-auto p-2">
          {snippets.length === 0 && <p className="px-3 pt-14 text-center text-[12.5px] leading-relaxed text-(--u-ink-3)">Save the things you paste again and again: an address, a reply, a signature. Use {'{date}'} or {'{time}'} and they fill in when you copy.</p>}
          {snippets.map((s) => (
            <button key={s.id} type="button" onClick={() => setEditing(s)} className={cn('mb-px flex w-full flex-col gap-0.5 rounded-[9px] px-3 py-2 text-left', cur?.id === s.id ? 'bg-(--u-wash-on)' : 'hover:bg-(--u-wash-hover)')}>
              <span className="truncate text-[13px] font-medium">{s.title || 'Untitled'}</span>
              <span className="line-clamp-2 text-[11.5px] text-(--u-ink-3)">{s.text}</span>
            </button>
          ))}
        </div>
      </section>
      <section className="flex min-w-0 flex-1 flex-col">
        {!cur ? (
          <p className="m-auto text-[13px] text-(--u-ink-3)">Choose a snippet, or make a new one.</p>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-3 p-5">
            <input value={cur.title} onChange={(e) => (setEditing({ ...cur, title: e.target.value }), upsert({ ...cur, title: e.target.value }))} placeholder="Name" className="u-field h-9 text-[14px] font-medium" />
            <textarea value={cur.text} onChange={(e) => (setEditing({ ...cur, text: e.target.value }), upsert({ ...cur, text: e.target.value }))} placeholder="The text to paste. {date} and {time} fill in when you copy." className="u-field min-h-0 flex-1 resize-none py-2.5 text-[13.5px] leading-relaxed" />
            <div className="flex items-center gap-2">
              <Button variant="accent" disabled={!cur.text} onClick={() => onCopy(cur)}>
                <Ico d={P.copy} size={13} /> Copy
              </Button>
              <span className="flex-1" />
              <Button variant="danger" onClick={() => (onSave(snippets.filter((s) => s.id !== cur.id)), setEditing(null))}>
                Delete
              </Button>
            </div>
          </div>
        )}
      </section>
    </>
  )
}
