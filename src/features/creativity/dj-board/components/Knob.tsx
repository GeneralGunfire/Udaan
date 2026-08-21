import { useCallback, useRef } from 'react'

interface KnobProps {
  label: string
  value: number
  min: number
  max: number
  onChange: (value: number) => void
  size?: number
  bipolar?: boolean
}

/** Vertical-drag rotary knob — mirrors real DJ hardware interaction (drag up/down, not left/right). */
export function Knob({ label, value, min, max, onChange, size = 40, bipolar = false }: KnobProps) {
  const dragState = useRef<{ startY: number; startValue: number } | null>(null)

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId)
      dragState.current = { startY: e.clientY, startValue: value }
    },
    [value],
  )

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!dragState.current) return
      const delta = dragState.current.startY - e.clientY
      const range = max - min
      const next = dragState.current.startValue + (delta / 140) * range
      onChange(Math.max(min, Math.min(max, next)))
    },
    [max, min, onChange],
  )

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.releasePointerCapture(e.pointerId)
    dragState.current = null
  }, [])

  const normalized = (value - min) / (max - min)
  const angle = -135 + normalized * 270

  return (
    <div className="flex flex-col items-center gap-1 select-none">
      <div
        role="slider"
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        tabIndex={0}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onKeyDown={(e) => {
          const step = (max - min) / 50
          if (e.key === 'ArrowUp') onChange(Math.min(max, value + step))
          if (e.key === 'ArrowDown') onChange(Math.max(min, value - step))
        }}
        onDoubleClick={() => onChange(bipolar ? 0 : min)}
        className="glass-surface relative cursor-ns-resize rounded-full"
        style={{ width: size, height: size }}
      >
        <div
          className="absolute inset-0 flex items-start justify-center"
          style={{ transform: `rotate(${angle}deg)` }}
        >
          <span
            className="bg-brand-cyan mt-1 block rounded-full"
            style={{ width: 2.5, height: size * 0.32 }}
          />
        </div>
        {bipolar && (
          <span className="bg-glass-border absolute top-1/2 left-1/2 h-2.5 w-px -translate-x-1/2 -translate-y-1/2" />
        )}
      </div>
      <span className="text-text-tertiary text-[9.5px] font-medium tracking-wide uppercase">
        {label}
      </span>
    </div>
  )
}
