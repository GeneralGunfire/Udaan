import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Dialog, DialogContent, DialogTitle } from '@/shared/components/ui/dialog'
import { Button } from '@/shared/components/ui/button'
import { PencilIcon, PlusIcon, TrashIcon, CheckIcon } from '@/shared/icons'
import { spring, prefersReducedMotion } from '@/shared/lib/motion'
import { cn } from '@/shared/lib/cn'
import { formatTime12h, formatWeekdayMonthDay } from '../lib/dateUtils'
import type { CalendarEvent } from '../lib/types'

export interface DayEventsPanelProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  date: Date
  events: CalendarEvent[]
  onAddEvent: () => void
  onEditEvent: (event: CalendarEvent) => void
  onDeleteEvent: (id: string) => void
  onToggleDone: (id: string) => void
}

/** Custom checkbox — a plain button styled to match Udaan's tokens rather than a native `<input type="checkbox">`, so it can carry the same rounded/gradient/motion language as the rest of the app instead of an unstyleable OS control. */
function EventDoneCheckbox({ done, onToggle }: { done: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        onToggle()
      }}
      aria-pressed={done}
      aria-label={done ? 'Mark as not done' : 'Mark as done'}
      className={cn(
        'mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-md border transition-[background-color,border-color,transform] duration-150 active:scale-90',
        done ? 'bg-accent border-transparent' : 'border-hairline bg-[var(--surface-raised)] hover:border-(--border-hairline)',
      )}
    >
      <motion.span
        initial={false}
        animate={{ scale: done ? 1 : 0, opacity: done ? 1 : 0 }}
        transition={spring.micro}
        className="text-accent-contrast flex"
      >
        <CheckIcon width={12} height={12} strokeWidth={3} />
      </motion.span>
    </button>
  )
}

export function DayEventsPanel({
  open,
  onOpenChange,
  date,
  events,
  onAddEvent,
  onEditEvent,
  onDeleteEvent,
  onToggleDone,
}: DayEventsPanelProps) {
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const reduced = prefersReducedMotion()

  function handleClose(next: boolean) {
    if (!next) setPendingDeleteId(null)
    onOpenChange(next)
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <AnimatePresence>
        {open && (
          <DialogContent className="max-w-md p-5">
            <div className="flex items-center justify-between">
              <DialogTitle className="font-display text-text-primary text-base font-semibold">
                {formatWeekdayMonthDay(date)}
              </DialogTitle>
              <Button variant="ghost" size="icon-sm" onClick={onAddEvent} aria-label="Add event">
                <PlusIcon width={16} height={16} />
              </Button>
            </div>

            <div className="mt-3 flex max-h-80 flex-col gap-2 overflow-y-auto pr-1">
              {events.length === 0 && (
                <p className="text-text-secondary py-6 text-center text-sm">
                  No events yet.
                </p>
              )}

              {events.map((event) => (
                <div
                  key={event.id}
                  className={cn(
                    'group bg-surface-hover relative flex items-start gap-3 rounded-xl px-3.5 py-3 transition-colors duration-150 hover:bg-surface-overlay',
                    event.done && 'opacity-70',
                  )}
                >
                  <EventDoneCheckbox done={event.done} onToggle={() => onToggleDone(event.id)} />

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p
                        className={cn(
                          'truncate text-sm font-medium transition-colors duration-150',
                          event.done ? 'text-text-tertiary line-through' : 'text-text-primary',
                        )}
                      >
                        {event.title}
                      </p>
                    </div>
                    <p className={cn('text-xs', event.done ? 'text-text-tertiary/70' : 'text-text-tertiary')}>
                      {event.allDay
                        ? 'All day'
                        : `${formatTime12h(event.time)} · ${event.durationMinutes} min`}
                    </p>
                    {event.notes && (
                      <p
                        className={cn(
                          'mt-1 line-clamp-2 text-xs',
                          event.done ? 'text-text-tertiary/70' : 'text-text-secondary',
                        )}
                      >
                        {event.notes}
                      </p>
                    )}
                  </div>

                  <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => onEditEvent(event)}
                      aria-label="Edit event"
                    >
                      <PencilIcon width={14} height={14} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => setPendingDeleteId(event.id)}
                      aria-label="Delete event"
                    >
                      <TrashIcon width={14} height={14} />
                    </Button>
                  </div>

                  <AnimatePresence>
                    {pendingDeleteId === event.id && (
                      <motion.div
                        initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.97 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.97 }}
                        transition={spring.micro}
                        className="border-hairline bg-surface-raised absolute inset-0 z-10 flex items-center justify-between gap-2 rounded-xl border px-3.5"
                        style={{ boxShadow: 'var(--shadow-panel)' }}
                      >
                        <span className="text-text-secondary text-xs">Delete this event?</span>
                        <div className="flex items-center gap-1.5">
                          <Button
                            variant="ghost"
                            size="pill-sm"
                            onClick={() => setPendingDeleteId(null)}
                          >
                            Cancel
                          </Button>
                          <Button
                            variant="danger"
                            size="pill-sm"
                            onClick={() => {
                              onDeleteEvent(event.id)
                              setPendingDeleteId(null)
                            }}
                          >
                            Delete
                          </Button>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              ))}
            </div>
          </DialogContent>
        )}
      </AnimatePresence>
    </Dialog>
  )
}
