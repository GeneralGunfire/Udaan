import { memo, useEffect, useRef, useState, type RefObject } from 'react'
import { convertFileSrc, invoke } from '@tauri-apps/api/core'
import { usePref } from '@/os/kernel/prefs'
import { usePoll } from '@/os/kernel/poll'
import { shell } from '@/os/kernel/shell'
import { useWallpaper } from '@/shared/hooks/useWallpaper'
import { LOOK_PARAMS, FRAG, VERT } from './shader'
import { useLiquid, type BarLiquid, type LiquidRole } from './config'

/**
 * The liquid-glass fill of a bar (the dock or the top bar), drawn on the GPU behind the bar's own widgets.
 *
 * It replaces ONLY the bar's background: layout, icons, menus, hit-testing and hover are untouched. While it
 * is on, the old fill is hidden by CSS keyed on `<html data-liquid>` (see ui.css), and turning it off in
 * Settings brings the old fill straight back.
 *
 * COST. CPU per frame is one uniform write and one tiny draw; nothing is allocated per frame. Rendering is
 * capped at 30 fps and falls to 10 fps after 30 s without input anywhere in Windows (`shell_idle_ms`). It stops
 * completely, with no redraw requests, while the bar is hidden (lock screen, screensaver, full-screen app), while
 * motion is frozen (the Freeze setting, "Turn off animations", or the Eco power profile). Time is accumulated,
 * so pausing and resuming never makes the surface jump.
 */

const FPS_ACTIVE = 30
const FPS_IDLE = 10
const FPS_TIGHT = 15 // the engine says memory is short: ease off
const IDLE_AFTER_MS = 30_000

type Role = LiquidRole
/** The dock and top bar own the plain-fill override (`<html data-liquid>`); cards simply paint their own canvas. */
const isBar = (r: Role) => r === 'dock' || r === 'bar'

interface Live {
  cfg: BarLiquid
  /** How hard the wallpaper behind this bar is on legibility: its brightness plus how busy it is (see useBackdropDemand). */
  demand: number
  paused: boolean
  frozen: boolean
}

/** Over a bright or busy wallpaper the liquid gets more solid, so the bar and its text stay readable. */
function effectiveOpacity(opacity: number, demand: number): number {
  return Math.min(Math.max(opacity, 0.92), opacity + Math.max(0, demand - 0.22) * 1.3)
}

/**
 * How much the wallpaper under this bar works against legible text: its average brightness (0 black to 1 white)
 * plus how busy it is (contrast between neighbouring pixels). A plain dark picture asks for nothing; a white one,
 * or a detailed photo, asks for a more solid bar.
 */
function useBackdropDemand(role: Role, barRef: RefObject<HTMLElement | null>): number {
  const { wallpaperId, revision } = useWallpaper()
  const [demand, setDemand] = useState(0.2)
  useEffect(() => {
    let cancelled = false
    if (wallpaperId.startsWith('color:')) {
      const n = parseInt(wallpaperId.slice(7), 16)
      const l = (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255
      setDemand(Number.isFinite(l) ? l : 0.2)
      return
    }
    if (!wallpaperId.startsWith('file:')) return
    void (async () => {
      let url = convertFileSrc(wallpaperId.slice(5))
      try {
        url = convertFileSrc(await invoke<string>('wallpaper_render', { path: wallpaperId.slice(5), width: 192, height: 108 }))
      } catch {
        /* the original picture works too, just larger */
      }
      if (cancelled) return
      const img = new Image()
      img.crossOrigin = 'anonymous' // local pictures come from the app's own protocol; without this the canvas cannot be read
      img.onload = () => {
        if (cancelled) return
        const cw = 192
        const ch = 108
        const cv = document.createElement('canvas')
        cv.width = cw
        cv.height = ch
        const ctx = cv.getContext('2d', { willReadFrequently: true })
        if (!ctx) return
        ctx.drawImage(img, 0, 0, cw, ch)
        const sw = window.screen.width
        const sh = window.screen.height
        const bar = barRef.current
        const rect = bar?.getBoundingClientRect()
        const bw = bar?.offsetWidth || (role === 'dock' ? 660 : sw)
        const bh = bar?.offsetHeight || (role === 'dock' ? 54 : 34)
        // The bars sit at known places; a card is wherever it was opened.
        const x0 = role === 'dock' ? (sw - bw) / 2 : role === 'bar' ? 0 : window.screenX + (rect?.left ?? 0)
        const y0 = role === 'dock' ? sh - 5 - bh : role === 'bar' ? 0 : window.screenY + (rect?.top ?? 0)
        const gx0 = Math.max(0, Math.floor((x0 / sw) * cw))
        const gx1 = Math.min(cw, Math.max(gx0 + 1, Math.ceil(((x0 + bw) / sw) * cw)))
        const gy0 = Math.max(0, Math.floor((y0 / sh) * ch))
        const gy1 = Math.min(ch, Math.max(gy0 + 1, Math.ceil(((y0 + bh) / sh) * ch)))
        try {
          const d = ctx.getImageData(gx0, gy0, gx1 - gx0, gy1 - gy0).data
          const n = d.length / 4
          let sum = 0
          let sq = 0
          for (let i = 0; i < d.length; i += 4) {
            const v = (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255
            sum += v
            sq += v * v
          }
          const mean = sum / n
          const busy = Math.sqrt(Math.max(0, sq / n - mean * mean))
          setDemand(mean + busy * 0.9)
        } catch {
          /* unreadable: keep the last value */
        }
      }
      img.src = url
    })()
    return () => {
      cancelled = true
    }
  }, [wallpaperId, revision, role, barRef])
  return demand
}

interface Renderer {
  layout: () => void
  apply: () => void
  wake: () => void
}

export const LiquidGlass = memo(function LiquidGlass({ role, barRef, paused, radius = 20 }: { role: Role; barRef: RefObject<HTMLElement | null>; paused: boolean; radius?: number }) {
  const { enabled, config } = useLiquid()
  const [profile] = usePref('power.profile')
  const [motionOff] = usePref('motion.off')
  const demand = useBackdropDemand(role, barRef)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const renderer = useRef<Renderer | null>(null)
  const idle = useRef(false)

  const live = useRef<Live>({ cfg: config[role], demand, paused, frozen: false })
  // A solid card is opaque and still: one frame, drawn once, nothing shows through and nothing animates.
  const solid = config[role].solid
  live.current = { cfg: solid ? { ...config[role], opacity: 1, contrast: Math.min(config[role].contrast, 0.25) } : config[role], demand: solid ? 0 : demand, paused, frozen: solid || config.frozen || motionOff || profile === 'eco' }

  // Every change of setting, wallpaper or state goes to the renderer, which redraws once (or resumes).
  useEffect(() => {
    renderer.current?.apply()
  })

  // "Is the user away?": ask the engine every few seconds (it stops while this window is hidden).
  usePoll(
    () =>
      void shell.idleMs().then(
        (ms) => {
          const now = ms > IDLE_AFTER_MS
          if (now === idle.current) return
          idle.current = now
          renderer.current?.wake()
        },
        () => {},
      ),
    5000,
    enabled && !live.current.frozen,
  )

  useEffect(() => {
    if (!enabled) return
    const canvas = canvasRef.current
    const bar = barRef.current
    if (!canvas || !bar) return
    const gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, powerPreference: 'low-power' })
    if (!gl) return // no GPU path: the bar keeps its normal fill

    const compile = (type: number, src: string) => {
      const s = gl.createShader(type)!
      gl.shaderSource(s, src)
      gl.compileShader(s)
      return s
    }
    const prog = gl.createProgram()!
    const vs = compile(gl.VERTEX_SHADER, VERT)
    const fs = compile(gl.FRAGMENT_SHADER, FRAG)
    gl.attachShader(prog, vs)
    gl.attachShader(prog, fs)
    gl.linkProgram(prog)
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.error('[liquid] shader failed:', gl.getShaderInfoLog(fs))
      return // keep the normal fill rather than a broken bar
    }
    gl.useProgram(prog)
    const buf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW) // one big triangle
    const loc = gl.getAttribLocation(prog, 'a')
    gl.enableVertexAttribArray(loc)
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)
    const u: Record<string, WebGLUniformLocation | null> = {}
    for (const n of ['uSize', 'uOrigin', 'uDpr', 'uT', 'uSc', 'uRadius', 'uAmp', 'uTimeMul', 'uSmooth', 'uBright', 'uOpacity', 'uContrast', 'uEdge', 'uLook']) u[n] = gl.getUniformLocation(prog, n)
    gl.disable(gl.DEPTH_TEST)
    gl.clearColor(0, 0, 0, 0)

    const html = document.documentElement
    if (isBar(role)) html.setAttribute('data-liquid', '')

    let T = 0 // accumulated seconds: never jumps
    let lastDraw = performance.now()
    let raf = 0
    let timer = 0
    let hidden = false

    const draw = () => {
      if (!canvas.width) return
      gl.uniform1f(u.uT, T)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
    }

    // Everything that changes only with the size, the settings or the wallpaper: set here, never per frame.
    const setUniforms = () => {
      const w = bar.offsetWidth
      const h = bar.offsetHeight
      if (!w || !h) return false
      const dpr = window.devicePixelRatio || 1
      const pw = Math.max(1, Math.round(w * dpr))
      const ph = Math.max(1, Math.round(h * dpr))
      if (canvas.width !== pw || canvas.height !== ph) {
        canvas.width = pw
        canvas.height = ph
        gl.viewport(0, 0, pw, ph)
      }
      const { cfg, demand: need } = live.current
      const look = LOOK_PARAMS[cfg.look]
      gl.uniform2f(u.uSize, w, h)
      // Where the bar is on the screen, so the dock and the top bar sample one continuous liquid field.
      const rect = bar.getBoundingClientRect()
      gl.uniform2f(u.uOrigin, window.screenX + (isBar(role) ? bar.offsetLeft : rect.left), window.screenY + (isBar(role) ? bar.offsetTop : rect.top))
      gl.uniform1f(u.uDpr, dpr)
      gl.uniform1f(u.uSc, role === 'bar' ? 0.42 : 1)
      gl.uniform1f(u.uRadius, role === 'dock' ? h / 2 : role === 'bar' ? 0 : Math.min(radius, h / 2, w / 2))
      gl.uniform1f(u.uAmp, look.amp * cfg.amp)
      gl.uniform1f(u.uTimeMul, look.time)
      gl.uniform1f(u.uSmooth, look.smooth)
      gl.uniform1f(u.uBright, role === 'bar' ? 0.6 : 1)
      gl.uniform1f(u.uOpacity, cfg.opacity >= 1 ? 1 : effectiveOpacity(cfg.opacity, need))
      canvas.dataset.demand = need.toFixed(2) // for inspection
      gl.uniform1f(u.uContrast, cfg.contrast)
      gl.uniform1f(u.uEdge, cfg.edge)
      gl.uniform1i(u.uLook, look.id)
      return true
    }

    const stop = () => {
      cancelAnimationFrame(raf)
      clearTimeout(timer)
      raf = timer = 0
    }

    const schedule = () => {
      stop()
      const { paused: p, frozen } = live.current
      // Event-driven: while paused, frozen or hidden nothing is requested at all.
      if (p || frozen || hidden) return
      const tight = html.getAttribute('data-tier') === 'tight'
      const gap = 1000 / (idle.current ? FPS_IDLE : tight ? FPS_TIGHT : FPS_ACTIVE)
      // Wake a little early: the rAF lands on the next vsync, so the period comes out at `gap`.
      const wait = Math.max(0, gap - (performance.now() - lastDraw) - 10)
      timer = window.setTimeout(() => (raf = requestAnimationFrame(frame)), wait)
    }

    const frame = () => {
      raf = 0
      const now = performance.now()
      T += Math.min((now - lastDraw) / 1000, 0.1) * live.current.cfg.speed // a long gap can never make the surface jump
      lastDraw = now
      draw()
      schedule()
    }

    const r: Renderer = {
      layout: () => {
        if (setUniforms()) draw()
      },
      apply: () => {
        if (live.current.frozen) T = 12 // one fixed, good-looking moment
        if (setUniforms()) draw()
        lastDraw = performance.now()
        schedule()
      },
      wake: () => {
        lastDraw = performance.now()
        schedule()
      },
    }
    renderer.current = r

    const ro = new ResizeObserver(r.layout)
    ro.observe(bar)
    const onVis = () => {
      hidden = document.visibilityState !== 'visible'
      r.wake()
    }
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('ui-scale-changed', r.layout)
    r.apply()

    return () => {
      stop()
      ro.disconnect()
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('ui-scale-changed', r.layout)
      renderer.current = null
      if (isBar(role)) html.removeAttribute('data-liquid')
    }
  }, [enabled, role, barRef, radius])

  if (!enabled) return null
  return <canvas ref={canvasRef} data-liquid-canvas aria-hidden className="pointer-events-none absolute left-0 top-0 block h-full w-full" style={{ zIndex: -1 }} />
})
