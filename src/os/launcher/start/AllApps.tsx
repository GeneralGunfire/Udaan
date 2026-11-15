import { useMemo, useRef, useState, type ReactNode } from 'react'
import { cn } from '@/shared/lib/cn'
import { APP_DEFS, APP_IDS } from '@/os/kernel/registry'
import { openApp } from '@/os/kernel/shell'
import { AppIcon } from '@/os/ui/icons/AppIcon'
import { useAppMenu } from './appMenu'
import { Button, Segmented } from '@/os/ui/controls'
import { SearchIcon } from '@/shared/icons'
import { launchPin, type InstalledApp, type Pin } from './model'

/**
 * ALL APPS: every app on the PC, A to Z.
 *
 * Udaan's own apps come first as a bigger group. Below them the installed apps are grouped under large
 * letters. A filter box narrows both as you type, a rail on the right jumps to a letter (letters with no
 * apps are dimmed), and a switch flips between a grid of tiles and a compact list. Right-click pins an app
 * to Start, opens it as administrator, or shows it in its folder.
 */
type PinAction = (p: Pin) => { pinned: boolean; onPin: () => void; onUnpin: () => void }

export function AllApps({
  installed,
  Icon,
  pinAction,
  finish,
  onBack,
}: {
  installed: InstalledApp[]
  Icon: (p: { id: string; size: number }) => ReactNode
  pinAction: PinAction
  finish: (fn: () => unknown) => void
  onBack: () => void
}) {
  const appMenu = useAppMenu()
  const [filter, setFilter] = useState('')
  const [layout, setLayout] = useState<'grid' | 'list'>('grid')
  const scroller = useRef<HTMLDivElement>(null)
  const f = filter.trim().toLowerCase()

  const udaan = useMemo(() => APP_IDS.filter((id) => !f || APP_DEFS[id].name.toLowerCase().includes(f)), [f])
  const groups = useMemo(() => {
    const m = new Map<string, InstalledApp[]>()
    for (const a of installed) {
      if (f && !a.name.toLowerCase().includes(f)) continue
      const c = /[a-z]/i.test(a.name[0]) ? a.name[0].toUpperCase() : '#'
      m.set(c, [...(m.get(c) ?? []), a])
    }
    return [...m.entries()].sort(([a], [b]) => (a === '#' ? -1 : b === '#' ? 1 : a.localeCompare(b)))
  }, [installed, f])
  const present = new Set(groups.map(([l]) => l))
  const rail = ['#', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ']
  const jump = (l: string) => scroller.current?.querySelector(`[data-letter="${l}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' })

  const cell = (key: string, icon: ReactNode, name: string, run: () => void, pin: Pin, path?: string) => (
    <div key={key} onContextMenu={(e) => appMenu(e, { path, onOpen: run, ...pinAction(pin) })} className="contents">
      {layout === 'grid' ? (
        <button type="button" className="u-tile h-[104px] justify-center gap-2" onClick={run} title={name}>
          {icon}
          <span className="line-clamp-2 w-full text-center text-[11.5px] font-medium leading-tight">{name}</span>
        </button>
      ) : (
        <button type="button" className="u-row h-10 gap-3 px-3" onClick={run} title={name}>
          {icon}
          <span className="truncate text-[13px] font-medium">{name}</span>
        </button>
      )}
    </div>
  )
  const gridCls = layout === 'grid' ? 'grid grid-cols-7 gap-1' : 'grid grid-cols-3 gap-x-1'

  return (
    <div className="flex min-h-0 flex-1">
      <div ref={scroller} className="u-scroll min-h-0 min-w-0 flex-1 overflow-y-auto pb-5 pl-5 pr-2">
        <div className="sticky top-0 z-20 flex items-center gap-2 bg-(--u-m-solid) pb-3 pt-3">
          <Button size="sm" variant="tinted" onClick={onBack}>
            ‹ Back
          </Button>
          <h2 className="text-[15px] font-semibold">All apps</h2>
          <span className="text-[12px] text-(--u-ink-3)">{APP_IDS.length + installed.length}</span>
          <span className="flex-1" />
          <label className="u-search h-8 w-[200px] gap-2 px-3">
            <SearchIcon width={13} height={13} className="shrink-0 opacity-50" />
            <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter apps" spellCheck={false} className="h-full min-w-0 flex-1 bg-transparent text-[12.5px] outline-none placeholder:text-(--u-ink-3)" />
          </label>
          <Segmented value={layout} options={[{ value: 'grid', label: 'Grid' }, { value: 'list', label: 'List' }]} onChange={setLayout} />
        </div>

        {udaan.length > 0 && (
          <section data-letter="★" className="mb-2">
            <p className="u-label pb-1 pt-1">Udaan</p>
            <div className={gridCls}>
              {udaan.map((id) => {
                const run = () => finish(() => openApp(id))
                return cell(`u-${id}`, <AppIcon appId={id} size={layout === 'grid' ? 44 : 26} />, APP_DEFS[id].name, run, { kind: 'udaan', appId: id })
              })}
            </div>
          </section>
        )}

        {groups.map(([letter, list]) => (
          <section key={letter} data-letter={letter} className="mb-2">
            <p className="sticky top-[52px] z-10 -mx-1 flex items-baseline gap-2 bg-(--u-m-solid) px-1 pb-1.5 pt-2 leading-none">
              <span className="text-[24px] font-light text-(--u-ink)">{letter}</span>
              <span className="text-[11px] tabular-nums text-(--u-ink-3)">{list.length}</span>
              <span className="ml-1 h-px flex-1 bg-(--u-edge)" />
            </p>
            <div className={gridCls}>
              {list.map((a) => {
                const pin: Pin = { kind: 'installed', app: a }
                return cell(a.id, <Icon id={a.id} size={layout === 'grid' ? 44 : 26} />, a.name, () => finish(() => launchPin(pin)), pin, `shell:AppsFolder\${a.id}`)
              })}
            </div>
          </section>
        ))}
        {!udaan.length && !groups.length && <p className="py-10 text-center text-[13px] text-(--u-ink-3)">No apps match “{filter}”.</p>}
      </div>

      <div className="flex w-8 shrink-0 flex-col items-center justify-center gap-px py-2 pr-1.5">
        <button type="button" onClick={() => jump('★')} className="u-btn u-btn--ghost u-btn--sm h-4.5 w-6 px-0 text-[10px]" title="Udaan">
          ★
        </button>
        {rail.map((l) => (
          <button key={l} type="button" disabled={!present.has(l)} onClick={() => jump(l)} className={cn('u-btn u-btn--ghost u-btn--sm h-4.5 w-6 px-0 text-[10px] font-semibold', !present.has(l) && 'opacity-25')}>
            {l}
          </button>
        ))}
      </div>
    </div>
  )
}
