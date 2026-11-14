import { useId, type ComponentType, type ReactNode, type SVGProps } from 'react'
import { cn } from '@/shared/lib/cn'
import { Select as ThemedSelect } from '@/shared/components/ui/select'
import { Button, Segmented as KitSegmented, Switch as KitSwitch } from '@/os/ui/controls'

/**
 * The building blocks of Settings, on the shared control kit (`os/ui/controls`, `ui/ui.css`):
 * cards of rows, switches, segmented controls, a search field. A switch here is the same switch
 * as in the Sound popup; only the layout pieces (Group, Row, Stack) are local.
 */

export function Switch({ checked, onChange, disabled, label }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label?: string }) {
  return <KitSwitch checked={checked} onChange={onChange} disabled={disabled} label={label} />
}

/** A titled card of rows, separated by hairlines. */
export function Group({ title, footer, children, className }: { title?: string; footer?: string; children: ReactNode; className?: string }) {
  return (
    <section className={cn('flex flex-col', className)}>
      {title && <h3 className="u-label mb-2 px-1">{title}</h3>}
      <div className="u-surface--card overflow-hidden [&>*+*]:border-t [&>*+*]:border-(--u-edge)">{children}</div>
      {footer && <p className="mt-1.5 px-1 text-[11.5px] leading-snug text-(--u-ink-3)">{footer}</p>}
    </section>
  )
}

/** Vertical stack of groups. */
export function Stack({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-6">{children}</div>
}

export function Row({ title, description, children, stack }: { title: string; description?: string; children?: ReactNode; stack?: boolean }) {
  return (
    <div className={cn('flex min-h-[52px] gap-4 px-4 py-3', stack ? 'flex-col' : 'items-center')}>
      <div className="min-w-0 flex-1">
        <p className="text-[13.5px] font-medium">{title}</p>
        {description && <p className="mt-0.5 text-[12px] leading-snug text-(--u-ink-3)">{description}</p>}
      </div>
      {children}
    </div>
  )
}

/** Button for row actions. */
export function ActionButton({ children, onClick, disabled, danger }: { children: ReactNode; onClick: () => void; disabled?: boolean; danger?: boolean }) {
  return (
    <Button variant={danger ? 'danger' : 'tinted'} size="sm" onClick={onClick} disabled={disabled} className="shrink-0">
      {children}
    </Button>
  )
}

/** One choice out of a few. */
export function Segmented<T extends string | number>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  const str = options.map((o) => ({ value: String(o.value), label: o.label }))
  return (
    <KitSegmented
      value={String(value)}
      options={str}
      onChange={(v) => {
        const hit = options.find((o) => String(o.value) === v)
        if (hit) onChange(hit.value)
      }}
      className="shrink-0"
    />
  )
}

/** The app's themed dropdown. */
export function Select<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label?: string }) {
  return <ThemedSelect value={value} options={options} onChange={onChange} size="sm" className="shrink-0" />
}

export function KeyCaps({ keys }: { keys: string }) {
  return (
    <span className="flex shrink-0 gap-1">
      {keys.split('+').map((k) => (
        <kbd key={k} className="min-w-[24px] rounded-[6px] bg-(--u-wash-on) px-1.5 text-center text-[11.5px] font-medium leading-[22px] text-(--u-ink-2) shadow-[inset_0_0_0_1px_var(--u-edge),0_1px_0_var(--u-edge)]">
          {k}
        </kbd>
      ))}
    </span>
  )
}

export function SearchField({ value, onChange, placeholder = 'Search' }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const id = useId()
  return (
    <label className="u-search h-9 gap-2 px-3" htmlFor={id}>
      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="shrink-0 opacity-50" aria-hidden>
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </svg>
      <input id={id} type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder} spellCheck={false} className="h-full min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-(--u-ink-3) [&::-webkit-search-cancel-button]:hidden" />
    </label>
  )
}

/** Sidebar icon: a small tile. */
export function IconTile({ icon: Icon }: { icon: ComponentType<SVGProps<SVGSVGElement>> }) {
  return (
    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] bg-(--u-wash-on) shadow-[inset_0_0_0_1px_var(--u-edge)]">
      <Icon width={16} height={16} />
    </span>
  )
}
