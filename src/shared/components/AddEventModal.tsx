import { useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import { createScheduleEvent } from '@/integrations/schedule/scheduleStore'
import type { EventCategory } from '@/integrations/schedule/scheduleStore'
import { DatePicker } from './DatePicker'
import { TimePicker } from './TimePicker'
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from './ui/dialog'
import { Button } from './ui/button'

interface AddEventModalProps {
  onClose: () => void
}

const CATEGORIES: { id: EventCategory; label: string }[] = [
  { id: 'school', label: 'School' },
  { id: 'work', label: 'Work' },
  { id: 'creativity', label: 'Creativity' },
  { id: 'general', label: 'General' },
]

function categoryAccentVar(category: EventCategory) {
  return `--color-accent-${category}`
}

/** Add-event/todo form — fully custom-styled controls (date/time pickers, category pills), no native OS widgets. Leaving `date` empty creates an "unplanned" todo-style item. */
export function AddEventModal({ onClose }: AddEventModalProps) {
  const [title, setTitle] = useState('')
  const [date, setDate] = useState('')
  const [startTime, setStartTime] = useState('')
  const [endTime, setEndTime] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState<EventCategory>('general')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) {
      setError('Title is required.')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      await createScheduleEvent({
        title: title.trim(),
        date: date || undefined,
        startTime: startTime || undefined,
        endTime: endTime || undefined,
        description: description.trim() || undefined,
        category,
      })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <AnimatePresence>
        <DialogContent>
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <div>
              <DialogTitle className="text-text-primary text-[15px] font-semibold">
                Add Event
              </DialogTitle>
              <DialogDescription className="text-text-tertiary mt-0.5 text-[11.5px]">
                Leave the date blank to add it as an unplanned todo instead.
              </DialogDescription>
            </div>

            <label className="flex flex-col gap-1 text-[12px]">
              <span className="text-text-secondary">Title</span>
              <input
                autoFocus
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="glass-surface focus-visible:ring-brand-cyan/60 rounded-lg px-2.5 py-1.5 text-[13px] outline-none focus-visible:ring-2"
                placeholder="e.g. Team standup"
              />
            </label>

            <label className="flex flex-col gap-1 text-[12px]">
              <span className="text-text-secondary">
                Date (leave blank for unplanned)
              </span>
              <DatePicker value={date} onChange={setDate} />
            </label>

            <div className="flex gap-2">
              <label className="flex flex-1 flex-col gap-1 text-[12px]">
                <span className="text-text-secondary">Start time</span>
                <TimePicker value={startTime} onChange={setStartTime} />
              </label>
              <label className="flex flex-1 flex-col gap-1 text-[12px]">
                <span className="text-text-secondary">End time</span>
                <TimePicker value={endTime} onChange={setEndTime} />
              </label>
            </div>

            <div className="flex flex-col gap-1 text-[12px]">
              <span className="text-text-secondary">Category</span>
              <div className="flex flex-wrap gap-1.5">
                {CATEGORIES.map((c) => {
                  const active = category === c.id
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setCategory(c.id)}
                      className="focus-visible:ring-brand-cyan/60 flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-semibold outline-none transition-all duration-150 focus-visible:ring-2"
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
            </div>

            <label className="flex flex-col gap-1 text-[12px]">
              <span className="text-text-secondary">Description (optional)</span>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                className="glass-surface focus-visible:ring-brand-cyan/60 resize-none rounded-lg px-2.5 py-1.5 text-[13px] outline-none focus-visible:ring-2"
              />
            </label>

            {error && <p className="text-[12px] text-red-400">{error}</p>}

            <div className="mt-1 flex justify-end gap-2">
              <Button type="button" onClick={onClose} variant="ghost" size="pill-sm" className="rounded-full">
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={submitting}
                variant="brand"
                size="pill-sm"
                className="rounded-full disabled:opacity-50"
              >
                {submitting ? 'Adding…' : 'Add'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </AnimatePresence>
    </Dialog>
  )
}
