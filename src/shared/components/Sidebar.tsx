import { motion } from 'framer-motion'
import { ChatBubbleIcon, GridIcon, CalendarIcon, ClockIcon } from '@/shared/icons'
import { spring, prefersReducedMotion } from '@/shared/lib/motion'
import { Tooltip, TooltipProvider } from '@/shared/components/ui/tooltip'
import { cn } from '@/shared/lib/cn'

/** Staggered mount for the rail's two tile groups — each tile settles in a
 *  beat after the last, so the rail reads as assembling itself rather than
 *  appearing all at once. Purely a first-mount moment (no `layout`/persist
 *  concerns since App.tsx never remounts this component after boot). */
const RAIL_GROUP = {
  hidden: {},
  show: { transition: { staggerChildren: 0.05 } },
}
const RAIL_ITEM = {
  hidden: { opacity: 0, y: -6, scale: 0.9 },
  show: { opacity: 1, y: 0, scale: 1 },
}

export type SidebarView = 'chat' | 'calendar'

export interface SidebarProps {
  activeView: SidebarView
  onSelectView: (view: SidebarView) => void
  onOpenLaunchpad: () => void
  onOpenScreensaver: () => void
}

/**
 * Fixed-width icon rail — two destinations now (General Chat, Calendar),
 * so this is a real view switcher rather than a static single-icon strip.
 * Rendered as the left edge of the same panel surface as the main content
 * (App.tsx composes this and the active view inside one shared glass/
 * rounded container), with only a hairline divider between them rather
 * than its own separate rounded box.
 *
 * Tiles use the app's surface ladder rather than their own bespoke
 * treatment: a tile is invisible at rest, fills to `surface-raised` on
 * hover, and sits at `surface-overlay` when active. A Radix tooltip names
 * each tile on hover/focus (side="right", since the rail sits at the
 * panel's left edge) so the icon-only tiles stay identifiable without
 * visible labels crowding this narrow a rail.
 *
 * Current position is marked by an accent edge bar rather than a filled
 * tile. It's a shared `layoutId` element, so Framer slides the single bar
 * between destinations on switch instead of each tile fading its own
 * marker in and out — the movement itself communicates that you changed
 * position within one list.
 *
 * The Launchpad launcher lives pinned to the bottom of this rail — the
 * closest thing this shell has to a taskbar edge.
 */
export function Sidebar({ activeView, onSelectView, onOpenLaunchpad, onOpenScreensaver }: SidebarProps) {
  const reduced = prefersReducedMotion()

  return (
    <TooltipProvider>
      <nav
        aria-label="Primary"
        className="relative z-10 flex h-full w-17 shrink-0 flex-col items-center gap-1 border-r border-(--border-hairline) px-3 py-4"
      >
        {/* The decorative centre spine that used to sit here has been
            removed: the active-position indicator bar now does that job
            with real meaning, and a second vertical line competing with it
            read as noise rather than structure. */}
        <motion.div
          className="flex flex-col items-center gap-1.5"
          variants={reduced ? undefined : RAIL_GROUP}
          initial={reduced ? undefined : 'hidden'}
          animate={reduced ? undefined : 'show'}
        >
          <RailTile
            label="General Chat"
            active={activeView === 'chat'}
            reduced={reduced}
            onClick={() => onSelectView('chat')}
            variants={RAIL_ITEM}
          >
            <ChatBubbleIcon width={20} height={20} />
          </RailTile>

          <RailTile
            label="Calendar"
            active={activeView === 'calendar'}
            reduced={reduced}
            onClick={() => onSelectView('calendar')}
            variants={RAIL_ITEM}
          >
            <CalendarIcon width={20} height={20} />
          </RailTile>
        </motion.div>

        <div className="my-2 w-7 border-t border-(--border-hairline)" aria-hidden />

        <motion.div
          className="mt-auto flex flex-col items-center gap-1.5"
          variants={reduced ? undefined : RAIL_GROUP}
          initial={reduced ? undefined : 'hidden'}
          animate={reduced ? undefined : 'show'}
        >
          <RailTile label="Screensaver" reduced={reduced} onClick={onOpenScreensaver} variants={RAIL_ITEM}>
            <ClockIcon width={19} height={19} />
          </RailTile>

          <RailTile label="Launchpad" reduced={reduced} onClick={onOpenLaunchpad} variants={RAIL_ITEM}>
            <GridIcon width={19} height={19} />
          </RailTile>
        </motion.div>
      </nav>
    </TooltipProvider>
  )
}

/**
 * One rail tile — the shared building block behind every icon here.
 * Inactive tiles are invisible until hovered; the active one carries the
 * accent edge bar plus a raised surface, so "where am I" is legible at a
 * glance without the tile shouting.
 */
function RailTile({
  label,
  active = false,
  reduced,
  onClick,
  children,
  variants,
}: {
  label: string
  active?: boolean
  reduced: boolean
  onClick: () => void
  children: React.ReactNode
  variants?: typeof RAIL_ITEM
}) {
  return (
    <Tooltip content={label} side="right">
      <motion.button
        type="button"
        onClick={onClick}
        aria-current={active ? 'page' : undefined}
        aria-label={label}
        className={cn(
          'group relative flex h-11 w-11 items-center justify-center rounded-lg',
          'transition-transform duration-150 ease-out',
          !active && 'hover:-translate-y-px active:translate-y-0',
          'outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
          'motion-reduce:transform-none',
        )}
        variants={variants}
        transition={reduced ? { duration: 0 } : spring.standard}
      >
        {/* The active indicator is a shared layout element: one bar that
            physically slides between destinations rather than each tile
            fading its own in. An edge bar rather than a fill — it reads as
            a position marker on the rail (which is what a nav rail needs)
            and leaves the icon itself legible at full contrast. */}
        {active && (
          <motion.span
            layoutId="sidebar-active-indicator"
            aria-hidden
            className="absolute top-1/2 -left-3 h-6 w-[3px] -translate-y-1/2 rounded-r-full"
            style={{ background: 'var(--gradient-brand)' }}
            transition={reduced ? { duration: 0 } : spring.panel}
          />
        )}

        {/* Tile fill. Active sits at `overlay`, hover at `raised` — the
            same ladder every other control uses, so the rail doesn't
            invent its own interaction language. */}
        <span
          aria-hidden
          className={cn(
            'pointer-events-none absolute inset-0 rounded-lg border transition-[background-color,border-color,opacity] duration-150',
            active
              ? 'border-(--border-hairline) bg-(--surface-overlay) opacity-100'
              : 'border-transparent bg-(--surface-raised) opacity-0 group-hover:opacity-100',
          )}
        />
        <span
          className={cn(
            'relative transition-colors duration-150',
            // Accent, not white: the icon now carries the "active" colour
            // signal itself (the tile behind it is a neutral surface step),
            // and the lifted accent clears contrast where the raw logo
            // blue would not.
            active ? 'text-accent' : 'text-text-tertiary group-hover:text-text-primary',
          )}
        >
          {children}
        </span>
      </motion.button>
    </Tooltip>
  )
}
