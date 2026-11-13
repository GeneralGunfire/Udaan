import { useEffect, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { loadEdgeConfig, onEdgeConfig, type EdgeLightConfig } from '@/features/edge-light/config'

const N = 64
const MAX_DPR = 1.5

type RGB = [number, number, number]

function hexToRgb(hex: string): RGB {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  const v = m ? parseInt(m[1], 16) : 0xffffff
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255]
}

function mix(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
}

function hslToRgb(h: number, s: number, l: number): RGB {
  h = ((h % 360) + 360) % 360
  const k = (n: number) => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  return [f(0) * 255, f(8) * 255, f(4) * 255]
}

const css = (c: RGB, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`
const smooth = (x: number) => x * x * (3 - 2 * x)
const WHITE: RGB = [255, 255, 255]

interface Side {
  len: number
  /** Point on the border at distance s along this side (clockwise). */
  at: (s: number) => [number, number]
  /** Unit vector pointing into the screen. */
  n: [number, number]
}

/**
 * Click-through overlay that draws the screen-border light show. The
 * analysis happens in Rust (`shell/edge_light.rs`); this window only
 * smooths the 64 bands it receives and paints them in the user's style:
 * bars with peak caps, one smooth wave, or a soft ambient glow. The paint
 * loop runs only while there is sound to show.
 */
export function EdgeLightWindow() {
  const main = useRef<HTMLCanvasElement>(null)
  const glow = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = main.current!
    const glowCanvas = glow.current!
    const ctx = canvas.getContext('2d')!
    const gctx = glowCanvas.getContext('2d')!

    let cfg: EdgeLightConfig = loadEdgeConfig()
    const target = new Float32Array(N)
    const cur = new Float32Array(N)
    const peak = new Float32Array(N)
    let beat = 0
    let bassAvg = 0
    let beatCooldown = 0
    let phase = 0
    let hue = 0
    let last = 0
    let raf = 0
    let quietFor = 0
    // Slowly-falling loudest recent band: lets quiet music light as brightly as loud music.
    let envelope = 0.3
    let gain = 1
    let W = 0
    let H = 0
    let dpr = 1

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR)
      W = Math.max(1, Math.round(window.innerWidth))
      H = Math.max(1, Math.round(window.innerHeight))
      canvas.width = Math.round(W * dpr)
      canvas.height = Math.round(H * dpr)
      // The bloom layer is drawn at half resolution; the browser blurs and
      // stretches it, which is far cheaper than blurring a full-size canvas.
      glowCanvas.width = Math.max(1, Math.round(canvas.width / 2))
      glowCanvas.height = Math.max(1, Math.round(canvas.height / 2))
    }
    resize()
    window.addEventListener('resize', resize)

    const read = (arr: Float32Array, idx: number) => {
      const x = Math.min(N - 1, Math.max(0, idx * (N - 1)))
      const i = Math.floor(x)
      const f = x - i
      return arr[i] * (1 - f) + arr[Math.min(N - 1, i + 1)] * f
    }

    const colorAt = (u: number, level: number): RGB => {
      const c1 = hexToRgb(cfg.color1)
      const c2 = hexToRgb(cfg.color2)
      switch (cfg.colorMode) {
        case 'solid':
          return c1
        case 'gradient': {
          // Ping-pong so the loop has no seam; drifts with hueSpeed.
          const p = (u + hue / 360) % 1
          return mix(c1, c2, 1 - Math.abs(2 * p - 1))
        }
        case 'rainbow':
          return hslToRgb(u * 360 + hue, 0.9, 0.6)
        case 'level':
          return mix(c1, c2, Math.min(1, level * 1.1))
      }
    }

    const sides = (): Side[] => {
      const all: [keyof EdgeLightConfig['sides'], Side][] = [
        ['top', { len: W, at: (s) => [s, 0], n: [0, 1] }],
        ['right', { len: H, at: (s) => [W, s], n: [-1, 0] }],
        ['bottom', { len: W, at: (s) => [W - s, H], n: [0, -1] }],
        ['left', { len: H, at: (s) => [0, H - s], n: [1, 0] }],
      ]
      return all.filter(([k]) => cfg.sides[k]).map(([, s]) => s)
    }

    const draw = () => {
      const list = sides()
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      if (!list.length) return
      const total = list.reduce((a, s) => a + s.len, 0)
      const beatBoost = beat * cfg.beatPulse
      const thick = cfg.thickness * (1 + beatBoost * 0.8)
      const reach = cfg.height * (1 + beatBoost * 0.12)
      const alpha = Math.min(1, cfg.opacity * (1 + beatBoost * 0.3))
      ctx.lineCap = cfg.rounded ? 'round' : 'butt'
      ctx.lineJoin = 'round'
      const fade = cfg.cornerRadius

      let offset = 0
      for (const side of list) {
        const [nx, ny] = side.n
        const info = (s: number) => {
          let u = (offset + s) / total
          if (cfg.direction === 'anticlockwise') u = 1 - u
          u = (((u + phase) % 1) + 1) % 1
          const idx = cfg.mirror ? 1 - Math.abs(2 * u - 1) : u
          const raw = read(cur, idx)
          const lv = Math.min(1, Math.pow(raw, 1.35))
          // Taper toward the corners so the light reads as rounded.
          const edge = fade > 0 ? smooth(Math.min(1, Math.min(s, side.len - s) / fade)) : 1
          return { u, idx, lv, a: lv * reach * edge, edge }
        }
        const base = (s: number, d: number): [number, number] => {
          const [x, y] = side.at(s)
          return [x + nx * d, y + ny * d]
        }

        if (cfg.style === 'bars') {
          // Equaliser bars standing on the screen edge, each with a falling cap.
          const pitch = thick * (1 + cfg.gap)
          ctx.globalAlpha = alpha
          ctx.lineWidth = thick
          for (let s = pitch / 2; s < side.len; s += pitch) {
            const { u, idx, lv, a, edge } = info(s)
            if (a < 1) continue
            const colour = colorAt(u, lv)
            ctx.strokeStyle = css(colour)
            ctx.beginPath()
            ctx.moveTo(...base(s, 0))
            ctx.lineTo(...base(s, Math.max(thick, a)))
            ctx.stroke()
            if (cfg.peaks) {
              const cap = Math.min(1, Math.pow(read(peak, idx), 1.35)) * reach * edge
              if (cap > a + thick * 0.9) {
                ctx.strokeStyle = css(mix(colour, WHITE, 0.55))
                ctx.lineWidth = Math.max(2, thick * 0.55)
                ctx.beginPath()
                ctx.moveTo(...base(s, cap))
                ctx.lineTo(...base(s, cap + Math.max(1, thick * 0.1)))
                ctx.stroke()
                ctx.lineWidth = thick
              }
            }
          }
        } else {
          // Wave / glow: one smooth shape along the whole side, coloured by a
          // gradient that follows the spectrum.
          const steps = Math.max(2, Math.ceil(side.len / 6))
          const pts: [number, number][] = []
          for (let k = 0; k <= steps; k++) {
            const s = (k / steps) * side.len
            pts.push(base(s, Math.max(0, info(s).a)))
          }
          const [gx0, gy0] = side.at(0)
          const [gx1, gy1] = side.at(side.len)
          const gradient = ctx.createLinearGradient(gx0, gy0, gx1, gy1)
          for (let k = 0; k <= 24; k++) {
            const { u, lv } = info((k / 24) * side.len)
            gradient.addColorStop(k / 24, css(colorAt(u, lv)))
          }
          const trace = () => {
            ctx.moveTo(pts[0][0], pts[0][1])
            for (let k = 1; k < pts.length - 1; k++) {
              const mx = (pts[k][0] + pts[k + 1][0]) / 2
              const my = (pts[k][1] + pts[k + 1][1]) / 2
              ctx.quadraticCurveTo(pts[k][0], pts[k][1], mx, my)
            }
            ctx.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1])
          }
          ctx.beginPath()
          ctx.moveTo(...base(0, 0))
          ctx.lineTo(pts[0][0], pts[0][1])
          trace()
          ctx.lineTo(...base(side.len, 0))
          ctx.closePath()
          ctx.globalAlpha = alpha * (cfg.style === 'glow' ? 0.5 : 0.6)
          ctx.fillStyle = gradient
          ctx.fill()
          ctx.beginPath()
          trace()
          ctx.globalAlpha = alpha
          ctx.strokeStyle = gradient
          ctx.lineWidth = cfg.style === 'glow' ? Math.max(2, thick * 0.7) : Math.max(2, thick * 0.5)
          ctx.stroke()
        }
        offset += side.len
      }
      ctx.globalAlpha = 1

      // Bloom: copy the crisp frame to the half-size layer; CSS blurs it.
      if (cfg.softness > 0 || cfg.style === 'glow') {
        gctx.globalCompositeOperation = 'copy'
        gctx.drawImage(canvas, 0, 0, glowCanvas.width, glowCanvas.height)
      } else {
        gctx.clearRect(0, 0, glowCanvas.width, glowCanvas.height)
      }
    }

    const tick = (now: number) => {
      const dt = Math.min(0.05, last ? (now - last) / 1000 : 1 / 60)
      last = now
      const frames = dt * 60

      // Auto level: follow the loudest recent band slowly (about 6 s to relax),
      // and scale to it, so the light looks the same on a quiet film and a loud track.
      let top = 0
      for (let i = 0; i < N; i++) top = Math.max(top, target[i])
      envelope = Math.max(top, envelope * Math.pow(0.5, dt / 6))
      const wanted = cfg.autoGain ? Math.min(2.8, Math.max(0.8, 0.9 / Math.max(envelope, 0.15))) : 1
      gain += (wanted - gain) * Math.min(1, dt * 1.5)

      // Smoothing: fast attack, slower release, both frame-rate independent.
      const attack = 1 - Math.pow(Math.min(0.9, cfg.smoothing * 0.6), frames)
      const release = 1 - Math.pow(0.55 + cfg.smoothing * 0.4, frames)
      let energy = 0
      for (let i = 0; i < N; i++) {
        const t = Math.min(1, target[i] * cfg.sensitivity * gain)
        cur[i] += (t - cur[i]) * (t > cur[i] ? attack : release)
        // Peak caps jump up with the signal and drift down.
        peak[i] = Math.max(cur[i], peak[i] - dt * 0.32)
        energy += cur[i]
      }

      let bass = 0
      for (let i = 0; i < 8; i++) bass += cur[i]
      bass /= 8
      bassAvg += (bass - bassAvg) * Math.min(1, dt * 1.2)
      beatCooldown -= dt
      if (beatCooldown <= 0 && bass > bassAvg * 1.3 + 0.06) {
        beat = 1
        beatCooldown = 0.18
      }
      beat *= Math.pow(0.88, frames)

      hue = (hue + cfg.hueSpeed * 6 * dt) % 360
      phase = (((phase + (cfg.spin / 60) * dt) % 1) + 1) % 1

      draw()

      quietFor = energy < 0.05 ? quietFor + dt : 0
      if (quietFor > 0.6) {
        ctx.setTransform(1, 0, 0, 1, 0, 0)
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        gctx.clearRect(0, 0, glowCanvas.width, glowCanvas.height)
        peak.fill(0)
        raf = 0
        last = 0
        return
      }
      raf = requestAnimationFrame(tick)
    }
    const wake = () => {
      quietFor = 0
      if (!raf) raf = requestAnimationFrame(tick)
    }

    const applyBloom = () => {
      // A glow needs a wide, soft halo even if softness is set low.
      const blur = cfg.style === 'glow' ? Math.max(cfg.softness, 18) : cfg.softness
      glowCanvas.style.filter = blur > 0 ? `blur(${blur}px)` : 'none'
      glowCanvas.style.opacity = blur > 0 ? (cfg.style === 'glow' ? '1' : '0.9') : '0'
    }
    applyBloom()

    const offCfg = onEdgeConfig((c) => {
      cfg = c
      applyBloom()
      wake()
    })
    const unFrame = listen<{ bands: number[] }>('edge-light:frame', (e) => {
      const b = e.payload.bands
      let any = false
      for (let i = 0; i < N; i++) {
        target[i] = (b[i] ?? 0) / 255
        if (b[i]) any = true
      }
      if (any) wake()
    })

    // The window is created hidden; the first run (and every launch) turns
    // it back on when the setting says so.
    if (cfg.enabled) void invoke('edge_light_set_enabled', { enabled: true }).catch(() => {})

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
      offCfg()
      void unFrame.then((fn) => fn())
    }
  }, [])

  return (
    <div className="pointer-events-none fixed inset-0 overflow-hidden">
      <canvas ref={glow} className="absolute inset-0 h-full w-full" aria-hidden />
      <canvas ref={main} className="absolute inset-0 h-full w-full" aria-hidden />
    </div>
  )
}
