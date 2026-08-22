import { useState } from 'react'
import { motion } from 'framer-motion'
import {
  SCHEDULE_EVENTS,
  TODO_ITEMS,
  deleteScheduleEvent,
  setTodoDone,
  updateScheduleEvent,
  type EventCategory,
} from '@/integrations/schedule/scheduleStore'
import { GlassPanel } from '@/shared/components/GlassPanel'
import { DatePicker } from '@/shared/components/DatePicker'
import { TimePicker } from '@/shared/components/TimePicker'
import { WindowCloseIcon, PencilIcon } from '@/shared/icons'

const CATEGORIES: { id: EventCategory; label: string }[] = [
  { id: 'school', label: 'School' },
  { id: 'work', label: 'Work' },
  { id: 'creativity', label: 'Creativity' },
  { id: 'general', label: 'General' },
]

function categoryAccentVar(category: EventCategory) {
  return `--color-accent-${category}`
}

/**
 * Event/todo management list — create lives in the "Add Event" modal; this
 * covers edit/delete/mark-done, which have no hook point inside
 * CalendarView.tsx/ScheduleView.tsx by design (those views stay untouched;
 * this is a separate management surface).
 */
export function ManageEventsView() {
  const [editingId, setEditingId] = useState<string | null>(null)

  return (
    <div className="flex w-full max-w-3xl flex-col gap-3 overflow-y-auto py-4">
      <div>
        <h1 className="text-text-primary text-[16px] font-semibold">
          Manage Events
        </h1>
        <p className="text-text-tertiary mt-0.5 text-[12px]">
          Edit, delete, or mark items done. New items are added via the +
          button on Calendar/Schedule.
        </p>
      </div>

      {SCHEDULE_EVENTS.length === 0 ? (
        <GlassPanel className="text-text-tertiary text-center text-[13px]">
          No events yet.
        </GlassPanel>
      ) : (
        <div className="flex flex-col gap-2">
          {SCHEDULE_EVENTS.map((event) =>
            editingId === event.id ? (
              <EditRow
                key={event.id}
                event={event}
                onDone={() => setEditingId(null)}
              />
            ) : (
              <div
                key={event.id}
                className="glass-surface flex items-center gap-3 rounded-2xl px-3.5 py-2.5"
              >
                <button
                  type="button"
                  aria-label={wasDone(event.id) ? 'Mark not done' : 'Mark done'}
                  onClick={() => setTodoDone(event.id, !wasDone(event.id))}
                  className={`flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-[5px] border transition-colors duration-150 ${
                    wasDone(event.id)
                      ? 'border-brand-cyan bg-brand-cyan/30'
                      : 'border-glass-border'
                  }`}
                >
                  {wasDone(event.id) && (
                    <svg width={9} height={9} viewBox="0 0 20 20" fill="none">
                      <path
                        d="M4 10.5l4 4 8-9"
                        stroke="currentColor"
                        strokeWidth={2.5}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="text-text-primary"
                      />
                    </svg>
                  )}
                </button>

                <span
                  className="h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ backgroundColor: `var(${categoryAccentVar(event.category)})` }}
                />

                <div className="min-w-0 flex-1">
                  <div
                    className={`truncate text-[13px] font-medium ${
                      wasDone(event.id)
                        ? 'text-text-tertiary line-through'
                        : 'text-text-primary'
                    }`}
                  >
                    {event.title}
                  </div>
                  <div className="text-text-tertiary text-[11px]">
                    {event.date || 'unplanned'}
                    {event.startTime ? ` · ${event.startTime}` : ''} ·{' '}
                    {event.category}
                  </div>
                </div>

                <button
                  type="button"
                  aria-label="Edit"
                  onClick={() => setEditingId(event.id)}
                  className="text-text-tertiary hover:text-text-primary hover:bg-glass-hover flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-colors duration-150"
                >
                  <PencilIcon width={13} height={13} />
                </button>
                <button
                  type="button"
                  aria-label="Delete"
                  onClick={() => deleteScheduleEvent(event.id)}
                  className="text-text-tertiary hover:bg-glass-hover flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-colors duration-150 hover:text-red-400"
                >
                  <WindowCloseIcon width={13} height={13} />
                </button>
              </div>
            ),
          )}
        </div>
      )}
    </div>
  )
}

// setTodoDone flips status to 'done'/'planned'; there's no dedicated "was
// this already done" flag on the view-facing ScheduleEvent shape (only
// TodoItem carries `done`), so read it from the parallel TODO_ITEMS array.
function wasDone(id: string): boolean {
  return TODO_ITEMS.find((t) => t.id === id)?.done ?? false
}

function EditRow({
  event,
  onDone,
}: {
  event: (typeof SCHEDULE_EVENTS)[number]
  onDone: () => void
}) {
  const [title, setTitle] = useState(event.title)
  const [date, setDate] = useState(event.date)
  const [startTime, setStartTime] = useState(event.startTime ?? '')
  const [category, setCategory] = useState<EventCategory>(event.category)
  const [saving, setSaving] = useState(false)

  async function save() {
    setSaving(true)
    try {
      await updateScheduleEvent(event.id, {
        title: title.trim() || event.title,
        date: date || undefined,
        startTime: startTime || undefined,
        category,
      })
      onDone()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="glass-surface flex flex-col gap-2.5 rounded-2xl p-3.5">
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        className="glass-surface text-text-primary min-w-0 rounded-lg px-2.5 py-1.5 text-[13px] outline-none"
      />
      <div className="flex flex-wrap gap-2">
        <div className="min-w-32 flex-1">
          <DatePicker value={date} onChange={setDate} />
        </div>
        <div className="w-28">
          <TimePicker value={startTime} onChange={setStartTime} />
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {CATEGORIES.map((c) => {
          const active = category === c.id
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => setCategory(c.id)}
              className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold transition-all duration-150"
              style={{
                backgroundColor: active
                  ? `color-mix(in srgb, var(${categoryAccentVar(c.id)}) 18%, transparent)`
                  : 'transparent',
                color: active
                  ? `var(${categoryAccentVar(c.id)})`
                  : 'var(--color-text-tertiary)',
                border: `1px solid ${active ? `color-mix(in srgb, var(${categoryAccentVar(c.id)}) 32%, transparent)` : 'var(--color-glass-border)'}`,
              }}
            >
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{
                  backgroundColor: `var(${categoryAccentVar(c.id)})`,
                  opacity: active ? 1 : 0.45,
                }}
              />
              {c.label}
            </button>
          )
        })}
      </div>
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onDone}
          className="text-text-secondary hover:text-text-primary rounded-full px-3 py-1.5 text-[12px] transition-colors duration-150"
        >
          Cancel
        </button>
        <motion.button
          type="button"
          onClick={save}
          disabled={saving}
          whileHover={{ scale: 1.03 }}
          whileTap={{ scale: 0.96 }}
          transition={{ type: 'spring', stiffness: 500, damping: 30 }}
          className="rounded-full px-3.5 py-1.5 text-[12px] font-semibold text-white disabled:opacity-50"
          style={{ background: 'var(--gradient-brand)' }}
        >
          {saving ? 'Saving…' : 'Save'}
        </motion.button>
      </div>
    </div>
  )
}
