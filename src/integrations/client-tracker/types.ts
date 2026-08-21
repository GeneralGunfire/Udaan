export type ContactStatus = 'lead' | 'active' | 'past'

export interface Contact {
  id: string
  name: string
  company: string
  email: string
  phone: string
  status: ContactStatus
  createdAt: string
}

export interface ContactNote {
  id: string
  contactId: string
  body: string
  createdAt: string
}

export interface FollowUp {
  id: string
  contactId: string
  note: string
  /** ISO date (YYYY-MM-DD). No calendar hook yet — see client.ts. */
  dueDate: string
  done: boolean
  createdAt: string
}
