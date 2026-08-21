import type { FollowUp } from '@/integrations/client-tracker'
import type { Contact } from '@/integrations/client-tracker'
import { BellIcon } from '@/shared/icons'

interface FollowUpsPanelProps {
  followUps: FollowUp[]
  contacts: Contact[]
  onToggleDone: (id: string, done: boolean) => void
}

function isOverdue(dueDate: string): boolean {
  return new Date(dueDate) < new Date(new Date().toDateString())
}

/** Flat list of every open follow-up across all contacts, sorted by due date (real SQLite data, computed status on load — see hooks/useFollowUps.ts for the calendar-hook TODO). */
export function FollowUpsPanel({ followUps, contacts, onToggleDone }: FollowUpsPanelProps) {
  const contactName = (id: string) => contacts.find((c) => c.id === id)?.name ?? 'Unknown contact'
  const open = followUps.filter((f) => !f.done)
  const done = followUps.filter((f) => f.done)

  return (
    <div className="glass-surface flex flex-col gap-2 rounded-xl p-4">
      <div className="flex items-center gap-1.5">
        <BellIcon width={13} height={13} className="text-accent-work" />
        <h2 className="text-text-primary text-[12.5px] font-semibold">Follow-ups</h2>
      </div>

      {open.length === 0 ? (
        <p className="text-text-tertiary text-[11px]">No open follow-ups.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {open.map((f) => (
            <li
              key={f.id}
              className="border-glass-border flex items-center gap-2 rounded-md border p-2"
            >
              <input
                type="checkbox"
                checked={f.done}
                onChange={() => onToggleDone(f.id, true)}
                className="accent-accent-work shrink-0"
                aria-label={`Mark "${f.note}" done`}
              />
              <div className="min-w-0 flex-1">
                <p className="text-text-secondary truncate text-[11px]">{f.note}</p>
                <p className="text-text-tertiary text-[9.5px]">{contactName(f.contactId)}</p>
              </div>
              <span
                className={`shrink-0 text-[10px] tabular-nums ${
                  isOverdue(f.dueDate) ? 'text-danger font-semibold' : 'text-text-tertiary'
                }`}
              >
                {f.dueDate}
              </span>
            </li>
          ))}
        </ul>
      )}

      {done.length > 0 && (
        <details className="text-[10.5px]">
          <summary className="text-text-tertiary cursor-pointer">
            {done.length} completed
          </summary>
          <ul className="mt-1 flex flex-col gap-1">
            {done.map((f) => (
              <li key={f.id} className="text-text-tertiary flex items-center gap-2 px-1 py-0.5">
                <input
                  type="checkbox"
                  checked
                  onChange={() => onToggleDone(f.id, false)}
                  className="accent-accent-work shrink-0"
                  aria-label={`Mark "${f.note}" not done`}
                />
                <span className="truncate line-through">{f.note}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}
