import { useEffect, useMemo, useState } from 'react'
import { Button, Segmented, Switch } from '@/os/ui/controls'
import { cn } from '@/shared/lib/cn'
import { fs, on, type BinItem, type DupeGroup } from './api'
import { baseName, bytes, extOf, fullDate, join, parentOf, when, type Item, type Loc } from './model'
import * as ops from './ops'
import { FileIcon, G, Glyph, Modal } from './ui'

/* ── BATCH RENAME ────────────────────────────────────────────────── */

type CaseMode = 'keep' | 'lower' | 'upper' | 'title'

export function BatchRename({ items, onClose, onDone }: { items: Item[]; onClose: () => void; onDone: () => void }) {
  const [find, setFind] = useState('')
  const [replace, setReplace] = useState('')
  const [regex, setRegex] = useState(false)
  const [matchCase, setMatchCase] = useState(false)
  const [template, setTemplate] = useState('{name}')
  const [start, setStart] = useState(1)
  const [digits, setDigits] = useState(2)
  const [caseMode, setCaseMode] = useState<CaseMode>('keep')
  const [ext, setExt] = useState('')
  const [busy, setBusy] = useState(false)

  const rows = useMemo(() => {
    let reErr: string | null = null
    let re: RegExp | null = null
    if (find) {
      try {
        re = new RegExp(regex ? find : find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), matchCase ? 'g' : 'gi')
      } catch (e) {
        reErr = (e as Error).message
      }
    }
    const out = items.map((it, i) => {
      const dot = it.isDir ? -1 : it.name.lastIndexOf('.')
      let stem = dot > 0 ? it.name.slice(0, dot) : it.name
      let e = dot > 0 ? it.name.slice(dot + 1) : ''
      if (re) stem = stem.replace(re, replace)
      const n = String(start + i).padStart(digits, '0')
      const d = new Date(it.modifiedMs || Date.now())
      const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      stem = (template || '{name}').replaceAll('{name}', stem).replaceAll('{n}', n).replaceAll('{date}', date).replaceAll('{folder}', baseName(parentOf(it.path) ?? ''))
      if (caseMode === 'lower') stem = stem.toLowerCase()
      else if (caseMode === 'upper') stem = stem.toUpperCase()
      else if (caseMode === 'title') stem = stem.toLowerCase().replace(/(^|[\s_-])(\p{L})/gu, (_, a, b) => a + b.toUpperCase())
      if (ext.trim() && !it.isDir) e = ext.trim().replace(/^\./, '')
      const name = e ? `${stem.trim()}.${e}` : stem.trim()
      return { it, name, to: join(parentOf(it.path)!, name) }
    })
    // Problems: illegal names, two the same, or a name already used by something not being renamed.
    const counts = new Map<string, number>()
    out.forEach((r) => counts.set(r.to.toLowerCase(), (counts.get(r.to.toLowerCase()) ?? 0) + 1))
    const problems = out.map((r) => (!r.name || /[<>:"/\\|?*]/.test(r.name) || /[ .]$/.test(r.name) ? 'Not a valid name' : (counts.get(r.to.toLowerCase()) ?? 0) > 1 ? 'Same name as another item' : null))
    return { list: out.map((r, i) => ({ ...r, problem: problems[i] })), reErr }
  }, [items, find, replace, regex, matchCase, template, start, digits, caseMode, ext])

  const changes = rows.list.filter((r) => r.name !== r.it.name)
  const blocked = !!rows.reErr || rows.list.some((r) => r.problem)

  const insert = (tok: string) => setTemplate((t) => (t.includes(tok) ? t : `${t} ${tok}`.trim()))

  return (
    <Modal onClose={onClose} width={760} className="h-[min(620px,100%)]">
      <header className="flex items-center justify-between border-b border-(--u-edge) px-5 py-3.5">
        <div>
          <h2 className="text-[15px] font-semibold">Rename {items.length} items</h2>
          <p className="text-[12px] text-(--u-ink-3)">Changes show live below. Undo puts every name back.</p>
        </div>
        <Button size="sm" icon aria-label="Close" onClick={onClose}>
          <Glyph d={G.close} />
        </Button>
      </header>
      <div className="grid grid-cols-[1fr_1fr] gap-x-5 gap-y-3 border-b border-(--u-edge) px-5 py-4 text-[12.5px]">
        <label className="flex flex-col gap-1">
          <span className="text-(--u-ink-3)">Find</span>
          <input className="u-field h-8" value={find} onChange={(e) => setFind(e.target.value)} placeholder="Text to replace" spellCheck={false} autoFocus />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-(--u-ink-3)">Replace with</span>
          <input className="u-field h-8" value={replace} onChange={(e) => setReplace(e.target.value)} placeholder={regex ? 'Use $1 for groups' : 'Leave empty to remove'} spellCheck={false} />
        </label>
        <div className="col-span-2 flex flex-wrap items-center gap-5">
          <label className="flex items-center gap-2">
            <Switch checked={regex} onChange={setRegex} label="Regular expression" /> Regular expression
          </label>
          <label className="flex items-center gap-2">
            <Switch checked={matchCase} onChange={setMatchCase} label="Match case" /> Match case
          </label>
          {rows.reErr && <span className="text-(--u-danger)">{rows.reErr}</span>}
        </div>
        <label className="flex flex-col gap-1">
          <span className="flex items-center justify-between text-(--u-ink-3)">
            Name pattern
            <span className="flex gap-1">
              {['{n}', '{date}', '{folder}'].map((t) => (
                <button key={t} type="button" onClick={() => insert(t)} className="rounded-[4px] bg-(--u-wash-on) px-1.5 font-mono text-[11px] text-(--u-ink-2) hover:text-(--u-ink)">
                  {t}
                </button>
              ))}
            </span>
          </span>
          <input className="u-field h-8 font-mono" value={template} onChange={(e) => setTemplate(e.target.value)} spellCheck={false} />
        </label>
        <div className="flex gap-3">
          <label className="flex w-20 flex-col gap-1">
            <span className="text-(--u-ink-3)">Start at</span>
            <input type="number" className="u-field h-8" value={start} onChange={(e) => setStart(Number(e.target.value) || 0)} />
          </label>
          <label className="flex w-20 flex-col gap-1">
            <span className="text-(--u-ink-3)">Digits</span>
            <input type="number" min={1} max={6} className="u-field h-8" value={digits} onChange={(e) => setDigits(Math.min(6, Math.max(1, Number(e.target.value) || 1)))} />
          </label>
          <label className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="text-(--u-ink-3)">New extension</span>
            <input className="u-field h-8" value={ext} onChange={(e) => setExt(e.target.value)} placeholder="Keep" spellCheck={false} />
          </label>
        </div>
        <div className="col-span-2 flex items-center gap-3">
          <span className="text-(--u-ink-3)">Case</span>
          <Segmented<CaseMode>
            value={caseMode}
            onChange={setCaseMode}
            options={[
              { value: 'keep', label: 'As is' },
              { value: 'lower', label: 'lower' },
              { value: 'upper', label: 'UPPER' },
              { value: 'title', label: 'Title' },
            ]}
          />
        </div>
      </div>
      <div className="u-scroll min-h-0 flex-1 overflow-y-auto px-3 py-2 text-[12.5px]">
        {rows.list.map((r) => (
          <div key={r.it.path} className="grid grid-cols-[1fr_16px_1fr] items-center gap-3 rounded-[6px] px-2 py-1 hover:bg-(--u-wash-hover)">
            <span className="flex min-w-0 items-center gap-2 text-(--u-ink-3)">
              <FileIcon ext={r.it.ext} isDir={r.it.isDir} size={16} />
              <span className="truncate">{r.it.name}</span>
            </span>
            <Glyph d={G.fwd} size={12} className="text-(--u-ink-3)" />
            <span className={cn('min-w-0 truncate', r.problem ? 'text-(--u-danger)' : r.name !== r.it.name ? 'font-medium text-(--u-ink)' : 'text-(--u-ink-3)')} title={r.problem ?? r.name}>
              {r.name}
              {r.problem && <span className="ml-2 text-[11px]">· {r.problem}</span>}
            </span>
          </div>
        ))}
      </div>
      <footer className="flex items-center justify-between border-t border-(--u-edge) px-5 py-3">
        <span className="text-[12px] text-(--u-ink-3)">{changes.length ? `${changes.length} of ${items.length} will change` : 'Nothing changes yet'}</span>
        <div className="flex gap-2">
          <Button variant="tinted" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="accent"
            disabled={blocked || !changes.length || busy}
            onClick={async () => {
              setBusy(true)
              await ops.batchRename(changes.map((r) => [r.it.path, r.to]))
              setBusy(false)
              onDone()
              onClose()
            }}
          >
            Rename
          </Button>
        </div>
      </footer>
    </Modal>
  )
}

/* ── RECYCLE BIN ─────────────────────────────────────────────────── */

export function RecycleBin({ onGo }: { onGo: (l: Loc) => void }) {
  const [items, setItems] = useState<BinItem[] | null>(null)
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const load = () => void fs.binList().then((l) => (setItems(l), setSel(new Set())), (e) => (ops.fail(e), setItems([])))
  useEffect(load, [])
  const shown = useMemo(() => (items ?? []).filter((i) => !q || i.name.toLowerCase().includes(q.toLowerCase()) || i.originalPath.toLowerCase().includes(q.toLowerCase())), [items, q])
  const total = (items ?? []).reduce((a, i) => a + (i.size ?? 0), 0)
  const picked = shown.filter((i) => sel.has(i.id))
  const run = async (f: () => Promise<void>, msg: string) => {
    setBusy(true)
    try {
      await f()
      ops.toast(msg)
    } catch (e) {
      ops.fail(e)
    }
    setBusy(false)
    load()
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-(--u-edge) px-5 py-3">
        <div className="mr-auto">
          <h2 className="text-[15px] font-semibold">Recycle Bin</h2>
          <p className="text-[12px] text-(--u-ink-3)">{items ? `${items.length.toLocaleString()} items · ${bytes(total)}` : 'Reading…'}</p>
        </div>
        <input className="u-field h-8 w-[200px]" placeholder="Filter" value={q} onChange={(e) => setQ(e.target.value)} />
        <Button size="sm" variant="tinted" disabled={!picked.length || busy} onClick={() => void run(() => fs.binRestore(picked.map((i) => i.id)), `Restored ${picked.length} item${picked.length === 1 ? '' : 's'}`)}>
          Restore
        </Button>
        <Button
          size="sm"
          variant="danger"
          disabled={!picked.length || busy}
          onClick={async () => {
            const r = await ops.ask({ title: `Delete ${picked.length} item${picked.length === 1 ? '' : 's'} forever?`, body: 'They cannot be recovered afterwards.', choices: [{ label: 'Cancel', value: 'no' }, { label: 'Delete', value: 'yes', tone: 'danger' }] })
            if (r?.value === 'yes') void run(() => fs.binPurge(picked.map((i) => i.id)), 'Deleted')
          }}
        >
          Delete
        </Button>
        <Button
          size="sm"
          variant="danger-solid"
          disabled={!items?.length || busy}
          onClick={async () => {
            const r = await ops.ask({ title: 'Empty the Recycle Bin?', body: `${items!.length.toLocaleString()} items (${bytes(total)}) will be deleted forever.`, choices: [{ label: 'Cancel', value: 'no' }, { label: 'Empty', value: 'yes', tone: 'danger' }] })
            if (r?.value === 'yes') void run(() => fs.binPurge([]), 'Recycle Bin emptied')
          }}
        >
          Empty
        </Button>
      </div>
      <div className="flex h-[30px] shrink-0 items-center border-b border-(--u-edge) px-5 text-[11.5px] text-(--u-ink-3)">
        <span className="w-7">
          <input type="checkbox" className="accent-(--u-accent)" checked={!!shown.length && picked.length === shown.length} onChange={(e) => setSel(new Set(e.target.checked ? shown.map((i) => i.id) : []))} />
        </span>
        <span className="flex-1">Name</span>
        <span className="w-[260px]">Came from</span>
        <span className="w-[150px]">Deleted</span>
        <span className="w-[80px] text-right">Size</span>
      </div>
      <div className="u-scroll min-h-0 flex-1 overflow-y-auto px-3 py-1 text-[12.5px]">
        {items && !shown.length && <p className="pt-16 text-center text-(--u-ink-3)">{q ? 'Nothing matches.' : 'The Recycle Bin is empty.'}</p>}
        {shown.slice(0, 2000).map((i) => (
          <label key={i.id} className={cn('flex h-[30px] items-center rounded-[6px] px-2', sel.has(i.id) ? 'bg-(--u-wash-on)' : 'hover:bg-(--u-wash-hover)')}>
            <span className="w-7">
              <input type="checkbox" className="accent-(--u-accent)" checked={sel.has(i.id)} onChange={(e) => setSel((s) => { const n = new Set(s); if (e.target.checked) n.add(i.id); else n.delete(i.id); return n })} />
            </span>
            <span className="flex min-w-0 flex-1 items-center gap-2.5 pr-3">
              <FileIcon ext={extOf(i.name)} isDir={i.isDir} size={18} />
              <span className="truncate">{i.name}</span>
            </span>
            <button type="button" className="w-[260px] truncate pr-3 text-left text-(--u-ink-3) hover:text-(--u-accent)" title={i.originalPath} onClick={(e) => (e.preventDefault(), onGo({ kind: 'dir', path: parentOf(i.originalPath) ?? i.originalPath }))}>
              {parentOf(i.originalPath)}
            </button>
            <span className="w-[150px] text-(--u-ink-2)">{when(i.deletedMs)}</span>
            <span className="w-[80px] text-right tabular-nums text-(--u-ink-3)">{i.size === null ? '' : bytes(i.size)}</span>
          </label>
        ))}
      </div>
    </div>
  )
}

/* ── DUPLICATES ──────────────────────────────────────────────────── */

export function Duplicates({ root, onGo }: { root: string; onGo: (l: Loc) => void }) {
  const [min, setMin] = useState('1048576')
  const [hidden, setHidden] = useState(false)
  const [groups, setGroups] = useState<DupeGroup[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [prog, setProg] = useState<{ stage: string; done: number; total: number } | null>(null)
  const [del, setDel] = useState<Set<string>>(new Set())

  useEffect(() => on<{ stage: string; done: number; total: number }>('files://dupes-progress', setProg), [])
  useEffect(() => () => void fs.dupesCancel(), [])
  useEffect(() => (setGroups(null), setDel(new Set())), [root])

  const scan = async () => {
    setBusy(true)
    setGroups(null)
    setDel(new Set())
    setProg({ stage: 'Starting', done: 0, total: 0 })
    try {
      const g = await fs.dupes(root, Number(min), hidden)
      setGroups(g)
      // Suggest keeping the oldest copy of each.
      setDel(new Set(g.flatMap((x) => x.files.slice(1).map((f) => f.path))))
    } catch (e) {
      ops.fail(e)
    }
    setBusy(false)
    setProg(null)
  }
  const wasted = (groups ?? []).reduce((a, g) => a + g.size * (g.files.length - 1), 0)
  const freeing = (groups ?? []).reduce((a, g) => a + g.size * g.files.filter((f) => del.has(f.path)).length, 0)
  const allGone = (groups ?? []).some((g) => g.files.every((f) => del.has(f.path)))

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-(--u-edge) px-5 py-3">
        <div className="mr-auto min-w-0">
          <h2 className="text-[15px] font-semibold">Duplicates</h2>
          <p className="truncate text-[12px] text-(--u-ink-3)" title={root}>
            In {root} and everything inside it
          </p>
        </div>
        <Segmented
          value={min}
          onChange={setMin}
          options={[
            { value: '1', label: 'Any size' },
            { value: '1048576', label: '1 MB+' },
            { value: '52428800', label: '50 MB+' },
          ]}
        />
        <label className="flex items-center gap-2 text-[12.5px]">
          <Switch checked={hidden} onChange={setHidden} label="Include hidden files" /> Hidden
        </label>
        {busy ? (
          <Button size="sm" variant="tinted" onClick={() => void fs.dupesCancel()}>
            Stop
          </Button>
        ) : (
          <Button size="sm" variant="accent" onClick={() => void scan()}>
            {groups ? 'Scan again' : 'Scan'}
          </Button>
        )}
      </div>
      {groups && groups.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 border-b border-(--u-edge) px-5 py-2.5 text-[12.5px]">
          <span className="mr-auto text-(--u-ink-2)">
            {groups.length.toLocaleString()} sets of copies · {bytes(wasted)} could be freed
          </span>
          <Button size="sm" variant="tinted" onClick={() => setDel(new Set(groups.flatMap((g) => g.files.slice(1).map((f) => f.path))))}>
            Keep oldest
          </Button>
          <Button size="sm" variant="tinted" onClick={() => setDel(new Set(groups.flatMap((g) => g.files.slice(0, -1).map((f) => f.path))))}>
            Keep newest
          </Button>
          <Button size="sm" variant="tinted" onClick={() => setDel(new Set())}>
            Clear
          </Button>
          <Button
            size="sm"
            variant="danger"
            disabled={!del.size || allGone}
            title={allGone ? 'Every copy of a file is ticked. Keep at least one.' : undefined}
            onClick={async () => {
              const list = [...del]
              await ops.recycle(list)
              setGroups((gs) => (gs ?? []).map((g) => ({ ...g, files: g.files.filter((f) => !del.has(f.path)) })).filter((g) => g.files.length > 1))
              setDel(new Set())
            }}
          >
            Recycle {del.size.toLocaleString()} ({bytes(freeing)})
          </Button>
        </div>
      )}
      <div className="u-scroll min-h-0 flex-1 overflow-y-auto px-4 py-3 text-[12.5px]">
        {busy && prog && (
          <div className="mx-auto mt-16 flex w-[360px] flex-col gap-2 text-center">
            <p className="text-(--u-ink-2)">{prog.stage}…</p>
            <div className="h-1 overflow-hidden rounded-full bg-(--u-wash-press)">
              {prog.total > 0 ? <div className="h-full bg-(--u-accent)" style={{ width: `${(prog.done / prog.total) * 100}%` }} /> : <div className="files-indeterminate h-full w-1/3 rounded-full bg-(--u-accent)" />}
            </div>
            <p className="text-[11.5px] tabular-nums text-(--u-ink-3)">{prog.total ? `${prog.done.toLocaleString()} of ${prog.total.toLocaleString()} files compared` : prog.done ? `${prog.done.toLocaleString()} files found` : ''}</p>
          </div>
        )}
        {!busy && !groups && <p className="mx-auto mt-16 max-w-[380px] text-center leading-relaxed text-(--u-ink-3)">Files compares sizes first, then contents, so only real copies are listed. Pick a minimum size and press Scan.</p>}
        {!busy && groups?.length === 0 && <p className="mt-16 text-center text-(--u-ink-3)">No duplicates found.</p>}
        {groups?.slice(0, 500).map((g, gi) => (
          <div key={gi} className="mb-3 rounded-[10px] bg-(--u-wash-hover) p-2">
            <p className="px-2 pb-1 text-[11.5px] text-(--u-ink-3)">
              {g.files.length} copies of {bytes(g.size)}
            </p>
            {g.files.map((f) => (
              <label key={f.path} className="flex h-[28px] items-center gap-2.5 rounded-[6px] px-2 hover:bg-(--u-wash-on)">
                <input type="checkbox" className="accent-(--u-danger)" checked={del.has(f.path)} onChange={(e) => setDel((s) => { const n = new Set(s); if (e.target.checked) n.add(f.path); else n.delete(f.path); return n })} />
                <FileIcon ext={extOf(f.path)} isDir={false} size={16} />
                <span className={cn('min-w-0 flex-1 truncate', del.has(f.path) && 'text-(--u-ink-3) line-through')} title={f.path}>
                  {baseName(f.path)} <span className="text-(--u-ink-3)">in {parentOf(f.path)}</span>
                </span>
                <span className="shrink-0 text-(--u-ink-3)">{fullDate(f.modifiedMs)}</span>
                <button type="button" className="shrink-0 text-(--u-ink-3) hover:text-(--u-accent)" title="Show in folder" onClick={(e) => (e.preventDefault(), onGo({ kind: 'dir', path: parentOf(f.path)! }))}>
                  <Glyph d={G.folder} size={14} />
                </button>
              </label>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
