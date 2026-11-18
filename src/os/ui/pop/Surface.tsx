import { useRef, type CSSProperties, type ReactNode } from 'react'
import { cn } from '@/shared/lib/cn'
import { LiquidGlass } from '@/os/ui/liquid/LiquidGlass'
import { useLiquid, type LiquidRole } from '@/os/ui/liquid/config'
import './pop.css'

/**
 * The card every popup, menu, banner and Start is made of: a liquid-glass fill (the same renderer and the same
 * Settings as the dock and top bar), a hairline edge and a soft neutral shadow. With liquid glass switched off
 * it falls back to the plain material, so nothing depends on the GPU path.
 */
export function Surface({
  glass = 'panel',
  radius = 20,
  paused = false,
  className,
  style,
  children,
  ...rest
}: {
  /** Which liquid-glass settings this card takes: popups and menus share 'panel', Start has its own. */
  glass?: Extract<LiquidRole, 'panel' | 'start'>
  radius?: number
  paused?: boolean
  className?: string
  style?: CSSProperties
  children: ReactNode
} & Omit<React.HTMLAttributes<HTMLDivElement>, 'style' | 'className' | 'children'>) {
  const ref = useRef<HTMLDivElement>(null)
  const { enabled } = useLiquid()
  return (
    <div ref={ref} className={cn('pop-surface', !enabled && 'pop-surface--flat', className)} style={{ borderRadius: radius, ...style }} {...rest}>
      <LiquidGlass role={glass} barRef={ref} paused={paused} radius={radius} />
      {children}
    </div>
  )
}
