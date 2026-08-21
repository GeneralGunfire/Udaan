import { useState } from 'react'
import type { Contact, ContactStatus } from '@/integrations/client-tracker'
import { UsersIcon, PlusIcon } from '@/shared/icons'

interface ContactListProps {
  contacts: Contact[]
  loading: boolean
  selectedId: string | null
  onSelect: (id: string) => void
  onCreate: (input: { name: string; company: string; email: string; phone: string; status: ContactStatus }) => void
}

const STATUS_LABEL: Record<ContactStatus, string> = {
  lead: 'Lead',
  active: 'Active',
  past: 'Past',
}

const STATUS_COLOR: Record<ContactStatus, string> = {
  lead: 'var(--color-warning)',
  active: 'var(--color-success)',
  past: 'var(--color-text-tertiary)',
}

export function ContactList({ contacts, loading, selectedId, onSelect, onCreate }: ContactListProps) {
  const [showForm, setShowForm] = useState(false)
  const [name, setName] = useState('')
  const [company, setCompany] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [status, setStatus] = useState<ContactStatus>('lead')

  function submit() {
    if (!name.trim()) return
    onCreate({ name: name.trim(), company: company.trim(), email: email.trim(), phone: phone.trim(), status })
    setName('')
    setCompany('')
    setEmail('')
    setPhone('')
    setStatus('lead')
    setShowForm(false)
  }

  return (
    <div className="glass-surface flex h-full flex-col rounded-xl p-3">
      <div className="mb-2.5 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <UsersIcon width={14} height={14} className="text-accent-work shrink-0" />
          <h2 className="text-text-primary text-[12.5px] font-semibold">Contacts</h2>
        </div>
        <button
          type="button"
          onClick={() => setShowForm((s) => !s)}
          className="text-text-secondary hover:text-text-primary hover:bg-glass-hover flex items-center gap-1 rounded-md px-2 py-1 text-[10.5px] font-medium transition-colors duration-150"
        >
          <PlusIcon width={11} height={11} />
          Add
        </button>
      </div>

      {showForm && (
        <div className="border-glass-border mb-2 flex flex-col gap-1.5 rounded-md border p-2">
          <input
            type="text"
            placeholder="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="border-glass-border bg-glass text-text-primary rounded-md border px-2 py-1 text-[11px]"
          />
          <input
            type="text"
            placeholder="Company"
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            className="border-glass-border bg-glass text-text-primary rounded-md border px-2 py-1 text-[11px]"
          />
          <input
            type="text"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="border-glass-border bg-glass text-text-primary rounded-md border px-2 py-1 text-[11px]"
          />
          <input
            type="text"
            placeholder="Phone"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="border-glass-border bg-glass text-text-primary rounded-md border px-2 py-1 text-[11px]"
          />
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as ContactStatus)}
            className="border-glass-border bg-glass text-text-primary rounded-md border px-2 py-1 text-[11px]"
          >
            <option value="lead">Lead</option>
            <option value="active">Active</option>
            <option value="past">Past</option>
          </select>
          <button
            type="button"
            onClick={submit}
            disabled={!name.trim()}
            className="text-white disabled:opacity-40"
            style={{
              background: 'var(--gradient-brand)',
              borderRadius: 'var(--radius-md)',
              padding: '6px',
              fontSize: '11px',
              fontWeight: 600,
            }}
          >
            Save contact
          </button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <p className="text-text-tertiary p-2 text-[11px]">Loading...</p>
        ) : contacts.length === 0 ? (
          <p className="text-text-tertiary p-2 text-[11px]">No contacts yet — add one above.</p>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {contacts.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => onSelect(c.id)}
                  className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors duration-150 ${
                    c.id === selectedId ? 'bg-glass-hover' : 'hover:bg-glass-hover'
                  }`}
                >
                  <span
                    className="h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{ backgroundColor: STATUS_COLOR[c.status] }}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-text-secondary truncate text-[11px] font-medium">{c.name}</p>
                    <p className="text-text-tertiary truncate text-[9.5px]">
                      {c.company || 'No company'} · {STATUS_LABEL[c.status]}
                    </p>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
