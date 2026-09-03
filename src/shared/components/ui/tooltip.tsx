import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import { motion } from 'framer-motion'
import { cn } from '@/shared/lib/cn'
import { duration, zIndex } from '@/shared/lib/motion'

/**
 * Thin restyle of Radix's tooltip onto the app's glass tokens. Radix owns
 * the open-delay, positioning, and keyboard-focus behavior — a tooltip
 * should appear for keyboard focus exactly like it does for hover, which a
 * hand-rolled `title`/hover-only version can't give for free.
 *
 * Reserved for icon-only controls per the interaction-polish pass — a
 * labeled button doesn't need a tooltip repeating its own label.
 */
export const TooltipProvider = TooltipPrimitive.Provider

export function Tooltip({
  content,
  children,
  side = 'top',
}: {
  content: string
  children: React.ReactNode
  side?: 'top' | 'bottom' | 'left' | 'right'
}) {
  return (
    <TooltipPrimitive.Root delayDuration={400}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content side={side} sideOffset={6} asChild>
          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ duration: duration.instant }}
            className={cn(
              'text-text-primary rounded-md border px-2 py-1 text-2xs font-medium',
            )}
            style={{
              // A tooltip is the topmost transient layer, so it takes the
              // lightest surface step — it should read as sitting above
              // even an open dialog, not level with it.
              background: 'var(--surface-overlay)',
              borderColor: 'var(--border-hairline)',
              boxShadow: 'var(--shadow-overlay)',
              zIndex: zIndex.tooltip,
            }}
          >
            {content}
          </motion.div>
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  )
}
