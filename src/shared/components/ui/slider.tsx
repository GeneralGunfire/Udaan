import { useCallback, useRef } from 'react'
import { cn } from '@/shared/lib/cn'

interface SliderProps {
  value: number
  min: number
  max: number
  step: number
  onChange: (value: number) => void
  className?: string
}

function clamp(v: number, min: number, max: number) {
  return Math.min(Math.max(v, min), max)
}

function roundToStep(v: number, min: number, step: number) {
  return min + Math.round((v - min) / step) * step
}

/**
 * Hand-built single-thumb slider — replaces the Radix-backed version.
 * Pointer capture (drag continues even if the cursor leaves the thumb —
 * the track is 4px tall, easy to overshoot mid-drag) + full arrow-key
 * stepping, since a native `<input type="range">`'s OS-themed track/thumb
 * doesn't pick up this app's dark UI.
 */
export function Slider({ value, min, max, step, onChange, className }: SliderProps) {
  const trackRef = useRef<HTMLDivElement>(null)
  const percent = ((value - min) / (max - min)) * 100

  const valueFromClientX = useCallback(
    (clientX: number): number => {
      const track = trackRef.current
      if (!track) return value
      const rect = track.getBoundingClientRect()
      const ratio = clamp((clientX - rect.left) / rect.width, 0, 1)
      return clamp(roundToStep(min + ratio * (max - min), min, step), min, max)
    },
    [min, max, step, value],
  )

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId)
    onChange(valueFromClientX(e.clientX))
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (e.buttons !== 1) return
    onChange(valueFromClientX(e.clientX))
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowUp':
        e.preventDefault()
        onChange(clamp(value + step, min, max))
        return
      case 'ArrowLeft':
      case 'ArrowDown':
        e.preventDefault()
        onChange(clamp(value - step, min, max))
        return
      case 'Home':
        e.preventDefault()
        onChange(min)
        return
      case 'End':
        e.preventDefault()
        onChange(max)
        return
      case 'PageUp':
        e.preventDefault()
        onChange(clamp(value + step * 10, min, max))
        return
      case 'PageDown':
        e.preventDefault()
        onChange(clamp(value - step * 10, min, max))
    }
  }

  return (
    <div
      ref={trackRef}
      role="slider"
      tabIndex={0}
      aria-label="Value"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onKeyDown={handleKeyDown}
      className={cn(
        'relative flex h-4 w-full touch-none items-center select-none',
        'outline-none focus-visible:[&>span:last-child]:outline-2',
        className,
      )}
    >
      <span className="relative h-1 w-full grow overflow-hidden rounded-full bg-(--surface-overlay)">
        <span
          className="absolute h-full rounded-full"
          style={{ background: 'var(--color-accent)', width: `${percent}%` }}
        />
      </span>
      <span
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute block h-3.5 w-3.5 -translate-x-1/2 rounded-full border-2 bg-white',
          'shadow-[0_1px_3px_rgb(0_0_0/35%)]',
          'transition-transform duration-150 ease-out',
          'outline-none outline-offset-2 focus-visible:outline-accent',
          'motion-reduce:transform-none',
        )}
        style={{ left: `${percent}%`, borderColor: 'var(--color-accent)' }}
      />
    </div>
  )
}
