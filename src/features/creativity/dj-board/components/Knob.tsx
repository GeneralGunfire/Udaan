import { useCallback, useRef, useState } from 'react'
import { motion } from 'framer-motion'

interface KnobProps {
  label: string
  value: number
  min: number
  max: number
  onChange: (value: number) => void
  size?: number
  bipolar?: boolean
}

const ARC_START = -135
const ARC_SWEEP = 270

/** Polar coordinate on the knob's ring, for the SVG arc path. */
function polar(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) }
}

function arcPath(cx: number, cy: number, r: number, startAngle: number, endAngle: number) {
  const start = polar(cx, cy, r, startAngle)
  const end = polar(cx, cy, r, endAngle)
  const largeArc = endAngle - startAngle > 180 ? 1 : 0
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 1 ${end.x} ${end.y}`
}

/**
 * Rotary knob — redesigned for easier interaction than the original
 * drag-only version: a visible fill-arc shows position at a glance (no
 * need to drag to see where it's set), a compact value chip is always
 * visible underneath rather than only appearing while dragging, drag
 * sensitivity is gentler (more travel needed per unit change, easier to
 * land on a precise value), and scroll-wheel is a full alternative
 * input — hover and scroll for small nudges without needing to grab
 * and drag at all.
 */
export function Knob({ label, value, min, max, onChange, size = 40, bipolar = false }: KnobProps) {
  const dragState = useRef<{ startY: number; startValue: number } | null>(null)
  const [dragging, setDragging] = useState(false)

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId)
      dragState.current = { startY: e.clientY, startValue: value }
      setDragging(true)
    },
    [value],
  )

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!dragState.current) return
      const delta = dragState.current.startY - e.clientY
      const range = max - min
      // Gentler than before (was /140): more pixels of travel per unit
      // of value, so small hand movements don't overshoot — easier to
      // land on a precise setting.
      const next = dragState.current.startValue + (delta / 220) * range
      onChange(Math.max(min, Math.min(max, next)))
    },
    [max, min, onChange],
  )

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.releasePointerCapture(e.pointerId)
    dragState.current = null
    setDragging(false)
  }, [])

  const handleWheel = useCallback(
    (e: React.WheelEvent<HTMLDivElement>) => {
      e.preventDefault()
      const step = (max - min) / 60
      const next = value + (e.deltaY < 0 ? step : -step)
      onChange(Math.max(min, Math.min(max, next)))
    },
    [max, min, onChange, value],
  )

  const normalized = Math.max(0, Math.min(1, (value - min) / (max - min)))
  const angle = ARC_START + normalized * ARC_SWEEP
  const zeroNormalized = bipolar ? Math.max(0, Math.min(1, (0 - min) / (max - min))) : 0
  const zeroAngle = ARC_START + zeroNormalized * ARC_SWEEP

  const r = size / 2 - 3
  const cx = size / 2
  const cy = size / 2
  const trackPath = arcPath(cx, cy, r, ARC_START, ARC_START + ARC_SWEEP)
  const fillPath = bipolar
    ? arcPath(cx, cy, r, Math.min(zeroAngle, angle), Math.max(zeroAngle, angle))
    : arcPath(cx, cy, r, ARC_START, angle)

  return (
    <div className="relative flex flex-col items-center gap-1 select-none">
      <motion.div
        role="slider"
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        tabIndex={0}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onWheel={handleWheel}
        onKeyDown={(e) => {
          const step = (max - min) / 50
          if (e.key === 'ArrowUp') onChange(Math.min(max, value + step))
          if (e.key === 'ArrowDown') onChange(Math.max(min, value - step))
        }}
        onDoubleClick={() => onChange(bipolar ? 0 : min)}
        whileHover={{ scale: 1.08 }}
        animate={{ scale: dragging ? 1.14 : 1 }}
        transition={{ type: 'spring', stiffness: 500, damping: 28 }}
        title={`${label}: ${value.toFixed(1)} — drag, scroll, or arrow keys. Double-click to reset.`}
        className="glass-surface relative cursor-ns-resize rounded-full"
        style={{ width: size, height: size }}
      >
        <svg width={size} height={size} className="absolute inset-0" style={{ pointerEvents: 'none' }}>
          <path d={trackPath} fill="none" stroke="var(--color-glass-border)" strokeWidth={2.5} strokeLinecap="round" />
          <path d={fillPath} fill="none" stroke="var(--color-brand-cyan)" strokeWidth={2.5} strokeLinecap="round" />
        </svg>
        <motion.div
          className="absolute inset-0 flex items-start justify-center"
          animate={{ rotate: angle }}
          transition={{ type: 'spring', stiffness: 400, damping: 32 }}
        >
          <span
            className="bg-brand-cyan mt-1.5 block rounded-full"
            style={{ width: 2.5, height: size * 0.28 }}
          />
        </motion.div>
      </motion.div>
      <span className="text-text-tertiary text-[9.5px] font-medium tracking-wide uppercase">
        {label}
      </span>
      <span
        className={`text-[9px] font-semibold tabular-nums transition-colors duration-150 ${
          dragging ? 'text-brand-cyan' : 'text-text-tertiary'
        }`}
      >
        {value > 0 && bipolar ? '+' : ''}
        {value.toFixed(1)}
      </span>
    </div>
  )
}
