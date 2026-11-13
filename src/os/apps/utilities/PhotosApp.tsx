import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { invoke, convertFileSrc } from '@tauri-apps/api/core'
import { openWithSystem } from '@/integrations/file-explorer/client'
import { shell } from '@/os/kernel/shell'

interface Photo {
  path: string
  folder: string
  modifiedMs: number
  size: number
}

const thumbCache = new Map<string, string>()

/** A thumbnail that only loads when scrolled into view. */
const Thumb = memo(function Thumb({ photo, onOpen }: { photo: Photo; onOpen: () => void }) {
  const ref = useRef<HTMLButtonElement>(null)
  const [src, setSrc] = useState(() => thumbCache.get(photo.path) ?? null)
  useEffect(() => {
    if (src || !ref.current) return
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e.isIntersecting) return
        io.disconnect()
        void invoke<string>('photos_thumb', { path: photo.path, size: 360 }).then((url) => {
          thumbCache.set(photo.path, url)
          setSrc(url)
        }, () => {})
      },
      { rootMargin: '400px' },
    )
    io.observe(ref.current)
    return () => io.disconnect()
  }, [photo.path, src])
  return (
    <button ref={ref} type="button" onClick={onOpen} className="group relative aspect-square overflow-hidden rounded-[10px] bg-white/[0.05]">
      {src && <motion.img initial={{ opacity: 0 }} animate={{ opacity: 1 }} src={src} alt="" className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" />}
    </button>
  )
})

/** Photos: every picture in your photo folders, by month, with a viewer and quick edits. */
export function PhotosApp(_props: { onClose: () => void }) {
  const [photos, setPhotos] = useState<Photo[] | null>(null)
  const [folder, setFolder] = useState('All')
  const [open, setOpen] = useState<number | null>(null)

  useEffect(() => {
    void invoke<Photo[]>('photos_scan').then(setPhotos, () => setPhotos([]))
  }, [])

  const folders = useMemo(() => ['All', ...new Set((photos ?? []).map((p) => p.folder))], [photos])
  const shown = useMemo(() => (photos ?? []).filter((p) => folder === 'All' || p.folder === folder), [photos, folder])
  const months = useMemo(() => {
    const map = new Map<string, { label: string; items: { p: Photo; i: number }[] }>()
    shown.forEach((p, i) => {
      const d = new Date(p.modifiedMs)
      const key = `${d.getFullYear()}-${d.getMonth()}`
      const g = map.get(key) ?? { label: d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }), items: [] }
      g.items.push({ p, i })
      map.set(key, g)
    })
    return [...map.values()]
  }, [shown])

  return (
    <div className="relative flex h-full flex-col bg-[var(--surface-base)] text-[var(--color-text-primary)]">
      <header className="flex shrink-0 items-center gap-3 px-6 pb-3 pt-5">
        <div className="flex-1">
          <h1 className="text-[22px] font-bold tracking-tight">Photos</h1>
          <p className="text-[12.5px] text-[var(--color-text-tertiary)]">{photos ? `${shown.length} pictures` : 'Finding your pictures…'}</p>
        </div>
        <div className="flex rounded-[10px] bg-white/[0.07] p-1 text-[12.5px] font-medium">
          {folders.map((f) => (
            <button key={f} type="button" onClick={() => setFolder(f)} className={`relative rounded-[7px] px-3 py-1.5 ${folder === f ? 'text-[var(--color-text-primary)]' : 'text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]'}`}>
              {folder === f && <motion.span layoutId="ph-folder" className="absolute inset-0 rounded-[7px] bg-white/[0.14]" />}
              <span className="relative">{f}</span>
            </button>
          ))}
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-8">
        {photos?.length === 0 && <p className="mt-20 text-center text-[var(--color-text-tertiary)]">No pictures found in Pictures, Downloads or Desktop.</p>}
        {months.map((m) => (
          <section key={m.label} className="mb-6">
            <h2 className="sticky top-0 z-10 bg-[var(--surface-base)]/95 py-2 text-[15px] font-semibold backdrop-blur">{m.label}</h2>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2">
              {m.items.map(({ p, i }) => (
                <Thumb key={p.path} photo={p} onOpen={() => setOpen(i)} />
              ))}
            </div>
          </section>
        ))}
      </div>
      <AnimatePresence>
        {open !== null && shown[open] && (
          <Viewer
            photo={shown[open]}
            onClose={() => setOpen(null)}
            onPrev={open > 0 ? () => setOpen(open - 1) : undefined}
            onNext={open < shown.length - 1 ? () => setOpen(open + 1) : undefined}
            onDeleted={() => {
              setPhotos((prev) => (prev ?? []).filter((x) => x.path !== shown[open].path))
              setOpen(null)
            }}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

function Viewer({ photo, onClose, onPrev, onNext, onDeleted }: { photo: Photo; onClose: () => void; onPrev?: () => void; onNext?: () => void; onDeleted: () => void }) {
  const [rotate, setRotate] = useState(0)
  const [adjust, setAdjust] = useState({ brightness: 100, contrast: 100, saturate: 100 })
  const [editing, setEditing] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const src = convertFileSrc(photo.path)
  const filter = `brightness(${adjust.brightness}%) contrast(${adjust.contrast}%) saturate(${adjust.saturate}%)`
  const changed = rotate % 360 !== 0 || adjust.brightness !== 100 || adjust.contrast !== 100 || adjust.saturate !== 100

  useEffect(() => {
    setRotate(0)
    setAdjust({ brightness: 100, contrast: 100, saturate: 100 })
    setNote(null)
  }, [photo.path])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowLeft') onPrev?.()
      else if (e.key === 'ArrowRight') onNext?.()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, onPrev, onNext])

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
    ctx.drawImage(im, -im.naturalWidth / 2, -im.naturalHeight / 2)
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/png'))
    if (!blob) return
    const saved = await invoke<string>('photos_save_copy', { original: photo.path, png: Array.from(new Uint8Array(await blob.arrayBuffer())) })
    setNote(`Saved ${saved.split('\\').pop()}`)
  }

  return (
    <motion.div className="absolute inset-0 z-20 flex flex-col bg-black/95" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <header className="flex shrink-0 items-center gap-2 px-5 py-3">
        <button type="button" onClick={onClose} className="h-9 rounded-[9px] px-3 text-[13.5px] text-[var(--color-text-secondary)] hover:bg-white/[0.1]">
          ‹ Back
        </button>
        <p className="min-w-0 flex-1 truncate text-[13px] text-[var(--color-text-secondary)]">
          {photo.path.split('\\').pop()} · {new Date(photo.modifiedMs).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
        </p>
        {note && <span className="text-[12.5px] text-[#6fdc8c]">{note}</span>}
        <button type="button" onClick={() => setRotate((r) => r - 90)} className="h-9 rounded-[9px] px-3 text-[13px] hover:bg-white/[0.1]">
          Rotate
        </button>
        <button type="button" onClick={() => setEditing((e) => !e)} className={`h-9 rounded-[9px] px-3 text-[13px] ${editing ? 'bg-white text-black' : 'hover:bg-white/[0.1]'}`}>
          Adjust
        </button>
        {changed && (
          <button type="button" onClick={() => void saveCopy()} className="h-9 rounded-[9px] bg-[var(--color-accent)] px-3.5 text-[13px] font-semibold">
            Save copy
          </button>
        )}
        <button type="button" onClick={() => void openWithSystem(photo.path)} className="h-9 rounded-[9px] px-3 text-[13px] hover:bg-white/[0.1]">
          Open with…
        </button>
        <button type="button" onClick={() => void openWithSystem(photo.path.replace(/\\[^\\]+$/, ''))} className="h-9 rounded-[9px] px-3 text-[13px] hover:bg-white/[0.1]">
          Show in folder
        </button>
        <button
          type="button"
          onClick={() => window.confirm('Move this picture to the Recycle Bin?') && void shell.recycle([photo.path]).then(onDeleted)}
          className="h-9 rounded-[9px] px-3 text-[13px] text-[#ff6b6b] hover:bg-white/[0.1]"
        >
          Delete
        </button>
      </header>
      <div className="relative flex min-h-0 flex-1 items-center justify-center px-16 pb-6">
        {onPrev && (
          <button type="button" aria-label="Previous" onClick={onPrev} className="absolute left-4 z-10 flex h-12 w-12 items-center justify-center rounded-full bg-white/10 text-[22px] hover:bg-white/20">
            ‹
          </button>
        )}
        <motion.img key={photo.path} initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1, rotate }} transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }} src={src} alt="" className="max-h-full max-w-full object-contain" style={{ filter }} />
        {onNext && (
          <button type="button" aria-label="Next" onClick={onNext} className="absolute right-4 z-10 flex h-12 w-12 items-center justify-center rounded-full bg-white/10 text-[22px] hover:bg-white/20">
            ›
          </button>
        )}
        <AnimatePresence>
          {editing && (
            <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }} className="absolute right-6 top-4 w-64 rounded-[14px] bg-[#232429]/95 p-4">
              {(['brightness', 'contrast', 'saturate'] as const).map((k) => (
                <label key={k} className="mb-3 block text-[12.5px] capitalize text-[var(--color-text-secondary)]">
                  <span className="flex justify-between">
                    {k === 'saturate' ? 'Saturation' : k} <span className="tabular-nums">{adjust[k]}%</span>
                  </span>
                  <input type="range" min={20} max={200} value={adjust[k]} onChange={(e) => setAdjust((a) => ({ ...a, [k]: Number(e.target.value) }))} className="os-slider mt-1 w-full" />
                </label>
              ))}
              <button type="button" onClick={() => setAdjust({ brightness: 100, contrast: 100, saturate: 100 })} className="text-[12.5px] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]">
                Reset
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  )
}
