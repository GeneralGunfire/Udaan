import { useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import { cn } from '@/shared/lib/cn'
import { ChevronDownIcon, CheckIcon } from '@/shared/icons'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/shared/components/primitives/DropdownMenu'

export interface SelectOption<T extends string> {
  value: T
  label: string
}

interface SelectProps<T extends string> {
  value: T
  options: SelectOption<T>[]
  onChange: (value: T) => void
  className?: string
  /** Renders the trigger as a compact pill (icon-adjacent controls like speed) rather than a full-width field. */
  size?: 'sm' | 'md'
}

/**
 * Custom-styled value select — single-select semantics on top of the
 * hand-built DropdownMenu, not a parallel primitive. A native `<select>`
 * renders with the OS's own non-themeable popup styling, which reads as
 * visually broken against this app's dark UI (and can render invisible/
 * wrong-colored text depending on the OS theme), so this composes the
 * app's own menu instead.
 */
export function Select<T extends string>({ value, options, onChange, className, size = 'md' }: SelectProps<T>) {
  const [open, setOpen] = useState(false)
  const current = options.find((o) => o.value === value)

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            'text-text-primary flex items-center gap-1.5 rounded-md border',
            'border-(--border-hairline) bg-(--surface-raised)',
            'shadow-[inset_0_1px_0_var(--highlight-inset)]',
            'transition-[background-color,border-color,transform] duration-150 ease-out',
            'hover:bg-(--surface-overlay) hover:border-(--border-strong) hover:-translate-y-px',
            'active:translate-y-0 active:bg-(--surface-raised)',
            'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
            'motion-reduce:transform-none',
            size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3 py-1.5 text-sm',
            className,
          )}
        >
          <span className="truncate">{current?.label ?? value}</span>
          <ChevronDownIcon
            width={12}
            height={12}
            className={cn('text-text-tertiary shrink-0 transition-transform duration-150', open && 'rotate-180')}
          />
        </button>
      </DropdownMenuTrigger>

      <AnimatePresence>
        {open && (
          <DropdownMenuContent align="end" className="min-w-36">
            {options.map((option) => (
              <DropdownMenuItem
                key={option.value}
                onSelect={() => onChange(option.value)}
                className={cn(
                  'justify-between gap-3',
                  option.value === value && 'text-text-primary',
                )}
              >
                <span className="truncate">{option.label}</span>
                {option.value === value && <CheckIcon width={12} height={12} className="shrink-0" />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        )}
      </AnimatePresence>
    </DropdownMenu>
  )
}
