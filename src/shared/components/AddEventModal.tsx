import { useState } from 'react'
import { motion } from 'framer-motion'
import { createScheduleEvent } from '@/integrations/schedule/scheduleStore'
import type { EventCategory } from '@/integrations/schedule/scheduleStore'
import { DatePicker } from './DatePicker'
import { TimePicker } from './TimePicker'

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
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.form
        initial={{ opacity: 0, y: 8, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 8, scale: 0.97 }}
        transition={{ type: 'spring', stiffness: 420, damping: 34 }}
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
        className="glass-surface flex w-full max-w-sm flex-col gap-3 rounded-2xl p-5"
        style={{ boxShadow: 'var(--shadow-panel)' }}
      >
        <h2 className="text-text-primary text-[15px] font-semibold">
          Add Event
        </h2>

        <label className="flex flex-col gap-1 text-[12px]">
          <span className="text-text-secondary">Title</span>
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="glass-surface rounded-lg px-2.5 py-1.5 text-[13px] outline-none"
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
                  className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-semibold transition-all duration-150"
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
            className="glass-surface resize-none rounded-lg px-2.5 py-1.5 text-[13px] outline-none"
          />
        </label>

        {error && <p className="text-[12px] text-red-400">{error}</p>}

        <div className="mt-1 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="text-text-secondary hover:text-text-primary rounded-full px-3 py-1.5 text-[12px] transition-colors duration-150"
          >
            Cancel
          </button>
          <motion.button
            type="submit"
            disabled={submitting}
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.96 }}
            transition={{ type: 'spring', stiffness: 500, damping: 30 }}
            className="rounded-full px-3.5 py-1.5 text-[12px] font-semibold text-white disabled:opacity-50"
            style={{ background: 'var(--gradient-brand)' }}
          >
            {submitting ? 'Adding…' : 'Add'}
          </motion.button>
        </div>
      </motion.form>
    </motion.div>
  )
}
