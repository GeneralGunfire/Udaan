import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { invoke, convertFileSrc } from '@tauri-apps/api/core'
import { openWithSystem } from '@/integrations/file-explorer/client'
import { shell } from '@/os/kernel/shell'
import { Button, Segmented, Slider } from '@/os/ui/controls'
import { cn } from '@/shared/lib/cn'
import { SearchIcon } from '@/shared/icons'

interface Photo {
  path: string
  folder: string
  modifiedMs: number
  size: number
}

type SortKey = 'new' | 'old' | 'name' | 'big'

const thumbCache = new Map<string, string>()
const nameOf = (p: string) => p.split(/[\\/]/).pop() ?? p
const kb = (b: number) => (b >= 1024 ** 2 ? `${(b / 1024 ** 2).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`)

/** A thumbnail that only loads when scrolled into view. */
const Thumb = memo(function Thumb({ photo, size, selected, onOpen }: { photo: Photo; size: number; selected: boolean; onOpen: () => void }) {
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
    <button ref={ref} type="button" title={nameOf(photo.path)} onClick={onOpen} style={{ width: size, height: size }} className={cn('group relative overflow-hidden rounded-[8px] bg-(--u-wash-on) outline-none', selected && 'shadow-[0_0_0_2px_var(--u-accent)]')}>
      {src && <img src={src} alt="" draggable={false} className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.04]" />}
      <span className="pointer-events-none absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/70 to-transparent px-2 pb-1 pt-4 text-[11px] text-white opacity-0 transition-opacity group-hover:opacity-100">{nameOf(photo.path)}</span>
    </button>
  )
})

/** Photos: every picture in your photo folders, by month, with a zoomable viewer, filmstrip, slideshow and quick edits. */
export function PhotosApp(_props: { onClose: () => void }) {
  const [photos, setPhotos] = useState<Photo[] | null>(null)
  const [folder, setFolder] = useState('All')
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SortKey>('new')
  const [size, setSize] = useState(() => Number(localStorage.getItem('udaan.photos.size')) || 170)
  const [open, setOpen] = useState<number | null>(null)

  useEffect(() => {
    void invoke<Photo[]>('photos_scan').then(setPhotos, () => setPhotos([]))
  }, [])

  const folders = useMemo(() => ['All', ...new Set((photos ?? []).map((p) => p.folder))], [photos])
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = (photos ?? []).filter((p) => (folder === 'All' || p.folder === folder) && (!q || nameOf(p.path).toLowerCase().includes(q)))
    return list.sort((a, b) => (sort === 'new' ? b.modifiedMs - a.modifiedMs : sort === 'old' ? a.modifiedMs - b.modifiedMs : sort === 'big' ? b.size - a.size : nameOf(a.path).localeCompare(nameOf(b.path))))
  }, [photos, folder, query, sort])

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

  return (
    <div className="relative flex h-full flex-col bg-(--u-bg) text-(--u-ink)">
      <header className="flex shrink-0 items-center gap-3 border-b border-(--u-edge) px-5 py-3">
        <div className="mr-2">
          <h1 className="text-[19px] font-semibold leading-tight tracking-tight">Photos</h1>
          <p className="text-[11.5px] text-(--u-ink-3)">{photos ? `${shown.length} pictures · ${kb(total)}` : 'Finding your pictures…'}</p>
        </div>
        <label className="u-search h-9 w-[220px]">
          <SearchIcon width={14} height={14} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by name" />
        </label>
        <div className="min-w-0 flex-1 overflow-x-auto">
          <Segmented value={folder} options={folders.map((f) => ({ value: f, label: f }))} onChange={setFolder} />
        </div>
        <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className="u-field h-9 w-[132px]" aria-label="Sort pictures">
          <option value="new">Newest first</option>
          <option value="old">Oldest first</option>
          <option value="name">Name</option>
          <option value="big">Largest first</option>
        </select>
        <div className="flex w-[130px] items-center gap-2 text-[11px] text-(--u-ink-3)" title="Thumbnail size">
          <span>▫</span>
          <Slider value={size} min={110} max={300} step={10} aria-label="Thumbnail size" onChange={setSize} onCommit={(v) => localStorage.setItem('udaan.photos.size', String(v))} />
          <span className="text-[15px]">▣</span>
        </div>
        <Button variant="primary" size="sm" disabled={!shown.length} onClick={() => setOpen(0)} title="Play every picture as a slideshow">
          Slideshow
        </Button>
      </header>

      <div className="u-scroll min-h-0 flex-1 overflow-y-auto px-5 pb-8">
        {photos === null && <p className="mt-20 text-center text-(--u-ink-3)">Finding your pictures…</p>}
        {photos?.length === 0 && <p className="mt-20 text-center text-(--u-ink-3)">No pictures found in Pictures, Downloads or Desktop.</p>}
        {photos && photos.length > 0 && shown.length === 0 && <p className="mt-20 text-center text-(--u-ink-3)">Nothing matches.</p>}
        {sections.map((m) => (
          <section key={m.label} className="mb-5">
            <h2 className="sticky top-0 z-10 bg-(--u-bg)/95 py-2.5 text-[13px] font-semibold text-(--u-ink-2) backdrop-blur">
              {m.label} <span className="ml-1 font-normal text-(--u-ink-3)">{m.items.length}</span>
            </h2>
            <div className="flex flex-wrap gap-2">
              {m.items.map(({ p, i }) => (
                <Thumb key={p.path} photo={p} size={size} selected={open === i} onOpen={() => setOpen(i)} />
              ))}
            </div>
          </section>
        ))}
      </div>

      <AnimatePresence>
        {open !== null && shown[open] && (
          <Viewer
            photos={shown}
            index={open}
            onIndex={setOpen}
            onClose={() => setOpen(null)}
            onDeleted={(path) => {
              setPhotos((prev) => (prev ?? []).filter((x) => x.path !== path))
              setOpen((o) => (o !== null && o > 0 ? o - 1 : o))
            }}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

/* ── the viewer ──────────────────────────────────────────────────────── */

function Viewer({ photos, index, onIndex, onClose, onDeleted }: { photos: Photo[]; index: number; onIndex: (i: number) => void; onClose: () => void; onDeleted: (path: string) => void }) {
  const photo = photos[index]
  const [rotate, setRotate] = useState(0)
  const [flip, setFlip] = useState(false)
  const [adjust, setAdjust] = useState({ brightness: 100, contrast: 100, saturate: 100 })
  const [editing, setEditing] = useState(false)
  const [info, setInfo] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null)
  const [playing, setPlaying] = useState(false)
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null)
  const strip = useRef<HTMLDivElement>(null)
  const src = convertFileSrc(photo.path)
  const filter = `brightness(${adjust.brightness}%) contrast(${adjust.contrast}%) saturate(${adjust.saturate}%)`
  const changed = rotate % 360 !== 0 || flip || adjust.brightness !== 100 || adjust.contrast !== 100 || adjust.saturate !== 100

  const go = useCallback((d: number) => onIndex((index + d + photos.length) % photos.length), [index, onIndex, photos.length])

  useEffect(() => {
    setRotate(0)
    setFlip(false)
    setZoom(1)
    setPan({ x: 0, y: 0 })
    setAdjust({ brightness: 100, contrast: 100, saturate: 100 })
    setNote(null)
    setDims(null)
  }, [photo.path])

  // Slideshow.
  useEffect(() => {
    if (!playing) return
    const t = setInterval(() => go(1), 4000)
    return () => clearInterval(t)
  }, [playing, go])

  // Keep the current thumbnail in the strip.
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
      if (k === 'Escape') onClose()
      else if (k === 'ArrowLeft') go(-1)
      else if (k === 'ArrowRight') go(1)
      else if (k === ' ') (e.preventDefault(), setPlaying((p) => !p))
      else if (k === '+' || k === '=') setZoom((z) => Math.min(8, z * 1.25))
      else if (k === '-') setZoom((z) => Math.max(1, z / 1.25))
      else if (k === '0') (setZoom(1), setPan({ x: 0, y: 0 }))
      else if (k.toLowerCase() === 'r') setRotate((r) => r + 90)
      else if (k.toLowerCase() === 'i') setInfo((v) => !v)
      else if (k === 'Delete') void remove()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [go, onClose, remove])

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
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/png'))
    if (!blob) return
    const saved = await invoke<string>('photos_save_copy', { original: photo.path, png: Array.from(new Uint8Array(await blob.arrayBuffer())) })
    setNote(`Saved ${nameOf(saved)}`)
  }

  const bar = 'h-8 px-3 text-[12.5px] text-white/85 hover:bg-white/10 hover:text-white'

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
        <Button className={cn(bar, playing && 'bg-white/15')} onClick={() => setPlaying((p) => !p)}>
          {playing ? 'Pause' : 'Slideshow'}
        </Button>
        <Button className={bar} onClick={() => setRotate((r) => r - 90)} title="Rotate (R)">
          Rotate
        </Button>
        <Button className={bar} onClick={() => setFlip((f) => !f)}>
          Flip
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
        <Button className={bar} onClick={() => void openWithSystem(photo.path.replace(/[\\/][^\\/]+$/, ''))}>
          Folder
        </Button>
        <Button className={cn(bar, 'text-(--u-danger) hover:text-(--u-danger)')} onClick={() => void remove()}>
          Delete
        </Button>
      </header>

      <div
        className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden"
        onWheel={(e) => setZoom((z) => Math.min(8, Math.max(1, z * (e.deltaY < 0 ? 1.12 : 1 / 1.12))))}
        onDoubleClick={() => (zoom > 1 ? (setZoom(1), setPan({ x: 0, y: 0 })) : setZoom(2.5))}
        onPointerDown={(e) => {
          if (zoom <= 1) return
          e.currentTarget.setPointerCapture(e.pointerId)
          drag.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y }
        }}
        onPointerMove={(e) => drag.current && setPan({ x: drag.current.px + e.clientX - drag.current.x, y: drag.current.py + e.clientY - drag.current.y })}
        onPointerUp={() => (drag.current = null)}
        style={{ cursor: zoom > 1 ? 'grab' : 'default' }}
      >
        <button type="button" aria-label="Previous" onClick={() => go(-1)} className="absolute left-3 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-[20px] text-white hover:bg-white/20">
          ‹
        </button>
        <img
          key={photo.path}
          src={src}
          alt=""
          draggable={false}
          onLoad={(e) => setDims({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
          className="max-h-full max-w-full select-none object-contain"
          style={{ filter, transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom}) rotate(${rotate}deg) scaleX(${flip ? -1 : 1})`, transition: drag.current ? 'none' : 'transform 160ms ease-out' }}
        />
        <button type="button" aria-label="Next" onClick={() => go(1)} className="absolute right-3 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-[20px] text-white hover:bg-white/20">
          ›
        </button>

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
            <motion.div initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }} className="absolute left-16 top-3 w-64 rounded-[12px] bg-[#1f2024]/95 p-4 text-[12px] shadow-[inset_0_0_0_1px_rgb(0_0_0/40%)]">
              <p className="mb-2 truncate text-[13px] font-semibold text-white">{nameOf(photo.path)}</p>
              {[
                ['Size', dims ? `${dims.w} × ${dims.h}` : '…'],
                ['File', kb(photo.size)],
                ['Modified', new Date(photo.modifiedMs).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })],
                ['Folder', photo.folder],
              ].map(([k, v]) => (
                <p key={k} className="flex justify-between gap-3 py-0.5 text-white/60">
                  <span>{k}</span>
                  <span className="truncate text-white/90">{v}</span>
                </p>
              ))}
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
