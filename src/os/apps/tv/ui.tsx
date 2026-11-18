import { useRef, type ReactNode } from 'react'
import { cn } from '@/shared/lib/cn'
import { logo, type Service } from './services'
import type { Status, Title } from './types'

/**
 * TV is one dark, full-screen surface whatever the system theme, so it uses fixed charcoal and white
 * washes (not the themed kit tokens). Accent is the one shared blue. No glows, no looping motion.
 */

export const ACCENT = 'var(--u-accent)'

const PATH = {
  home: 'M12 3 2.5 11h2.8v9.5h5v-6h3.4v6h5V11h2.8z',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM20 20l-3.5-3.5',
  plus: 'M12 5v14M5 12h14',
  check: 'M5 12.5 10 17.5 19 7',
  bookmark: 'M7 4h10v16l-5-3.5L7 20z',
  back: 'M15 5l-7 7 7 7',
  fwd: 'M9 5l7 7-7 7',
  close: 'M6 6l12 12M18 6 6 18',
  star: 'M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 16.9 6.8 19.7l1-5.9L3.5 9.7l5.9-.8z',
  bell: 'M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20.5h4',
  play: 'M8 5.5v13l10.5-6.5z',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 7v5l3 2',
  film: 'M4 5h16v14H4zM8 5v14M16 5v14M4 9h4M4 15h4M16 9h4M16 15h4',
  tv: 'M3 7h18v11H3zM8 21h8M9 3l3 4 3-4',
  grid: 'M4 4h6.5v6.5H4zM13.5 4H20v6.5h-6.5zM4 13.5h6.5V20H4zM13.5 13.5H20V20h-6.5z',
  moon: 'M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z',
  reload: 'M20 12a8 8 0 1 1-2.4-5.7M20 4v5h-5',
  video: 'M3 6h12v12H3zM15 10l6-3v10l-6-3',
}
export type IconName = keyof typeof PATH
const FILLED: IconName[] = ['home', 'play', 'moon']

export function Icon({ name, size = 16, className }: { name: IconName; size?: number; className?: string }) {
  const fill = FILLED.includes(name)
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill={fill ? 'currentColor' : 'none'} stroke={fill ? 'none' : 'currentColor'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={cn('shrink-0', className)} aria-hidden>
      <path d={PATH[name]} />
    </svg>
  )
}

export function Logo({ s, size }: { s: Service; size: number }) {
  return (
    <span className="flex shrink-0 items-center justify-center overflow-hidden rounded-[24%] bg-white" style={{ width: size, height: size }}>
      <img src={logo(s.domain)} alt="" className="object-contain" style={{ width: size * 0.66, height: size * 0.66 }} draggable={false} />
    </span>
  )
}

export const focusRing = 'outline-none focus-visible:ring-2 focus-visible:ring-[var(--u-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0c0d10]'

export function Pill({ on, onClick, children, className }: { on?: boolean; onClick: () => void; children: ReactNode; className?: string }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick} className={cn('h-8 shrink-0 rounded-full px-3.5 text-[12.5px] font-medium transition-colors duration-100', focusRing, on ? 'bg-white text-black' : 'bg-white/[0.08] text-white/75 hover:bg-white/[0.15]', className)}>
      {children}
    </button>
  )
}

export function StatusMark({ status }: { status: Status }) {
  const m = { want: ['bookmark', 'Want to watch'], watching: ['play', 'Watching'], watched: ['check', 'Watched'] } as const
  const [icon, label] = m[status]
  return (
    <span className={cn('absolute bottom-2 left-2 flex h-6 items-center gap-1 rounded-full px-2 text-[11px] font-semibold', status === 'watching' ? 'bg-[var(--u-accent)] text-white' : 'bg-black/70 text-white')}>
      <Icon name={icon} size={11} />
      {label}
    </span>
  )
}

/** A poster with its title underneath. The bookmark and play buttons appear on hover or keyboard focus. */
export function PosterCard({ t, status, sub, onOpen, onBookmark, onPlay, width = 168 }: { t: Title; status?: Status; sub?: string; onOpen: () => void; onBookmark?: () => void; onPlay?: () => void; width?: number }) {
  const act = 'absolute flex h-8 w-8 items-center justify-center rounded-full bg-black/75 text-white opacity-0 transition-opacity duration-100 hover:bg-black group-hover:opacity-100 focus-visible:opacity-100'
  return (
    <div className={cn('group relative', width ? 'shrink-0' : 'min-w-0')} style={width ? { width } : undefined}>
      <button type="button" onClick={onOpen} title={t.summary} className={cn('block w-full rounded-[12px] text-left', focusRing)}>
        <span className="relative block aspect-[2/3] overflow-hidden rounded-[10px] bg-white/[0.06] transition-transform duration-150 group-hover:-translate-y-1">
          <img src={t.image} alt="" loading="lazy" decoding="async" draggable={false} className="h-full w-full object-cover" />
          {status && <StatusMark status={status} />}
        </span>
        <p className="mt-2 truncate text-[13px] font-medium">{t.title}</p>
        <p className="truncate text-[11.5px] text-white/45">{sub ?? [t.year, t.genre].filter(Boolean).join(' · ')}</p>
      </button>
      {onBookmark && (
        <button type="button" aria-label={status ? 'Remove from my list' : 'Add to my list'} title={status ? 'Remove from my list' : 'Add to my list'} onClick={onBookmark} className={cn(act, 'right-2 top-2')}>
          <Icon name={status ? 'check' : 'plus'} size={15} />
        </button>
      )}
      {onPlay && (
        <button type="button" aria-label="Resume" title="Resume" onClick={onPlay} className={cn(act, 'left-2 top-2 !bg-[var(--u-accent)]')}>
          <Icon name="play" size={14} />
        </button>
      )}
    </div>
  )
}

/** A titled row that scrolls sideways, with arrows. */
export function Rail({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const by = (d: number) => ref.current?.scrollBy({ left: d * ref.current.clientWidth * 0.8, behavior: 'smooth' })
  return (
    <section className="px-14 pt-8">
      <div className="flex items-end justify-between gap-4">
        <div className="flex items-baseline gap-3">
          <h2 className="text-[19px] font-semibold">{title}</h2>
          {hint && <span className="text-[12.5px] text-white/40">{hint}</span>}
        </div>
        <div className="flex gap-1">
          {(['back', 'fwd'] as const).map((n, i) => (
            <button key={n} type="button" aria-label={n === 'back' ? 'Scroll left' : 'Scroll right'} onClick={() => by(i ? 1 : -1)} className={cn('flex h-7 w-7 items-center justify-center rounded-full text-white/60 hover:bg-white/[0.1] hover:text-white', focusRing)}>
              <Icon name={n} size={14} />
            </button>
          ))}
        </div>
      </div>
      <div ref={ref} className="-mx-2 mt-3 flex gap-4 overflow-x-auto px-2 pb-3 pt-1 [scrollbar-width:none]">
        {children}
      </div>
    </section>
  )
}

export function Empty({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="mx-auto flex max-w-[420px] flex-col items-center gap-2 px-6 pt-24 text-center">
      <p className="text-[17px] font-semibold text-white/85">{title}</p>
      <p className="text-[13.5px] leading-relaxed text-white/50">{body}</p>
      {action && <div className="mt-3">{action}</div>}
    </div>
  )
}

export function Btn({ children, onClick, primary, disabled, title, className }: { children: ReactNode; onClick: () => void; primary?: boolean; disabled?: boolean; title?: string; className?: string }) {
  return (
    <button type="button" title={title} disabled={disabled} onClick={onClick} className={cn('flex h-10 shrink-0 items-center gap-2 rounded-full px-5 text-[13.5px] font-semibold transition-colors duration-100 disabled:opacity-40', focusRing, primary ? 'bg-white text-black enabled:hover:bg-white/90' : 'bg-white/[0.1] text-white enabled:hover:bg-white/[0.18]', className)}>
      {children}
    </button>
  )
}
