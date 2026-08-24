import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu'
import { cn } from '@/shared/lib/cn'
import { spring, zIndex } from '@/shared/lib/motion'
import { ChevronDownIcon, CheckIcon } from '@/shared/icons'

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
 * Custom-styled value select, built on the same Radix dropdown-menu +
 * Framer Motion combo as the rest of the app's menus (see ui/dropdown-menu.tsx)
 * rather than a native `<select>` — native selects render with the OS's own
 * (non-themeable) popup styling, which reads as visually broken against
 * this app's dark glass UI and can even render invisible/wrong-colored text
 * depending on the OS theme.
 */
export function Select<T extends string>({ value, options, onChange, className, size = 'md' }: SelectProps<T>) {
  const [open, setOpen] = useState(false)
  const current = options.find((o) => o.value === value)

  return (
    <DropdownMenuPrimitive.Root open={open} onOpenChange={setOpen}>
      <DropdownMenuPrimitive.Trigger asChild>
        <button
          type="button"
          className={cn(
            'border-glass-border bg-glass-bg text-text-primary hover:bg-glass-bg-hover flex items-center gap-1.5 rounded-lg border transition-colors outline-none',
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
      </DropdownMenuPrimitive.Trigger>

      <AnimatePresence>
        {open && (
          <DropdownMenuPrimitive.Portal forceMount>
            <DropdownMenuPrimitive.Content align="end" sideOffset={6} asChild>
              <motion.div
                initial={{ opacity: 0, y: 6, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 6, scale: 0.97 }}
                transition={spring.standard}
                className="glass-surface border-glass-border flex max-h-72 min-w-[9rem] flex-col overflow-y-auto rounded-xl border p-1"
                style={{ boxShadow: 'var(--shadow-panel)', zIndex: zIndex.dropdown }}
              >
                {options.map((option) => (
                  <DropdownMenuPrimitive.Item
                    key={option.value}
                    onSelect={() => onChange(option.value)}
                    className={cn(
                      'text-text-secondary hover:text-text-primary data-highlighted:bg-glass-hover data-highlighted:text-text-primary flex cursor-pointer items-center justify-between gap-3 rounded-lg px-2.5 py-1.5 text-left text-[12px] outline-none transition-colors duration-150',
                      option.value === value && 'text-text-primary',
                    )}
                  >
                    <span className="truncate">{option.label}</span>
                    {option.value === value && <CheckIcon width={12} height={12} className="shrink-0" />}
                  </DropdownMenuPrimitive.Item>
                ))}
              </motion.div>
            </DropdownMenuPrimitive.Content>
          </DropdownMenuPrimitive.Portal>
        )}
      </AnimatePresence>
    </DropdownMenuPrimitive.Root>
  )
}
