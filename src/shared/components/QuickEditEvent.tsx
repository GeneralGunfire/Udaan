import { useState } from 'react'
import {
  updateScheduleEvent,
  deleteScheduleEvent,
  type ScheduleEvent,
  type EventCategory,
} from '@/integrations/schedule/scheduleStore'
import { DatePicker } from './DatePicker'
import { TimePicker } from './TimePicker'
import { Popover, PopoverTrigger, PopoverContent } from './ui/popover'
import { Button } from './ui/button'
import { Tooltip, TooltipProvider } from './ui/tooltip'
import { TrashIcon } from '@/shared/icons'

const CATEGORIES: { id: EventCategory; label: string }[] = [
  { id: 'school', label: 'School' },
  { id: 'work', label: 'Work' },
  { id: 'creativity', label: 'Creativity' },
  { id: 'general', label: 'General' },
]

function categoryAccentVar(category: EventCategory) {
  return `--color-accent-${category}`
}

interface QuickEditEventProps {
  event: ScheduleEvent
  /** The trigger element — typically the event's existing pill/row, made clickable. */
  children: React.ReactNode
  side?: 'top' | 'bottom' | 'left' | 'right'
}

/**
 * Click-to-edit popover for an existing event — the fast path for
 * "postpone this" or "fix the time" without leaving Calendar/Schedule for
 * the separate Manage Events page. Shares the same field set as
 * ManageEventsView's EditRow (title/date/time/category) but scoped to a
 * popover rather than an inline row, since it needs to work from a small
 * day-cell pill, not just a full-width list row.
 */
export function QuickEditEvent({ event, children, side = 'right' }: QuickEditEventProps) {
  const [open, setOpen] = useState(false)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      {open && (
        <PopoverContent side={side} align="start" className="w-72 p-3.5">
          <QuickEditForm event={event} onDone={() => setOpen(false)} />
        </PopoverContent>
      )}
    </Popover>
  )
}

function QuickEditForm({ event, onDone }: { event: ScheduleEvent; onDone: () => void }) {
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

  async function remove() {
    await deleteScheduleEvent(event.id)
    onDone()
  }

  return (
    <TooltipProvider delayDuration={400}>
      <div className="flex flex-col gap-2.5">
        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="glass-surface focus-visible:ring-brand-cyan/60 rounded-lg px-2.5 py-1.5 text-[13px] outline-none focus-visible:ring-2"
        />

        <div className="flex gap-2">
          <div className="min-w-0 flex-1">
            <DatePicker value={date} onChange={setDate} />
          </div>
          <div className="w-24">
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
                className="focus-visible:ring-brand-cyan/60 flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10.5px] font-semibold outline-none transition-all duration-150 focus-visible:ring-2"
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
                {c.label}
              </button>
            )
          })}
        </div>

        <div className="mt-1 flex items-center justify-between gap-2">
          <Tooltip content="Delete event">
            <Button
              type="button"
              aria-label="Delete event"
              onClick={remove}
              variant="ghost"
              size="icon-sm"
              className="rounded-full hover:text-red-400"
            >
              <TrashIcon width={13} height={13} />
            </Button>
          </Tooltip>
          <div className="flex gap-2">
            <Button type="button" onClick={onDone} variant="ghost" size="pill-sm" className="rounded-full">
              Cancel
            </Button>
            <Button
              type="button"
              onClick={save}
              disabled={saving}
              variant="brand"
              size="pill-sm"
              className="rounded-full disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </div>
      </div>
    </TooltipProvider>
  )
}
