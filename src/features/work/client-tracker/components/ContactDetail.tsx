import { useState } from 'react'
import type { Contact } from '@/integrations/client-tracker'
import { useContactNotes } from '../hooks/useContactNotes'
import { PencilIcon, CalendarIcon } from '@/shared/icons'
import { Button } from '@/shared/components/ui/button'

interface ContactDetailProps {
  contact: Contact | null
  onCreateFollowUp: (note: string, dueDate: string) => void
}

export function ContactDetail({ contact, onCreateFollowUp }: ContactDetailProps) {
  const notes = useContactNotes(contact?.id ?? null)
  const [noteBody, setNoteBody] = useState('')
  const [followUpNote, setFollowUpNote] = useState('')
  const [followUpDate, setFollowUpDate] = useState('')

  if (!contact) {
    return (
      <div className="glass-surface flex h-full flex-col items-center justify-center gap-2 rounded-xl p-4">
        <PencilIcon width={24} height={24} className="text-text-tertiary" />
        <p className="text-text-tertiary text-[11.5px]">Select a contact to view details.</p>
      </div>
    )
  }

  function submitNote() {
    if (!noteBody.trim()) return
    notes.create(noteBody)
    setNoteBody('')
  }

  function submitFollowUp() {
    if (!followUpNote.trim() || !followUpDate) return
    onCreateFollowUp(followUpNote, followUpDate)
    setFollowUpNote('')
    setFollowUpDate('')
  }

  return (
    <div className="glass-surface flex h-full flex-col gap-3 overflow-y-auto rounded-xl p-4">
      <div>
        <h2 className="text-text-primary text-[14px] font-semibold">{contact.name}</h2>
        <p className="text-text-tertiary text-[11px]">{contact.company || 'No company'}</p>
        <p className="text-text-tertiary text-[10.5px]">
          {contact.email || 'No email'} {contact.phone && `· ${contact.phone}`}
        </p>
      </div>

      <div className="border-glass-border border-t pt-3">
        <h3 className="text-text-secondary mb-1.5 text-[11.5px] font-semibold">Notes</h3>
        <div className="mb-2 flex gap-1.5">
          <input
            type="text"
            value={noteBody}
            onChange={(e) => setNoteBody(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submitNote()}
            placeholder="Add a note..."
            className="border-glass-border bg-glass text-text-primary focus-visible:ring-brand-cyan/60 flex-1 rounded-md border px-2 py-1.5 text-[11px] outline-none focus-visible:ring-2"
          />
          <Button type="button" onClick={submitNote} variant="surface" size="pill-sm" className="rounded-md">
            Add
          </Button>
        </div>
        <div className="flex flex-col gap-1.5">
          {notes.notes.length === 0 ? (
            <p className="text-text-tertiary text-[10.5px]">No notes yet.</p>
          ) : (
            notes.notes.map((n) => (
              <div key={n.id} className="border-glass-border rounded-md border p-2">
                <p className="text-text-secondary text-[11px]">{n.body}</p>
                <p className="text-text-tertiary mt-0.5 text-[9.5px]">
                  {new Date(n.createdAt).toLocaleString()}
                </p>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="border-glass-border border-t pt-3">
        <div className="mb-1.5 flex items-center gap-1.5">
          <CalendarIcon width={12} height={12} className="text-text-tertiary" />
          <h3 className="text-text-secondary text-[11.5px] font-semibold">Follow-up reminder</h3>
        </div>
        <div className="flex gap-1.5">
          <input
            type="text"
            value={followUpNote}
            onChange={(e) => setFollowUpNote(e.target.value)}
            placeholder="What to follow up on..."
            className="border-glass-border bg-glass text-text-primary focus-visible:ring-brand-cyan/60 flex-1 rounded-md border px-2 py-1.5 text-[11px] outline-none focus-visible:ring-2"
          />
          <input
            type="date"
            value={followUpDate}
            onChange={(e) => setFollowUpDate(e.target.value)}
            className="border-glass-border bg-glass text-text-primary focus-visible:ring-brand-cyan/60 rounded-md border px-2 py-1.5 text-[11px] outline-none focus-visible:ring-2"
          />
          <Button type="button" onClick={submitFollowUp} variant="surface" size="pill-sm" className="rounded-md">
            Set
          </Button>
        </div>
        <p className="text-text-tertiary mt-1.5 text-[10px] leading-relaxed">
          TODO: no calendar integration yet — this due date is checked when you open the Client
          Tracker, not a real alarm/notification. Wire into Schedule/Calendar once that hook exists.
        </p>
      </div>
    </div>
  )
}
