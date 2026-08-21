import { useCallback, useEffect, useState } from 'react'
import { listNotes, addNote, type ContactNote } from '@/integrations/client-tracker'

let idCounter = 0
function nextId() {
  idCounter += 1
  return `note-${Date.now()}-${idCounter}`
}

/** Real SQLite-backed notes for one contact. */
export function useContactNotes(contactId: string | null) {
  const [notes, setNotes] = useState<ContactNote[]>([])
  const [loading, setLoading] = useState(false)

  const reload = useCallback(async () => {
    if (!contactId) {
      setNotes([])
      return
    }
    setLoading(true)
    try {
      setNotes(await listNotes(contactId))
    } catch (err) {
      console.error('Failed to load contact notes', err)
      setNotes([])
    } finally {
      setLoading(false)
    }
  }, [contactId])

  useEffect(() => {
    reload()
  }, [reload])

  const create = useCallback(
    async (body: string) => {
      if (!contactId || !body.trim()) return
      const note: ContactNote = {
        id: nextId(),
        contactId,
        body: body.trim(),
        createdAt: new Date().toISOString(),
      }
      await addNote(note)
      await reload()
    },
    [contactId, reload],
  )

  return { notes, loading, create }
}
