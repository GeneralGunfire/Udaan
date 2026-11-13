import { memo, useEffect, useRef } from 'react'
import { prefersReducedMotion } from '@/shared/lib/motion'
import { daylight, liveWallpaper } from './liveWallpapers'

/**
 * Runs a live wallpaper shader behind the desktop.
 *
 * THE RULES A BACKGROUND ANIMATION MUST FOLLOW
 * --------------------------------------------
 * A wallpaper is the one surface that is always on screen and never looked
 * at directly. That makes it uniquely capable of wasting a machine's
 * resources, so this component is strict about four things:
 *
 *  1. IT STOPS WHEN UNSEEN. `document.hidden`, the desktop being covered by
 *     a maximised window, and losing focus all pause the loop. A paused
 *     loop costs literally nothing — no rAF is scheduled at all.
 *  2. IT CAPS ITS FRAME RATE. 30fps. At background motion speeds this is
 *     indistinguishable from 120fps and costs a quarter as much. Frames are
 *     skipped against a clock, not by a timer, so playback speed stays
 *     correct regardless of when frames actually land.
 *  3. IT RENDERS BELOW NATIVE RESOLUTION. 4K of fragment shader per frame
 *     is wasteful for a defocused background; this draws at 70% and lets the
 *     compositor scale. The difference is invisible on a blurred gradient.
 *  4. IT GIVES UP GRACEFULLY. No WebGL2, a lost context, a shader that
 *     fails to compile, or reduced-motion → it renders nothing and lets the
 *     static <img> underneath show through. The desktop never goes black.
 *
 * The pointer is followed with heavy damping (~8% per frame). Tracking the
 * raw cursor makes the whole desktop feel twitchy; a slow follow reads as
 * the light responding to you.
 */
export const LiveWallpaperCanvas = memo(function LiveWallpaperCanvas({
  id,
  paused = false,
  onFailed,
}: {
  id: string
  /** The desktop is covered or otherwise not worth animating. */
  paused?: boolean
  /** Called if the shader cannot run, so the caller can show the static image. */
  onFailed?: () => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // Held in a ref so the pointer handler never triggers a React render.
  const pointer = useRef({ x: 0.5, y: 0.5, tx: 0.5, ty: 0.5 })
  const pausedRef = useRef(paused)
  pausedRef.current = paused

  useEffect(() => {
    const def = liveWallpaper(id)
    const canvas = canvasRef.current
    if (!def || !canvas) return
    if (prefersReducedMotion()) {
      onFailed?.()
      return
    }

    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'low-power' })
    if (!gl) {
      onFailed?.()
      return
    }

    /* ---- compile ---- */
    const compile = (type: number, src: string) => {
      const s = gl.createShader(type)!
      gl.shaderSource(s, src)
      gl.compileShader(s)
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        console.error('[live-wallpaper] shader', gl.getShaderInfoLog(s))
        gl.deleteShader(s)
        return null
      }
      return s
    }
    const vs = compile(gl.VERTEX_SHADER, '#version 300 es\nin vec2 pos;\nvoid main(){gl_Position=vec4(pos,0.,1.);}')
    const fs = compile(gl.FRAGMENT_SHADER, def.fragment)
    if (!vs || !fs) {
      onFailed?.()
      return
    }
    const prog = gl.createProgram()!
    gl.attachShader(prog, vs)
    gl.attachShader(prog, fs)
    gl.linkProgram(prog)
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.error('[live-wallpaper] link', gl.getProgramInfoLog(prog))
      onFailed?.()
      return
    }
    gl.useProgram(prog)

    const buf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    const loc = gl.getAttribLocation(prog, 'pos')
    gl.enableVertexAttribArray(loc)
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)

    const u = {
      resolution: gl.getUniformLocation(prog, 'uResolution'),
      time: gl.getUniformLocation(prog, 'uTime'),
      pointer: gl.getUniformLocation(prog, 'uPointer'),
      daylight: gl.getUniformLocation(prog, 'uDaylight'),
    }
    const hex = (h: string): [number, number, number] => {
      const n = parseInt(h.replace('#', '').slice(0, 6).padEnd(6, '0'), 16)
      return [((n >> 16) & 0xff) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255]
    }
    ;['uC0', 'uC1', 'uC2', 'uC3'].forEach((name, i) => {
      const l = gl.getUniformLocation(prog, name)
      if (l) gl.uniform3fv(l, hex(def.palette[i] ?? def.palette[def.palette.length - 1]))
    })

    /* ---- sizing: render below native, let the compositor scale ---- */
    const SCALE = 0.7
    let width = 0
    let height = 0
    const resize = () => {
      const w = Math.max(1, Math.round(window.innerWidth * SCALE))
      const h = Math.max(1, Math.round(window.innerHeight * SCALE))
      if (w === width && h === height) return
      width = w
      height = h
      canvas.width = w
      canvas.height = h
      gl.viewport(0, 0, w, h)
      gl.uniform2f(u.resolution, w, h)
    }
    resize()
    window.addEventListener('resize', resize)

    /* ---- pointer, heavily damped ---- */
    const onPointer = (e: PointerEvent) => {
      pointer.current.tx = e.clientX / window.innerWidth
      // GL's y runs up the screen; the DOM's runs down.
      pointer.current.ty = 1 - e.clientY / window.innerHeight
    }
    window.addEventListener('pointermove', onPointer, { passive: true })

    /* ---- loop ---- */
    const FRAME_MS = 1000 / 30
    let raf = 0
    let lastDraw = 0
    let daylightValue = daylight()
    const start = performance.now()

    // Recomputed every minute rather than every frame: the sun does not
    // move fast enough to justify a Date allocation at 30fps.
    const dayTimer = setInterval(() => {
      daylightValue = daylight()
    }, 60_000)

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame)
      if (pausedRef.current || document.hidden) return
      if (now - lastDraw < FRAME_MS) return
      lastDraw = now

      const p = pointer.current
      // ~8% per frame: slow enough to read as the scene responding, not
      // the cursor being mirrored.
      p.x += (p.tx - p.x) * 0.08
      p.y += (p.ty - p.y) * 0.08

      gl.uniform1f(u.time, (now - start) / 1000)
      gl.uniform2f(u.pointer, p.x, p.y)
      gl.uniform1f(u.daylight, daylightValue)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
    }
    raf = requestAnimationFrame(frame)

    /* ---- context loss: the GPU can reclaim a background context ---- */
    const onLost = (e: Event) => {
      e.preventDefault()
      cancelAnimationFrame(raf)
      onFailed?.()
    }
    canvas.addEventListener('webglcontextlost', onLost)

    return () => {
      cancelAnimationFrame(raf)
      clearInterval(dayTimer)
      window.removeEventListener('resize', resize)
      window.removeEventListener('pointermove', onPointer)
      canvas.removeEventListener('webglcontextlost', onLost)
      gl.deleteBuffer(buf)
      gl.deleteProgram(prog)
      gl.deleteShader(vs)
      gl.deleteShader(fs)
      // Free the VRAM now; a 4K context is not small and the GC is lazy.
      gl.getExtension('WEBGL_lose_context')?.loseContext()
    }
  }, [id, onFailed])

  return <canvas ref={canvasRef} aria-hidden className="absolute inset-0 h-full w-full" style={{ display: 'block' }} />
})
