import type { ReactNode } from 'react'
import { motion } from 'framer-motion'
import { cn } from '@/shared/lib/cn'
import { spring, prefersReducedMotion } from '@/shared/lib/motion'

/**
 * Shared layout shell for every full-screen feature view.
 *
 * The screensaver established the composition this generalises: one
 * element owns the screen, everything else recedes to the edges as quiet
 * metadata, and negative space does the structural work that borders and
 * cards were doing before. Applied to a feature view that means a large
 * light-weight title with real breathing room above the content, actions
 * sitting to the side rather than competing for the same visual weight,
 * and no wrapper card around content that is already inside a panel.
 *
 * These exist as components rather than a documented convention because a
 * convention drifts — nine views styled by hand end up nine slightly
 * different shapes. Composing the same three pieces makes structural
 * consistency the default rather than something each view has to
 * remember.
 */

export function ViewShell({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  const reduced = prefersReducedMotion()
  return (
    <motion.div
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={reduced ? { duration: 0 } : spring.gentle}
      // The app panel behind this (App.tsx's .app-panel) is opaque
      // --surface-base, not translucent — the wallpaper only shows in the
      // gutter around the panel now, never through it. This view has no
      // background of its own for the same reason it never did: it sits
      // directly on that opaque panel fill, and legibility comes from type
      // weight and shadow, not a card underneath it.
      className={cn('flex h-full min-h-0 w-full flex-col', className)}
    >
      {children}
    </motion.div>
  )
}

/**
 * The view's masthead. Deliberately generous: `text-xl` at light weight
 * with a wide margin below, rather than the cramped `text-sm font-medium`
 * label every view used before — a screen's own name should read as the
 * title of the thing you're looking at, not as another piece of chrome.
 */
export function ViewHeader({
  title,
  subtitle,
  actions,
  className,
}: {
  title: string
  subtitle?: string
  actions?: ReactNode
  className?: string
}) {
  return (
    <header
      className={cn(
        'flex shrink-0 items-start justify-between gap-6 px-8 pt-8 pb-6',
        className,
      )}
    >
      <div className="flex min-w-0 flex-col gap-1.5">
        {/* No text-shadow: this sits on the opaque --surface-base panel
            fill, not the photo wallpaper, so legibility comes from real
            contrast (the text-* tokens) rather than a shadow tuned for a
            photograph behind it. */}
        <h1 className="font-display text-text-primary truncate text-xl font-light tracking-tight">
          {title}
        </h1>
        {subtitle && <p className="text-text-tertiary text-sm">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  )
}

/** The scrolling region under the header. */
export function ViewBody({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div
      data-overlay-scroll
      className={cn('min-h-0 flex-1 overflow-y-auto px-8 pb-8', className)}
    >
      {children}
    </div>
  )
}

/**
 * Empty state. Follows the same lesson General Chat's welcome screen
 * taught: an empty screen is an invitation to act, so it takes an action
 * rather than only explaining that there is nothing here.
 */
export function ViewEmpty({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon?: React.ComponentType<React.SVGProps<SVGSVGElement>>
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 py-20 text-center">
      {Icon && <Icon width={28} height={28} className="text-text-tertiary opacity-50" />}
      <div className="flex flex-col gap-1.5">
        <p className="text-text-secondary text-md font-medium">{title}</p>
        {description && (
          <p className="text-text-tertiary mx-auto max-w-xs text-sm">{description}</p>
        )}
      </div>
      {action}
    </div>
  )
}

