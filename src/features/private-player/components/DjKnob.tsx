import { useCallback, useEffect, useRef } from 'react'

interface DjKnobProps {
  label: string
  value: number
  min: number
  max: number
  /** Value that renders as the knob's rest position — for a ±15dB EQ this
   * is 0 (pointer straight up, arc drawn outward from centre); for a
   * 0-100% effect it's the minimum (pointer fully counter-clockwise, arc
   * drawn from the left, matching a real mixer's off position). */
  centerValue?: number
  onChange: (v: number) => void
  formatValue?: (v: number) => string
  /** Fractional step for continuous params (e.g. LFO rate in Hz). Whole
   * numbers by default, since most controls here are dB or percent. */
  step?: number
  size?: 'sm' | 'md'
  /** Dims the whole control when its effect is bypassed upstream. */
  disabled?: boolean
}

const MIN_ANGLE = -135
const MAX_ANGLE = 135
const SWEEP = MAX_ANGLE - MIN_ANGLE

/**
 * Rotary knob, drag-vertical to adjust — the standard DJ-software
 * interaction, since a mouse cannot rotate.
 *
 * Draws a real value arc rather than only a pointer line. That is the
 * difference between reading as an actual mixer control and reading as a
 * circle with a stick in it: the arc gives the value a length you can
 * judge at a glance across a rack of twelve knobs, and it shows *which
 * direction* a bipolar control has been pushed — an EQ boost sweeps
 * clockwise from top, a cut sweeps counter-clockwise from top, so a row
 * of EQ knobs reads as a shape rather than as three identical dials.
 */
export function DjKnob({
  label,
  value,
  min,
  max,
  centerValue,
  onChange,
  formatValue,
  step = 1,
  size = 'md',
  disabled = false,
}: DjKnobProps) {
  const dragStartRef = useRef<{ y: number; value: number } | null>(null)
  // Throttles onChange to at most once per animation frame. Without this,
  // every pointermove during a drag (the OS can deliver well over 100/sec)
  // fired a full React re-render of the panel plus a dozen live
  // AudioParam ramps, synchronously, uncapped. That sustained main-thread
  // flood is the confirmed cause of the screen going blank mid-drag;
  // rAF-throttling caps the work at the rate the screen can show it.
  const rafRef = useRef<number | null>(null)
  const pendingValueRef = useRef<number | null>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    }
  }, [])

  const px = size === 'sm' ? 38 : 46
  const fraction = clamp01((value - min) / (max - min))
  const angle = MIN_ANGLE + fraction * SWEEP

  // Bipolar controls (a ±15dB EQ) draw their arc outward from the top;
  // unipolar ones (a 0-100% send) draw from the far left. Detected from
  // where the rest position sits rather than from a separate prop, so a
  // control cannot declare one and behave as the other.
  const restFraction = centerValue === undefined ? 0 : clamp01((centerValue - min) / (max - min))
  const restAngle = MIN_ANGLE + restFraction * SWEEP
  const arcFrom = Math.min(restAngle, angle)
  const arcTo = Math.max(restAngle, angle)

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (disabled) return
      e.currentTarget.setPointerCapture(e.pointerId)
      dragStartRef.current = { y: e.clientY, value }
    },
    [value, disabled],
  )

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragStartRef.current) return
      const deltaY = dragStartRef.current.y - e.clientY
      // 150px of drag traverses the full range; holding shift divides the
      // travel by four for fine adjustment, which matters for a control
      // like echo time where one pixel is otherwise several milliseconds.
      const travel = e.shiftKey ? 600 : 150
      const deltaFraction = deltaY / travel
      const raw = dragStartRef.current.value + deltaFraction * (max - min)
      const snapped = Math.round(raw / step) * step
      const next = Math.min(max, Math.max(min, snapped))
      // Floating-point steps (0.1Hz) accumulate visible error otherwise.
      pendingValueRef.current = Number(next.toFixed(4))
      if (rafRef.current !== null) return
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null
        if (pendingValueRef.current !== null) onChangeRef.current(pendingValueRef.current)
      })
    },
    [min, max, step],
  )

  const handlePointerUp = useCallback(() => {
    dragStartRef.current = null
    // Flush a value computed on the final pointermove whose rAF hasn't
    // fired yet, so a drag ending mid-frame doesn't drop its last position.
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
      if (pendingValueRef.current !== null) onChangeRef.current(pendingValueRef.current)
    }
  }, [])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (disabled) return
      const coarse = (max - min) / 10
      let next: number | null = null
      if (e.key === 'ArrowUp' || e.key === 'ArrowRight') next = value + (e.shiftKey ? step : coarse)
      else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') next = value - (e.shiftKey ? step : coarse)
      else if (e.key === 'Home') next = centerValue ?? min
      if (next === null) return
      e.preventDefault()
      onChange(Number(Math.min(max, Math.max(min, next)).toFixed(4)))
    },
    [value, min, max, step, centerValue, onChange, disabled],
  )

  const isActive = centerValue !== undefined && Math.abs(value - centerValue) > 1e-6

  return (
    <div className={`flex flex-col items-center gap-1 select-none ${disabled ? 'opacity-40' : ''}`}>
      <div
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={label}
        aria-valuenow={value}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuetext={formatValue ? formatValue(value) : String(value)}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onKeyDown={handleKeyDown}
        onDoubleClick={() => centerValue !== undefined && !disabled && onChange(centerValue)}
        style={{ width: px, height: px }}
        className={`focus-visible:outline-accent relative rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 ${
          disabled ? 'cursor-default' : 'cursor-ns-resize'
        }`}
        title={`${label} — drag to adjust, shift for fine, double-click to reset`}
      >
        <svg viewBox="0 0 48 48" className="h-full w-full overflow-visible">
          {/* Full travel, always visible, so the knob reads as a control
              with a range rather than as a plain disc. */}
          <path
            d={arcPath(MIN_ANGLE, MAX_ANGLE, 21)}
            fill="none"
            stroke="var(--border-hairline)"
            strokeWidth="2.5"
            strokeLinecap="round"
          />
          {isActive && (
            <path
              d={arcPath(arcFrom, arcTo, 21)}
              fill="none"
              stroke="var(--color-brand-cyan)"
              strokeWidth="2.5"
              strokeLinecap="round"
            />
          )}
          <circle
            cx="24"
            cy="24"
            r="16"
            fill="var(--surface-overlay)"
            stroke="var(--border-hairline)"
            strokeWidth="1"
          />
          <g transform={`rotate(${angle} 24 24)`}>
            <rect
              x="23.25"
              y="10"
              width="1.5"
              height="8"
              rx="0.75"
              fill={isActive ? 'var(--color-brand-cyan)' : 'var(--color-text-tertiary)'}
            />
          </g>
        </svg>
      </div>
      <span
        className={`text-2xs-alt font-medium tabular-nums ${isActive ? 'text-text-primary' : 'text-text-tertiary'}`}
      >
        {formatValue ? formatValue(value) : value}
      </span>
      <span className="text-text-tertiary text-3xs tracking-wide uppercase">{label}</span>
    </div>
  )
}

function clamp01(v: number): number {
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0
}

/** SVG arc between two angles measured from 12 o'clock, clockwise. */
function arcPath(fromDeg: number, toDeg: number, radius: number): string {
  const a = polar(fromDeg, radius)
  const b = polar(toDeg, radius)
  const largeArc = Math.abs(toDeg - fromDeg) > 180 ? 1 : 0
  return `M ${a.x} ${a.y} A ${radius} ${radius} 0 ${largeArc} 1 ${b.x} ${b.y}`
}

function polar(deg: number, radius: number): { x: number; y: number } {
  const rad = ((deg - 90) * Math.PI) / 180
  return { x: 24 + radius * Math.cos(rad), y: 24 + radius * Math.sin(rad) }
}
