import { useEffect, useRef } from 'react'

interface SoundBarsProps {
  analyser: AnalyserNode | null
  isPlaying: boolean
  /** Number of bars to render — fewer for a compact mini-player badge, more for the Now Playing hero. */
  barCount?: number
  className?: string
  /** Reflection beneath the bars, for the hero-sized Now Playing placement
   * where there's room for one. Off by default (the compact mini-player/
   * header badges don't have the vertical space). */
  reflection?: boolean
}

// Below this a bar is drawn at 0 height rather than floored to a minimum
// — a floor meant every bar had *some* height even at total silence,
// which at low levels made adjacent bars' minimum stubs touch and read
// as one solid connected strip instead of distinct bars.
const SILENCE_THRESHOLD = 0.012

/**
 * Real frequency-domain equalizer bars — a read-only tap off the shared
 * playback analyser (getByteFrequencyData), grouped into `barCount` bands
 * by averaging contiguous FFT bins (the analyser's default fftSize gives
 * far more bins than any reasonable bar count needs). Distinct from
 * LevelMeter (single RMS loudness bar) and EdgeGlow (ambient background
 * glow) — this is the classic multi-bar "equalizer" visual, sized to sit
 * inline next to transport controls per the reference music-app layout.
 */
export function SoundBars({ analyser, isPlaying, barCount = 24, className, reflection = false }: SoundBarsProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const rafRef = useRef<number | null>(null)
  const barsRef = useRef<Float32Array>(new Float32Array(barCount))

  useEffect(() => {
    barsRef.current = new Float32Array(barCount)
  }, [barCount])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const freqData = new Uint8Array(analyser?.frequencyBinCount ?? 1024)
    // Canvas gradients don't resolve CSS custom properties, so the accent
    // colour is read from the resolved computed style once per mount
    // rather than passed as a literal `var(--color-accent)` string.
    const accentColor = getComputedStyle(canvas).getPropertyValue('--color-accent').trim() || '#4a7fb5'
    const accentBright = getComputedStyle(canvas).getPropertyValue('--color-accent-alt').trim() || accentColor

    function resize() {
      if (!canvas) return
      const rect = canvas.getBoundingClientRect()
      canvas.width = Math.max(1, rect.width * window.devicePixelRatio)
      canvas.height = Math.max(1, rect.height * window.devicePixelRatio)
    }
    resize()
    window.addEventListener('resize', resize)

    function draw() {
      if (!canvas || !ctx) return
      const { width, height } = canvas
      ctx.clearRect(0, 0, width, height)

      const bars = barsRef.current
      if (analyser && isPlaying) {
        analyser.getByteFrequencyData(freqData)
        // Bias toward the lower/mid bins (bass+vocal range reads as the
        // "musical" part of a spectrum) rather than a linear spread across
        // the full range, most of which is near-silent high frequency.
        const usableBins = Math.floor(freqData.length * 0.5)
        const binsPerBar = usableBins / barCount
        for (let i = 0; i < barCount; i++) {
          const start = Math.floor(i * binsPerBar)
          const end = Math.max(start + 1, Math.floor((i + 1) * binsPerBar))
          let sum = 0
          for (let b = start; b < end; b++) sum += freqData[b]
          const avg = sum / (end - start) / 255
          // The analyser itself already smooths (smoothingTimeConstant:
          // 0.55 — see audioGraph.ts/usePlayerEngine.ts), so stacking a
          // slow second exponential smoothing on top of that (this used to
          // be 0.22) compounded into visibly laggy, mushy-feeling bars —
          // real transients in the source audio were already softened once
          // before they ever reached this loop. A faster attack here lets
          // bars actually track the beat instead of smearing it further.
          bars[i] = bars[i] + (avg - bars[i]) * 0.55
        }
      } else {
        for (let i = 0; i < barCount; i++) bars[i] = bars[i] * 0.9
      }

      // Bar geometry — gap and width both derived from the same unit so
      // (barWidth + gap) * barCount - gap exactly equals the canvas width
      // with no rounding slop that could leave bars overlapping by a
      // fractional pixel at certain widths.
      const unit = width / (barCount + (barCount - 1) * 0.28)
      const barWidth = unit
      const gap = unit * 0.28
      const radius = Math.min(barWidth / 2, 3 * window.devicePixelRatio)

      const REFLECTION_HEIGHT = 0.3
      const REFLECTION_GAP = 0.05
      const barsAreaHeight = reflection ? height * (1 - REFLECTION_HEIGHT - REFLECTION_GAP) : height
      const reflectionTop = height * (1 - REFLECTION_HEIGHT)

      for (let i = 0; i < barCount; i++) {
        const level = Math.min(1, bars[i] * 1.9)
        if (level < SILENCE_THRESHOLD) continue

        const barHeight = level * barsAreaHeight
        const x = i * (barWidth + gap)
        const y = barsAreaHeight - barHeight

        const gradient = ctx.createLinearGradient(0, barsAreaHeight, 0, 0)
        gradient.addColorStop(0, accentColor)
        gradient.addColorStop(1, accentBright)
        ctx.fillStyle = gradient
        ctx.beginPath()
        ctx.roundRect(x, y, barWidth, barHeight, radius)
        ctx.fill()

        if (reflection) {
          const reflHeight = Math.min(barHeight, height * REFLECTION_HEIGHT)
          const reflGrad = ctx.createLinearGradient(0, reflectionTop, 0, reflectionTop + reflHeight)
          reflGrad.addColorStop(0, `color-mix(in srgb, ${accentColor} 35%, transparent)`)
          reflGrad.addColorStop(1, 'transparent')
          ctx.fillStyle = reflGrad
          ctx.beginPath()
          ctx.roundRect(x, reflectionTop, barWidth, reflHeight, radius)
          ctx.fill()
        }
      }

      rafRef.current = requestAnimationFrame(draw)
    }
    draw()

    return () => {
      window.removeEventListener('resize', resize)
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    }
  }, [analyser, isPlaying, barCount, reflection])

  return (
    <div className={className} aria-hidden>
      <canvas ref={canvasRef} className="h-full w-full" />
    </div>
  )
}
