import { useShellMenu } from '@/os/ui/useShellMenu'
import { cn } from '@/shared/lib/cn'
import type { SourceStatus } from './api'

/** A button that shows the chosen source and opens the shared shell menu to change it. */
export function SourcePicker({ sources, value, onChange, className }: { sources: SourceStatus[] | null; value: string; onChange: (id: string) => void; className?: string }) {
  const openMenu = useShellMenu()
  const current = sources?.find((s) => s.id === value)
  return (
    <button
      type="button"
      disabled={!sources}
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect()
        openMenu(
          { x: r.left, y: r.bottom + 4 },
          (sources ?? []).map((s) => ({ label: s.name, onSelect: () => onChange(s.id) })),
        )
      }}
      className={cn('u-btn u-btn--tonal h-8 min-w-[210px] justify-between gap-3 px-3 text-[13px]', className)}
    >
      <span className="truncate">{current?.name ?? 'Choose a source'}</span>
      <span aria-hidden className="text-(--u-ink-3)">
        ▾
      </span>
    </button>
  )
}
