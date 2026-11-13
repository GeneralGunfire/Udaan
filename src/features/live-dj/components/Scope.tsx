import { useEffect, useRef } from 'react'

const BARS = 72

/** Live spectrum of the processed signal, read from the deck's analyser
 * (a pure tap: it never sits in the signal path). */
export function Scope({ analyser, live }: { analyser: AnalyserNode | null; live: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const data = new Uint8Array(analyser?.frequencyBinCount ?? 1024)
    const peaks = new Float32Array(BARS)
    let raf = 0
    const accent = () => getComputedStyle(canvas).getPropertyValue('--color-accent').trim() || '#7aa2ff'

    const draw = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const w = canvas.clientWidth * dpr
      const h = canvas.clientHeight * dpr
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w
        canvas.height = h
      }
      ctx.clearRect(0, 0, w, h)
      if (analyser && live) analyser.getByteFrequencyData(data)
      else data.fill(0)

      // Log-spaced bars from ~40 Hz to 16 kHz.
      const sr = analyser?.context.sampleRate ?? 48000
      const binHz = sr / 2 / data.length
      const gap = 2 * dpr
      const bw = (w - gap * (BARS - 1)) / BARS
      ctx.fillStyle = accent()
      for (let i = 0; i < BARS; i++) {
        const f0 = 40 * Math.pow(16000 / 40, i / BARS)
        const f1 = 40 * Math.pow(16000 / 40, (i + 1) / BARS)
        const lo = Math.max(1, Math.floor(f0 / binHz))
        const hi = Math.max(lo + 1, Math.ceil(f1 / binHz))
        let m = 0
        for (let b = lo; b < hi && b < data.length; b++) m = Math.max(m, data[b])
        const v = Math.pow(m / 255, 1.6)
        peaks[i] = Math.max(v, peaks[i] - 0.012)
        const bh = Math.max(2 * dpr, v * h)
        const x = i * (bw + gap)
        ctx.globalAlpha = 0.85
        ctx.fillRect(x, h - bh, bw, bh)
        ctx.globalAlpha = 0.45
        ctx.fillRect(x, h - Math.max(bh, peaks[i] * h) - 2 * dpr, bw, 2 * dpr)
      }
      ctx.globalAlpha = 1
      raf = requestAnimationFrame(draw)
    }
    draw()
    return () => cancelAnimationFrame(raf)
  }, [analyser, live])

  return <canvas ref={ref} className="h-full w-full" aria-hidden />
}
