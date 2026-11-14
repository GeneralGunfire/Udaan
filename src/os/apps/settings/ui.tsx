import { useId, type ComponentType, type ReactNode, type SVGProps } from 'react'
import { motion } from 'framer-motion'
import { cn } from '@/shared/lib/cn'
import { Select as ThemedSelect } from '@/shared/components/ui/select'
import { springs } from '@/os/motion/systemMotion'
import { prefersReducedMotion } from '@/shared/lib/motion'
import { Button, Switch as OsSwitch } from '@/os/ui/controls'
import { radius, space, type } from '@/os/design/scale'

/**
 * The building blocks of Settings: grouped inset lists, switches, segmented
 * controls and a search field.
 *
 * The interactive controls here are the shared ones from os/ui/controls, so
 * a switch in Settings behaves exactly like a switch in the Sound panel.
 * They used to be a separate implementation with its own timings and press
 * behaviour, which is how a single product ends up with two switches that
 * feel different — nobody notices the specific difference, only that the
 * whole thing feels unfinished.
 *
 * What stays local are the *layout* pieces (Group, Row, Stack), because
 * grouped inset lists are a Settings idiom and nothing else in the shell
 * uses them. Sizes come from the 4pt grid and radius scale in
 * os/design/scale, not from literals.
 */

export function Switch({ checked, onChange, disabled, label }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label?: string }) {
  return <OsSwitch checked={checked} onChange={onChange} disabled={disabled} label={label} />
}

/** A rounded, inset list of rows. Rows are separated by hairlines, never boxed individually. */
export function Group({ title, footer, children, className }: { title?: string; footer?: string; children: ReactNode; className?: string }) {
  return (
    <section className={cn('flex flex-col', className)}>
      {title && <h3 className="mb-1.5 px-1 font-semibold text-(--color-text-primary)" style={{ fontSize: type.body.size }}>{title}</h3>}
      <div
        className="overflow-hidden border border-(--border-hairline) bg-(--surface-raised) [&>*+*]:border-t [&>*+*]:border-(--border-hairline)"
        style={{ borderRadius: radius.lg, boxShadow: 'var(--os-edge)' }}
      >
        {children}
      </div>
      {footer && <p className="mt-1.5 px-1 text-(--color-text-secondary)" style={{ fontSize: type.caption.size, lineHeight: `${type.caption.line}px` }}>{footer}</p>}
    </section>
  )
}

/** Vertical stack of groups with the standard 24px rhythm between them. */
export function Stack({ children }: { children: ReactNode }) {
  return <div className="flex flex-col" style={{ gap: space(6) }}>{children}</div>
}

export function Row({ title, description, children, stack }: { title: string; description?: string; children?: ReactNode; stack?: boolean }) {
  return (
    <div
      className={cn('flex gap-4 transition-colors duration-150 hover:bg-(--os-hover)', stack ? 'flex-col' : 'items-center')}
      style={{ padding: `${space(3)}px ${space(4)}px`, minHeight: 44 }}
    >
      <div className="min-w-0 flex-1">
        <p className="font-medium text-(--color-text-primary)" style={{ fontSize: type.body.size, lineHeight: `${type.body.line}px` }}>{title}</p>
        {description && (
          <p className="text-(--color-text-secondary)" style={{ fontSize: type.caption.size + 1, lineHeight: `${type.caption.line}px` }}>
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
    <Button variant="tinted" size="sm" onClick={onClick} disabled={disabled} className="shrink-0">
      {children}
    </Button>
  )
}

/**
 * One choice out of a few, as a segmented control whose selection slides.
 *
 * The pill is a shared `layoutId`, so Framer animates it between cells
 * rather than cross-fading two static backgrounds. That movement is what
 * says "these are positions on one axis" instead of "these are separate
 * buttons that happen to be adjacent".
 */
export function Segmented<T extends string | number>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  const id = useId()
  const reduced = prefersReducedMotion()
  return (
    <div role="radiogroup" className="relative inline-flex shrink-0 rounded-[9px] bg-(--os-hover) p-0.5" style={{ boxShadow: 'inset 0 1px 2px rgb(0 0 0 / 12%)' }}>
      {options.map((o) => {
        const selected = o.value === value
        return (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(o.value)}
            className={cn(
              'relative z-10 px-3 font-medium outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-accent/60',
              selected ? 'text-(--color-text-primary)' : 'text-(--color-text-secondary)',
            )}
            style={{ height: 24, fontSize: type.caption.size + 1, borderRadius: 7 }}
          >
            {selected && (
              <motion.span
                layoutId={reduced ? undefined : id}
                aria-hidden
                className="absolute inset-0 -z-10 rounded-[7px] bg-(--os-active)"
                style={{ boxShadow: 'var(--os-edge), var(--os-shadow-sm)' }}
                transition={springs.standard}
              />
            )}
            {o.label}
          </button>
        )
      })}
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
        <kbd
          key={k}
          className="min-w-[22px] rounded-[5px] border border-(--border-hairline) bg-(--os-hover) px-1.5 text-center font-medium text-(--color-text-secondary)"
          style={{ fontSize: type.caption.size, lineHeight: '20px', boxShadow: 'var(--os-edge)' }}
        >
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
      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-(--color-text-secondary)" aria-hidden>
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
        className="os-field w-full [&::-webkit-search-cancel-button]:hidden"
        // Inline, not a Tailwind pl-8: .os-field sets its own padding in an
        // unlayered stylesheet, which beats utility classes, so pl-8 was
        // silently ignored and the placeholder rendered under the icon.
        style={{ height: 28, fontSize: type.body.size, paddingLeft: 32, paddingRight: 8 }}
      />
    </div>
  )
}

/** Sidebar icon: a small monochrome glass tile like System Settings' coloured squares. */
export function IconTile({ icon: Icon }: { icon: ComponentType<SVGProps<SVGSVGElement>> }) {
  return (
    <span
      className="flex shrink-0 items-center justify-center bg-[linear-gradient(160deg,rgb(255_255_255/0.22),rgb(255_255_255/0.08))] text-(--color-text-primary)"
      style={{ width: 28, height: 28, borderRadius: 7, boxShadow: 'var(--os-edge), var(--os-shadow-sm)' }}
    >
      <Icon width={17} height={17} />
    </span>
  )
}
