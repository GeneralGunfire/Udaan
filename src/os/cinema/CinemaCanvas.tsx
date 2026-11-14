import { useEffect, useRef } from 'react'

/**
 * CINEMA: the animated backdrops behind the boot screen and the screensavers.
 *
 * Four scenes, each a slow, wide, film-like movement rather than a busy effect:
 *   aurora  luminous ribbons of colour drifting like northern lights
 *   warp    a slow flight through a star field, with light trails
 *   flow    thousands of particles carried along an invisible current
 *   drift   the Udaan mark adrift in light shafts and dust
 *
 * Built for a slow PC: a 2D canvas drawn at a reduced internal size and scaled up by CSS (the scenes
 * are soft, so nothing is lost), capped at 30 frames a second, paused while hidden, and a single
 * still frame when "Reduce motion" is on. Nothing runs when it is not on screen.
 */
export type CinemaKind = 'aurora' | 'warp' | 'flow' | 'drift'

export const CINEMA_KINDS: { id: CinemaKind; name: string; blurb: string }[] = [
  { id: 'aurora', name: 'Aurora', blurb: 'Ribbons of light drifting like northern lights.' },
  { id: 'warp', name: 'Starflight', blurb: 'A slow flight through the stars.' },
  { id: 'flow', name: 'Silk', blurb: 'Fine lines of light flowing like fabric.' },
  { id: 'drift', name: 'Udaan', blurb: 'The Udaan mark adrift in light and dust.' },
]

interface Scene {
  draw(ctx: CanvasRenderingContext2D, t: number, dt: number, w: number, h: number): void
}

const TAU = Math.PI * 2

/** Deep mesh of soft colour: a few huge, slow, low-contrast lights on near-black, like a studio backdrop. */
function aurora(w: number, h: number): Scene {
  const lights = [
    { c: [28, 84, 214], r: 0.62, sx: 0.045, sy: 0.038, ph: 0.2, a: 0.34 },
    { c: [0, 150, 205], r: 0.5, sx: 0.06, sy: 0.05, ph: 2.1, a: 0.22 },
    { c: [226, 98, 40], r: 0.46, sx: 0.05, sy: 0.043, ph: 3.9, a: 0.2 },
    { c: [92, 56, 200], r: 0.56, sx: 0.038, sy: 0.052, ph: 5.2, a: 0.22 },
  ]
  return {
    draw(ctx, t) {
      ctx.globalCompositeOperation = 'source-over'
      ctx.fillStyle = '#04050a'
      ctx.fillRect(0, 0, w, h)
      ctx.globalCompositeOperation = 'screen'
      for (const l of lights) {
        const x = w * (0.5 + 0.38 * Math.sin(t * l.sx + l.ph))
        const y = h * (0.5 + 0.3 * Math.cos(t * l.sy * 1.3 + l.ph))
        const r = Math.max(w, h) * l.r
        const g = ctx.createRadialGradient(x, y, 0, x, y, r)
        g.addColorStop(0, `rgba(${l.c[0]},${l.c[1]},${l.c[2]},${l.a})`)
        g.addColorStop(0.5, `rgba(${l.c[0]},${l.c[1]},${l.c[2]},${(l.a * 0.35).toFixed(3)})`)
        g.addColorStop(1, `rgba(${l.c[0]},${l.c[1]},${l.c[2]},0)`)
        ctx.fillStyle = g
        ctx.fillRect(0, 0, w, h)
      }
      ctx.globalCompositeOperation = 'source-over'
    },
  }
}

function warp(w: number, h: number): Scene {
  const N = 380
  const stars = Array.from({ length: N }, () => ({ x: (Math.random() - 0.5) * 2, y: (Math.random() - 0.5) * 2, z: Math.random() * 0.95 + 0.05, tint: Math.random() }))
  const f = Math.max(w, h) * 0.55
  return {
    draw(ctx, t, dt) {
      // Trails: the previous frame fades instead of clearing.
      ctx.globalCompositeOperation = 'source-over'
      ctx.fillStyle = 'rgba(3,4,9,0.32)'
      ctx.fillRect(0, 0, w, h)
      const speed = 0.16 + 0.1 * (0.5 + 0.5 * Math.sin(t * 0.13))
      const cx = w / 2 + Math.sin(t * 0.07) * w * 0.04
      const cy = h / 2 + Math.cos(t * 0.05) * h * 0.03
      ctx.globalCompositeOperation = 'lighter'
      for (const s of stars) {
        const pz = s.z
        s.z -= speed * dt
        if (s.z <= 0.02) {
          s.x = (Math.random() - 0.5) * 2
          s.y = (Math.random() - 0.5) * 2
          s.z = 1
          continue
        }
        const x0 = cx + (s.x / pz) * f * 0.5
        const y0 = cy + (s.y / pz) * f * 0.5
        const x1 = cx + (s.x / s.z) * f * 0.5
        const y1 = cy + (s.y / s.z) * f * 0.5
        if (x1 < -20 || x1 > w + 20 || y1 < -20 || y1 > h + 20) {
          s.z = 1
          continue
        }
        const a = Math.min(1, (1 - s.z) * 1.4)
        const col = s.tint > 0.88 ? '255,170,90' : s.tint > 0.6 ? '150,200,255' : '235,240,255'
        ctx.strokeStyle = `rgba(${col},${a.toFixed(2)})`
        ctx.lineWidth = 0.6 + (1 - s.z) * 1.6
        ctx.beginPath()
        ctx.moveTo(x0, y0)
        ctx.lineTo(x1, y1)
        ctx.stroke()
      }
      ctx.globalCompositeOperation = 'source-over'
    },
  }
}

/** Silk: fine luminous lines flowing in layered waves, like light through a sheet of fabric. */
function flow(w: number, h: number): Scene {
  const LINES = 46
  return {
    draw(ctx, t) {
      ctx.globalCompositeOperation = 'source-over'
      const bg = ctx.createLinearGradient(0, 0, w, h)
      bg.addColorStop(0, '#05060c')
      bg.addColorStop(1, '#0a0a14')
      ctx.fillStyle = bg
      ctx.fillRect(0, 0, w, h)
      ctx.globalCompositeOperation = 'lighter'
      ctx.lineWidth = 1
      for (let i = 0; i < LINES; i++) {
        const f = i / (LINES - 1)
        const base = h * (0.3 + 0.42 * f)
        const amp = h * (0.12 + 0.07 * Math.sin(f * 3 + t * 0.07))
        ctx.beginPath()
        for (let x = 0; x <= w; x += 6) {
          const u = x / w
          const y =
            base +
            Math.sin(u * 4.2 + t * 0.16 + f * 2.4) * amp * (0.4 + 0.6 * Math.sin(u * Math.PI)) +
            Math.sin(u * 9.5 - t * 0.1 + f * 5) * amp * 0.16
          if (x === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        }
        // Blue at one end of the sheet, warm at the other, the middle near white.
        const r = Math.round(70 + 185 * Math.max(0, f - 0.45) * 1.8)
        const g = Math.round(140 + 60 * (1 - Math.abs(f - 0.5) * 2))
        const b = Math.round(255 - 170 * Math.max(0, f - 0.4) * 1.6)
        ctx.strokeStyle = `rgba(${Math.min(255, r)},${g},${Math.max(60, b)},${(0.1 + 0.2 * Math.sin(f * Math.PI)).toFixed(3)})`
        ctx.stroke()
      }
      ctx.globalCompositeOperation = 'source-over'
    },
  }
}

/** The Udaan mark, lit from within, with slow rings of light and bokeh drifting past. */
function drift(w: number, h: number): Scene {
  const img = new Image()
  img.src = '/logo/udaan.png'
  const bokeh = Array.from({ length: 22 }, () => ({ x: Math.random(), y: Math.random(), r: 0.012 + Math.random() * 0.05, z: 0.3 + Math.random() * 0.7, ph: Math.random() * TAU, hue: Math.random() }))
  return {
    draw(ctx, t, dt) {
      ctx.globalCompositeOperation = 'source-over'
      const bg = ctx.createRadialGradient(w / 2, h * 0.52, 0, w / 2, h * 0.52, Math.max(w, h) * 0.7)
      bg.addColorStop(0, '#0c1224')
      bg.addColorStop(1, '#030409')
      ctx.fillStyle = bg
      ctx.fillRect(0, 0, w, h)
      ctx.globalCompositeOperation = 'lighter'
      for (const b of bokeh) {
        b.y -= 0.006 * b.z * dt
        b.x += Math.sin(t * 0.1 + b.ph) * 0.0002
        if (b.y < -0.1) b.y = 1.1
        const x = b.x * w
        const y = b.y * h
        const r = b.r * Math.max(w, h)
        const g = ctx.createRadialGradient(x, y, 0, x, y, r)
        const c = b.hue > 0.6 ? '255,160,90' : b.hue > 0.3 ? '90,170,255' : '170,200,255'
        g.addColorStop(0, `rgba(${c},${(0.07 * b.z).toFixed(3)})`)
        g.addColorStop(0.7, `rgba(${c},${(0.045 * b.z).toFixed(3)})`)
        g.addColorStop(1, `rgba(${c},0)`)
        ctx.fillStyle = g
        ctx.beginPath()
        ctx.arc(x, y, r, 0, TAU)
        ctx.fill()
      }
      const cx = w / 2
      const cy = h / 2
      for (let i = 0; i < 4; i++) {
        const k = (t * 0.07 + i / 4) % 1
        ctx.strokeStyle = `rgba(140,190,255,${(0.16 * (1 - k)).toFixed(3)})`
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.arc(cx, cy, Math.min(w, h) * (0.2 + 0.5 * k), 0, TAU)
        ctx.stroke()
      }
      const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.min(w, h) * 0.46)
      const breathe = 0.2 + 0.05 * Math.sin(t * 0.6)
      glow.addColorStop(0, `rgba(80,140,255,${breathe.toFixed(3)})`)
      glow.addColorStop(0.5, 'rgba(255,140,60,0.05)')
      glow.addColorStop(1, 'rgba(80,140,255,0)')
      ctx.fillStyle = glow
      ctx.fillRect(0, 0, w, h)
      ctx.globalCompositeOperation = 'source-over'
      if (img.complete && img.naturalWidth) {
        const s = Math.min(w, h) * (0.36 + 0.008 * Math.sin(t * 0.6))
        ctx.drawImage(img, cx - s / 2, cy - s / 2 + Math.sin(t * 0.4) * h * 0.008, s, s)
      }
    },
  }
}

const SCENES: Record<CinemaKind, (w: number, h: number) => Scene> = { aurora, warp, flow, drift }

export function CinemaCanvas({ kind, className, scale = 0.5, fps = 30, paused = false, still = false }: { kind: CinemaKind; className?: string; scale?: number; fps?: number; paused?: boolean; still?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const cv = ref.current
    if (!cv) return
    const ctx = cv.getContext('2d', { alpha: false })
    if (!ctx) return
    const fit = () => {
      cv.width = Math.max(64, Math.round(cv.clientWidth * scale))
      cv.height = Math.max(36, Math.round(cv.clientHeight * scale))
    }
    fit()
    let scene = SCENES[kind](cv.width, cv.height)
    const renderStill = () => {
      t = 0
      for (let i = 0; i < 30; i++) {
        t += 0.1
        scene.draw(ctx, t, 0.1, cv.width, cv.height)
      }
    }
    const ro = new ResizeObserver(() => {
      fit()
      scene = SCENES[kind](cv.width, cv.height)
      if (still) renderStill()
    })
    ro.observe(cv)

    let raf = 0
    let last = performance.now()
    let t = 0
    const step = 1000 / fps
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame)
      if (document.hidden || paused) {
        last = now
        return
      }
      const elapsed = now - last
      if (elapsed < step) return
      last = now
      const dt = Math.min(0.1, elapsed / 1000)
      t += dt
      scene.draw(ctx, t, dt, cv.width, cv.height)
    }
    if (still) {
      // One frame, advanced a little so it is not an empty first frame.
      renderStill()
    } else {
      raf = requestAnimationFrame(frame)
    }
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, [kind, scale, fps, paused, still])

  return (
    <div className={`relative h-full w-full ${className ?? ''}`}>
      <canvas ref={ref} style={{ width: '100%', height: '100%', display: 'block' }} aria-hidden />
      {/* Fine film grain over everything: it hides banding in the dark gradients and gives the picture a photographic finish. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.1] mix-blend-overlay" style={{ backgroundImage: 'var(--u-grain)', backgroundSize: '96px 96px' }} />
    </div>
  )
}
