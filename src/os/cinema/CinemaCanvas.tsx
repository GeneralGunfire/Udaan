import { useEffect, useRef } from 'react'

/**
 * CINEMA: the animated canvas scenes behind the boot screen and the screensavers.
 *
 *   aurora    luminous ribbons of colour drifting like northern lights
 *   flow      "Currents": light carried along an invisible current
 *   daylight  a soft colour mesh that follows the hour of the day
 *
 * Built for a slow PC: a 2D canvas drawn at a reduced internal size and scaled up by CSS (the scenes are
 * soft, so nothing is lost), capped at 30 frames a second, paused while hidden. Nothing runs when it is
 * not on screen.
 */
export type CinemaKind = 'aurora' | 'flow' | 'daylight'

interface Scene {
  draw(ctx: CanvasRenderingContext2D, t: number, dt: number, w: number, h: number): void
}

const PALETTE = [
  [48, 114, 240], // blue
  [0, 200, 255], // cyan
  [255, 140, 40], // orange
  [255, 70, 50], // red-orange
  [150, 90, 255], // violet
]

function aurora(w: number, h: number): Scene {
  const blobs = PALETTE.concat(PALETTE.slice(0, 2)).map((c, i) => ({ c, sx: 0.07 + 0.045 * ((i * 7) % 5), sy: 0.05 + 0.04 * ((i * 3) % 4), ph: i * 1.7, r: 0.42 + 0.12 * (i % 3) }))
  return {
    draw(ctx, t) {
      ctx.globalCompositeOperation = 'source-over'
      const bg = ctx.createLinearGradient(0, 0, 0, h)
      bg.addColorStop(0, '#04050a')
      bg.addColorStop(1, '#0a0d18')
      ctx.fillStyle = bg
      ctx.fillRect(0, 0, w, h)
      ctx.globalCompositeOperation = 'lighter'
      for (const b of blobs) {
        const x = w * (0.5 + 0.42 * Math.sin(t * b.sx + b.ph))
        const y = h * (0.5 + 0.34 * Math.cos(t * b.sy + b.ph * 1.31))
        const r = Math.max(w, h) * b.r
        const g = ctx.createRadialGradient(x, y, 0, x, y, r)
        g.addColorStop(0, `rgba(${b.c[0]},${b.c[1]},${b.c[2]},0.34)`)
        g.addColorStop(0.55, `rgba(${b.c[0]},${b.c[1]},${b.c[2]},0.10)`)
        g.addColorStop(1, `rgba(${b.c[0]},${b.c[1]},${b.c[2]},0)`)
        ctx.fillStyle = g
        ctx.fillRect(0, 0, w, h)
      }
      // A few translucent ribbons give the glow direction, like curtains of light.
      ctx.globalCompositeOperation = 'screen'
      for (let k = 0; k < 3; k++) {
        const c = PALETTE[(k * 2) % PALETTE.length]
        ctx.beginPath()
        const base = h * (0.35 + 0.18 * k)
        ctx.moveTo(0, h)
        for (let x = 0; x <= w; x += 8) {
          const y = base + Math.sin(x * 0.006 + t * (0.18 + k * 0.05) + k) * h * 0.09 + Math.sin(x * 0.015 - t * 0.12) * h * 0.025
          ctx.lineTo(x, y)
        }
        ctx.lineTo(w, h)
        ctx.closePath()
        const g = ctx.createLinearGradient(0, base - h * 0.15, 0, h)
        g.addColorStop(0, `rgba(${c[0]},${c[1]},${c[2]},0.16)`)
        g.addColorStop(1, `rgba(${c[0]},${c[1]},${c[2]},0)`)
        ctx.fillStyle = g
        ctx.fill()
      }
      ctx.globalCompositeOperation = 'source-over'
    },
  }
}

function flow(w: number, h: number): Scene {
  const N = Math.max(120, Math.min(900, Math.round((w * h) / 576)))
  const ps = Array.from({ length: N }, () => ({ x: Math.random() * w, y: Math.random() * h, life: Math.random() * 200 }))
  return {
    draw(ctx, t, dt) {
      ctx.globalCompositeOperation = 'source-over'
      ctx.fillStyle = 'rgba(4,5,10,0.07)'
      ctx.fillRect(0, 0, w, h)
      ctx.globalCompositeOperation = 'lighter'
      const sp = 38 * dt
      for (const p of ps) {
        const a = (Math.sin(p.x * 0.0042 + t * 0.21) + Math.cos(p.y * 0.0051 - t * 0.17) + Math.sin((p.x + p.y) * 0.0031 + t * 0.09)) * 1.05
        const nx = p.x + Math.cos(a) * sp
        const ny = p.y + Math.sin(a) * sp
        const k = (a / 3 + 1) / 2
        const r = Math.round(40 + 215 * k)
        const g = Math.round(130 + 10 * k)
        const b = Math.round(255 - 190 * k)
        ctx.strokeStyle = `rgba(${r},${g},${b},0.55)`
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(p.x, p.y)
        ctx.lineTo(nx, ny)
        ctx.stroke()
        p.x = nx
        p.y = ny
        p.life -= 1
        if (p.life < 0 || p.x < -5 || p.x > w + 5 || p.y < -5 || p.y > h + 5) {
          p.x = Math.random() * w
          p.y = Math.random() * h
          p.life = 120 + Math.random() * 200
        }
      }
      ctx.globalCompositeOperation = 'source-over'
    },
  }
}

/** Colours of the sky by hour: deep blues at night, rose at dawn, clear blue by day, amber at dusk. */
function skyFor(hour: number): { bg: string; lights: number[][] } {
  if (hour >= 5 && hour < 8) return { bg: '#0b0f1c', lights: [[255, 150, 120], [250, 200, 140], [90, 120, 220], [170, 110, 200]] }
  if (hour >= 8 && hour < 17) return { bg: '#0a1426', lights: [[70, 150, 240], [120, 200, 250], [60, 110, 220], [150, 200, 255]] }
  if (hour >= 17 && hour < 20) return { bg: '#0d0b18', lights: [[255, 130, 60], [230, 80, 110], [120, 70, 200], [255, 190, 110]] }
  return { bg: '#04050a', lights: [[28, 70, 190], [60, 50, 170], [20, 110, 170], [90, 60, 190]] }
}

function daylight(w: number, h: number): Scene {
  const motion = [
    { r: 0.62, sx: 0.04, sy: 0.034, ph: 0.2, a: 0.34 },
    { r: 0.5, sx: 0.052, sy: 0.045, ph: 2.1, a: 0.26 },
    { r: 0.46, sx: 0.046, sy: 0.04, ph: 3.9, a: 0.24 },
    { r: 0.56, sx: 0.036, sy: 0.05, ph: 5.2, a: 0.26 },
  ]
  return {
    draw(ctx, t) {
      const sky = skyFor(new Date().getHours())
      ctx.globalCompositeOperation = 'source-over'
      ctx.fillStyle = sky.bg
      ctx.fillRect(0, 0, w, h)
      ctx.globalCompositeOperation = 'screen'
      motion.forEach((l, i) => {
        const c = sky.lights[i % sky.lights.length]
        const x = w * (0.5 + 0.38 * Math.sin(t * l.sx + l.ph))
        const y = h * (0.5 + 0.3 * Math.cos(t * l.sy * 1.3 + l.ph))
        const r = Math.max(w, h) * l.r
        const g = ctx.createRadialGradient(x, y, 0, x, y, r)
        g.addColorStop(0, `rgba(${c[0]},${c[1]},${c[2]},${l.a})`)
        g.addColorStop(0.5, `rgba(${c[0]},${c[1]},${c[2]},${(l.a * 0.35).toFixed(3)})`)
        g.addColorStop(1, `rgba(${c[0]},${c[1]},${c[2]},0)`)
        ctx.fillStyle = g
        ctx.fillRect(0, 0, w, h)
      })
      ctx.globalCompositeOperation = 'source-over'
    },
  }
}

const SCENES: Record<CinemaKind, (w: number, h: number) => Scene> = { aurora, flow, daylight }

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
    let t = 0
    const renderStill = () => {
      t = 0
      // Played at the real frame rate for a few seconds, so the still looks like a frame of the real thing.
      for (let i = 0; i < 90; i++) {
        t += 1 / 30
        scene.draw(ctx, t, 1 / 30, cv.width, cv.height)
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
    if (still) renderStill()
    else raf = requestAnimationFrame(frame)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, [kind, scale, fps, paused, still])

  return <canvas ref={ref} className={className} style={{ width: '100%', height: '100%', display: 'block' }} aria-hidden />
}
