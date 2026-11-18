import { useEffect, useState, type ReactNode } from 'react'
import { useShellMenu } from '@/os/ui/useShellMenu'
import { cn } from '@/shared/lib/cn'
import { fs, type Drive, type Place, type TreeNode } from './api'
import { baseName, bytes, favourites, locKey, TAG_COLORS, tags, useStore, type Loc } from './model'
import { ask, fail } from './ops'
import { dragBus, FileIcon, G, Glyph, placeGlyph, TagDot, useBus } from './ui'

/**
 * SIDEBAR: places, favourites, drives (with how full they are), tags, tools,
 * and a lazily loaded folder tree. Every folder row is a drop target.
 */
export function Sidebar({ loc, onGo, onOpenTab }: { loc: Loc; onGo: (l: Loc) => void; onOpenTab: (l: Loc) => void }) {
  const [places, setPlaces] = useState<Place[]>([])
  const [drives, setDrives] = useState<Drive[]>([])
  const favs = useStore(favourites)
  const tagState = useStore(tags)
  const openMenu = useShellMenu()
  const current = locKey(loc)
  const [treeOpen, setTreeOpen] = useState(() => localStorage.getItem('files2.tree') === '1')

  useEffect(() => {
    void fs.places().then(setPlaces, () => {})
    const load = () => void fs.drives().then((d) => setDrives(d.filter((x) => x.totalBytes > 0)), () => {})
    load()
    const t = setInterval(load, 60_000)
    return () => clearInterval(t)
  }, [])

  const dirRow = (path: string, label: string, glyph: string, extra?: ReactNode, onMenu?: (e: React.MouseEvent) => void) => (
    <Row
      key={path}
      active={current === locKey({ kind: 'dir', path })}
      drop={path}
      onClick={() => onGo({ kind: 'dir', path })}
      onAux={() => onOpenTab({ kind: 'dir', path })}
      onMenu={
        onMenu ??
        ((e) =>
          openMenu(e, [
            { label: 'Open in new tab', onSelect: () => onOpenTab({ kind: 'dir', path }) },
            { label: 'Open terminal here', onSelect: () => void fs.terminal(path).catch(fail) },
            { label: 'Show in Windows Explorer', onSelect: () => void fs.reveal(path).catch(fail) },
          ]))
      }
    >
      <Glyph d={glyph} className="text-(--u-accent)" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {extra}
    </Row>
  )

  return (
    <nav className="u-scroll flex h-full w-[220px] shrink-0 flex-col gap-4 overflow-y-auto border-r border-(--u-edge) px-2.5 py-3 text-[12.5px]">
      <Section title="Places">
        {places.map((p) => dirRow(p.path, p.name, placeGlyph(p.id)))}
        <Row active={current === 'recent'} onClick={() => onGo({ kind: 'recent' })}>
          <Glyph d={G.clock} className="text-(--u-accent)" />
          <span className="flex-1">Recent</span>
        </Row>
      </Section>

      {favs.length > 0 && (
        <Section title="Favourites">
          {favs.map((f) =>
            dirRow(f, baseName(f), G.star, undefined, (e) =>
              openMenu(e, [
                { label: 'Open in new tab', onSelect: () => onOpenTab({ kind: 'dir', path: f }) },
                { label: 'Move up', onSelect: () => favourites.set((l) => move(l, f, -1)) },
                { label: 'Move down', onSelect: () => favourites.set((l) => move(l, f, 1)) },
                {},
                { label: 'Remove from Favourites', danger: true, onSelect: () => favourites.set((l) => l.filter((x) => x !== f)) },
              ]),
            ),
          )}
        </Section>
      )}

      <Section title="Drives">
        {drives.map((d) => {
          const used = 1 - d.freeBytes / d.totalBytes
          const label = d.name ? `${d.name} (${d.mount.replace(/\\$/, '')})` : `Local Disk (${d.mount.replace(/\\$/, '')})`
          return dirRow(
            d.mount,
            label,
            G.drive,
            <span className="flex w-[54px] shrink-0 flex-col items-end gap-0.5" title={`${bytes(d.freeBytes)} free of ${bytes(d.totalBytes)}`}>
              <span className="text-[10.5px] tabular-nums text-(--u-ink-3)">{bytes(d.freeBytes)}</span>
              <span className="h-[3px] w-full overflow-hidden rounded-full bg-(--u-wash-press)">
                <span className={cn('block h-full rounded-full', used > 0.9 ? 'bg-(--u-danger)' : 'bg-(--u-accent)')} style={{ width: `${used * 100}%` }} />
              </span>
            </span>,
          )
        })}
      </Section>

      <Section
        title="Tags"
        action={
          <button
            type="button"
            title="New tag"
            className="rounded-[5px] p-0.5 text-(--u-ink-3) hover:bg-(--u-wash-hover) hover:text-(--u-ink)"
            onClick={async () => {
              const r = await ask({ title: 'New tag', input: { value: '', placeholder: 'Name' }, choices: [{ label: 'Cancel', value: 'no' }, { label: 'Create', value: 'ok', tone: 'accent' }] })
              const name = r?.value === 'ok' ? r.text?.trim() : ''
              if (!name || tags.get().defs.some((d) => d.name.toLowerCase() === name.toLowerCase())) return
              tags.set((s) => ({ ...s, defs: [...s.defs, { name, color: TAG_COLORS[s.defs.length % TAG_COLORS.length] }] }))
            }}
          >
            <Glyph d={G.plus} size={13} />
          </button>
        }
      >
        {tagState.defs.map((t) => {
          const count = Object.values(tagState.map).filter((l) => l.includes(t.name)).length
          return (
            <Row
              key={t.name}
              active={current === locKey({ kind: 'tag', tag: t.name })}
              onClick={() => onGo({ kind: 'tag', tag: t.name })}
              onMenu={(e) =>
                openMenu(e, [
                  ...TAG_COLORS.map((c, i) => ({ label: `${c === t.color ? '✓ ' : ''}Colour ${['red', 'orange', 'yellow', 'green', 'blue', 'teal', 'grey'][i]}`, onSelect: () => tags.set((s) => ({ ...s, defs: s.defs.map((d) => (d.name === t.name ? { ...d, color: c } : d)) })) })),
                  {},
                  {
                    label: 'Rename…',
                    onSelect: async () => {
                      const r = await ask({ title: 'Rename tag', input: { value: t.name }, choices: [{ label: 'Cancel', value: 'no' }, { label: 'Rename', value: 'ok', tone: 'accent' }] })
                      const name = r?.value === 'ok' ? r.text?.trim() : ''
                      if (!name || name === t.name) return
                      tags.set((s) => ({
                        defs: s.defs.map((d) => (d.name === t.name ? { ...d, name } : d)),
                        map: Object.fromEntries(Object.entries(s.map).map(([k, v]) => [k, v.map((x) => (x === t.name ? name : x))])),
                      }))
                    },
                  },
                  {
                    label: 'Delete tag',
                    danger: true,
                    onSelect: () =>
                      tags.set((s) => ({
                        defs: s.defs.filter((d) => d.name !== t.name),
                        map: Object.fromEntries(Object.entries(s.map).map(([k, v]) => [k, v.filter((x) => x !== t.name)] as const).filter(([, v]) => v.length)),
                      })),
                  },
                ])
              }
            >
              <span className="flex w-4 justify-center">
                <TagDot color={t.color} size={9} />
              </span>
              <span className="min-w-0 flex-1 truncate">{t.name}</span>
              {count > 0 && <span className="text-[11px] tabular-nums text-(--u-ink-3)">{count}</span>}
            </Row>
          )
        })}
      </Section>

      <Section title="Tools">
        <Row active={current === 'bin'} onClick={() => onGo({ kind: 'bin' })}>
          <Glyph d={G.trash} className="text-(--u-accent)" />
          <span className="flex-1">Recycle Bin</span>
        </Row>
        <Row active={loc.kind === 'dupes'} onClick={() => onGo({ kind: 'dupes', root: loc.kind === 'dir' ? loc.path : places[0]?.path ?? 'C:\\' })}>
          <Glyph d={G.copies} className="text-(--u-accent)" />
          <span className="flex-1">Find duplicates</span>
        </Row>
      </Section>

      <Section
        title="Folders"
        action={
          <button type="button" className="rounded-[5px] p-0.5 text-(--u-ink-3) hover:bg-(--u-wash-hover) hover:text-(--u-ink)" title={treeOpen ? 'Hide' : 'Show'} onClick={() => setTreeOpen((o) => (localStorage.setItem('files2.tree', o ? '0' : '1'), !o))}>
            <Glyph d={treeOpen ? G.chevronDown : G.chevron} size={13} />
          </button>
        }
      >
        {treeOpen && (
          <div className="flex flex-col">
            {places[0] && <TreeItem node={{ name: 'Home', path: places[0].path, hasChildren: true, hidden: false }} depth={0} loc={loc} onGo={onGo} />}
            {drives.map((d) => (
              <TreeItem key={d.mount} node={{ name: d.mount.replace(/\\$/, ''), path: d.mount, hasChildren: true, hidden: false }} depth={0} loc={loc} onGo={onGo} />
            ))}
          </div>
        )}
      </Section>
    </nav>
  )
}

function move(list: string[], item: string, by: number) {
  const i = list.indexOf(item)
  const j = Math.max(0, Math.min(list.length - 1, i + by))
  const n = [...list]
  n.splice(i, 1)
  n.splice(j, 0, item)
  return n
}

function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-px">
      <div className="flex h-6 items-center justify-between px-2">
        <span className="text-[11px] font-semibold text-(--u-ink-3)">{title}</span>
        {action}
      </div>
      {children}
    </section>
  )
}

function Row({ active, drop, onClick, onAux, onMenu, children }: { active?: boolean; drop?: string; onClick: () => void; onAux?: () => void; onMenu?: (e: React.MouseEvent) => void; children: ReactNode }) {
  const d = useBus(dragBus)
  const target = drop && d?.target?.toLowerCase() === drop.toLowerCase()
  return (
    <button
      type="button"
      data-drop={drop}
      onClick={onClick}
      onAuxClick={(e) => e.button === 1 && onAux?.()}
      onContextMenu={(e) => {
        if (!onMenu) return
        e.preventDefault()
        onMenu(e)
      }}
      className={cn('flex h-[28px] w-full items-center gap-2.5 rounded-[7px] px-2 text-left', target ? 'bg-(--u-accent) text-white' : active ? 'bg-(--u-wash-on) font-medium' : 'hover:bg-(--u-wash-hover)')}
    >
      {children}
    </button>
  )
}

function TreeItem({ node, depth, loc, onGo }: { node: TreeNode; depth: number; loc: Loc; onGo: (l: Loc) => void }) {
  const [open, setOpen] = useState(false)
  const [kids, setKids] = useState<TreeNode[] | null>(null)
  const d = useBus(dragBus)
  const here = loc.kind === 'dir' ? loc.path.toLowerCase().replace(/\\$/, '') : ''
  const me = node.path.toLowerCase().replace(/\\$/, '')
  const active = here === me
  // Follow the pane: open the branches that lead to the folder being shown.
  useEffect(() => {
    if (here.startsWith(me + '\\') && !open) setOpen(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [here])
  useEffect(() => {
    if (open && !kids) void fs.subdirs(node.path).then(setKids, () => setKids([]))
  }, [open, kids, node.path])
  const target = d?.target?.toLowerCase() === node.path.toLowerCase()
  return (
    <>
      <div
        data-drop={node.path}
        onClick={() => onGo({ kind: 'dir', path: node.path })}
        className={cn('flex h-[26px] cursor-default items-center gap-1 rounded-[6px] pr-2', target ? 'bg-(--u-accent) text-white' : active ? 'bg-(--u-wash-on) font-medium' : 'hover:bg-(--u-wash-hover)', node.hidden && 'opacity-60')}
        style={{ paddingLeft: 2 + depth * 12 }}
      >
        <button
          type="button"
          aria-label={open ? 'Collapse' : 'Expand'}
          onClick={(e) => (e.stopPropagation(), setOpen((o) => !o))}
          className={cn('flex h-5 w-5 shrink-0 items-center justify-center rounded-[4px] text-(--u-ink-3) hover:text-(--u-ink)', !node.hasChildren && 'invisible')}
        >
          <Glyph d={open ? G.chevronDown : G.chevron} size={11} />
        </button>
        <FileIcon ext="" isDir size={15} open={open} />
        <span className="ml-1 min-w-0 truncate">{node.name}</span>
      </div>
      {open && kids?.map((k) => <TreeItem key={k.path} node={k} depth={depth + 1} loc={loc} onGo={onGo} />)}
    </>
  )
}
