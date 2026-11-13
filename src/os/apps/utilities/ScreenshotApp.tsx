import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { invoke, convertFileSrc } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { playSound } from '@/os/sound/sounds'

type Tool = 'crop' | 'pen' | 'highlight' | 'box'
interface Stroke {
  tool: Exclude<Tool, 'crop'>
  color: string
  points: { x: number; y: number }[]
}

const COLORS = ['#ff453a', '#ffd60a', '#30d158', '#0a84ff', '#ffffff', '#000000']

/** Screenshot: capture the screen, crop and mark it up, then save or copy. */
export function ScreenshotApp(_props: { onClose: () => void }) {
  const [src, setSrc] = useState<string | null>(null)
  const [img, setImg] = useState<HTMLImageElement | null>(null)
  const [tool, setTool] = useState<Tool>('crop')
  const [color, setColor] = useState(COLORS[0])
  const [strokes, setStrokes] = useState<Stroke[]>([])
  const [crop, setCrop] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const [countdown, setCountdown] = useState(0)
  const [status, setStatus] = useState<string | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drag = useRef<{ x: number; y: number } | null>(null)

  const capture = async (delay: number) => {
    const win = getCurrentWindow()
    for (let s = delay; s > 0; s--) {
      setCountdown(s)
      await new Promise((r) => setTimeout(r, 1000))
    }
    setCountdown(0)
    await win.hide()
    await new Promise((r) => setTimeout(r, 350))
    try {
      const path = await invoke<string>('screenshot_capture')
      playSound('switch')
      setSrc(convertFileSrc(path))
      setStrokes([])
      setCrop(null)
      setTool('crop')
    } finally {
      await win.show()
      await win.setFocus()
    }
  }

  useEffect(() => {
    if (!src) return
    const im = new Image()
    im.onload = () => setImg(im)
    im.src = src
  }, [src])

  // Redraw: screenshot, then marks, then the crop frame.
  useEffect(() => {
    const c = canvasRef.current
    if (!c || !img) return
    c.width = img.naturalWidth
    c.height = img.naturalHeight
    const ctx = c.getContext('2d')!
    ctx.drawImage(img, 0, 0)
    for (const s of strokes) {
      ctx.strokeStyle = s.color
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      if (s.tool === 'box' && s.points.length > 1) {
        const [a, b] = [s.points[0], s.points[s.points.length - 1]]
        ctx.lineWidth = 5
        ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y)
        continue
      }
      ctx.globalAlpha = s.tool === 'highlight' ? 0.35 : 1
      ctx.lineWidth = s.tool === 'highlight' ? 26 : 5
      ctx.beginPath()
      s.points.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)))
      ctx.stroke()
      ctx.globalAlpha = 1
    }
    if (crop && crop.w && crop.h) {
      ctx.fillStyle = 'rgba(0,0,0,0.5)'
      ctx.fillRect(0, 0, c.width, crop.y)
      ctx.fillRect(0, crop.y + crop.h, c.width, c.height - crop.y - crop.h)
      ctx.fillRect(0, crop.y, crop.x, crop.h)
      ctx.fillRect(crop.x + crop.w, crop.y, c.width - crop.x - crop.w, crop.h)
      ctx.strokeStyle = '#ffffff'
      ctx.lineWidth = 3
      ctx.setLineDash([12, 8])
      ctx.strokeRect(crop.x, crop.y, crop.w, crop.h)
      ctx.setLineDash([])
    }
  }, [img, strokes, crop])

  const toImage = (e: React.PointerEvent) => {
    const c = canvasRef.current!
    const r = c.getBoundingClientRect()
    return { x: ((e.clientX - r.left) / r.width) * c.width, y: ((e.clientY - r.top) / r.height) * c.height }
  }

  const exportPng = async (): Promise<number[]> => {
    if (!img) return []
    const out = document.createElement('canvas')
    const area = crop && crop.w > 4 && crop.h > 4 ? normal(crop) : { x: 0, y: 0, w: img.naturalWidth, h: img.naturalHeight }
    out.width = area.w
    out.height = area.h
    // Draw marks without the crop overlay.
    const tmp = document.createElement('canvas')
    tmp.width = img.naturalWidth
    tmp.height = img.naturalHeight
    const saveCrop = crop
    setCrop(null)
    await new Promise((r) => requestAnimationFrame(r))
    tmp.getContext('2d')!.drawImage(canvasRef.current!, 0, 0)
    setCrop(saveCrop)
    out.getContext('2d')!.drawImage(tmp, area.x, area.y, area.w, area.h, 0, 0, area.w, area.h)
    const blob = await new Promise<Blob | null>((r) => out.toBlob(r, 'image/png'))
    return blob ? Array.from(new Uint8Array(await blob.arrayBuffer())) : []
  }

  const finish = async (toFile: boolean, toClipboard: boolean) => {
    const png = await exportPng()
    const saved = await invoke<string | null>('screenshot_save', { png, toFile, toClipboard }).catch((e) => {
      setStatus(String(e))
      return null
    })
    playSound('tap')
    setStatus(saved ? `Saved to ${saved.split('\\').slice(-2).join('\\')}` : toClipboard ? 'Copied to clipboard' : null)
    if (saved) setTimeout(() => setStatus(null), 4000)
  }

  if (!src) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-6 bg-[var(--surface-base)] text-[var(--color-text-primary)]">
        <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="flex h-20 w-20 items-center justify-center rounded-[22px] bg-gradient-to-br from-[var(--color-accent)] to-[var(--color-accent-muted)] text-[36px]">
          ⌗
        </motion.div>
        <div className="text-center">
          <h1 className="text-[24px] font-bold">Screenshot</h1>
          <p className="mt-1 text-[13.5px] text-[var(--color-text-tertiary)]">Capture your screen, then crop and mark it up.</p>
        </div>
        {countdown > 0 ? (
          <p className="text-[48px] font-light tabular-nums">{countdown}</p>
        ) : (
          <div className="flex gap-2">
            <button type="button" onClick={() => void capture(0)} className="h-11 rounded-full bg-[var(--color-accent)] px-6 text-[14px] font-semibold hover:brightness-110">
              Capture screen
            </button>
            <button type="button" onClick={() => void capture(3)} className="h-11 rounded-full bg-[var(--os-menu-item-hover)] px-5 text-[14px] font-medium hover:bg-white/[0.14]">
              In 3 s
            </button>
            <button type="button" onClick={() => void capture(5)} className="h-11 rounded-full bg-[var(--os-menu-item-hover)] px-5 text-[14px] font-medium hover:bg-white/[0.14]">
              In 5 s
            </button>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col bg-[var(--surface-base)] text-[var(--color-text-primary)]">
      <header className="flex shrink-0 items-center gap-2 border-b border-white/[0.06] px-4 py-2.5">
        {(
          [
            ['crop', 'Crop'],
            ['pen', 'Draw'],
            ['highlight', 'Highlight'],
            ['box', 'Box'],
          ] as [Tool, string][]
        ).map(([t, label]) => (
          <button key={t} type="button" onClick={() => setTool(t)} className={`h-8 rounded-[8px] px-3 text-[13px] font-medium ${tool === t ? 'bg-white text-black' : 'text-[var(--color-text-secondary)] hover:bg-[var(--os-menu-item-hover)]'}`}>
            {label}
          </button>
        ))}
        <span className="mx-2 h-5 w-px bg-white/10" />
        {COLORS.map((c) => (
          <button key={c} type="button" aria-label={`Colour ${c}`} onClick={() => setColor(c)} className={`h-6 w-6 rounded-full ring-offset-2 ring-offset-[var(--surface-base)] ${color === c ? 'ring-2 ring-white' : ''}`} style={{ background: c }} />
        ))}
        <span className="mx-2 h-5 w-px bg-white/10" />
        <button type="button" onClick={() => setStrokes((s) => s.slice(0, -1))} disabled={!strokes.length} className="h-8 rounded-[8px] px-3 text-[13px] text-[var(--color-text-secondary)] hover:bg-[var(--os-menu-item-hover)] disabled:opacity-30">
          Undo
        </button>
        {crop && (
          <button type="button" onClick={() => setCrop(null)} className="h-8 rounded-[8px] px-3 text-[13px] text-[var(--color-text-secondary)] hover:bg-[var(--os-menu-item-hover)]">
            Clear crop
          </button>
        )}
        <span className="flex-1" />
        {status && <span className="text-[12.5px] text-[var(--color-text-secondary)]">{status}</span>}
        <button type="button" onClick={() => setSrc(null)} className="h-8 rounded-[8px] px-3 text-[13px] text-[var(--color-text-secondary)] hover:bg-[var(--os-menu-item-hover)]">
          New
        </button>
        <button type="button" onClick={() => void finish(false, true)} className="h-8 rounded-[8px] bg-white/[0.1] px-3.5 text-[13px] font-medium hover:bg-white/[0.16]">
          Copy
        </button>
        <button type="button" onClick={() => void finish(true, true)} className="h-8 rounded-[8px] bg-[var(--color-accent)] px-3.5 text-[13px] font-semibold hover:brightness-110">
          Save
        </button>
      </header>
      <div className="flex min-h-0 flex-1 items-center justify-center p-5">
        <canvas
          ref={canvasRef}
          className="max-h-full max-w-full cursor-crosshair rounded-[6px] shadow-[0_20px_60px_rgb(0_0_0/0.5)]"
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId)
            const p = toImage(e)
            drag.current = p
            if (tool === 'crop') setCrop({ x: p.x, y: p.y, w: 0, h: 0 })
            else setStrokes((s) => [...s, { tool, color, points: [p] }])
          }}
          onPointerMove={(e) => {
            if (!drag.current) return
            const p = toImage(e)
            if (tool === 'crop') setCrop({ x: drag.current.x, y: drag.current.y, w: p.x - drag.current.x, h: p.y - drag.current.y })
            else setStrokes((s) => [...s.slice(0, -1), { ...s[s.length - 1], points: [...s[s.length - 1].points, p] }])
          }}
          onPointerUp={() => {
            drag.current = null
            if (crop) setCrop(normal(crop))
          }}
        />
      </div>
    </div>
  )
}

function normal(c: { x: number; y: number; w: number; h: number }) {
  return { x: Math.round(Math.min(c.x, c.x + c.w)), y: Math.round(Math.min(c.y, c.y + c.h)), w: Math.round(Math.abs(c.w)), h: Math.round(Math.abs(c.h)) }
}
