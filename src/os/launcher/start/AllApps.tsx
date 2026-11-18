import { useMemo, useState, type ReactNode } from 'react'
import { cn } from '@/shared/lib/cn'
import { APP_DEFS, APP_IDS } from '@/os/kernel/registry'
import { openApp } from '@/os/kernel/shell'
import { AppIcon } from '@/os/ui/icons/AppIcon'
import { PopIcon } from '@/os/ui/pop/icons'
import { Segmented } from '@/os/ui/controls'
import { useProfile } from '@/os/kernel/profile'
import { launchPin, WORK_ONLY_APPS, type InstalledApp, type Pin } from './model'

/**
 * ALL APPS: every app on the PC, A to Z.
 *
 *   toolbar     Back, the apps' count and a Grid / List switch
 *   Udaan       Udaan's own apps first, as a larger group
 *   A to Z      the installed apps under big letters
 * Right-click any app for everything you can do with it (pin to Start or the taskbar, run as administrator...).
 * Icons are the same size as the taskbar's (32 px).
 */
export function AllApps({
  installed,
  Icon,
  onMenu,
  finish,
  onBack,
}: {
  installed: InstalledApp[]
  Icon: (p: { id: string; size: number }) => ReactNode
  /** Opens the app's right-click menu. */
  onMenu: (e: React.MouseEvent, pin: Pin, run: () => void) => void
  finish: (fn: () => unknown) => void
  onBack?: () => void
}) {
  const [layout, setLayout] = useState<'grid' | 'list'>('grid')

  // Work's own apps (Anvil) are not part of Personal's Start at all.
  const profile = useProfile()
  const shownIds = useMemo(() => APP_IDS.filter((id) => profile === 'work' || !WORK_ONLY_APPS.includes(id)), [profile])
  const udaan = useMemo(() => shownIds, [shownIds])
  const groups = useMemo(() => {
    const m = new Map<string, InstalledApp[]>()
    for (const a of installed) {
      const c = /[a-z]/i.test(a.name[0]) ? a.name[0].toUpperCase() : '#'
      m.set(c, [...(m.get(c) ?? []), a])
    }
    return [...m.entries()].sort(([a], [b]) => (a === '#' ? -1 : b === '#' ? 1 : a.localeCompare(b)))
  }, [installed])
  const grid = layout === 'grid'

  const cell = (key: string, icon: ReactNode, name: string, pin: Pin, run: () => void, tag?: string) => (
    <button
      key={key}
      type="button"
      title={name}
      onClick={run}
      onContextMenu={(e) => onMenu(e, pin, run)}
      className={grid ? 'group relative flex h-[84px] flex-col items-center justify-center gap-2 rounded-[10px] px-0.5 transition-colors hover:bg-white/[0.09] active:bg-white/[0.14]' : 'pop-row h-11'}
    >
      <span className={grid ? 'transition-transform duration-150 group-hover:scale-[1.07]' : ''}>{icon}</span>
      <span className={grid ? 'line-clamp-2 w-full text-center text-[11.5px] leading-tight' : 'min-w-0 flex-1 truncate text-[13.5px]'}>{name}</span>
      {tag && <span className={cn('rounded-full bg-[#2f6bff]/30 px-1.5 text-[9.5px] font-semibold uppercase tracking-wide text-[#9dbaff]', grid && 'absolute right-1.5 top-1.5')}>{tag}</span>}
    </button>
  )
  const gridCls = grid ? 'grid grid-cols-8 gap-0.5' : 'grid grid-cols-2 gap-x-2'
  const total = udaan.length + groups.reduce((n, [, l]) => n + l.length, 0)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* toolbar */}
      <div className="flex items-center gap-3 px-7 pb-2 pt-1">
        {onBack && (
          <button type="button" className="pop-btn" onClick={onBack}>
            <PopIcon name="chevron" size={12} style={{ transform: 'scaleX(-1)' }} /> Back
          </button>
        )}
        <span className="text-[12px] tabular-nums text-(--u-ink-3)">{total} {total === 1 ? 'app' : 'apps'}</span>
        <span className="flex-1" />
        <Segmented value={layout} options={[{ value: 'grid', label: 'Grid' }, { value: 'list', label: 'List' }]} onChange={setLayout} />
      </div>

      <div className="pop-scroll min-h-0 flex-1 overflow-y-auto px-7 pb-4 pt-1">
        {udaan.length > 0 && (
          <section data-letter="★" className="mb-3 mt-2">
            <p className="flex items-center gap-2 pb-1.5 text-[13px] font-semibold">
              Udaan <span className="text-[11.5px] font-normal tabular-nums text-(--u-ink-3)">{udaan.length}</span>
              <span className="h-px flex-1 bg-white/10" />
            </p>
            <div className={gridCls}>
              {udaan.map((id) => cell(`u-${id}`, <AppIcon appId={id} size={grid ? 44 : 28} />, APP_DEFS[id].name, { kind: 'udaan', appId: id }, () => finish(() => openApp(id)), WORK_ONLY_APPS.includes(id) ? 'Work' : undefined))}
            </div>
          </section>
        )}

        {groups.map(([letter, list]) => (
          <section key={letter} data-letter={letter} className="mb-3">
            <p className="flex items-baseline gap-2 pb-1 pt-1 leading-none">
              <span className="text-[26px] font-extralight">{letter}</span>
              <span className="text-[11px] tabular-nums text-(--u-ink-3)">{list.length}</span>
              <span className="ml-1 h-px flex-1 bg-white/10" />
            </p>
            <div className={gridCls}>
              {list.map((a) => {
                const pin: Pin = { kind: 'installed', app: a }
                return cell(a.id, <Icon id={a.id} size={grid ? 44 : 28} />, a.name, pin, () => finish(() => launchPin(pin)))
              })}
            </div>
          </section>
        ))}
        {!udaan.length && !groups.length && <p className="py-12 text-center text-[13px] text-(--u-ink-3)">No apps found.</p>}
      </div>
    </div>
  )
}
