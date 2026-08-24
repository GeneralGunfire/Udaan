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
      <SliderPrimitive.Track className="bg-glass-bg-hover relative h-1 w-full grow overflow-hidden rounded-full">
        <SliderPrimitive.Range className="bg-brand-cyan absolute h-full rounded-full" />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb className="border-brand-cyan block h-3 w-3 rounded-full border-2 bg-white outline-none transition-transform hover:scale-110 focus-visible:scale-110" />
    </SliderPrimitive.Root>
  )
}
