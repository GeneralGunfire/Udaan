import { useState } from 'react'
import { useContacts } from './hooks/useContacts'
import { useFollowUps } from './hooks/useFollowUps'
import { ContactList } from './components/ContactList'
import { ContactDetail } from './components/ContactDetail'
import { FollowUpsPanel } from './components/FollowUpsPanel'
import { UsersIcon } from '@/shared/icons'

/**
 * Client / Stakeholder Tracker — lightweight CRM with real SQLite
 * persistence (src-tauri/src/client_tracker), not hardcoded arrays.
 * Contacts, notes, and follow-up reminders all survive app restarts.
 * No calendar integration yet — follow-up due dates are checked on view
 * load only; see the TODO in useFollowUps.ts.
 */
export function ClientTrackerView() {
  const contacts = useContacts()
  const followUps = useFollowUps()
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const selectedContact = contacts.contacts.find((c) => c.id === selectedId) ?? null

  return (
    <div className="flex h-full w-full max-w-5xl flex-col gap-3 overflow-y-auto py-2">
      <div className="flex items-center gap-2">
        <UsersIcon width={16} height={16} className="text-accent-work" />
        <h1 className="font-display text-text-primary text-[16px] font-semibold">
          Client / Stakeholder Tracker
        </h1>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[240px_1fr_260px] gap-3">
        <ContactList
          contacts={contacts.contacts}
          loading={contacts.loading}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onCreate={async (input) => {
            const created = await contacts.createContact(input)
            setSelectedId(created.id)
          }}
        />

        <ContactDetail
          contact={selectedContact}
          onCreateFollowUp={(note, dueDate) => {
            if (selectedContact) followUps.create(selectedContact.id, note, dueDate)
          }}
        />

        <FollowUpsPanel
          followUps={followUps.followUps}
          contacts={contacts.contacts}
          onToggleDone={followUps.toggleDone}
        />
      </div>

      {contacts.error && <p className="text-danger text-[11px]">{contacts.error}</p>}
    </div>
  )
}
