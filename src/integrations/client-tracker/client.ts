import { invoke } from '@tauri-apps/api/core'
import type { Contact, ContactNote, ContactStatus, FollowUp } from './types'

interface RawContact {
  id: string
  name: string
  company: string
  email: string
  phone: string
  status: string
  created_at: string
}

interface RawNote {
  id: string
  contact_id: string
  body: string
  created_at: string
}

interface RawFollowUp {
  id: string
  contact_id: string
  note: string
  due_date: string
  done: boolean
  created_at: string
}

function contactFromRaw(raw: RawContact): Contact {
  return {
    id: raw.id,
    name: raw.name,
    company: raw.company,
    email: raw.email,
    phone: raw.phone,
    status: raw.status as ContactStatus,
    createdAt: raw.created_at,
  }
}

function noteFromRaw(raw: RawNote): ContactNote {
  return { id: raw.id, contactId: raw.contact_id, body: raw.body, createdAt: raw.created_at }
}

function followUpFromRaw(raw: RawFollowUp): FollowUp {
  return {
    id: raw.id,
    contactId: raw.contact_id,
    note: raw.note,
    dueDate: raw.due_date,
    done: raw.done,
    createdAt: raw.created_at,
  }
}

export async function listContacts(): Promise<Contact[]> {
  const raw = await invoke<RawContact[]>('client_tracker_list_contacts')
  return raw.map(contactFromRaw)
}

export async function upsertContact(contact: Contact): Promise<void> {
  await invoke('client_tracker_upsert_contact', {
    contact: {
      id: contact.id,
      name: contact.name,
      company: contact.company,
      email: contact.email,
      phone: contact.phone,
      status: contact.status,
      created_at: contact.createdAt,
    },
  })
}

export async function deleteContact(id: string): Promise<void> {
  await invoke('client_tracker_delete_contact', { id })
}

export async function listNotes(contactId: string): Promise<ContactNote[]> {
  const raw = await invoke<RawNote[]>('client_tracker_list_notes', { contactId })
  return raw.map(noteFromRaw)
}

export async function addNote(note: ContactNote): Promise<void> {
  await invoke('client_tracker_add_note', {
    note: { id: note.id, contact_id: note.contactId, body: note.body, created_at: note.createdAt },
  })
}

export async function listFollowUps(): Promise<FollowUp[]> {
  const raw = await invoke<RawFollowUp[]>('client_tracker_list_follow_ups')
  return raw.map(followUpFromRaw)
}

/**
 * Adds a follow-up reminder with a due date. This checks due dates only
 * when the Client Tracker view is open (see useFollowUps.ts) — there is
 * no real-time alarm/notification wired up. TODO: hook this into a real
 * calendar/schedule integration once one exists; calendar/schedule are
 * off-limits to touch this session per standing rules, so this stays a
 * plain due-date field for now.
 */
export async function addFollowUp(followUp: FollowUp): Promise<void> {
  await invoke('client_tracker_add_follow_up', {
    followUp: {
      id: followUp.id,
      contact_id: followUp.contactId,
      note: followUp.note,
      due_date: followUp.dueDate,
      done: followUp.done,
      created_at: followUp.createdAt,
    },
  })
}

export async function setFollowUpDone(id: string, done: boolean): Promise<void> {
  await invoke('client_tracker_set_follow_up_done', { id, done })
}
