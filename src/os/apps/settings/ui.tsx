import { useId, type ComponentType, type ReactNode, type SVGProps } from 'react'
import { cn } from '@/shared/lib/cn'
import { Select as ThemedSelect } from '@/shared/components/ui/select'
import { curve, dur } from '@/os/motion/systemMotion'
import { radius, space, type } from '@/os/design/scale'

/**
 * The building blocks of the macOS-style Settings: grouped inset lists,
 * switches, segmented controls and a search field. Sizes come from the 4pt
 * grid and radius scale in `os/design/scale`, not from literals.
 */

const SNAP = `cubic-bezier(${curve.snap.join(',')})`

/** macOS switch: 38×22 track, 18px knob, 2px inset. */
export function Switch({ checked, onChange, disabled, label }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative shrink-0 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]/60 disabled:opacity-50',
        checked ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-text-primary)]/20',
      )}
      style={{ width: 38, height: 22, transition: `background-color ${dur.normal}s ${SNAP}` }}
    >
      <span
        className="absolute left-0.5 top-0.5 rounded-full bg-white shadow-[0_1px_3px_rgb(0_0_0/0.35)]"
        style={{ width: 18, height: 18, transform: `translateX(${checked ? 16 : 0}px)`, transition: `transform ${dur.normal}s ${SNAP}` }}
      />
    </button>
  )
}

/** A rounded, inset list of rows. Rows are separated by hairlines, never boxed individually. */
export function Group({ title, footer, children, className }: { title?: string; footer?: string; children: ReactNode; className?: string }) {
  return (
    <section className={cn('flex flex-col', className)}>
      {title && <h3 className="mb-1.5 px-1 font-semibold text-[var(--color-text-primary)]" style={{ fontSize: type.body.size }}>{title}</h3>}
      <div
        className="overflow-hidden border border-[var(--border-hairline)] bg-[var(--surface-raised)] [&>*+*]:border-t [&>*+*]:border-[var(--border-hairline)]"
        style={{ borderRadius: radius.lg }}
      >
        {children}
      </div>
      {footer && <p className="mt-1.5 px-1 text-[var(--color-text-secondary)]" style={{ fontSize: type.caption.size, lineHeight: `${type.caption.line}px` }}>{footer}</p>}
    </section>
  )
}

/** Vertical stack of groups with the standard 24px rhythm between them. */
export function Stack({ children }: { children: ReactNode }) {
  return <div className="flex flex-col" style={{ gap: space(6) }}>{children}</div>
}

export function Row({ title, description, children, stack }: { title: string; description?: string; children?: ReactNode; stack?: boolean }) {
  return (
    <div className={cn('flex gap-4', stack ? 'flex-col' : 'items-center')} style={{ padding: `${space(3)}px ${space(4)}px`, minHeight: 44 }}>
      <div className="min-w-0 flex-1">
        <p className="font-medium text-[var(--color-text-primary)]" style={{ fontSize: type.body.size, lineHeight: `${type.body.line}px` }}>{title}</p>
        {description && (
          <p className="text-[var(--color-text-secondary)]" style={{ fontSize: type.caption.size + 1, lineHeight: `${type.caption.line}px` }}>
            {description}
          </p>
        )}
      </div>
      {children}
    </div>
  )
}

/** Pill-shaped button for row actions. */
export function ActionButton({ children, onClick, disabled }: { children: ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="shrink-0 rounded-[var(--os-radius-control)] bg-[var(--color-text-primary)]/10 px-3 font-medium text-[var(--color-text-primary)] outline-none transition-colors hover:bg-[var(--color-text-primary)]/16 focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]/60 disabled:opacity-40"
      style={{ height: 28, fontSize: type.caption.size + 1 }}
    >
      {children}
    </button>
  )
}

/** One choice out of a few, as a sliding segmented control. */
export function Segmented<T extends string | number>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  const index = Math.max(0, options.findIndex((o) => o.value === value))
  const width = 100 / options.length
  return (
    <div role="radiogroup" className="relative inline-flex shrink-0 rounded-[9px] bg-[var(--color-text-primary)]/10 p-0.5">
      <span
        aria-hidden
        className="absolute bottom-0.5 top-0.5 rounded-[7px] bg-[var(--surface-hover)] shadow-[0_1px_2px_rgb(0_0_0/0.3)]"
        style={{ width: `calc(${width}% - 2px)`, left: 2, transform: `translateX(${index * 100}%)`, transition: `transform ${dur.normal}s ${SNAP}` }}
      />
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
          className={cn('relative z-10 px-3 font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]/60', o.value === value ? 'text-[var(--color-text-primary)]' : 'text-[var(--color-text-secondary)]')}
          style={{ height: 24, fontSize: type.caption.size + 1, borderRadius: 7 }}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** The app's themed dropdown: a native <select> opens an unstyled OS list that is unreadable on the dark UI. */
export function Select<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label?: string }) {
  return <ThemedSelect value={value} options={options} onChange={onChange} size="sm" className="shrink-0" />
}

export function KeyCaps({ keys }: { keys: string }) {
  return (
    <span className="flex shrink-0 gap-1">
      {keys.split('+').map((k) => (
        <kbd key={k} className="min-w-[22px] rounded-[5px] border border-[var(--border-hairline)] bg-[var(--color-text-primary)]/8 px-1.5 text-center font-medium text-[var(--color-text-secondary)]" style={{ fontSize: type.caption.size, lineHeight: '20px' }}>
          {k}
        </kbd>
      ))}
    </span>
  )
}

export function SearchField({ value, onChange, placeholder = 'Search' }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const id = useId()
  return (
    <div className="relative">
      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-secondary)]" aria-hidden>
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </svg>
      <input
        id={id}
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="w-full rounded-[9px] border border-[var(--border-hairline)] bg-[var(--color-text-primary)]/8 pl-8 pr-2 text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-secondary)] focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]/60 [&::-webkit-search-cancel-button]:hidden"
        style={{ height: 28, fontSize: type.body.size }}
      />
    </div>
  )
}

/** Sidebar icon: a small monochrome glass tile like System Settings' coloured squares. */
export function IconTile({ icon: Icon }: { icon: ComponentType<SVGProps<SVGSVGElement>> }) {
  return (
    <span
      className="flex shrink-0 items-center justify-center bg-[linear-gradient(160deg,rgb(255_255_255/0.22),rgb(255_255_255/0.08))] text-[var(--color-text-primary)] shadow-[inset_0_0.5px_0_rgb(255_255_255/0.35),0_1px_2px_rgb(0_0_0/0.25)]"
      style={{ width: 28, height: 28, borderRadius: 7 }}
    >
      <Icon width={17} height={17} />
    </span>
  )
}
