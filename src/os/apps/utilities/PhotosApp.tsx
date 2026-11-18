import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { invoke, convertFileSrc } from '@tauri-apps/api/core'
import { homeDir } from '@tauri-apps/api/path'
import { Duplicates } from '@/features/files/Tools'
import { AskHost, Toasts } from '@/features/files/ui'
import { launchApp } from '@/integrations/installed-apps/client'
import { openWithSystem } from '@/integrations/file-explorer/client'
import { openApp, shell } from '@/os/kernel/shell'
import { useShellMenu } from '@/os/ui/useShellMenu'
import { Button, Slider } from '@/os/ui/controls'
import { cn } from '@/shared/lib/cn'

interface Photo {
  path: string
  folder: string
  modifiedMs: number
  size: number
}
interface Album {
  id: string
  name: string
  paths: string[]
}
interface Exif {
  taken?: string | null
  make?: string | null
  model?: string | null
  lens?: string | null
  exposure?: string | null
  fNumber?: number | null
  iso?: number | null
  focalMm?: number | null
  lat?: number | null
  lon?: number | null
}

type SortKey = 'new' | 'old' | 'name' | 'big'
type View = { k: 'all' } | { k: 'favs' } | { k: 'album'; id: string } | { k: 'folder'; name: string } | { k: 'dupes' }

const thumbCache = new Map<string, string>()
const nameOf = (p: string) => p.split(/[\\/]/).pop() ?? p
const kb = (b: number) => (b >= 1024 ** 2 ? `${(b / 1024 ** 2).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`)
const uid = () => (crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)).replace(/[^a-zA-Z0-9-]/g, '')
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

/* ── favourites and albums, saved to a file ──────────────────────── */

function usePhotoState() {
  const [state, setState] = useState<{ favs: string[]; albums: Album[] }>({ favs: [], albums: [] })
  const loaded = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => {
    void invoke<string>('photos_state_get').then(
      (raw) => {
        try {
          const v = raw ? JSON.parse(raw) : {}
          setState({ favs: v.favs ?? [], albums: v.albums ?? [] })
        } catch {
          /* start empty */
        }
        loaded.current = true
      },
      () => (loaded.current = true),
    )
  }, [])
  const update = useCallback((fn: (s: { favs: string[]; albums: Album[] }) => { favs: string[]; albums: Album[] }) => {
    setState((cur) => {
      const next = fn(cur)
      if (loaded.current) {
        clearTimeout(timer.current)
        timer.current = setTimeout(() => void invoke('photos_state_set', { json: JSON.stringify(next) }).catch(() => {}), 400)
      }
      return next
    })
  }, [])
  return { ...state, update }
}

const Heart = ({ on, size = 14 }: { on: boolean; size?: number }) => (
  <svg viewBox="0 0 16 16" width={size} height={size} fill={on ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" aria-hidden>
    <path d="M8 13.5S2.5 10 2.5 6.1A2.9 2.9 0 0 1 8 5a2.9 2.9 0 0 1 5.5 1.1C13.5 10 8 13.5 8 13.5Z" />
  </svg>
)

/** A thumbnail that only loads when scrolled into view. */
const Thumb = memo(function Thumb({ photo, size, selected, checked, fav, picking, onOpen, onPick }: { photo: Photo; size: number; selected: boolean; checked: boolean; fav: boolean; picking: boolean; onOpen: () => void; onPick: (e: React.MouseEvent) => void }) {
  const ref = useRef<HTMLButtonElement>(null)
  const [src, setSrc] = useState(() => thumbCache.get(photo.path) ?? null)
  useEffect(() => {
    if (src || !ref.current) return
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e.isIntersecting) return
        io.disconnect()
        void invoke<string>('photos_thumb', { path: photo.path, size: 480 }).then(
          (url) => {
            thumbCache.set(photo.path, url)
            setSrc(url)
          },
          () => {},
        )
      },
      { rootMargin: '500px' },
    )
    io.observe(ref.current)
    return () => io.disconnect()
  }, [photo.path, src])
  return (
    <button
      ref={ref}
      type="button"
      title={nameOf(photo.path)}
      onClick={(e) => (picking || e.ctrlKey || e.metaKey || e.shiftKey ? onPick(e) : onOpen())}
      style={{ width: size, height: size }}
      className={cn('group relative overflow-hidden rounded-[8px] bg-(--u-wash-on) outline-none', (selected || checked) && 'shadow-[0_0_0_2px_var(--u-accent)]')}
    >
      {src && <img src={src} alt="" draggable={false} className={cn('h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.04]', checked && 'scale-[0.92] rounded-[6px]')} />}
      <span className="pointer-events-none absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/70 to-transparent px-2 pb-1 pt-4 text-[11px] text-white opacity-0 transition-opacity group-hover:opacity-100">{nameOf(photo.path)}</span>
      {fav && <span className="pointer-events-none absolute right-1.5 top-1.5 text-white drop-shadow"><Heart on size={14} /></span>}
      <span
        role="checkbox"
        aria-checked={checked}
        onClick={(e) => (e.stopPropagation(), onPick(e))}
        className={cn('absolute left-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-white/70 text-[11px] text-white transition-opacity', checked ? 'border-transparent bg-(--u-accent) opacity-100' : 'bg-black/30 opacity-0 group-hover:opacity-100')}
      >
        {checked && '✓'}
      </span>
    </button>
  )
})

/**
 * PHOTOS. Your pictures by month, with albums you make, favourites, folders and a duplicate finder. A viewer with
 * zoom, a filmstrip, slideshow, crop, rotate and adjust (saved as a copy, never over the original), and the
 * picture's details: camera, exposure, when and where it was taken.
 *   Click opens    Ctrl / Shift + click selects    in the viewer: arrows, Space, R, I, F favourite, C crop
 */
export function PhotosApp(_props: { onClose: () => void }) {
  const [photos, setPhotos] = useState<Photo[] | null>(null)
  const [view, setView] = useState<View>({ k: 'all' })
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SortKey>('new')
  const [size, setSize] = useState(() => Number(localStorage.getItem('udaan.photos.size')) || 170)
  const [open, setOpen] = useState<number | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [naming, setNaming] = useState<null | { paths: string[] }>(null)
  const [pictures, setPictures] = useState('C:\\Users')
  const st = usePhotoState()
  const openMenu = useShellMenu()

  const scan = useCallback(() => void invoke<Photo[]>('photos_scan').then(setPhotos, () => setPhotos([])), [])
  useEffect(() => {
    scan()
    void homeDir().then((h) => setPictures(h.replace(/[\\/]+$/, '') + '\\Pictures'), () => {})
  }, [scan])

  const favSet = useMemo(() => new Set(st.favs.map((f) => f.toLowerCase())), [st.favs])
  const folders = useMemo(() => [...new Set((photos ?? []).map((p) => p.folder))], [photos])
  const album = view.k === 'album' ? st.albums.find((a) => a.id === view.id) : undefined

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    const inAlbum = album ? new Set(album.paths.map((p) => p.toLowerCase())) : null
    const list = (photos ?? []).filter((p) => {
      if (view.k === 'favs' && !favSet.has(p.path.toLowerCase())) return false
      if (view.k === 'folder' && p.folder !== view.name) return false
      if (inAlbum && !inAlbum.has(p.path.toLowerCase())) return false
      return !q || nameOf(p.path).toLowerCase().includes(q)
    })
    return list.sort((a, b) => (sort === 'new' ? b.modifiedMs - a.modifiedMs : sort === 'old' ? a.modifiedMs - b.modifiedMs : sort === 'big' ? b.size - a.size : nameOf(a.path).localeCompare(nameOf(b.path))))
  }, [photos, view, album, favSet, query, sort])

  const sections = useMemo(() => {
    if (sort === 'name' || sort === 'big') return [{ label: sort === 'name' ? 'A to Z' : 'Largest first', items: shown.map((p, i) => ({ p, i })) }]
    const map = new Map<string, { label: string; items: { p: Photo; i: number }[] }>()
    shown.forEach((p, i) => {
      const d = new Date(p.modifiedMs)
      const key = `${d.getFullYear()}-${d.getMonth()}`
      const g = map.get(key) ?? { label: d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }), items: [] }
      g.items.push({ p, i })
      map.set(key, g)
    })
    return [...map.values()]
  }, [shown, sort])

  const total = shown.reduce((s, p) => s + p.size, 0)
  const title = view.k === 'all' ? 'All photos' : view.k === 'favs' ? 'Favourites' : view.k === 'album' ? (album?.name ?? 'Album') : view.k === 'folder' ? view.name : 'Duplicates'
  const go = (v: View) => (setView(v), setPicked(new Set()), setOpen(null))

  /* ── albums and favourites ─────────────────────────────────────── */

  const toggleFav = (paths: string[]) =>
    st.update((s) => {
      const allFav = paths.every((p) => s.favs.some((f) => same(f, p)))
      return { ...s, favs: allFav ? s.favs.filter((f) => !paths.some((p) => same(p, f))) : [...s.favs, ...paths.filter((p) => !s.favs.some((f) => same(f, p)))] }
    })
  const addToAlbum = (id: string, paths: string[]) => st.update((s) => ({ ...s, albums: s.albums.map((a) => (a.id === id ? { ...a, paths: [...a.paths, ...paths.filter((p) => !a.paths.some((x) => same(x, p)))] } : a)) }))
  const albumMenu = (e: { clientX: number; clientY: number } | { x: number; y: number }, paths: string[]) =>
    openMenu(e, [
      ...st.albums.map((a) => ({ label: `Add to ${a.name}`, onSelect: () => addToAlbum(a.id, paths) })),
      ...(st.albums.length ? [{}] : []),
      { label: 'New album…', onSelect: () => setNaming({ paths }) },
    ])
  const removeSelectedFromAlbum = () => {
    if (!album) return
    st.update((s) => ({ ...s, albums: s.albums.map((a) => (a.id === album.id ? { ...a, paths: a.paths.filter((p) => ![...picked].some((x) => same(x, p))) } : a)) }))
    setPicked(new Set())
  }
  const deletePicked = async () => {
    const paths = [...picked]
    if (!window.confirm(`Move ${paths.length} picture${paths.length === 1 ? '' : 's'} to the Recycle Bin?`)) return
    await shell.recycle(paths).catch(() => {})
    setPhotos((p) => (p ?? []).filter((x) => !paths.some((q) => same(q, x.path))))
    setPicked(new Set())
  }

  const lastPicked = useRef<number>(-1)
  const pick = (p: Photo, index: number, e: React.MouseEvent) => {
    setPicked((cur) => {
      const n = new Set(cur)
      if (e.shiftKey && lastPicked.current >= 0) {
        const [a, b] = [Math.min(lastPicked.current, index), Math.max(lastPicked.current, index)]
        shown.slice(a, b + 1).forEach((x) => n.add(x.path))
      } else if (n.has(p.path)) n.delete(p.path)
      else n.add(p.path)
      return n
    })
    lastPicked.current = index
  }

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (open !== null || (e.target as HTMLElement).tagName === 'INPUT') return
      if (e.key === 'Escape') setPicked(new Set())
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') (e.preventDefault(), setPicked(new Set(shown.map((p) => p.path))))
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [open, shown])

  const navItem = (v: View, label: string, count?: number, menu?: (e: React.MouseEvent) => void) => (
    <button
      key={JSON.stringify(v)}
      type="button"
      onClick={() => go(v)}
      onContextMenu={menu ? (e) => (e.preventDefault(), menu(e)) : undefined}
      className={cn('flex h-[30px] w-full items-center gap-2 rounded-[8px] px-2.5 text-left text-[13px]', JSON.stringify(view) === JSON.stringify(v) ? 'bg-(--u-wash-on) font-medium' : 'text-(--u-ink-2) hover:bg-(--u-wash-hover) hover:text-(--u-ink)')}
    >
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count !== undefined && <span className="text-[11px] tabular-nums text-(--u-ink-3)">{count}</span>}
    </button>
  )

  return (
    <div className="relative flex h-full text-(--u-ink)">
      <nav className="u-scroll flex w-[200px] shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-(--u-edge) px-2.5 py-4">
        <h1 className="px-2.5 pb-3 text-[18px] font-semibold tracking-tight">Photos</h1>
        {navItem({ k: 'all' }, 'All photos', photos?.length)}
        {navItem({ k: 'favs' }, 'Favourites', favSet.size || undefined)}
        <div className="flex items-center justify-between px-2.5 pb-1 pt-4">
          <span className="text-[11px] font-semibold text-(--u-ink-3)">Albums</span>
          <button type="button" aria-label="New album" title="New album" onClick={() => setNaming({ paths: [] })} className="rounded-[5px] px-1 text-[15px] leading-none text-(--u-ink-3) hover:bg-(--u-wash-hover) hover:text-(--u-ink)">
            +
          </button>
        </div>
        {st.albums.map((a) =>
          navItem({ k: 'album', id: a.id }, a.name, a.paths.length, (e) =>
            openMenu(e, [
              { label: 'Rename…', onSelect: () => { const n = window.prompt('Album name', a.name)?.trim(); if (n) st.update((s) => ({ ...s, albums: s.albums.map((x) => (x.id === a.id ? { ...x, name: n } : x)) })) } },
              { label: 'Delete album', danger: true, onSelect: () => (st.update((s) => ({ ...s, albums: s.albums.filter((x) => x.id !== a.id) })), view.k === 'album' && view.id === a.id && go({ k: 'all' })) },
            ]),
          ),
        )}
        {!st.albums.length && <p className="px-2.5 text-[11.5px] leading-snug text-(--u-ink-3)">Select pictures and add them to an album.</p>}
        <p className="px-2.5 pb-1 pt-4 text-[11px] font-semibold text-(--u-ink-3)">Folders</p>
        {folders.map((f) => navItem({ k: 'folder', name: f }, f, (photos ?? []).filter((p) => p.folder === f).length))}
        <p className="px-2.5 pb-1 pt-4 text-[11px] font-semibold text-(--u-ink-3)">Tools</p>
        {navItem({ k: 'dupes' }, 'Find duplicates')}
      </nav>

      <div className="flex min-w-0 flex-1 flex-col">
        {view.k === 'dupes' ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <Duplicates root={pictures} onGo={(l) => l.kind === 'dir' && void openApp('file-explorer', { initialPath: l.path })} />
          </div>
        ) : (
          <>
            <header className="flex shrink-0 items-center gap-3 border-b border-(--u-edge) px-5 py-3">
              <div className="mr-2 min-w-0">
                <h2 className="truncate text-[18px] font-semibold leading-tight tracking-tight">{title}</h2>
                <p className="text-[11.5px] text-(--u-ink-3)">{photos ? `${shown.length} pictures · ${kb(total)}` : 'Finding your pictures…'}</p>
              </div>
              <span className="flex-1" />
              <label className="u-search h-9 w-[170px] shrink-0">
                <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden>
                  <path d="M7 12A5 5 0 1 0 7 2a5 5 0 0 0 0 10ZM10.6 10.6 14 14" />
                </svg>
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by name" />
              </label>
              <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className="u-field h-9 w-[124px] shrink-0" aria-label="Sort pictures">
                <option value="new">Newest first</option>
                <option value="old">Oldest first</option>
                <option value="name">Name</option>
                <option value="big">Largest first</option>
              </select>
              <div className="flex w-[96px] shrink-0 items-center gap-1.5 text-[11px] text-(--u-ink-3)" title="Thumbnail size">
                <span>▫</span>
                <Slider value={size} min={110} max={300} step={10} aria-label="Thumbnail size" onChange={setSize} onCommit={(v) => localStorage.setItem('udaan.photos.size', String(v))} />
                <span className="text-[15px]">▣</span>
              </div>
              <Button variant="primary" size="sm" disabled={!shown.length} onClick={() => setOpen(0)} title="Play every picture as a slideshow">
                Slideshow
              </Button>
            </header>

            {picked.size > 0 && (
              <div className="flex shrink-0 items-center gap-2 border-b border-(--u-edge) bg-(--u-wash-hover) px-5 py-2">
                <span className="mr-2 text-[13px] font-medium">{picked.size} selected</span>
                <Button size="sm" variant="tinted" onClick={() => toggleFav([...picked])}>
                  <Heart on={[...picked].every((p) => favSet.has(p.toLowerCase()))} size={13} /> Favourite
                </Button>
                <Button size="sm" variant="tinted" onClick={(e) => albumMenu({ x: e.currentTarget.getBoundingClientRect().left, y: e.currentTarget.getBoundingClientRect().bottom + 4 }, [...picked])}>
                  Add to album
                </Button>
                {album && (
                  <Button size="sm" variant="tinted" onClick={removeSelectedFromAlbum}>
                    Remove from album
                  </Button>
                )}
                <Button size="sm" variant="danger" onClick={() => void deletePicked()}>
                  Delete
                </Button>
                <span className="flex-1" />
                <Button size="sm" variant="ghost" onClick={() => setPicked(new Set())}>
                  Clear
                </Button>
              </div>
            )}

            <div className="u-scroll min-h-0 flex-1 overflow-y-auto px-5 pb-8">
              {photos === null && <p className="mt-20 text-center text-(--u-ink-3)">Finding your pictures…</p>}
              {photos?.length === 0 && <p className="mt-20 text-center text-(--u-ink-3)">No pictures found in Pictures, Downloads or Desktop.</p>}
              {photos && photos.length > 0 && shown.length === 0 && (
                <p className="mt-20 text-center text-(--u-ink-3)">{view.k === 'favs' ? 'No favourites yet. Press the heart on a picture.' : view.k === 'album' ? 'This album is empty. Select pictures and use Add to album.' : 'Nothing matches.'}</p>
              )}
              {sections.map((m) => (
                <section key={m.label} className="mb-5">
                  <h3 className="sticky top-0 z-10 bg-(--u-m-solid)/95 py-2.5 text-[13px] font-semibold text-(--u-ink-2) backdrop-blur">
                    {m.label} <span className="ml-1 font-normal text-(--u-ink-3)">{m.items.length}</span>
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {m.items.map(({ p, i }) => (
                      <Thumb key={p.path} photo={p} size={size} selected={open === i} checked={picked.has(p.path)} fav={favSet.has(p.path.toLowerCase())} picking={picked.size > 0} onOpen={() => setOpen(i)} onPick={(e) => pick(p, i, e)} />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </>
        )}
      </div>

      <AnimatePresence>
        {open !== null && shown[open] && (
          <Viewer
            photos={shown}
            index={open}
            favSet={favSet}
            onFav={(p) => toggleFav([p])}
            onAlbum={(p, e) => albumMenu(e, [p])}
            onIndex={setOpen}
            onClose={() => setOpen(null)}
            onDeleted={(path) => {
              setPhotos((prev) => (prev ?? []).filter((x) => x.path !== path))
              setOpen((o) => (o !== null && o > 0 ? o - 1 : o))
            }}
            onSaved={scan}
          />
        )}
      </AnimatePresence>

      {naming && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/45 p-6" onPointerDown={(e) => e.target === e.currentTarget && setNaming(null)}>
          <form
            className="flex w-[380px] max-w-full flex-col gap-4 rounded-[14px] bg-(--u-m-solid) p-5 shadow-[inset_0_0_0_1px_var(--u-edge)]"
            onSubmit={(e) => {
              e.preventDefault()
              const n = (new FormData(e.currentTarget).get('n') as string).trim()
              if (!n) return
              const id = uid()
              st.update((s) => ({ ...s, albums: [...s.albums, { id, name: n, paths: naming.paths }] }))
              setNaming(null)
              setPicked(new Set())
              if (!naming.paths.length) go({ k: 'album', id })
            }}
            onKeyDown={(e) => e.key === 'Escape' && setNaming(null)}
          >
            <h2 className="text-[15px] font-semibold">New album</h2>
            <input name="n" autoFocus placeholder="Album name" className="u-field h-9" />
            <div className="flex justify-end gap-2">
              <Button variant="tinted" onClick={() => setNaming(null)}>
                Cancel
              </Button>
              <Button type="submit" variant="accent">
                Create{naming.paths.length ? ` with ${naming.paths.length}` : ''}
              </Button>
            </div>
          </form>
        </div>
      )}
      <Toasts />
      <AskHost />
    </div>
  )
}

/* ── the viewer ──────────────────────────────────────────────────────── */

const ASPECTS: [string, number | null][] = [
  ['Original', null],
  ['1:1', 1],
  ['4:3', 4 / 3],
  ['3:2', 3 / 2],
  ['16:9', 16 / 9],
  ['3:4', 3 / 4],
  ['2:3', 2 / 3],
]

function Viewer({
  photos,
  index,
  favSet,
  onFav,
  onAlbum,
  onIndex,
  onClose,
  onDeleted,
  onSaved,
}: {
  photos: Photo[]
  index: number
  favSet: Set<string>
  onFav: (path: string) => void
  onAlbum: (path: string, at: { x: number; y: number }) => void
  onIndex: (i: number) => void
  onClose: () => void
  onDeleted: (path: string) => void
  onSaved: () => void
}) {
  const photo = photos[index]
  const [rotate, setRotate] = useState(0)
  const [flip, setFlip] = useState(false)
  const [adjust, setAdjust] = useState({ brightness: 100, contrast: 100, saturate: 100 })
  const [editing, setEditing] = useState(false)
  const [info, setInfo] = useState(false)
  const [exif, setExif] = useState<Exif | null | undefined>(undefined)
  const [note, setNote] = useState<string | null>(null)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null)
  const [playing, setPlaying] = useState(false)
  const [crop, setCrop] = useState<{ on: boolean; aspect: number | null; size: number; cx: number; cy: number }>({ on: false, aspect: null, size: 0.8, cx: 0.5, cy: 0.5 })
  const [imgBox, setImgBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null)
  const cropDrag = useRef<{ x: number; y: number; cx: number; cy: number } | null>(null)
  const strip = useRef<HTMLDivElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  const src = convertFileSrc(photo.path)
  const filter = `brightness(${adjust.brightness}%) contrast(${adjust.contrast}%) saturate(${adjust.saturate}%)`
  const changed = rotate % 360 !== 0 || flip || adjust.brightness !== 100 || adjust.contrast !== 100 || adjust.saturate !== 100 || crop.on
  const fav = favSet.has(photo.path.toLowerCase())

  const go = useCallback((d: number) => onIndex((index + d + photos.length) % photos.length), [index, onIndex, photos.length])

  useEffect(() => {
    setRotate(0)
    setFlip(false)
    setZoom(1)
    setPan({ x: 0, y: 0 })
    setAdjust({ brightness: 100, contrast: 100, saturate: 100 })
    setCrop((c) => ({ ...c, on: false, cx: 0.5, cy: 0.5 }))
    setNote(null)
    setDims(null)
    setExif(undefined)
  }, [photo.path])

  useEffect(() => {
    if (!info) return
    let live = true
    void invoke<Exif | null>('photos_exif', { path: photo.path }).then((x) => live && setExif(x), () => live && setExif(null))
    return () => {
      live = false
    }
  }, [info, photo.path])

  // Where the picture sits on the stage (as seen, after rotation), so the crop box can sit exactly over it.
  const measure = useCallback(() => {
    const s = stage.current?.getBoundingClientRect()
    const i = imgRef.current?.getBoundingClientRect()
    if (s && i) setImgBox({ x: i.left - s.left, y: i.top - s.top, w: i.width, h: i.height })
  }, [])
  useLayoutEffect(() => {
    if (!crop.on) return
    const t = setTimeout(measure, 30)
    window.addEventListener('resize', measure)
    return () => {
      clearTimeout(t)
      window.removeEventListener('resize', measure)
    }
  }, [crop.on, rotate, flip, measure, photo.path, dims])

  // Slideshow.
  useEffect(() => {
    if (!playing) return
    const t = setInterval(() => go(1), 4000)
    return () => clearInterval(t)
  }, [playing, go])

  useEffect(() => {
    const el = strip.current?.querySelector<HTMLElement>(`[data-i="${index}"]`)
    el?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' })
  }, [index])

  const remove = useCallback(async () => {
    if (!window.confirm('Move this picture to the Recycle Bin?')) return
    await shell.recycle([photo.path]).catch(() => {})
    onDeleted(photo.path)
    if (photos.length <= 1) onClose()
  }, [photo.path, onDeleted, onClose, photos.length])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = e.key
      if (k === 'Escape') (crop.on ? setCrop((c) => ({ ...c, on: false })) : onClose())
      else if (k === 'ArrowLeft') go(-1)
      else if (k === 'ArrowRight') go(1)
      else if (k === ' ') (e.preventDefault(), setPlaying((p) => !p))
      else if (k === '+' || k === '=') setZoom((z) => Math.min(8, z * 1.25))
      else if (k === '-') setZoom((z) => Math.max(1, z / 1.25))
      else if (k === '0') (setZoom(1), setPan({ x: 0, y: 0 }))
      else if (k.toLowerCase() === 'r') setRotate((r) => r + 90)
      else if (k.toLowerCase() === 'i') setInfo((v) => !v)
      else if (k.toLowerCase() === 'f') onFav(photo.path)
      else if (k.toLowerCase() === 'c') (setZoom(1), setPan({ x: 0, y: 0 }), setCrop((c) => ({ ...c, on: !c.on })))
      else if (k === 'Delete') void remove()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [go, onClose, remove, crop.on, onFav, photo.path])

  // The crop box, in pixels over the stage: the biggest box of the chosen shape that fits, scaled by the size slider.
  const box = useMemo(() => {
    if (!crop.on || !imgBox) return null
    const ratio = crop.aspect ?? imgBox.w / imgBox.h
    let h = Math.min(imgBox.h, imgBox.w / ratio)
    let w = h * ratio
    h *= crop.size
    w *= crop.size
    const x = imgBox.x + Math.min(Math.max(crop.cx * imgBox.w - w / 2, 0), imgBox.w - w)
    const y = imgBox.y + Math.min(Math.max(crop.cy * imgBox.h - h / 2, 0), imgBox.h - h)
    return { x, y, w, h }
  }, [crop, imgBox])

  const saveCopy = async () => {
    const im = new Image()
    im.src = src
    await im.decode()
    const turn = ((rotate % 360) + 360) % 360
    const c = document.createElement('canvas')
    const sideways = turn === 90 || turn === 270
    c.width = sideways ? im.naturalHeight : im.naturalWidth
    c.height = sideways ? im.naturalWidth : im.naturalHeight
    const ctx = c.getContext('2d')!
    ctx.filter = filter
    ctx.translate(c.width / 2, c.height / 2)
    ctx.rotate((turn * Math.PI) / 180)
    if (flip) ctx.scale(-1, 1)
    ctx.drawImage(im, -im.naturalWidth / 2, -im.naturalHeight / 2)
    let out = c
    if (box && imgBox) {
      // The box is measured on the picture as seen; the canvas holds that same picture at full size.
      const fx = (box.x - imgBox.x) / imgBox.w
      const fy = (box.y - imgBox.y) / imgBox.h
      const sx = Math.round(fx * c.width)
      const sy = Math.round(fy * c.height)
      const sw = Math.max(1, Math.round((box.w / imgBox.w) * c.width))
      const sh = Math.max(1, Math.round((box.h / imgBox.h) * c.height))
      out = document.createElement('canvas')
      out.width = sw
      out.height = sh
      out.getContext('2d')!.drawImage(c, sx, sy, sw, sh, 0, 0, sw, sh)
    }
    const blob = await new Promise<Blob | null>((r) => out.toBlob(r, 'image/png'))
    if (!blob) return
    const saved = await invoke<string>('photos_save_copy', { original: photo.path, png: Array.from(new Uint8Array(await blob.arrayBuffer())) })
    setNote(`Saved ${nameOf(saved)}`)
    onSaved()
  }

  const bar = 'h-8 px-3 text-[12.5px] text-white/85 hover:bg-white/10 hover:text-white'
  const row = (k: string, v?: string | null) =>
    v ? (
      <p key={k} className="flex justify-between gap-3 py-0.5 text-white/60">
        <span className="shrink-0">{k}</span>
        <span className="truncate text-right text-white/90">{v}</span>
      </p>
    ) : null
  const settings = exif ? [exif.exposure, exif.fNumber ? `f/${exif.fNumber}` : null, exif.iso ? `ISO ${exif.iso}` : null, exif.focalMm ? `${Math.round(exif.focalMm)} mm` : null].filter(Boolean).join('  ·  ') : ''

  return (
    <motion.div className="absolute inset-0 z-20 flex flex-col bg-black/96" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.16 }}>
      <header className="flex shrink-0 items-center gap-1 px-4 py-2.5">
        <Button className={bar} onClick={onClose}>
          ‹ Back
        </Button>
        <p className="mx-2 min-w-0 flex-1 truncate text-[12.5px] text-white/70">
          {nameOf(photo.path)} · {index + 1} of {photos.length}
        </p>
        {note && <span className="mr-2 text-[12px] text-(--u-ok)">{note}</span>}
        <Button className={cn(bar, fav && 'text-(--u-accent)')} onClick={() => onFav(photo.path)} title="Favourite (F)">
          <Heart on={fav} />
        </Button>
        <Button className={bar} onClick={(e) => onAlbum(photo.path, { x: e.currentTarget.getBoundingClientRect().left, y: e.currentTarget.getBoundingClientRect().bottom + 4 })} title="Add to an album">
          Album
        </Button>
        <Button className={cn(bar, playing && 'bg-white/15')} onClick={() => setPlaying((p) => !p)}>
          {playing ? 'Pause' : 'Slideshow'}
        </Button>
        <Button className={bar} onClick={() => setRotate((r) => r - 90)} title="Rotate (R)">
          Rotate
        </Button>
        <Button className={bar} onClick={() => setFlip((f) => !f)}>
          Flip
        </Button>
        <Button className={cn(bar, crop.on && 'bg-white/15')} onClick={() => (setZoom(1), setPan({ x: 0, y: 0 }), setCrop((c) => ({ ...c, on: !c.on })))} title="Crop (C)">
          Crop
        </Button>
        <Button className={cn(bar, editing && 'bg-white/15')} onClick={() => setEditing((e) => !e)}>
          Adjust
        </Button>
        <Button className={cn(bar, info && 'bg-white/15')} onClick={() => setInfo((v) => !v)} title="Details (I)">
          Info
        </Button>
        {changed && (
          <Button variant="primary" size="sm" onClick={() => void saveCopy()}>
            Save copy
          </Button>
        )}
        <Button className={bar} onClick={() => void openWithSystem(photo.path)}>
          Open with…
        </Button>
        <Button className={cn(bar, 'text-(--u-danger) hover:text-(--u-danger)')} onClick={() => void remove()}>
          Delete
        </Button>
      </header>

      <div
        ref={stage}
        className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden"
        onWheel={(e) => !crop.on && setZoom((z) => Math.min(8, Math.max(1, z * (e.deltaY < 0 ? 1.12 : 1 / 1.12))))}
        onDoubleClick={() => !crop.on && (zoom > 1 ? (setZoom(1), setPan({ x: 0, y: 0 })) : setZoom(2.5))}
        onPointerDown={(e) => {
          if (zoom <= 1 || crop.on) return
          e.currentTarget.setPointerCapture(e.pointerId)
          drag.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y }
        }}
        onPointerMove={(e) => {
          if (drag.current) setPan({ x: drag.current.px + e.clientX - drag.current.x, y: drag.current.py + e.clientY - drag.current.y })
          else if (cropDrag.current && imgBox) setCrop((c) => ({ ...c, cx: Math.min(1, Math.max(0, cropDrag.current!.cx + (e.clientX - cropDrag.current!.x) / imgBox.w)), cy: Math.min(1, Math.max(0, cropDrag.current!.cy + (e.clientY - cropDrag.current!.y) / imgBox.h)) }))
        }}
        onPointerUp={() => ((drag.current = null), (cropDrag.current = null))}
        style={{ cursor: zoom > 1 && !crop.on ? 'grab' : 'default' }}
      >
        <button type="button" aria-label="Previous" onClick={() => go(-1)} className="absolute left-3 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-[20px] text-white hover:bg-white/20">
          ‹
        </button>
        <img
          ref={imgRef}
          key={photo.path}
          src={src}
          alt=""
          draggable={false}
          onLoad={(e) => (setDims({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight }), measure())}
          className="max-h-full max-w-full select-none object-contain"
          style={{ filter, transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom}) rotate(${rotate}deg) scaleX(${flip ? -1 : 1})`, transition: drag.current || crop.on ? 'none' : 'transform 160ms ease-out' }}
        />
        <button type="button" aria-label="Next" onClick={() => go(1)} className="absolute right-3 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-[20px] text-white hover:bg-white/20">
          ›
        </button>

        {box && imgBox && (
          <>
            {/* Dim everything outside the crop, and let the box be dragged. */}
            <div className="pointer-events-none absolute" style={{ left: imgBox.x, top: imgBox.y, width: imgBox.w, height: imgBox.h, boxShadow: 'none' }}>
              <div className="absolute inset-0 bg-black/55" style={{ clipPath: `polygon(0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${box.x - imgBox.x}px ${box.y - imgBox.y}px, ${box.x - imgBox.x}px ${box.y - imgBox.y + box.h}px, ${box.x - imgBox.x + box.w}px ${box.y - imgBox.y + box.h}px, ${box.x - imgBox.x + box.w}px ${box.y - imgBox.y}px, ${box.x - imgBox.x}px ${box.y - imgBox.y}px)` }} />
            </div>
            <div
              className="absolute cursor-move border border-white"
              style={{ left: box.x, top: box.y, width: box.w, height: box.h, backgroundImage: 'linear-gradient(rgb(255 255 255 / 0.35) 1px, transparent 1px), linear-gradient(90deg, rgb(255 255 255 / 0.35) 1px, transparent 1px)', backgroundSize: `${box.w / 3}px ${box.h / 3}px` }}
              onPointerDown={(e) => {
                e.stopPropagation()
                stage.current?.setPointerCapture(e.pointerId)
                cropDrag.current = { x: e.clientX, y: e.clientY, cx: crop.cx, cy: crop.cy }
              }}
            />
            <div className="absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-[#1f2024]/95 px-3 py-1.5 text-[12px] text-white/80" onPointerDown={(e) => e.stopPropagation()}>
              {ASPECTS.map(([label, a]) => (
                <button key={label} type="button" onClick={() => setCrop((c) => ({ ...c, aspect: a }))} className={cn('rounded-full px-2.5 py-1', crop.aspect === a ? 'bg-white text-black' : 'hover:bg-white/10')}>
                  {label}
                </button>
              ))}
              <span className="mx-1 h-4 w-px bg-white/20" />
              <span className="w-[90px]">
                <Slider value={Math.round(crop.size * 100)} min={20} max={100} step={1} aria-label="Crop size" onChange={(v) => setCrop((c) => ({ ...c, size: v / 100 }))} />
              </span>
            </div>
          </>
        )}

        {zoom > 1 && <span className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-3 py-1 text-[11.5px] tabular-nums text-white/80">{Math.round(zoom * 100)}% · double-click to reset</span>}

        <AnimatePresence>
          {editing && (
            <motion.div initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 16 }} onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()} className="absolute right-5 top-3 w-60 rounded-[12px] bg-[#1f2024]/95 p-4 shadow-[inset_0_0_0_1px_rgb(0_0_0/40%)]">
              {(['brightness', 'contrast', 'saturate'] as const).map((k) => (
                <label key={k} className="mb-3 block text-[12px] text-white/70">
                  <span className="mb-1 flex justify-between">
                    {k === 'saturate' ? 'Saturation' : k[0].toUpperCase() + k.slice(1)} <span className="tabular-nums">{adjust[k]}%</span>
                  </span>
                  <Slider value={adjust[k]} min={20} max={200} step={1} aria-label={k} onChange={(v) => setAdjust((a) => ({ ...a, [k]: v }))} />
                </label>
              ))}
              <Button size="sm" onClick={() => setAdjust({ brightness: 100, contrast: 100, saturate: 100 })}>
                Reset
              </Button>
            </motion.div>
          )}
          {info && (
            <motion.div initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }} onPointerDown={(e) => e.stopPropagation()} className="absolute left-16 top-3 w-72 rounded-[12px] bg-[#1f2024]/95 p-4 text-[12px] shadow-[inset_0_0_0_1px_rgb(0_0_0/40%)]">
              <p className="mb-2 truncate text-[13px] font-semibold text-white">{nameOf(photo.path)}</p>
              {row('Size', dims ? `${dims.w} × ${dims.h}` : '…')}
              {row('File', kb(photo.size))}
              {row('Modified', new Date(photo.modifiedMs).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }))}
              {row('Folder', photo.folder)}
              {exif && (
                <div className="mt-2 border-t border-white/10 pt-2">
                  {row('Taken', exif.taken?.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3'))}
                  {row('Camera', [exif.make, exif.model].filter(Boolean).join(' '))}
                  {row('Lens', exif.lens)}
                  {row('Settings', settings)}
                  {exif.lat != null && exif.lon != null && (
                    <p className="flex items-center justify-between gap-3 py-0.5 text-white/60">
                      <span>Location</span>
                      <button type="button" onClick={() => void launchApp(`https://www.openstreetmap.org/?mlat=${exif.lat}&mlon=${exif.lon}#map=15/${exif.lat}/${exif.lon}`).catch(() => {})} className="truncate text-right text-(--u-accent) hover:underline" title="Open on a map">
                        {Math.abs(exif.lat).toFixed(4)}° {exif.lat >= 0 ? 'N' : 'S'}, {Math.abs(exif.lon).toFixed(4)}° {exif.lon >= 0 ? 'E' : 'W'} ↗
                      </button>
                    </p>
                  )}
                </div>
              )}
              {exif === null && <p className="mt-2 text-[11.5px] text-white/40">No camera details are stored in this picture.</p>}
              <p className="mt-1 break-all text-[11px] text-white/40">{photo.path}</p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div ref={strip} className="u-scroll flex h-[76px] shrink-0 items-center gap-1.5 overflow-x-auto px-4 pb-2 pt-1">
        {photos.map((p, i) => (
          <button key={p.path} type="button" data-i={i} onClick={() => onIndex(i)} className={cn('h-[56px] w-[56px] shrink-0 overflow-hidden rounded-[7px] bg-white/5 opacity-60 transition-opacity hover:opacity-100', i === index && 'opacity-100 shadow-[0_0_0_2px_var(--u-accent)]')}>
            {thumbCache.get(p.path) && <img src={thumbCache.get(p.path)} alt="" draggable={false} className="h-full w-full object-cover" />}
          </button>
        ))}
      </div>
    </motion.div>
  )
}
