import * as SliderPrimitive from '@radix-ui/react-slider'
import { cn } from '@/shared/lib/cn'

interface SliderProps {
  value: number
  min: number
  max: number
  step: number
  onChange: (value: number) => void
  className?: string
}

/**
 * Custom-styled single-thumb slider (Radix's unstyled Slider primitive +
 * this app's tokens) — replaces a native `<input type="range">`, whose
 * track/thumb are OS-themed and don't pick up this app's dark glass styling.
 */
export function Slider({ value, min, max, step, onChange, className }: SliderProps) {
  return (
    <SliderPrimitive.Root
      value={[value]}
      min={min}
      max={max}
      step={step}
      onValueChange={([v]) => onChange(v)}
      className={cn('relative flex h-4 w-full touch-none items-center select-none', className)}
    >
      <SliderPrimitive.Track className="relative h-1 w-full grow overflow-hidden rounded-full bg-(--surface-overlay)">
        <SliderPrimitive.Range
          className="absolute h-full rounded-full"
          style={{ background: 'var(--gradient-brand)' }}
        />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb
        aria-label="Value"
        className={cn(
          'block h-3.5 w-3.5 rounded-full border-2 bg-white',
          'shadow-[0_1px_3px_rgb(0_0_0/35%)]',
          'transition-transform duration-150 ease-out hover:scale-115 active:scale-105',
          // Radix sets outline:none on the thumb by default, so the focus
          // ring has to be re-established explicitly rather than inherited.
          'outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
          'motion-reduce:transform-none',
        )}
        style={{ borderColor: 'var(--color-accent)' }}
      />
    </SliderPrimitive.Root>
  )
}
