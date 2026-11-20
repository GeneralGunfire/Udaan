import { useState } from 'react'
import { usePref } from '@/os/kernel/prefs'
import { playSound } from '@/os/sound/sounds'
import { Button, Segmented, Switch } from '@/os/ui/controls'
import { ShellSelect } from '@/os/ui/ShellSelect'
import { useShellMenu } from '@/os/ui/useShellMenu'
import { cn } from '@/shared/lib/cn'
import {
  ALARM_SOUNDS,
  DAY_SHORT,
  KEYS,
  formatIn,
  loadAlarms,
  nextRing,
  repeatLabel,
  saveAlarms,
  uid,
  type Alarm,
  type AlarmSound,
} from './store'
import {
  Dialog,
  Empty,
  Ico,
  P,
  PaneHeader,
  fmtClock,
  useKeys,
  useNow,
  useStored,
} from './ui'

const WEEK = [1, 2, 3, 4, 5, 6, 0]

export function Alarms() {
  const now = useNow(15_000)
  const [clock24] = usePref('menubar.clock24')
  const [alarms, setAlarms] = useStored<Alarm[]>(
    KEYS.alarms,
    loadAlarms,
    saveAlarms,
  )
  const [editing, setEditing] = useState<Alarm | null>(null)
  const [sel, setSel] = useState<string | null>(null)

  const upcoming = alarms
    .map((a) => ({ a, at: nextRing(a, now) }))
    .filter((x): x is { a: Alarm; at: number } => x.at !== null)
    .sort((x, y) => x.at - y.at)[0]
  const sorted = [...alarms].sort(
    (x, y) => x.hour * 60 + x.minute - (y.hour * 60 + y.minute),
  )

  const upsert = (a: Alarm) =>
    setAlarms((list) =>
      list.some((x) => x.id === a.id)
        ? list.map((x) => (x.id === a.id ? a : x))
        : [...list, a],
    )
  const remove = (id: string) =>
    setAlarms((list) => list.filter((x) => x.id !== id))
  const toggle = (a: Alarm, on: boolean) =>
    upsert({ ...a, enabled: on, armedAt: Date.now(), snoozeUntil: null })
  const openMenu = useShellMenu()
  const duplicate = (a: Alarm) => {
    const copy = { ...a, id: uid(), armedAt: Date.now(), snoozeUntil: null }
    setAlarms((list) => [...list, copy])
    setSel(copy.id)
  }
  const create = () => {
    const d = new Date(Date.now() + 60 * 60_000)
    setEditing({
      id: uid(),
      hour: d.getHours(),
      minute: 0,
      label: '',
      days: [],
      enabled: true,
      snoozeMin: 10,
      sound: 'notify',
      armedAt: 0,
      snoozeUntil: null,
    })
  }

  useKeys((e) => {
    if (e.key === 'n' || e.key === 'N') (e.preventDefault(), create())
    else if (e.key === 'Delete' && sel) (e.preventDefault(), remove(sel))
  })

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PaneHeader title="Alarms">
        <Button
          size="sm"
          variant="tinted"
          onClick={create}
          title="New alarm (N)"
        >
          <Ico d={P.plus} size={13} /> New alarm
        </Button>
      </PaneHeader>
      <p
        className="shrink-0 px-5 pt-3 text-[12.5px] text-(--u-ink-2)"
        aria-live="polite"
      >
        {upcoming
          ? `Next alarm in ${formatIn(upcoming.at - now)}${upcoming.a.label ? `: ${upcoming.a.label}` : ''}`
          : 'No alarms are on.'}
      </p>
      <div className="u-scroll min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {alarms.length === 0 && (
          <Empty>
            No alarms yet. They go off even when this window is closed.
          </Empty>
        )}
        {sorted.map((a) => {
          const t = fmtClock(a.hour, a.minute, clock24)
          return (
            <div
              key={a.id}
              role="group"
              aria-label={`Alarm ${t.time} ${t.suffix} ${a.label}`}
              tabIndex={0}
              onFocus={() => setSel(a.id)}
              onClick={() => setSel(a.id)}
              onDoubleClick={() => setEditing(a)}
              onContextMenu={(e) => {
                e.preventDefault()
                setSel(a.id)
                openMenu(e, [
                  { label: 'Edit…', icon: 'pencil', shortcut: 'Enter', onSelect: () => setEditing(a) },
                  { label: a.enabled ? 'Turn off' : 'Turn on', onSelect: () => toggle(a, !a.enabled) },
                  { label: 'Duplicate', icon: 'copy', onSelect: () => duplicate(a) },
                  {},
                  { label: 'Delete', icon: 'trash', shortcut: 'Del', danger: true, onSelect: () => remove(a.id) },
                ])
              }}
              onKeyDown={(e) =>
                e.key === 'Enter' &&
                e.target === e.currentTarget &&
                setEditing(a)
              }
              className={cn(
                'group mb-px flex items-center gap-4 rounded-[10px] px-4 py-3 outline-none focus-visible:shadow-[inset_0_0_0_1.5px_var(--u-accent)]',
                sel === a.id ? 'bg-(--u-wash-on)' : 'hover:bg-(--u-wash-hover)',
              )}
            >
              <span
                className={cn('min-w-0 flex-1', !a.enabled && 'opacity-50')}
              >
                <span className="block leading-none font-semibold tabular-nums">
                  <span className="text-[30px] tracking-tight">{t.time}</span>
                  {t.suffix && (
                    <span className="ml-1 text-[13px] text-(--u-ink-2)">
                      {t.suffix}
                    </span>
                  )}
                </span>
                <span className="mt-1.5 block truncate text-[12px] text-(--u-ink-3)">
                  {[
                    a.label,
                    repeatLabel(a.days),
                    a.snoozeUntil && a.snoozeUntil > now
                      ? `Snoozed until ${new Date(a.snoozeUntil).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`
                      : '',
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </span>
              <span className="flex gap-0.5 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100">
                <Button
                  icon
                  size="sm"
                  aria-label="Edit alarm"
                  onClick={(e) => (e.stopPropagation(), setEditing(a))}
                >
                  <Ico d={P.edit} size={13} />
                </Button>
                <Button
                  icon
                  size="sm"
                  aria-label="Delete alarm"
                  title="Delete (Del)"
                  className="hover:text-(--u-danger)"
                  onClick={(e) => (e.stopPropagation(), remove(a.id))}
                >
                  <Ico d={P.trash} size={13} />
                </Button>
              </span>
              <Switch
                checked={a.enabled}
                onChange={(v) => toggle(a, v)}
                label={`Alarm ${t.time} ${t.suffix} on`}
              />
            </div>
          )
        })}
      </div>
      {editing && (
        <AlarmEditor
          alarm={editing}
          clock24={clock24}
          isNew={!alarms.some((a) => a.id === editing.id)}
          onClose={() => setEditing(null)}
          onSave={(a) => (
            upsert({
              ...a,
              enabled: true,
              armedAt: Date.now(),
              snoozeUntil: null,
            }),
            setSel(a.id),
            setEditing(null)
          )}
          onDelete={() => (remove(editing.id), setEditing(null))}
        />
      )}
    </div>
  )
}

function AlarmEditor({
  alarm,
  clock24,
  isNew,
  onSave,
  onClose,
  onDelete,
}: {
  alarm: Alarm
  clock24: boolean
  isNew: boolean
  onSave: (a: Alarm) => void
  onClose: () => void
  onDelete: () => void
}) {
  const [a, setA] = useState(alarm)
  const pm = a.hour >= 12
  const h12 = a.hour % 12 || 12
  const setHour12 = (h: number, isPm: boolean) =>
    setA({ ...a, hour: (h % 12) + (isPm ? 12 : 0) })
  const toggleDay = (d: number) =>
    setA({
      ...a,
      days: a.days.includes(d)
        ? a.days.filter((x) => x !== d)
        : [...a.days, d].sort(),
    })
  const preset = (days: number[]) => setA({ ...a, days })
  const num = (v: string, max: number) =>
    Math.max(0, Math.min(max, Math.floor(Number(v.replace(/\D/g, '')) || 0)))
  const field =
    'u-field h-12 w-[72px] text-center text-[24px] font-semibold tabular-nums'
  const presetOn = (days: number[]) =>
    [...a.days].sort().join() === [...days].sort().join()

  return (
    <Dialog
      title={isNew ? 'New alarm' : 'Edit alarm'}
      onClose={onClose}
      width={440}
      footer={
        <>
          {!isNew && (
            <Button variant="danger" onClick={onDelete} className="mr-auto">
              Delete
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="accent" onClick={() => onSave(a)}>
            Save
          </Button>
        </>
      }
    >
      <div className="flex items-center justify-center gap-2">
        {clock24 ? (
          <input
            aria-label="Hour"
            inputMode="numeric"
            className={field}
            value={String(a.hour).padStart(2, '0')}
            onChange={(e) =>
              setA({ ...a, hour: num(e.target.value.slice(-2), 23) })
            }
            onKeyDown={(e) =>
              spin(
                e,
                () => setA({ ...a, hour: (a.hour + 1) % 24 }),
                () => setA({ ...a, hour: (a.hour + 23) % 24 }),
              )
            }
          />
        ) : (
          <input
            aria-label="Hour"
            inputMode="numeric"
            className={field}
            value={String(h12)}
            onChange={(e) =>
              setHour12(Math.max(1, num(e.target.value.slice(-2), 12)), pm)
            }
            onKeyDown={(e) =>
              spin(
                e,
                () => setHour12((h12 % 12) + 1, pm),
                () => setHour12(((h12 + 10) % 12) + 1, pm),
              )
            }
          />
        )}
        <span className="text-[24px] font-semibold text-(--u-ink-3)">:</span>
        <input
          aria-label="Minute"
          inputMode="numeric"
          className={field}
          value={String(a.minute).padStart(2, '0')}
          onChange={(e) =>
            setA({ ...a, minute: num(e.target.value.slice(-2), 59) })
          }
          onKeyDown={(e) =>
            spin(
              e,
              () => setA({ ...a, minute: (a.minute + 1) % 60 }),
              () => setA({ ...a, minute: (a.minute + 59) % 60 }),
            )
          }
        />
        {!clock24 && (
          <Segmented<'am' | 'pm'>
            value={pm ? 'pm' : 'am'}
            onChange={(v) => setHour12(h12, v === 'pm')}
            options={[
              { value: 'am', label: 'AM' },
              { value: 'pm', label: 'PM' },
            ]}
            className="ml-2"
          />
        )}
      </div>

      <label className="mt-5 block">
        <span className="u-label">Label</span>
        <input
          value={a.label}
          onChange={(e) => setA({ ...a, label: e.target.value.slice(0, 60) })}
          placeholder="Alarm"
          className="u-field mt-1.5 w-full"
        />
      </label>

      <div className="mt-4">
        <span className="u-label">Repeat</span>
        <div className="mt-1.5 flex gap-1" role="group" aria-label="Repeat on">
          {WEEK.map((d) => (
            <button
              key={d}
              type="button"
              aria-pressed={a.days.includes(d)}
              onClick={() => toggleDay(d)}
              className={cn(
                'u-btn u-btn--sm h-8 flex-1 px-0',
                a.days.includes(d) ? 'u-btn--accent' : 'u-btn--tonal',
              )}
            >
              {DAY_SHORT[d]}
            </button>
          ))}
        </div>
        <div className="mt-2 flex gap-1">
          {(
            [
              ['Once', []],
              ['Weekdays', [1, 2, 3, 4, 5]],
              ['Weekends', [0, 6]],
              ['Every day', [0, 1, 2, 3, 4, 5, 6]],
            ] as [string, number[]][]
          ).map(([label, days]) => (
            <Button
              key={label}
              size="sm"
              variant="ghost"
              data-on={presetOn(days)}
              onClick={() => preset(days)}
            >
              {label}
            </Button>
          ))}
        </div>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <span className="u-label flex-1">Snooze</span>
        <Segmented<string>
          value={String(a.snoozeMin)}
          onChange={(v) => setA({ ...a, snoozeMin: Number(v) as 5 | 10 | 15 })}
          options={[
            { value: '5', label: '5 min' },
            { value: '10', label: '10 min' },
            { value: '15', label: '15 min' },
          ]}
        />
      </div>

      <div className="mt-4 flex items-center gap-2">
        <span className="u-label flex-1">Sound</span>
        <ShellSelect<AlarmSound>
          value={a.sound}
          onChange={(v) => setA({ ...a, sound: v })}
          ariaLabel="Alarm sound"
          className="h-8 w-[150px]"
          options={ALARM_SOUNDS.map((s) => ({ value: s.id, label: s.name }))}
        />
        <Button
          size="sm"
          variant="tinted"
          onClick={() =>
            void Promise.resolve()
              .then(() => playSound(a.sound))
              .catch(() => {})
          }
        >
          <Ico d={P.volume} size={13} /> Preview
        </Button>
      </div>
    </Dialog>
  )
}

function spin(e: React.KeyboardEvent, up: () => void, down: () => void) {
  if (e.key === 'ArrowUp') (e.preventDefault(), up())
  else if (e.key === 'ArrowDown') (e.preventDefault(), down())
}
