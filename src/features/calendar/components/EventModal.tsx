import { REMINDER_CHOICES, type Freq } from '../lib/recurrence'
import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Dialog, DialogContent, DialogTitle } from '@/shared/components/ui/dialog'
import { Button } from '@/shared/components/ui/button'
import { duration, prefersReducedMotion } from '@/shared/lib/motion'
import { cn } from '@/shared/lib/cn'
import { MonthGrid } from './MonthGrid'
import { MonthHeader } from './MonthHeader'
import { TimeSlotList } from './TimeSlotList'
import { formatWeekdayMonthDay, formatTime12h, toISODate } from '../lib/dateUtils'
import { TAG_CONFIG, TAG_ORDER } from '../lib/tags'
import type { CalendarEvent, EventDraft, EventTag } from '../lib/types'
import { Input, Textarea } from '@/shared/components/ui/input'

export interface EventModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialDate: Date
  today: Date
  datesWithEvents: Set<string>
  /** Present when editing an existing event; absent when creating new. */
  editingEvent?: CalendarEvent | null
  /** "HH:MM" to pre-select when creating — set when the user clicked a
   * specific slot in the week grid, so the time they aimed at is already
   * chosen rather than having to be found again in the picker. */
  initialTime?: string | null
  onSave: (draft: EventDraft, editingId?: string) => void
}

const DURATION_OPTIONS = [15, 30, 45, 60, 90, 120]

export function EventModal({
  open,
  onOpenChange,
  initialDate,
  today,
  datesWithEvents,
  editingEvent,
  initialTime,
  onSave,
}: EventModalProps) {
  const [step, setStep] = useState<'schedule' | 'details'>('schedule')
  const [viewYear, setViewYear] = useState(initialDate.getFullYear())
  const [viewMonth, setViewMonth] = useState(initialDate.getMonth())
  const [selectedDate, setSelectedDate] = useState(initialDate)
  const [selectedTime, setSelectedTime] = useState<string | null>(editingEvent?.time ?? null)
  const [allDay, setAllDay] = useState(editingEvent?.allDay ?? false)
  const [title, setTitle] = useState(editingEvent?.title ?? '')
  const [notes, setNotes] = useState(editingEvent?.notes ?? '')
  const [durationMinutes, setDurationMinutes] = useState(editingEvent?.durationMinutes ?? 30)
  const [tag, setTag] = useState<EventTag>(editingEvent?.tag ?? 'personal')
  const [repeat, setRepeat] = useState<Freq | 'none'>(editingEvent?.recurrence?.freq ?? 'none')
  const [weekdays, setWeekdays] = useState<number[]>(editingEvent?.recurrence?.weekdays ?? [])
  const [until, setUntil] = useState<string>(editingEvent?.recurrence?.until ?? '')
  const [reminder, setReminder] = useState<number | null>(editingEvent?.reminderMinutes ?? null)

  useEffect(() => {
    if (!open) return
    const base = editingEvent
      ? new Date(`${editingEvent.date}T00:00:00`)
      : initialDate
    setStep('schedule')
    setViewYear(base.getFullYear())
    setViewMonth(base.getMonth())
    setSelectedDate(base)
    setSelectedTime(editingEvent?.time ?? initialTime ?? null)
    setAllDay(editingEvent?.allDay ?? false)
    setTitle(editingEvent?.title ?? '')
    setNotes(editingEvent?.notes ?? '')
    setDurationMinutes(editingEvent?.durationMinutes ?? 30)
    setTag(editingEvent?.tag ?? 'personal')
    setRepeat(editingEvent?.recurrence?.freq ?? 'none')
    setWeekdays(editingEvent?.recurrence?.weekdays ?? [])
    setUntil(editingEvent?.recurrence?.until ?? '')
    setReminder(editingEvent?.reminderMinutes ?? null)
  }, [open, initialDate, editingEvent, initialTime])

  function goPrevMonth() {
    const d = new Date(viewYear, viewMonth - 1, 1)
    setViewYear(d.getFullYear())
    setViewMonth(d.getMonth())
  }

  function goNextMonth() {
    const d = new Date(viewYear, viewMonth + 1, 1)
    setViewYear(d.getFullYear())
    setViewMonth(d.getMonth())
  }

  function handleSelectDate(date: Date) {
    setSelectedDate(date)
    setSelectedTime(null)
    setAllDay(false)
  }

  function handleSelectAllDay() {
    setAllDay(true)
    setSelectedTime(null)
  }

  function handleSelectTime(time: string) {
    setAllDay(false)
    setSelectedTime(time)
  }

  function handleContinue() {
    if (!allDay && !selectedTime) return
    setStep('details')
  }

  function handleSave() {
    if (!title.trim() || (!allDay && !selectedTime)) return
    onSave(
      {
        date: toISODate(selectedDate),
        time: allDay ? '00:00' : (selectedTime as string),
        durationMinutes: allDay ? 24 * 60 : durationMinutes,
        allDay,
        tag,
        title: title.trim(),
        notes: notes.trim(),
        recurrence: repeat === 'none' ? null : { freq: repeat, interval: 1, until: until || null, weekdays: repeat === 'weekly' && weekdays.length ? weekdays : undefined },
        reminderMinutes: reminder,
      },
      editingEvent?.id,
    )
    onOpenChange(false)
  }

  const reduced = prefersReducedMotion()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open && (
          <DialogContent className="max-w-2xl overflow-hidden p-0" autoFocus={false}>
            <DialogTitle className="sr-only">
              {editingEvent ? 'Edit event' : 'Add event'}
            </DialogTitle>

            <AnimatePresence mode="wait" initial={false}>
              {step === 'schedule' ? (
                <motion.div
                  key="schedule"
                  initial={reduced ? { opacity: 0 } : { opacity: 0, x: 12 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={reduced ? { opacity: 0 } : { opacity: 0, x: -12 }}
                  transition={{ duration: duration.standard, ease: [0.2, 0, 0, 1] }}
                >
                  <div className="grid grid-cols-[1fr_auto_1fr] gap-0">
                    <div className="flex flex-col gap-3 p-5">
                      <MonthHeader
                        year={viewYear}
                        month={viewMonth}
                        onPrev={goPrevMonth}
                        onNext={goNextMonth}
                      />
                      <MonthGrid
                        year={viewYear}
                        month={viewMonth}
                        selectedDate={selectedDate}
                        today={today}
                        datesWithEvents={datesWithEvents}
                        onSelectDate={handleSelectDate}
                        selectionShape="square"
                        disablePast
                        toISODate={toISODate}
                      />
                    </div>

                    <div className="border-hairline border-l" />

                    <div className="flex h-85 flex-col gap-3 p-5">
                      <span className="text-text-secondary text-sm font-medium">
                        {formatWeekdayMonthDay(selectedDate)}
                      </span>
                      <TimeSlotList
                        date={selectedDate}
                        today={today}
                        selectedTime={selectedTime}
                        allDay={allDay}
                        onSelectTime={handleSelectTime}
                        onSelectAllDay={handleSelectAllDay}
                      />
                    </div>
                  </div>

                  <div className="border-hairline flex items-center justify-between gap-4 border-t px-5 py-4">
                    <p className="text-text-secondary min-w-0 text-sm">
                      {allDay ? (
                        <>
                          Your event is booked for{' '}
                          <span className="text-text-primary font-medium">
                            {formatWeekdayMonthDay(selectedDate)}
                          </span>
                          , all day.
                        </>
                      ) : selectedTime ? (
                        <>
                          Your event is booked for{' '}
                          <span className="text-text-primary font-medium">
                            {formatWeekdayMonthDay(selectedDate)}
                          </span>{' '}
                          at{' '}
                          <span className="text-text-primary font-medium">
                            {formatTime12h(selectedTime)}
                          </span>
                          .
                        </>
                      ) : (
                        'Pick a date and time to continue.'
                      )}
                    </p>
                    <Button
                      variant="brand"
                      size="pill"
                      disabled={!allDay && !selectedTime}
                      onClick={handleContinue}
                      className="shrink-0"
                    >
                      Continue
                    </Button>
                  </div>
                </motion.div>
              ) : (
                <motion.div
                  key="details"
                  initial={reduced ? { opacity: 0 } : { opacity: 0, x: 12 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={reduced ? { opacity: 0 } : { opacity: 0, x: -12 }}
                  transition={{ duration: duration.standard, ease: [0.2, 0, 0, 1] }}
                  className="flex flex-col gap-4 p-5"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-text-secondary text-sm">
                      {formatWeekdayMonthDay(selectedDate)} &middot;{' '}
                      {allDay ? 'All day' : selectedTime && formatTime12h(selectedTime)}
                    </span>
                    <button
                      type="button"
                      onClick={() => setStep('schedule')}
                      className="text-accent hover:text-text-primary text-xs font-semibold transition-colors duration-150"
                    >
                      Change
                    </button>
                  </div>

                  <label className="flex flex-col gap-1.5">
                    <span className="text-text-secondary text-2xs font-semibold uppercase tracking-wide">
                      Title
                    </span>
                    <Input
                      autoFocus
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder="Event title"
                      
                    />
                  </label>

                  <label className="flex flex-col gap-1.5">
                    <span className="text-text-secondary text-2xs font-semibold uppercase tracking-wide">
                      Notes (optional)
                    </span>
                    <Textarea
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder="Add details..."
                      rows={3}
                      
                    />
                  </label>

                  <div className="hidden">
                    <span className="text-text-secondary text-2xs font-semibold uppercase tracking-wide">
                      Tag
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {TAG_ORDER.map((t) => {
                        const config = TAG_CONFIG[t]
                        const selected = tag === t
                        return (
                          <button
                            key={t}
                            type="button"
                            onClick={() => setTag(t)}
                            aria-pressed={selected}
                            className={cn(
                              'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-[background-color,color] duration-150',
                              // Selected keeps the tag's OWN hue rather
                              // than swapping to the accent: the point of
                              // the tag colours is that School/Work/
                              // Personal are told apart by hue, and a
                              // selected chip that turns accent-blue
                              // throws that away at the exact moment the
                              // user is choosing between them.
                              selected
                                ? cn(config.chipBg, config.chipText, 'ring-1 ring-current')
                                : 'border-hairline bg-surface-hover text-text-primary border hover:bg-surface-overlay',
                            )}
                          >
                            <span
                              className={cn('h-1.5 w-1.5 rounded-full', config.dot)}
                              aria-hidden
                            />
                            {config.label}
                          </button>
                        )
                      })}
                    </div>
                  </div>

                  {!allDay && (
                    <div className="flex flex-col gap-1.5">
                      <span className="text-text-secondary text-2xs font-semibold uppercase tracking-wide">
                        Duration
                      </span>
                      <div className="flex flex-wrap gap-1.5">
                        {DURATION_OPTIONS.map((mins) => (
                          <button
                            key={mins}
                            type="button"
                            onClick={() => setDurationMinutes(mins)}
                            className={cn(
                              'rounded-lg px-3 py-1.5 text-xs font-medium transition-[background-color,color,box-shadow] duration-150',
                              durationMinutes === mins
                                ? 'bg-accent text-accent-contrast shadow-[inset_0_1px_0_rgb(255_255_255/22%),var(--shadow-raised)]'
                                : 'border-hairline bg-surface-hover text-text-primary border hover:bg-surface-overlay',
                            )}
                          >
                            {mins < 60 ? `${mins}m` : `${mins / 60}h${mins % 60 ? ` ${mins % 60}m` : ''}`}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="flex flex-col gap-1.5">
                    <span className="text-text-secondary text-2xs font-semibold uppercase tracking-wide">Repeat</span>
                    <div className="flex flex-wrap gap-1.5">
                      {([['none', 'Never'], ['daily', 'Daily'], ['weekly', 'Weekly'], ['monthly', 'Monthly'], ['yearly', 'Yearly']] as const).map(([k, label]) => (
                        <button key={k} type="button" onClick={() => setRepeat(k)} className={cn('rounded-lg px-3 py-1.5 text-xs font-medium transition-[background-color,color,box-shadow] duration-150', repeat === k ? 'bg-accent text-accent-contrast shadow-[inset_0_1px_0_rgb(255_255_255/22%),var(--shadow-raised)]' : 'border-hairline bg-surface-hover text-text-primary border hover:bg-surface-overlay')}>
                          {label}
                        </button>
                      ))}
                    </div>
                    {repeat === 'weekly' && (
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        <span className="text-text-secondary mr-1 text-xs">On</span>
                        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
                          <button key={i} type="button" aria-label={['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][i]} aria-pressed={weekdays.includes(i)} onClick={() => setWeekdays((w) => (w.includes(i) ? w.filter((x) => x !== i) : [...w, i]))} className={cn('h-8 w-8 rounded-full text-xs font-medium', weekdays.includes(i) ? 'bg-accent text-accent-contrast shadow-[inset_0_1px_0_rgb(255_255_255/22%),var(--shadow-raised)]' : 'border-hairline bg-surface-hover text-text-primary border hover:bg-surface-overlay')}>
                            {d}
                          </button>
                        ))}
                        <span className="text-text-tertiary ml-1 text-xs">{weekdays.length ? '' : 'the same weekday'}</span>
                      </div>
                    )}
                    {repeat !== 'none' && (
                      <label className="mt-1 flex items-center gap-2 text-xs">
                        <span className="text-text-secondary">Until</span>
                        <input type="date" value={until} min={toISODate(selectedDate)} onChange={(e) => setUntil(e.target.value)} className="border-hairline bg-surface-hover text-text-primary h-8 rounded-lg border px-2 text-xs" />
                        {until && (
                          <button type="button" onClick={() => setUntil('')} className="text-text-tertiary hover:text-text-primary">
                            No end
                          </button>
                        )}
                      </label>
                    )}
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <span className="text-text-secondary text-2xs font-semibold uppercase tracking-wide">Reminder</span>
                    <div className="flex flex-wrap gap-1.5">
                      {REMINDER_CHOICES.filter(([m]) => !(allDay && m !== null && m < 60 && m !== 0)).map(([m, label]) => (
                        <button key={String(m)} type="button" onClick={() => setReminder(m)} className={cn('rounded-lg px-3 py-1.5 text-xs font-medium transition-[background-color,color,box-shadow] duration-150', reminder === m ? 'bg-accent text-accent-contrast shadow-[inset_0_1px_0_rgb(255_255_255/22%),var(--shadow-raised)]' : 'border-hairline bg-surface-hover text-text-primary border hover:bg-surface-overlay')}>
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="border-hairline -mx-5 mt-1 flex items-center justify-between gap-4 border-t px-5 pt-4">
                    <p className="text-text-secondary min-w-0 truncate text-sm">
                      {title.trim() ? title : 'Untitled event'}
                    </p>
                    <Button
                      variant="brand"
                      size="pill"
                      disabled={!title.trim()}
                      onClick={handleSave}
                      className="shrink-0"
                    >
                      {editingEvent ? 'Save changes' : 'Save event'}
                    </Button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </DialogContent>
        )}
      </AnimatePresence>
    </Dialog>
  )
}
