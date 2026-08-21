import { useCallback, useEffect, useState } from 'react'
import { listFollowUps, addFollowUp, setFollowUpDone, type FollowUp } from '@/integrations/client-tracker'

let idCounter = 0
function nextId() {
  idCounter += 1
  return `followup-${Date.now()}-${idCounter}`
}

/**
 * Real SQLite-backed follow-up reminders. Overdue/due-today status is
 * computed on load by comparing `dueDate` against today's date — this is
 * a plain check-on-view, not a real notification. TODO: wire into a real
 * calendar/schedule integration for actual reminders once that
 * integration exists (calendar/schedule are off-limits to touch this
 * session per standing rules).
 */
export function useFollowUps() {
  const [followUps, setFollowUps] = useState<FollowUp[]>([])
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      setFollowUps(await listFollowUps())
    } catch (err) {
      console.error('Failed to load follow-ups', err)
      setFollowUps([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  const create = useCallback(
    async (contactId: string, note: string, dueDate: string) => {
      if (!contactId || !note.trim() || !dueDate) return
      const followUp: FollowUp = {
        id: nextId(),
        contactId,
        note: note.trim(),
        dueDate,
        done: false,
        createdAt: new Date().toISOString(),
      }
      await addFollowUp(followUp)
      await reload()
    },
    [reload],
  )

  const toggleDone = useCallback(
    async (id: string, done: boolean) => {
      await setFollowUpDone(id, done)
      await reload()
    },
    [reload],
  )

  return { followUps, loading, create, toggleDone }
}
