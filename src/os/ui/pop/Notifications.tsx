import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { APP_DEFS } from '@/os/kernel/registry'
import { AppIcon } from '@/os/ui/icons/AppIcon'
import { cn } from '@/shared/lib/cn'
import { spring, useMotion } from '@/os/motion/config'
import { PopIcon } from './icons'
import { Surface } from './Surface'
import type { Note } from './samples'

/**
 * NOTIFICATIONS, rebuilt.
 *
 *  Banner         a glass card with the app's own icon. Actions slide in on hover; a hairline at the bottom drains
 *                 while it waits and stops while you hover it; drag it right to dismiss.
 *  BannerStack    several at once fold behind the newest like a deck and fan out on hover ("+3").
 *  NotificationCenter  everything you missed, grouped by app, newest first, collapsible, with Do Not Disturb.
 */

/** The app's own icon for Udaan apps, otherwise a coloured monogram tile. */
export function AppTile({ n, size = 38 }: { n: Pick<Note, 'app' | 'appId' | 'tint' | 'renderIcon'>; size?: number }) {
  if (n.renderIcon) return <>{n.renderIcon(size)}</>
  if (n.appId && APP_DEFS[n.appId]) return <AppIcon appId={n.appId} size={size} />
  return (
    <span
      className="flex shrink-0 items-center justify-center font-semibold text-white"
      style={{ width: size, height: size, borderRadius: size * 0.27, fontSize: size * 0.42, background: `linear-gradient(150deg, ${n.tint ?? '#7a8494'}, color-mix(in srgb, ${n.tint ?? '#7a8494'} 62%, black))`, boxShadow: 'inset 0 1px 0 rgb(255 255 255 / .28)' }}
    >
      {n.app.charAt(0)}
    </span>
  )
}

export function Banner({
  n,
  seconds = 6,
  onDismiss,
  onAction,
  onOpen,
  onMenu,
  className,
  timer = true,
}: {
  n: Note
  seconds?: number
  onDismiss?: () => void
  onAction?: (label: string) => void
  /** Clicking the banner itself. */
  onOpen?: () => void
  /** Right-clicking the banner. */
  onMenu?: (e: React.MouseEvent) => void
  className?: string
  timer?: boolean
}) {
  const critical = n.kind === 'critical'
  return (
    <Surface radius={20} className={cn('pop-banner w-[372px] select-none', onOpen && 'cursor-pointer', className)} role="alert" onClick={onOpen} onContextMenu={onMenu}>
      <div className="relative px-3.5 pb-3 pt-3">
        <div className="flex gap-3">
          <AppTile n={n} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="pop-label truncate" style={{ fontSize: 10.5 }}>{n.app}</span>
              {critical && <span className="rounded-full bg-[#ff6b61]/20 px-1.5 text-[10px] font-semibold uppercase tracking-wide text-[#ff9c94]">Important</span>}
              <span className="ml-auto text-[11px] text-(--u-ink-3)">{n.time}</span>
            </div>
            <p className="mt-0.5 truncate text-[14px] font-semibold leading-tight">{n.title}</p>
            {n.body && <p className="mt-0.5 line-clamp-2 text-[12.5px] leading-snug text-(--u-ink-2)">{n.body}</p>}
            {!!n.actions?.length && (
              <div className="pop-actions flex gap-1.5">
                {n.actions.map((a, i) => (
                  <button key={a} type="button" className={cn('pop-btn', i === 0 && (critical ? 'pop-btn--accent' : ''))} style={i === 0 && critical ? { background: '#d9453c' } : undefined} onClick={(e) => (e.stopPropagation(), onAction?.(a))}>
                    {a}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        <button type="button" aria-label="Dismiss" className="pop-close pop-iconbtn absolute -left-1 -top-1 h-6 w-6 bg-black/55 backdrop-blur-sm" onClick={(e) => (e.stopPropagation(), onDismiss?.())}>
          <PopIcon name="x" size={12} strokeWidth={2.2} />
        </button>
      </div>
      {timer && onDismiss && <span aria-hidden className="pop-timer absolute inset-x-4 bottom-0 h-[2px] rounded-full bg-white/45" style={{ ['--pop-dur' as string]: `${seconds}s` }} onAnimationEnd={onDismiss} />}
    </Surface>
  )
}

/** Banners as they appear on screen: the newest in front, older ones folded behind it. Hover to fan them out. */
export function BannerStack({ notes, onDismiss, onAction, onOpen, onMenu, seconds = 6, timer = true }: { notes: Note[]; onDismiss: (id: string) => void; onAction?: (id: string, a: string) => void; onOpen?: (n: Note) => void; onMenu?: (e: React.MouseEvent, n: Note) => void; seconds?: number; timer?: boolean }) {
  const [fanned, setFanned] = useState(false)
  const mo = useMotion('notifications')
  const enter = !mo.on ? false : mo.style === 'drop' ? { opacity: 0, y: -60, scale: 0.97 } : mo.style === 'fade' ? { opacity: 0 } : { opacity: 0, x: 90, scale: 0.95 }
  const leave = !mo.on ? { opacity: 0, transition: { duration: 0 } } : mo.style === 'drop' ? { opacity: 0, y: -40, transition: { duration: 0.18 / mo.k } } : mo.style === 'fade' ? { opacity: 0, transition: { duration: 0.18 / mo.k } } : { opacity: 0, x: 140, transition: { duration: 0.18 / mo.k } }
  const shown = notes.slice(0, 4)
  const extra = notes.length - 1
  return (
    <div className="relative w-[372px]" style={{ paddingBottom: !fanned && extra > 0 ? Math.min(extra, 2) * 11 + 4 : 0 }} onMouseEnter={() => setFanned(true)} onMouseLeave={() => setFanned(false)}>
      <AnimatePresence initial={false} mode="popLayout">
        {shown.map((n, i) => {
          const folded = !fanned && i > 0
          return (
            <motion.div
              key={n.id}
                            drag="x"
              dragDirectionLock
              dragConstraints={{ left: 0, right: 0 }}
              dragElastic={{ left: 0, right: 0.7 }}
              onDragEnd={(_, info) => (info.offset.x > 100 || info.velocity.x > 600) && onDismiss(n.id)}
              initial={enter}
              animate={{ opacity: folded ? Math.max(0, 0.9 - i * 0.3) : 1, x: 0, scale: folded ? 1 - i * 0.045 : 1, y: folded ? i * 11 : 0 }}
              exit={leave}
              transition={spring(mo, 420, 36)}
              style={{ position: folded ? 'absolute' : 'relative', top: 0, left: 0, zIndex: 10 - i, marginTop: !folded && i > 0 ? 8 : 0, pointerEvents: folded ? 'none' : 'auto', transformOrigin: 'top center' }}
            >
              {folded ? (
                // Behind the front card only its edge shows: a blank glass card, never its text through the glass.
                <Surface radius={20} className="w-[372px]" style={{ height: 84 }}>{null}</Surface>
              ) : (
                <Banner n={n} seconds={seconds} timer={timer && i === 0 && !fanned} onDismiss={() => onDismiss(n.id)} onAction={(a) => onAction?.(n.id, a)} onOpen={onOpen && (() => onOpen(n))} onMenu={onMenu && ((e) => onMenu(e, n))} />
              )}
            </motion.div>
          )
        })}
      </AnimatePresence>
      {extra > 0 && !fanned && (
        <span className="absolute -bottom-1 right-3 z-20 rounded-full bg-white/90 px-2 py-0.5 text-[10.5px] font-bold text-black" style={{ transform: `translateY(${Math.min(extra, 2) * 11 + 6}px)` }}>
          +{extra}
        </span>
      )}
    </div>
  )
}

/* ── Notification Center ───────────────────────────────────────────── */

interface Group {
  app: string
  tile: Pick<Note, 'app' | 'appId' | 'tint' | 'renderIcon'>
  notes: Note[]
}

function groupByApp(notes: Note[]): Group[] {
  const map = new Map<string, Group>()
  for (const n of notes) {
    const g = map.get(n.app) ?? { app: n.app, tile: n, notes: [] }
    g.notes.push(n)
    map.set(n.app, g)
  }
  return [...map.values()]
}

interface CenterHandlers {
  onOpen?: (n: Note) => void
  onAction?: (n: Note, label: string) => void
  onMenu?: (e: React.MouseEvent, n: Note) => void
}

/** One notification. It never changes size: hover only tints it and swaps the time for a dismiss button. Click opens it. */
function Row({ n, onOpen, onAction, onMenu, onClear }: { n: Note; onClear: () => void } & CenterHandlers) {
  const extras = (n.actions ?? []).filter((a) => a !== 'Open').slice(0, 2)
  return (
    <div
      className={cn('group/n relative flex items-start gap-3 rounded-[14px] px-2.5 py-2.5 transition-colors duration-150 hover:bg-white/[0.07]', onOpen && 'cursor-pointer')}
      onClick={() => onOpen?.(n)}
      onContextMenu={(e) => onMenu?.(e, n)}
    >
      <span className="mt-0.5 shrink-0"><AppTile n={n} size={34} /></span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 pr-9">
          <p className="min-w-0 truncate text-[13.5px] font-semibold leading-[18px] tracking-[-0.005em]">{n.title}</p>
          {n.unread && <span aria-label="Unread" className="h-[7px] w-[7px] shrink-0 rounded-full bg-(--u-accent,#3072f0)" />}
        </div>
        {n.body && <p className="mt-0.5 line-clamp-2 whitespace-pre-line text-[12.5px] leading-[18px] text-(--u-ink-2)">{n.body}</p>}
        {extras.length > 0 && (
          <div className="mt-2 flex gap-2">
            {extras.map((a) => (
              <button key={a} type="button" className="h-7 rounded-full bg-white/10 px-3 text-[12px] font-medium transition-colors hover:bg-white/[0.18]" onClick={(e) => (e.stopPropagation(), onAction?.(n, a))}>{a}</button>
            ))}
          </div>
        )}
      </div>
      <span className="absolute right-3 top-2.5 text-[11px] tabular-nums text-(--u-ink-3) transition-opacity duration-150 group-hover/n:opacity-0">{n.time}</span>
      <button type="button" aria-label="Dismiss" className="pop-iconbtn absolute right-2 top-2 h-6 w-6 opacity-0 transition-opacity duration-150 group-hover/n:opacity-100" onClick={(e) => (e.stopPropagation(), onClear())}>
        <PopIcon name="x" size={12} strokeWidth={2.2} />
      </button>
    </div>
  )
}

/** One app's notifications: a quiet label, then flat rows. Details only appear on hover. No layout animation, so nothing jumps. */
function GroupCard({ g, onClear, onClearOne, onOpen, onAction, onMenu }: { g: Group; onClear: () => void; onClearOne: (id: string) => void } & CenterHandlers) {
  const [open, setOpen] = useState(false)
  const SHOWN = 3
  const hidden = Math.max(0, g.notes.length - SHOWN)
  const list = open ? g.notes : g.notes.slice(0, SHOWN)
  return (
    <section className="group/g">
      <div className="flex h-6 items-center px-1">
        <span className="pop-label" style={{ fontSize: 10.5 }}>{g.app}</span>
        <button type="button" className="ml-auto rounded-full px-2 text-[11px] text-(--u-ink-3) opacity-0 transition-opacity hover:text-(--u-ink) group-hover/g:opacity-100" onClick={onClear}>Clear</button>
      </div>
      <div>
        {list.map((n) => (
          <Row key={n.id} n={n} onOpen={onOpen} onAction={onAction} onMenu={onMenu} onClear={() => onClearOne(n.id)} />
        ))}
        {hidden > 0 && (
          <button type="button" className="flex w-full items-center justify-center gap-1 py-1.5 text-[11.5px] text-(--u-ink-2) transition-colors hover:text-(--u-ink)" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
            {open ? 'Show less' : `${hidden} more`}
          </button>
        )}
      </div>
    </section>
  )
}

export function NotificationCenter({ notes, onChange, dnd, onDnd, height, width = 380, maxHeight, onOpen, onAction, onMenu, onSettings }: { notes: Note[]; onChange: (notes: Note[]) => void; dnd: boolean; onDnd: (v: boolean) => void; height?: number | string; width?: number; maxHeight?: number | string; onSettings?: () => void } & CenterHandlers) {
  const groups = groupByApp(notes)
  return (
    <Surface radius={22} className="flex flex-col" style={{ height, width, maxHeight }}>
      <div className="flex items-center gap-2 px-4 pb-1 pt-4">
        <h2 className="min-w-0 flex-1 text-[17px] font-semibold leading-none tracking-tight">Notifications</h2>
        <button type="button" aria-pressed={dnd} title="Do not disturb" className={cn('pop-iconbtn', dnd && 'bg-[#6b5cff] text-white')} onClick={() => onDnd(!dnd)}>
          <PopIcon name="moon" size={15} />
        </button>
        {onSettings && <button type="button" aria-label="Notification settings" className="pop-iconbtn" onClick={onSettings}><PopIcon name="sliders" size={15} /></button>}
        {notes.length > 0 && (
          <button type="button" className="rounded-full px-2 text-[12px] text-(--u-ink-2) transition-colors hover:text-(--u-ink)" onClick={() => onChange([])}>
            Clear all
          </button>
        )}
      </div>

      <div className="pop-scroll flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-3 pb-3 pt-1">
        {groups.map((g) => (
          <GroupCard key={g.app} g={g} onClear={() => onChange(notes.filter((n) => n.app !== g.app))} onClearOne={(id) => onChange(notes.filter((n) => n.id !== id))} onOpen={onOpen} onAction={onAction} onMenu={onMenu} />
        ))}
        {notes.length === 0 && (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 py-14 text-center">
            <PopIcon name="bell" size={24} strokeWidth={1.5} />
            <p className="text-[13px] text-(--u-ink-2)">{dnd ? 'Do not disturb is on' : "You're all caught up"}</p>
          </div>
        )}
      </div>
    </Surface>
  )
}
