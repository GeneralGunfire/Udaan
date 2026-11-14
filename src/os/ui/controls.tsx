import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react'
import * as SwitchPrimitive from '@radix-ui/react-switch'
import * as SliderPrimitive from '@radix-ui/react-slider'
import * as ToggleGroup from '@radix-ui/react-toggle-group'
import { cn } from '@/shared/lib/cn'

/**
 * Every interactive control in the Udaan shell. One kit, one look.
 *
 * Behaviour comes from Radix (switch, slider, toggle group: keyboard,
 * ARIA, pointer capture, RTL, all handled and tested upstream). The look
 * is plain CSS in `src/ui/ui.css` (`u-*` classes): press is a transform on
 * the compositor, hover/press are a wash of the control's own ink, focus
 * is a real ring. No JS runs per hover, no spring libraries per button,
 * so a surface with fifty controls costs nothing at idle.
 */

/* ── BUTTON ──────────────────────────────────────────────────────── */

export type ButtonVariant = 'ghost' | 'filled' | 'tinted' | 'plain' | 'primary' | 'accent' | 'danger' | 'danger-solid' | 'ok'
export type ButtonSize = 'sm' | 'md' | 'lg'

const VARIANT: Record<ButtonVariant, string> = {
  ghost: 'u-btn--ghost',
  plain: '',
  tinted: 'u-btn--tonal',
  filled: 'u-btn--primary',
  primary: 'u-btn--primary',
  accent: 'u-btn--accent',
  danger: 'u-btn--danger',
  'danger-solid': 'u-btn--danger-solid',
  ok: 'u-btn--ok',
}
const SIZE: Record<ButtonSize, string> = { sm: 'u-btn--sm', md: '', lg: 'u-btn--lg' }

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  /** Square icon button. */
  icon?: boolean
  pill?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'ghost', size = 'md', icon = false, pill = false, className, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn('u-btn', VARIANT[variant], SIZE[size], icon && 'u-btn--icon', pill && 'u-btn--pill', className)}
      {...rest}
    />
  )
})

/* ── SWITCH ──────────────────────────────────────────────────────── */

export function Switch({
  checked,
  onChange,
  disabled,
  label,
  className,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  disabled?: boolean
  label?: string
  className?: string
}) {
  return (
    <SwitchPrimitive.Root checked={checked} onCheckedChange={onChange} disabled={disabled} aria-label={label} className={cn('u-switch', className)}>
      <SwitchPrimitive.Thumb className="u-switch__thumb" />
    </SwitchPrimitive.Root>
  )
}

/* ── SEGMENTED ───────────────────────────────────────────────────── */

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  className,
}: {
  value: T
  options: { value: T; label: ReactNode }[]
  onChange: (next: T) => void
  className?: string
}) {
  return (
    <ToggleGroup.Root
      type="single"
      value={value}
      // Radix reports '' when the active item is pressed again; a segmented control always has one value.
      onValueChange={(v) => v && onChange(v as T)}
      className={cn('u-seg', className)}
    >
      {options.map((o) => (
        <ToggleGroup.Item key={o.value} value={o.value} className="u-seg__item">
          {o.label}
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  )
}

/* ── SLIDER ──────────────────────────────────────────────────────── */

export function Slider({
  value,
  min = 0,
  max = 1,
  step = 0.01,
  onChange,
  onCommit,
  className,
  disabled,
  'aria-label': ariaLabel,
}: {
  value: number
  min?: number
  max?: number
  step?: number
  onChange: (next: number) => void
  /** Called once when the drag ends: use for expensive writes. */
  onCommit?: (next: number) => void
  className?: string
  disabled?: boolean
  'aria-label'?: string
}) {
  return (
    <SliderPrimitive.Root
      className={cn('u-slider', className)}
      value={[value]}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      onValueChange={([v]) => onChange(v)}
      onValueCommit={([v]) => onCommit?.(v)}
    >
      <SliderPrimitive.Track className="u-slider__track">
        <SliderPrimitive.Range className="u-slider__range" />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb className="u-slider__thumb" aria-label={ariaLabel} />
    </SliderPrimitive.Root>
  )
}

/* ── ROW ─────────────────────────────────────────────────────────── */

export const Row = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { selected?: boolean }>(function Row(
  { selected, className, children, ...rest },
  ref,
) {
  return (
    <button ref={ref} type="button" data-selected={selected || undefined} className={cn('u-row', className)} {...rest}>
      {children}
    </button>
  )
})

/* ── FIELD ───────────────────────────────────────────────────────── */

export const Field = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Field({ className, ...rest }, ref) {
  return (
    <input
      ref={ref}
      className={cn(
        'h-8 w-full rounded-[8px] border-0 bg-(--u-wash-hover) px-3 text-[13px] text-(--u-ink) shadow-[inset_0_0_0_1px_var(--u-edge)] outline-none placeholder:text-(--u-ink-3) focus:shadow-[inset_0_0_0_1px_var(--u-accent)]',
        className,
      )}
      {...rest}
    />
  )
})

/* ── SPOTLIGHT (kept as a plain wrapper: the pointer-following light was a glow) ── */

export function Spotlight({ children, className, ...rest }: { children: ReactNode; className?: string; radius?: number; strength?: number } & React.HTMLAttributes<HTMLDivElement>) {
  const { radius: _r, strength: _s, ...div } = rest as Record<string, unknown>
  return (
    <div className={cn('relative isolate', className)} {...(div as React.HTMLAttributes<HTMLDivElement>)}>
      {children}
    </div>
  )
}

/* ── DIVIDER ─────────────────────────────────────────────────────── */

export function Divider({ vertical = false, className }: { vertical?: boolean; className?: string }) {
  return <span aria-hidden className={cn('bg-(--u-edge)', vertical ? 'w-px self-stretch' : 'h-px w-full', className)} />
}
