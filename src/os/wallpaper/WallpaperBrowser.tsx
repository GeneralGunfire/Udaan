import { useEffect, useMemo, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { cn } from '@/shared/lib/cn'
import { screenPixels } from '@/app/wallpapers'
import { useWallpaper } from '@/shared/hooks/useWallpaper'
import { Button, Segmented, Slider, Switch } from '@/os/ui/controls'
import { thumbFor, useWallpaperLibrary, type FitSpec, type Item, type Library, type Rotation } from './library'

/**
 * THE WALLPAPER BROWSER: one component for Settings and for Start's wallpaper sheet.
 *
 * Everything it shows comes from the engine's library (the pictures in your wallpaper folders,
 * grouped into packs). Changing wallpaper, rotation, folders and per-picture fitting are all
 * engine commands; the engine announces the result and every window follows.
 */

const COLOURS = ['#0b0f16', '#1f2a44', '#2d4a3e', '#4a2d3e', '#3a3a3a', '#6b4f2a', '#0f5e9c', '#8a1c3a']
const FIT0: FitSpec = { mode: 'fill', fx: null, fy: null, zoom: 1 }

function ratio(i: Item) {
  const r = i.width / i.height
  return r >= 2.3 ? '21:9' : r >= 1.9 ? '2:1' : r >= 1.7 ? '16:9' : r >= 1.5 ? '16:10' : r >= 1.2 ? '4:3' : r >= 0.9 ? '1:1' : 'tall'
}

function Thumb({ item, width = 360, className }: { item: Item; width?: number; className?: string }) {
  const [src, setSrc] = useState('')
  useEffect(() => {
    let off = false
    void thumbFor(item.path, width).then((s) => !off && setSrc(s), () => {})
    return () => {
      off = true
    }
  }, [item.path, width])
  return src ? <img src={src} alt="" draggable={false} className={cn('h-full w-full object-cover', className)} /> : <span className="block h-full w-full bg-(--u-wash-on)" />
}

/* ── Fit editor ─────────────────────────────────────────────────── */

/** Mirrors the engine's `crop_rect`: which part of the picture the screen shows. */
function cropOf(item: Item, spec: FitSpec, aspect: number) {
  const sa = item.width / item.height
  let cw = sa > aspect ? aspect / sa : 1
  let ch = sa > aspect ? 1 : sa / aspect
  cw /= spec.zoom
  ch /= spec.zoom
  const fx = spec.fx ?? 0.5
  const fy = spec.fy ?? 0.5
  const x = Math.min(Math.max(fx - cw / 2, 0), 1 - cw)
  const y = Math.min(Math.max(fy - ch / 2, 0), 1 - ch)
  return { x, y, w: cw, h: ch }
}

function FitEditor({ item, spec, onChange, onClose }: { item: Item; spec: FitSpec; onChange: (s: FitSpec | null) => void; onClose: () => void }) {
  const { width, height } = screenPixels()
  const aspect = width / height
  const box = useRef<HTMLDivElement>(null)
  const [draft, setDraft] = useState(spec)
  useEffect(() => setDraft(spec), [spec, item.id])
  const crop = cropOf(item, draft, aspect)
  const setFocus = (e: React.PointerEvent) => {
    const r = box.current!.getBoundingClientRect()
    const fx = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))
    const fy = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))
    setDraft((d) => ({ ...d, fx, fy }))
    return { fx, fy }
  }
  return (
    <div className="u-surface--card flex flex-col gap-3 p-4">
      <div className="flex items-center gap-2">
        <h3 className="flex-1 text-[14px] font-semibold">Fit to your screen</h3>
        <Button size="sm" onClick={() => onChange(null)}>
          Auto
        </Button>
        <Button size="sm" variant="primary" onClick={onClose}>
          Done
        </Button>
      </div>
      <p className="text-[12px] text-(--u-ink-3)">
        {item.name} is {item.width}×{item.height}; your screen is {width}×{height}. {draft.mode === 'fill' ? 'Click the picture to choose what stays in view.' : 'The whole picture is shown on its own blurred colours.'}
      </p>
      <Segmented value={draft.mode} options={[{ value: 'fill', label: 'Fill screen' }, { value: 'fit', label: 'Show whole picture' }]} onChange={(m) => (setDraft((d) => ({ ...d, mode: m })), onChange({ ...draft, mode: m }))} />
      <div
        ref={box}
        className="relative w-full cursor-crosshair overflow-hidden rounded-[10px] shadow-[inset_0_0_0_1px_var(--u-edge)]"
        style={{ aspectRatio: `${item.width} / ${item.height}`, maxHeight: 300 }}
        onPointerDown={(e) => {
          if (draft.mode !== 'fill') return
          e.currentTarget.setPointerCapture(e.pointerId)
          setFocus(e)
        }}
        onPointerMove={(e) => e.buttons === 1 && draft.mode === 'fill' && setFocus(e)}
        onPointerUp={(e) => draft.mode === 'fill' && onChange({ ...draft, ...setFocus(e) })}
      >
        <Thumb item={item} width={900} className="object-fill" />
        {draft.mode === 'fill' && (
          <>
            <div className="pointer-events-none absolute inset-0 bg-black/55" style={{ clipPath: `polygon(0 0,100% 0,100% 100%,0 100%,0 0,${crop.x * 100}% ${crop.y * 100}%,${crop.x * 100}% ${(crop.y + crop.h) * 100}%,${(crop.x + crop.w) * 100}% ${(crop.y + crop.h) * 100}%,${(crop.x + crop.w) * 100}% ${crop.y * 100}%,${crop.x * 100}% ${crop.y * 100}%)` }} />
            <div className="pointer-events-none absolute rounded-[3px] border-2 border-white/90" style={{ left: `${crop.x * 100}%`, top: `${crop.y * 100}%`, width: `${crop.w * 100}%`, height: `${crop.h * 100}%` }} />
          </>
        )}
      </div>
      {draft.mode === 'fill' && (
        <label className="flex items-center gap-3 text-[12px] text-(--u-ink-2)">
          <span className="w-12">Zoom</span>
          <Slider value={draft.zoom} min={1} max={3} step={0.05} aria-label="Zoom" onChange={(z) => setDraft((d) => ({ ...d, zoom: z }))} onCommit={(z) => onChange({ ...draft, zoom: z })} />
          <span className="w-10 text-right tabular-nums text-(--u-ink)">{draft.zoom.toFixed(2)}×</span>
        </label>
      )}
    </div>
  )
}

/* ── Rotation ───────────────────────────────────────────────────── */

const MINUTES = [5, 15, 30, 60, 180]

function RotationCard({ lib, refresh }: { lib: Library; refresh: () => void }) {
  const r = lib.rotation
  const save = (next: Rotation) => void invoke('wallpaper_set_rotation', { rotation: next }).then(refresh)
  const kind = r.mode.mode
  const setKind = (k: string) => {
    const mode =
      k === 'interval' ? { mode: 'interval' as const, minutes: 30 } : k === 'day-night' ? { mode: 'day-night' as const, day_from: 7, night_from: 19 } : k === 'on-login' ? { mode: 'on-login' as const } : { mode: 'off' as const }
    save({ ...r, mode })
  }
  return (
    <section className="u-surface--card flex flex-col gap-3 p-4">
      <div>
        <h3 className="text-[14px] font-semibold">Change automatically</h3>
        <p className="text-[12px] text-(--u-ink-3)">Udaan can swap the wallpaper for you, from every picture or just one pack.</p>
      </div>
      <Segmented
        value={kind}
        options={[
          { value: 'off', label: 'Off' },
          { value: 'interval', label: 'Every so often' },
          { value: 'on-login', label: 'Each login' },
          { value: 'day-night', label: 'Day & night' },
        ]}
        onChange={setKind}
      />
      {r.mode.mode === 'interval' && (
        <div className="flex items-center gap-3 text-[12.5px] text-(--u-ink-2)">
          Every
          <Segmented value={String(r.mode.minutes)} options={MINUTES.map((m) => ({ value: String(m), label: m >= 60 ? `${m / 60} h` : `${m} min` }))} onChange={(v) => save({ ...r, mode: { mode: 'interval', minutes: Number(v) } })} />
        </div>
      )}
      {r.mode.mode === 'day-night' && (
        <div className="flex items-center gap-3 text-[12.5px] text-(--u-ink-2)">
          Light pictures from
          <HourPick value={r.mode.day_from} onChange={(h) => r.mode.mode === 'day-night' && save({ ...r, mode: { ...r.mode, day_from: h } })} />
          dark from
          <HourPick value={r.mode.night_from} onChange={(h) => r.mode.mode === 'day-night' && save({ ...r, mode: { ...r.mode, night_from: h } })} />
        </div>
      )}
      {kind !== 'off' && (
        <>
          <div className="flex items-center justify-between gap-3 text-[12.5px] text-(--u-ink-2)">
            Order
            <Segmented value={r.order} options={[{ value: 'shuffle', label: 'Shuffle' }, { value: 'sequential', label: 'In order' }]} onChange={(o) => save({ ...r, order: o })} />
          </div>
          <div className="flex items-center justify-between gap-3 text-[12.5px] text-(--u-ink-2)">
            From
            <select value={r.packId ?? ''} onChange={(e) => save({ ...r, packId: e.target.value || null })} className="u-field h-8 pr-6">
              <option value="">Everything</option>
              {lib.packs.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.count})
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center justify-between gap-3 text-[12.5px] text-(--u-ink-2)">
            <span>
              Prefer pictures that fit my screen
              <span className="block text-[11.5px] text-(--u-ink-3)">Skips shapes that would be cropped heavily.</span>
            </span>
            <Switch checked={r.fitScreen} onChange={(v) => save({ ...r, fitScreen: v })} label="Prefer pictures that fit my screen" />
          </div>
        </>
      )}
    </section>
  )
}

function HourPick({ value, onChange }: { value: number; onChange: (h: number) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(Number(e.target.value))} className="u-field h-8 w-[84px]">
      {Array.from({ length: 24 }, (_, h) => (
        <option key={h} value={h}>
          {String(h).padStart(2, '0')}:00
        </option>
      ))}
    </select>
  )
}

/* ── Browser ────────────────────────────────────────────────────── */

export function WallpaperBrowser({ compact = false }: { compact?: boolean }) {
  const { lib, refresh } = useWallpaperLibrary()
  const { wallpaperId, setWallpaperId } = useWallpaper()
  const [pack, setPack] = useState<string>('all')
  const [fitting, setFitting] = useState(false)

  const items = useMemo(() => {
    if (!lib) return []
    if (pack === 'all') return lib.items
    const p = lib.packs.find((x) => x.id === pack)
    if (!p) return lib.items
    const words = p.keywords.map((k) => k.toLowerCase())
    return lib.items.filter((i) => p.manual.includes(i.id) || i.name.toLowerCase().split(/[^a-z0-9]+/).some((w) => words.some((k) => w.startsWith(k))))
  }, [lib, pack])

  if (!lib) return <p className="p-4 text-[13px] text-(--u-ink-3)">Loading wallpapers…</p>
  const current = lib.items.find((i) => i.id === wallpaperId)
  const spec = (current && lib.fits[current.id]) || FIT0
  const setFit = (s: FitSpec | null) => current && void invoke('wallpaper_fit_set', { id: current.id, spec: s }).then(refresh)

  const addFolder = async () => {
    const dir = await openDialog({ directory: true, multiple: false })
    if (typeof dir === 'string' && !lib.folders.includes(dir)) void invoke('wallpaper_set_folders', { folders: [...lib.folders, dir] }).then(refresh)
  }
  const newPack = () => {
    const name = window.prompt('Name for the new pack')?.trim()
    if (!name) return
    const kw = window.prompt('Words in picture names that belong in it (comma separated, optional)') ?? ''
    void invoke('wallpaper_pack_save', { pack: { id: `u-${Date.now()}`, name, keywords: kw.split(',').map((s) => s.trim()).filter(Boolean), manual: [] } }).then(refresh)
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Current */}
      <section className="flex flex-col gap-3">
        <div className="relative aspect-[16/9] w-full max-w-[560px] overflow-hidden rounded-[14px] shadow-[inset_0_0_0_1px_var(--u-edge),var(--u-shadow-md)]" style={{ background: wallpaperId.startsWith('color:') ? wallpaperId.slice(6) : undefined }}>
          {current && <Thumb item={current} width={900} />}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="min-w-0 flex-1">
            <p className="truncate text-[14px] font-semibold">{current ? current.name : wallpaperId.startsWith('color:') ? 'Solid colour' : 'No wallpaper'}</p>
            {current && (
              <p className="text-[12px] text-(--u-ink-3)">
                {current.width}×{current.height} · {ratio(current)} · {current.tone}
                {lib.fits[current.id] ? ' · custom fit' : ''}
              </p>
            )}
          </div>
          <Button variant="tinted" onClick={() => void invoke('wallpaper_step', { forward: false }).then(refresh)}>
            Previous
          </Button>
          <Button variant="tinted" onClick={() => void invoke('wallpaper_step', { forward: true }).then(refresh)}>
            Next
          </Button>
          {current && !compact && (
            <Button variant={fitting ? 'primary' : 'tinted'} onClick={() => setFitting((f) => !f)}>
              Fit…
            </Button>
          )}
        </div>
        {fitting && current && !compact && <FitEditor item={current} spec={spec} onChange={setFit} onClose={() => setFitting(false)} />}
      </section>

      {/* Packs + grid */}
      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <Chip on={pack === 'all'} onClick={() => setPack('all')}>
            All · {lib.items.length}
          </Chip>
          {lib.packs.map((p) => (
            <Chip key={p.id} on={pack === p.id} onClick={() => setPack(p.id)}>
              {p.name} · {p.count}
            </Chip>
          ))}
          {!compact && (
            <Button size="sm" onClick={newPack}>
              + New pack
            </Button>
          )}
          {!compact && pack !== 'all' && (
            <Button size="sm" onClick={() => void invoke('wallpaper_pack_delete', { id: pack }).then(() => (setPack('all'), refresh()))}>
              Delete pack
            </Button>
          )}
        </div>
        <div className={cn('grid gap-3', compact ? 'grid-cols-4' : 'grid-cols-3')}>
          {items.map((i) => (
            <button key={i.id} type="button" aria-pressed={i.id === wallpaperId} onClick={() => setWallpaperId(i.id)} title={i.name} className={cn('u-tile items-stretch gap-1.5 p-1.5 text-left', i.id === wallpaperId && 'bg-(--u-wash-on) shadow-[inset_0_0_0_2px_var(--u-accent)]')}>
              <span className="relative block aspect-[16/10] overflow-hidden rounded-[8px] shadow-[inset_0_0_0_1px_var(--u-edge)]">
                <Thumb item={i} />
                <span className="absolute bottom-1 right-1 rounded-[5px] bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">{ratio(i)}</span>
              </span>
              <span className="truncate px-0.5 text-[11.5px] font-medium">{i.name}</span>
            </button>
          ))}
          {items.length === 0 && <p className="col-span-3 py-6 text-center text-[12.5px] text-(--u-ink-3)">No pictures here yet.</p>}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[12px] text-(--u-ink-3)">Solid colour</span>
          {COLOURS.map((c) => (
            <button key={c} type="button" aria-label={c} aria-pressed={wallpaperId === `color:${c}`} onClick={() => setWallpaperId(`color:${c}`)} className={cn('h-6 w-6 rounded-full shadow-[inset_0_0_0_1px_var(--u-edge-strong)]', wallpaperId === `color:${c}` && 'ring-2 ring-(--u-accent) ring-offset-2 ring-offset-transparent')} style={{ background: c }} />
          ))}
        </div>
      </section>

      {!compact && <RotationCard lib={lib} refresh={refresh} />}

      {!compact && (
        <section className="u-surface--card flex flex-col gap-2 p-4">
          <h3 className="text-[14px] font-semibold">Wallpaper folders</h3>
          <p className="text-[12px] text-(--u-ink-3)">Every picture in these folders appears above, grouped into packs by its name.</p>
          {lib.folders.map((f) => (
            <div key={f} className="flex items-center gap-2 text-[12.5px]">
              <span className="min-w-0 flex-1 truncate text-(--u-ink-2)">{f}</span>
              <Button size="sm" onClick={() => void invoke('wallpaper_set_folders', { folders: lib.folders.filter((x) => x !== f) }).then(refresh)}>
                Remove
              </Button>
            </div>
          ))}
          <Button variant="tinted" className="self-start" onClick={() => void addFolder()}>
            Add folder…
          </Button>
        </section>
      )}
    </div>
  )
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <Button size="sm" pill variant={on ? 'primary' : 'tinted'} aria-pressed={on} onClick={onClick}>
      {children}
    </Button>
  )
}
