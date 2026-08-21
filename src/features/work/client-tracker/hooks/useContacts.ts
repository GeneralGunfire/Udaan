import { useCallback, useEffect, useState } from 'react'
import { listContacts, upsertContact, deleteContact, type Contact, type ContactStatus } from '@/integrations/client-tracker'

let idCounter = 0
function nextId() {
  idCounter += 1
  return `contact-${Date.now()}-${idCounter}`
}

/** Real SQLite-backed contact list — no hardcoded arrays. Loads from the client_tracker.sqlite3 store on mount. */
export function useContacts() {
  const [contacts, setContacts] = useState<Contact[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setContacts(await listContacts())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  const createContact = useCallback(
    async (input: { name: string; company: string; email: string; phone: string; status: ContactStatus }) => {
      const contact: Contact = { id: nextId(), createdAt: new Date().toISOString(), ...input }
      await upsertContact(contact)
      await reload()
      return contact
    },
    [reload],
  )

  const updateContact = useCallback(
    async (contact: Contact) => {
      await upsertContact(contact)
      await reload()
    },
    [reload],
  )

  const removeContact = useCallback(
    async (id: string) => {
      await deleteContact(id)
      await reload()
    },
    [reload],
  )

  return { contacts, loading, error, createContact, updateContact, removeContact, reload }
}
