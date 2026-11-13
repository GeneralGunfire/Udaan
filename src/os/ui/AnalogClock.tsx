import { useRef } from 'react'
import { useAnimationFrame } from 'framer-motion'

/**
 * A quiet analogue face: hairline ticks, slim hands, and a second hand that
 * sweeps continuously. Hands are rotated straight on the SVG nodes from the
 * animation frame, so the sweep costs no React renders.
 */
export function AnalogClock({ size, glass = true }: { size: string; glass?: boolean }) {
  const hourRef = useRef<SVGLineElement>(null)
  const minRef = useRef<SVGLineElement>(null)
  const secRef = useRef<SVGGElement>(null)

  useAnimationFrame(() => {
    const d = new Date()
    const sec = d.getSeconds() + d.getMilliseconds() / 1000
    const min = d.getMinutes() + sec / 60
    const hour = (d.getHours() % 12) + min / 60
    hourRef.current?.setAttribute('transform', `rotate(${hour * 30} 100 100)`)
    minRef.current?.setAttribute('transform', `rotate(${min * 6} 100 100)`)
    secRef.current?.setAttribute('transform', `rotate(${sec * 6} 100 100)`)
  })

  return (
    <svg viewBox="0 0 200 200" style={{ width: size, height: size, filter: glass ? 'drop-shadow(0 6px 28px rgb(0 0 0 / 0.45))' : undefined }} aria-hidden>
      <circle cx="100" cy="100" r="96" fill="rgb(8 10 14 / 0.28)" stroke="rgb(255 255 255 / 0.22)" strokeWidth="1" />
      {Array.from({ length: 60 }, (_, i) => {
        const major = i % 5 === 0
        return (
          <line
            key={i}
            x1="100"
            y1={major ? 10 : 12}
            x2="100"
            y2={major ? 22 : 16}
            transform={`rotate(${i * 6} 100 100)`}
            stroke={major ? 'rgb(255 255 255 / 0.85)' : 'rgb(255 255 255 / 0.35)'}
            strokeWidth={major ? 2.2 : 1}
            strokeLinecap="round"
          />
        )
      })}
      <line ref={hourRef} x1="100" y1="100" x2="100" y2="52" stroke="#fff" strokeWidth="5" strokeLinecap="round" />
      <line ref={minRef} x1="100" y1="100" x2="100" y2="30" stroke="#fff" strokeWidth="3.2" strokeLinecap="round" />
      <g ref={secRef}>
        <line x1="100" y1="116" x2="100" y2="22" stroke="var(--color-accent)" strokeWidth="1.4" strokeLinecap="round" />
        <circle cx="100" cy="100" r="4" fill="var(--color-accent)" />
      </g>
      <circle cx="100" cy="100" r="1.8" fill="#fff" />
    </svg>
  )
}
