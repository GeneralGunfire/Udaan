import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cn } from '@/shared/lib/cn'

/**
 * The app-wide Button for feature views. Same visual system as the shell's
 * `os/ui/controls` Button (`u-btn` in src/ui/ui.css): one look, one press
 * feel, one focus ring, everywhere. The variant/size names below are the
 * ones feature code already uses; they map onto the shared classes.
 */
type Variant = 'ghost' | 'surface' | 'secondary' | 'brand' | 'danger' | 'danger-solid' | 'success' | 'tinted'
type Size = 'icon' | 'icon-sm' | 'icon-lg' | 'pill' | 'pill-sm' | 'lg' | 'sm' | 'large'

const VARIANT: Record<Variant, string> = {
  ghost: 'u-btn--ghost',
  surface: 'u-btn--tonal',
  secondary: 'u-btn--tonal',
  tinted: 'u-btn--tonal',
  brand: 'u-btn--primary',
  danger: 'u-btn--danger',
  'danger-solid': 'u-btn--danger-solid',
  success: 'u-btn--ok',
}
const SIZE: Record<Size, string> = {
  icon: 'u-btn--icon',
  'icon-sm': 'u-btn--icon u-btn--sm',
  'icon-lg': 'u-btn--icon u-btn--lg',
  pill: 'u-btn--pill',
  'pill-sm': 'u-btn--pill u-btn--sm',
  lg: 'u-btn--lg',
  large: 'u-btn--lg',
  sm: 'u-btn--sm',
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  asChild?: boolean
}

export function buttonVariants({ variant = 'ghost', size = 'icon', className }: { variant?: Variant; size?: Size; className?: string } = {}) {
  return cn('u-btn', VARIANT[variant], SIZE[size], className)
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, asChild = false, type, ...props }, ref) => {
  const Comp = asChild ? Slot : 'button'
  return <Comp ref={ref} {...(asChild ? {} : { type: type ?? 'button' })} className={buttonVariants({ variant, size, className })} {...props} />
})
Button.displayName = 'Button'
