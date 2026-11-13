import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { invoke } from '@tauri-apps/api/core'
import { cn } from '@/shared/lib/cn'
import { PlusIcon, TrashIcon, PencilIcon, CheckIcon } from '@/shared/icons'
import { APP_DEFS, APP_IDS, type AppId } from '@/os/kernel/registry'
import { AppIcon } from '@/os/ui/icons/AppIcon'
import {
  loadQuickstarts,
  saveQuickstarts,
  runQuickstart,
  type Quickstart,
  type QuickstartEntry,
  type Zone,
} from '@/os/kernel/quickstarts'

const COLS = 4
const ROWS = 2

/** Grid cell index -> the zone it covers, as work-area fractions. */
function cellZone(a: number, b: number): Zone {
  const ax = a % COLS
  const ay = Math.floor(a / COLS)
  const bx = b % COLS
  const by = Math.floor(b / COLS)
  const x0 = Math.min(ax, bx)
  const x1 = Math.max(ax, bx)
  const y0 = Math.min(ay, by)
  const y1 = Math.max(ay, by)
  return { x: x0 / COLS, y: y0 / ROWS, w: (x1 - x0 + 1) / COLS, h: (y1 - y0 + 1) / ROWS }
}

function zoneCovers(zone: Zone | undefined, index: number): boolean {
  if (!zone) return false
  const x = (index % COLS) / COLS
  const y = Math.floor(index / COLS) / ROWS
  const eps = 0.001
  return x >= zone.x - eps && x < zone.x + zone.w - eps && y >= zone.y - eps && y < zone.y + zone.h - eps
}

interface InstalledApp {
  name: string
  id: string
}

/** A 4×2 board where you drag across cells to set an app's rectangle. */
function ZonePicker({
  entries,
  activeIndex,
  onSetZone,
}: {
  entries: QuickstartEntry[]
  activeIndex: number
  onSetZone: (zone: Zone | undefined) => void
}) {
  const [anchor, setAnchor] = useState<number | null>(null)
  const [hover, setHover] = useState<number | null>(null)
  const active = entries[activeIndex]

  const preview = anchor !== null && hover !== null ? cellZone(anchor, hover) : undefined

  return (
    <div>
      <div
        className="grid gap-1 select-none"
        style={{ gridTemplateColumns: `repeat(${COLS}, 1fr)` }}
        onMouseLeave={() => {
          setAnchor(null)
          setHover(null)
        }}
      >
        {Array.from({ length: COLS * ROWS }, (_, i) => {
          const inPreview = zoneCovers(preview, i)
          const mine = zoneCovers(active?.zone, i)
          // Which other app already claims this cell, so overlaps are visible.
          const other = entries.find((e, idx) => idx !== activeIndex && zoneCovers(e.zone, i))
          return (
            <button
              key={i}
              type="button"
              onMouseDown={() => {
                setAnchor(i)
                setHover(i)
              }}
              onMouseEnter={() => anchor !== null && setHover(i)}
              onMouseUp={() => {
                if (anchor !== null) onSetZone(cellZone(anchor, i))
                setAnchor(null)
                setHover(null)
              }}
              className={cn(
                'flex h-12 items-center justify-center rounded-[7px] border text-[10px] font-medium transition-colors',
                inPreview || mine
                  ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/25 text-[var(--color-text-primary)]'
                  : other
                    ? 'border-[var(--border-hairline)] bg-[var(--os-menu-item-hover)] text-[var(--color-text-tertiary)]'
                    : 'border-[var(--border-hairline)] bg-[var(--os-menu-item-hover)] text-transparent hover:bg-[var(--os-menu-item-hover)]',
              )}
            >
              {inPreview || mine ? (active?.label.slice(0, 8) ?? '') : other ? other.label.slice(0, 6) : '·'}
            </button>
          )
        })}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <p className="text-[11.5px] text-[var(--color-text-tertiary)]">Drag across cells to place this app.</p>
        {active?.zone && (
          <button
            type="button"
            onClick={() => onSetZone(undefined)}
            className="ml-auto text-[11.5px] text-[var(--color-text-tertiary)] underline-offset-2 hover:text-[var(--color-text-primary)] hover:underline"
          >
            Don't arrange
          </button>
        )}
      </div>
    </div>
  )
}

function Editor({
  draft,
  installed,
  onChange,
  onSave,
  onCancel,
}: {
  draft: Quickstart
  installed: InstalledApp[]
  onChange: (q: Quickstart) => void
  onSave: () => void
  onCancel: () => void
}) {
  const [activeIndex, setActiveIndex] = useState(0)
  const [picker, setPicker] = useState<'udaan' | 'installed'>('udaan')
  const [search, setSearch] = useState('')

  const chosen = new Set(draft.entries.map((e) => e.ref))
  const filteredInstalled = useMemo(() => {
    const q = search.trim().toLowerCase()
    return installed.filter((a) => !q || a.name.toLowerCase().includes(q)).slice(0, 40)
  }, [installed, search])

  function addEntry(entry: QuickstartEntry) {
    onChange({ ...draft, entries: [...draft.entries, entry] })
    setActiveIndex(draft.entries.length)
  }

  function removeEntry(i: number) {
    onChange({ ...draft, entries: draft.entries.filter((_, idx) => idx !== i) })
    setActiveIndex((a) => Math.max(0, Math.min(a, draft.entries.length - 2)))
  }

  function setZone(zone: Zone | undefined) {
    onChange({
      ...draft,
      entries: draft.entries.map((e, i) => (i === activeIndex ? { ...e, zone } : e)),
    })
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      className="rounded-[12px] border border-[var(--border-hairline)] bg-[var(--os-menu-item-hover)] p-4"
    >
      <input
        value={draft.name}
        onChange={(e) => onChange({ ...draft, name: e.target.value })}
        placeholder="Quickstart name (e.g. Work)"
        className="mb-4 w-full rounded-[9px] border border-[var(--border-hairline)] bg-[var(--os-menu-item-hover)] px-3 py-2 text-[13.5px] text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-accent)]"
      />

      <div className="grid grid-cols-2 gap-4">
        <div>
          <p className="mb-2 text-[11.5px] font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]">
            Apps in this quickstart
          </p>
          {draft.entries.length === 0 ? (
            <p className="rounded-[9px] border border-dashed border-[var(--border-hairline)] px-3 py-4 text-center text-[12px] text-[var(--color-text-tertiary)]">
              Add apps from the list below.
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {draft.entries.map((e, i) => (
                <li key={`${e.kind}:${e.ref}`}>
                  <div
                    className={cn(
                      'flex items-center gap-2 rounded-[9px] border px-2.5 py-2 transition-colors',
                      i === activeIndex ? 'border-[var(--color-accent)]/60 bg-[var(--os-menu-item-hover)]' : 'border-[var(--border-hairline)] hover:bg-[var(--os-menu-item-hover)]',
                    )}
                  >
                    <button type="button" onClick={() => setActiveIndex(i)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                      {e.kind === 'udaan' ? (
                        <AppIcon appId={e.ref as AppId} size={20} />
                      ) : (
                        <span className="flex h-5 w-5 items-center justify-center rounded-[5px] bg-[var(--os-menu-item-hover)] text-[9px]">EXE</span>
                      )}
                      <span className="min-w-0 flex-1 truncate text-[12.5px]">{e.label}</span>
                      <span className="shrink-0 text-[10.5px] text-[var(--color-text-tertiary)]">
                        {e.kind === 'external' ? 'launch only' : e.zone ? 'placed' : 'no place'}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => removeEntry(i)}
                      aria-label={`Remove ${e.label}`}
                      className="shrink-0 rounded p-1 text-[var(--color-text-tertiary)] hover:bg-[var(--os-menu-item-hover)] hover:text-[var(--color-text-primary)]"
                    >
                      <TrashIcon width={11} height={11} />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <p className="mb-2 text-[11.5px] font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]">
            Arrangement
          </p>
          {draft.entries.length === 0 ? (
            <p className="rounded-[9px] border border-dashed border-[var(--border-hairline)] px-3 py-4 text-center text-[12px] text-[var(--color-text-tertiary)]">
              Add an app first.
            </p>
          ) : draft.entries[activeIndex]?.kind === 'external' ? (
            <p className="rounded-[9px] border border-[var(--border-hairline)] bg-[var(--os-menu-item-hover)] px-3 py-4 text-center text-[12px] text-[var(--color-text-tertiary)]">
              External programs are launched but not arranged — they open their
              own window on their own schedule.
            </p>
          ) : (
            <ZonePicker entries={draft.entries} activeIndex={activeIndex} onSetZone={setZone} />
          )}
        </div>
      </div>

      <div className="mt-4 border-t border-[var(--border-hairline)] pt-3">
        <div className="mb-2 flex items-center gap-1">
          {(['udaan', 'installed'] as const).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPicker(p)}
              className={cn(
                'rounded-full px-3 py-1 text-[12px] font-medium capitalize transition-colors',
                picker === p ? 'bg-[var(--surface-hover)] text-[var(--color-text-primary)]' : 'text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]',
              )}
            >
              {p === 'udaan' ? 'Udaan apps' : 'Installed programs'}
            </button>
          ))}
          {picker === 'installed' && (
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search…"
              className="ml-auto w-40 rounded-full border border-[var(--border-hairline)] bg-[var(--os-menu-item-hover)] px-3 py-1 text-[12px] outline-none placeholder:text-[var(--color-text-tertiary)]"
            />
          )}
        </div>

        <div className="flex max-h-[150px] flex-wrap gap-1 overflow-y-auto">
          {picker === 'udaan'
            ? APP_IDS.filter((id) => !chosen.has(id)).map((id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => addEntry({ kind: 'udaan', ref: id, label: APP_DEFS[id].name })}
                  className="flex items-center gap-1.5 rounded-full border border-[var(--border-hairline)] px-2.5 py-1 text-[12px] hover:bg-[var(--os-menu-item-hover)]"
                >
                  <AppIcon appId={id} size={15} />
                  {APP_DEFS[id].name}
                </button>
              ))
            : filteredInstalled
                .filter((a) => !chosen.has(a.id))
                .map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => addEntry({ kind: 'external', ref: `shell:AppsFolder\\${a.id}`, label: a.name })}
                    className="flex items-center gap-1.5 rounded-full border border-[var(--border-hairline)] px-2.5 py-1 text-[12px] hover:bg-[var(--os-menu-item-hover)]"
                  >
                    {a.name}
                  </button>
                ))}
        </div>
      </div>

      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-full px-4 py-1.5 text-[13px] font-medium text-[var(--color-text-secondary)] hover:bg-[var(--os-menu-item-hover)]"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={!draft.name.trim() || draft.entries.length === 0}
          className="rounded-full bg-[var(--color-accent)] px-4 py-1.5 text-[13px] font-semibold text-[var(--color-text-primary)] disabled:opacity-40"
        >
          Save quickstart
        </button>
      </div>
    </motion.div>
  )
}

export function QuickstartsSection() {
  const [list, setList] = useState<Quickstart[]>([])
  const [draft, setDraft] = useState<Quickstart | null>(null)
  const [installed, setInstalled] = useState<InstalledApp[]>([])
  const [justRan, setJustRan] = useState<string | null>(null)

  useEffect(() => {
    void loadQuickstarts().then(setList)
    void invoke<InstalledApp[]>('shell_installed_apps').then(setInstalled, () => {})
  }, [])

  async function commit(next: Quickstart[]) {
    setList(next)
    await saveQuickstarts(next)
  }

  function startNew() {
    setDraft({ id: crypto.randomUUID(), name: '', entries: [] })
  }

  async function save() {
    if (!draft) return
    const exists = list.some((q) => q.id === draft.id)
    await commit(exists ? list.map((q) => (q.id === draft.id ? draft : q)) : [...list, draft])
    setDraft(null)
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="text-[13px] leading-relaxed text-[var(--color-text-secondary)]">
          A quickstart opens a set of apps at once and arranges the Udaan ones on
          screen. Saved quickstarts appear on the desktop — double-click to run.
        </p>
      </div>

      <AnimatePresence initial={false}>
        {draft && (
          <Editor
            key="editor"
            draft={draft}
            installed={installed}
            onChange={setDraft}
            onSave={() => void save()}
            onCancel={() => setDraft(null)}
          />
        )}
      </AnimatePresence>

      {list.length === 0 && !draft ? (
        <p className="rounded-[12px] border border-dashed border-[var(--border-hairline)] px-4 py-6 text-center text-[13px] text-[var(--color-text-tertiary)]">
          No quickstarts yet.
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {list.map((q) => (
            <li
              key={q.id}
              className="group flex items-center gap-3 rounded-[11px] border border-[var(--border-hairline)] bg-[var(--os-menu-item-hover)] px-3.5 py-3"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13.5px] font-semibold">{q.name}</p>
                <p className="truncate text-[11.5px] text-[var(--color-text-tertiary)]">
                  {q.entries.map((e) => e.label).join(' · ')}
                </p>
              </div>

              <button
                type="button"
                onClick={async () => {
                  setJustRan(q.id)
                  await runQuickstart(q)
                  setTimeout(() => setJustRan(null), 1200)
                }}
                className="shrink-0 rounded-full border border-[var(--border-hairline)] px-3 py-1 text-[12px] font-medium hover:bg-[var(--os-menu-item-hover)]"
              >
                {justRan === q.id ? <CheckIcon width={12} height={12} /> : 'Run'}
              </button>
              <button
                type="button"
                onClick={() => setDraft(q)}
                aria-label={`Edit ${q.name}`}
                className="shrink-0 rounded p-1.5 text-[var(--color-text-tertiary)] opacity-0 transition-opacity hover:bg-[var(--os-menu-item-hover)] hover:text-[var(--color-text-primary)] group-hover:opacity-100"
              >
                <PencilIcon width={12} height={12} />
              </button>
              <button
                type="button"
                onClick={() => void commit(list.filter((x) => x.id !== q.id))}
                aria-label={`Delete ${q.name}`}
                className="shrink-0 rounded p-1.5 text-[var(--color-text-tertiary)] opacity-0 transition-opacity hover:bg-[var(--os-menu-item-hover)] hover:text-[var(--color-text-primary)] group-hover:opacity-100"
              >
                <TrashIcon width={12} height={12} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {!draft && (
        <button
          type="button"
          onClick={startNew}
          className="flex w-fit items-center gap-1.5 rounded-full bg-[var(--color-accent)] px-4 py-1.5 text-[13px] font-semibold text-[var(--color-text-primary)]"
        >
          <PlusIcon width={12} height={12} />
          New quickstart
        </button>
      )}
    </div>
  )
}
