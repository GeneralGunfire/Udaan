import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { Button } from '@/os/ui/controls'
import { cn } from '@/shared/lib/cn'
import { fs } from './api'
import { kindOf, type Kind } from './model'
import { askBus, progressBus, toastBus, type Ask } from './ops'

/* ── icons ───────────────────────────────────────────────────────── */

/** A small line icon, 16px grid. */
export function Glyph({ d, size = 16, className, fill }: { d: string; size?: number; className?: string; fill?: boolean }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} fill={fill ? 'currentColor' : 'none'} stroke={fill ? 'none' : 'currentColor'} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" className={cn('shrink-0', className)} aria-hidden>
      <path d={d} />
    </svg>
  )
}
export const G = {
  back: 'M10 3.5 5.5 8l4.5 4.5',
  fwd: 'M6 3.5 10.5 8 6 12.5',
  up: 'M8 13V3.5M4 7.5l4-4 4 4',
  plus: 'M8 3v10M3 8h10',
  search: 'M7 12A5 5 0 1 0 7 2a5 5 0 0 0 0 10ZM10.6 10.6 14 14',
  list: 'M5.5 4h8M5.5 8h8M5.5 12h8M2.5 4h.01M2.5 8h.01M2.5 12h.01',
  grid: 'M2.5 2.5h4.5v4.5H2.5zM9 2.5h4.5v4.5H9zM2.5 9h4.5v4.5H2.5zM9 9h4.5v4.5H9z',
  split: 'M2.5 3h11v10h-11zM8 3v10',
  info: 'M8 14.5A6.5 6.5 0 1 0 8 1.5a6.5 6.5 0 0 0 0 13ZM8 7.3V11M8 5h.01',
  sidebar: 'M2.5 3h11v10h-11zM6 3v10',
  more: 'M3.5 8h.01M8 8h.01M12.5 8h.01',
  close: 'M4 4l8 8M12 4l-8 8',
  chevron: 'M6 4l4 4-4 4',
  chevronDown: 'M4 6l4 4 4-4',
  star: 'M8 2.2l1.8 3.7 4 .6-2.9 2.8.7 4L8 11.4l-3.6 1.9.7-4L2.2 6.5l4-.6z',
  clock: 'M8 14.5A6.5 6.5 0 1 0 8 1.5a6.5 6.5 0 0 0 0 13ZM8 4.5V8l2.5 1.5',
  trash: 'M2.5 4.5h11M6 4.5V3h4v1.5M4 4.5l.7 9h6.6l.7-9',
  copies: 'M5.5 5.5h8v8h-8zM10.5 5.5v-3h-8v8h3',
  drive: 'M2 9.5h12v3.5H2zM3.5 9.5 5 3h6l1.5 6.5M11.5 11.3h.01',
  home: 'M2.5 7.5 8 3l5.5 4.5M4 6.5V13h3V9.5h2V13h3V6.5',
  desktop: 'M2 3h12v8H2zM6 14h4M8 11v3',
  doc: 'M4 1.8h5l3 3V14.2H4zM9 1.8v3h3',
  download: 'M8 2.5v8M4.5 7 8 10.5 11.5 7M3 13.5h10',
  picture: 'M2.5 3h11v10h-11zM2.5 11l3.5-3.5 3 3 2-2 2.5 2.5M10.5 6.2h.01',
  music: 'M6 12.5V3.5l7-1.5v9M6 12.5a1.8 1.8 0 1 1-3.6 0 1.8 1.8 0 0 1 3.6 0ZM13 11a1.8 1.8 0 1 1-3.6 0 1.8 1.8 0 0 1 3.6 0Z',
  video: 'M2 4h9v8H2zM11 7l3-2v6l-3-2',
  tag: 'M2.5 2.5h5l6 6-5 5-6-6zM5.3 5.3h.01',
  terminal: 'M2.5 3h11v10h-11zM5 6.5 7 8.5 5 10.5M8.5 10.5h3',
  archive: 'M2.5 3h11v3h-11zM3.5 6v7h9V6M6.5 8.5h3',
  undo: 'M5 3 2.5 5.5 5 8M2.5 5.5H10a3.5 3.5 0 0 1 0 7H6.5',
  redo: 'M11 3l2.5 2.5L11 8M13.5 5.5H6a3.5 3.5 0 0 0 0 7h3.5',
  folder: 'M1.8 4.2V12.8h12.4V5.6H7.6L6.2 3.4H1.8z',
  refresh: 'M13 8a5 5 0 1 1-1.5-3.5M13 2.5v3h-3',
  play: 'M5 3.5v9l7-4.5z',
  check: 'M3.5 8.5 6.5 11.5 12.5 4.5',
}

const PLACE_GLYPH: Record<string, string> = { home: G.home, desktop: G.desktop, documents: G.doc, downloads: G.download, pictures: G.picture, music: G.music, videos: G.video }
export const placeGlyph = (id: string) => PLACE_GLYPH[id] ?? G.folder

const KIND_TINT: Partial<Record<Kind, string>> = {
  image: '#3fa36b', video: '#c0563f', audio: '#c46aa5', pdf: '#d0463e', doc: '#3d78d8', sheet: '#2f9a5a', slides: '#d06a33', archive: '#a8873a', code: '#7a77d6', app: '#5e8fb0',
}

/** Folder: a filled folder in the accent. File: a page with its extension on it. Scales from 16 to 96px. */
export function FileIcon({ ext, isDir, size = 18, open }: { ext: string; isDir: boolean; size?: number; open?: boolean }) {
  if (isDir)
    return (
      <svg viewBox="0 0 32 32" width={size} height={size} className="shrink-0" aria-hidden>
        <path d="M3 8.5A2.5 2.5 0 0 1 5.5 6h6.4l2.6 2.8h12A2.5 2.5 0 0 1 29 11.3v13.2a2.5 2.5 0 0 1-2.5 2.5h-21A2.5 2.5 0 0 1 3 24.5z" fill="#2a5fc4" />
        <path d={open ? 'M5 13.5A2 2 0 0 1 7 12h21.4a1.2 1.2 0 0 1 1.1 1.6l-3.6 11.8a2.4 2.4 0 0 1-2.3 1.6H5.5A2.5 2.5 0 0 1 3 24.5z' : 'M3 12.3A2 2 0 0 1 5 10.3h22a2 2 0 0 1 2 2v12.2a2.5 2.5 0 0 1-2.5 2.5h-21A2.5 2.5 0 0 1 3 24.5z'} fill="#3d7ff2" />
      </svg>
    )
  const kind = kindOf(ext, false)
  const tint = KIND_TINT[kind]
  const label = ext.slice(0, 4).toUpperCase()
  const showLabel = size >= 30 && label
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} className="shrink-0" aria-hidden>
      <path d="M7.5 3h11.2L26 10.3v16.2A2.5 2.5 0 0 1 23.5 29h-16A2.5 2.5 0 0 1 5 26.5v-21A2.5 2.5 0 0 1 7.5 3z" fill="#d9dde4" />
      <path d="M18.7 3v5.3a2 2 0 0 0 2 2H26z" fill="#b4bac5" />
      {tint && <rect x="5" y={showLabel ? 19 : 22} width="21" height={showLabel ? 7.5 : 4.5} fill={tint} />}
      {showLabel && (
        <text x="15.5" y="25" textAnchor="middle" fontSize={label.length > 3 ? 5.2 : 6} fontWeight="700" fontFamily="Montserrat, Segoe UI, sans-serif" fill={tint ? '#fff' : '#596273'}>
          {label}
        </text>
      )}
    </svg>
  )
}

/** A thumbnail for images (cached on disk by Rust), the icon for everything else. Only asks once it is on screen. */
export function Thumb({ path, ext, isDir, size, inner }: { path: string; ext: string; isDir: boolean; size: number; inner?: boolean }) {
  const [src, setSrc] = useState<string | null>(null)
  const isImage = !isDir && !inner && kindOf(ext, false) === 'image' && ext !== 'svg' && ext !== 'ico' && ext !== 'heic' && ext !== 'avif'
  useEffect(() => {
    setSrc(null)
    if (!isImage) return
    let live = true
    const t = setTimeout(() => void fs.thumb(path, size > 140 ? 512 : 256).then((s) => live && setSrc(s), () => {}), 60)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [path, isImage, size])
  if (src) return <img src={src} alt="" draggable={false} decoding="async" className="max-h-full max-w-full rounded-[4px] object-contain shadow-[0_1px_2px_rgba(0,0,0,.35)]" style={{ maxWidth: size, maxHeight: size }} />
  return <FileIcon ext={ext} isDir={isDir} size={Math.round(size * 0.78)} />
}

export function TagDot({ color, size = 8 }: { color: string; size?: number }) {
  return <span className="inline-block shrink-0 rounded-full" style={{ width: size, height: size, background: color }} />
}

/* ── hooks for the ops buses ─────────────────────────────────────── */

export const useBus = <T,>(b: { get: () => T; subscribe: (s: () => void) => () => void }) => useSyncExternalStore(b.subscribe, b.get, b.get)

/* ── dialog ──────────────────────────────────────────────────────── */

export function Modal({ children, onClose, width = 420, className }: { children: ReactNode; onClose: () => void; width?: number; className?: string }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && (e.stopPropagation(), onClose())
    window.addEventListener('keydown', k, true)
    return () => window.removeEventListener('keydown', k, true)
  }, [onClose])
  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/45 p-6" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" className={cn('u-surface flex max-h-full flex-col overflow-hidden rounded-[14px] bg-(--u-m-solid) shadow-[inset_0_0_0_1px_var(--u-edge)]', className)} style={{ width, maxWidth: '100%' }}>
        {children}
      </div>
    </div>
  )
}

export function AskHost() {
  const a = useBus(askBus)
  return a ? <AskDialog a={a} /> : null
}
function AskDialog({ a }: { a: Ask }) {
  const [text, setText] = useState(a.input?.value ?? '')
  const ref = useRef<HTMLInputElement>(null)
  const def = a.choices[a.choices.length - 1]
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.focus()
    if (a.input?.select) el.setSelectionRange(...a.input.select)
    else el.select()
  }, [a])
  return (
    <Modal onClose={() => a.resolve(null)}>
      <form
        className="flex flex-col gap-4 p-5"
        onSubmit={(e) => {
          e.preventDefault()
          a.resolve({ value: def.value, text })
        }}
      >
        <div>
          <h2 className="text-[15px] font-semibold">{a.title}</h2>
          {a.body && <p className="mt-1.5 text-[13px] leading-relaxed text-(--u-ink-2)">{a.body}</p>}
        </div>
        {a.input && <input ref={ref} value={text} onChange={(e) => setText(e.target.value)} placeholder={a.input.placeholder} className="u-field h-9 w-full" spellCheck={false} />}
        <div className="flex justify-end gap-2">
          {a.choices.map((c, i) =>
            i === a.choices.length - 1 ? (
              <Button key={c.value} type="submit" variant={c.tone === 'danger' ? 'danger-solid' : 'accent'} autoFocus={!a.input}>
                {c.label}
              </Button>
            ) : (
              <Button key={c.value} variant={c.tone === 'danger' ? 'danger' : 'tinted'} onClick={() => a.resolve({ value: c.value, text })}>
                {c.label}
              </Button>
            ),
          )}
        </div>
      </form>
    </Modal>
  )
}

/* ── toasts and progress ─────────────────────────────────────────── */

export function Toasts() {
  const list = useBus(toastBus)
  const prog = useBus(progressBus)
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-10 z-40 flex flex-col items-center gap-2">
      {prog && (
        <div className="pointer-events-auto flex w-[340px] flex-col gap-2 rounded-[12px] bg-(--u-m-solid-hi) px-4 py-3 text-[12.5px] shadow-[inset_0_0_0_1px_var(--u-edge)]">
          <div className="flex justify-between gap-3">
            <span className="truncate">{prog.label}</span>
            {prog.total > 0 && <span className="shrink-0 tabular-nums text-(--u-ink-3)">{prog.done} of {prog.total}</span>}
          </div>
          <div className="h-1 overflow-hidden rounded-full bg-(--u-wash-press)">
            {prog.total > 0 ? <div className="h-full rounded-full bg-(--u-accent) transition-[width] duration-200" style={{ width: `${(prog.done / prog.total) * 100}%` }} /> : <div className="files-indeterminate h-full w-1/3 rounded-full bg-(--u-accent)" />}
          </div>
        </div>
      )}
      {list.map((t) => (
        <div key={t.id} className={cn('pointer-events-auto flex max-w-[460px] items-center gap-3 rounded-[10px] bg-(--u-m-solid-hi) py-2 pl-4 pr-2 text-[12.5px] shadow-[inset_0_0_0_1px_var(--u-edge)]', t.tone === 'danger' && 'text-(--u-danger)')}>
          <span className="min-w-0 flex-1 py-1">{t.text}</span>
          {t.action && (
            <Button size="sm" variant="tinted" onClick={t.action.run}>
              {t.action.label}
            </Button>
          )}
        </div>
      ))}
    </div>
  )
}

/* ── drag layer (pointer-driven; WebView2's HTML5 drag is unreliable with Tauri's drop handler) ── */

export interface DragState {
  paths: string[]
  label: string
  x: number
  y: number
  target: string | null
  copy: boolean
  /** Set when dragging entries out of an archive: dropping extracts them. */
  zip?: string
  inners?: string[]
}
let drag: DragState | null = null
const dragSubs = new Set<() => void>()
export const dragBus = {
  get: () => drag,
  set: (d: DragState | null) => {
    drag = d
    dragSubs.forEach((s) => s())
  },
  subscribe: (s: () => void) => (dragSubs.add(s), () => void dragSubs.delete(s)),
}

/** The folder path under a point, from the nearest `[data-drop]`. */
export function dropTargetAt(x: number, y: number): string | null {
  const el = document.elementFromPoint(x, y) as HTMLElement | null
  return (el?.closest('[data-drop]') as HTMLElement | null)?.dataset.drop ?? null
}

export function DragGhost() {
  const d = useBus(dragBus)
  if (!d) return null
  return (
    <div className="pointer-events-none fixed z-[60] flex items-center gap-2 rounded-[8px] bg-(--u-accent) px-2.5 py-1.5 text-[12px] font-medium text-white" style={{ left: d.x + 14, top: d.y + 10 }}>
      {d.copy && <Glyph d={G.plus} size={12} />}
      {d.label}
    </div>
  )
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded-[4px] bg-(--u-wash-on) px-1.5 py-px font-sans text-[11px] text-(--u-ink-2)">{children}</kbd>
}
