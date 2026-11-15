import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/os/ui/controls'
import { cn } from '@/shared/lib/cn'
import { FORGED_SLUGS, FORGED_TYPES, forgedDecide, forgedDelete, forgedDraft, forgedList, reason, when, type Draft } from './api'

/**
 * The Forged bridge: notes drafted from what was done in Anvil, waiting for approval. Nothing is sent from here.
 * An approved note goes to DEXA Forged only when you say so in the chat. Counts and descriptions only: a note with
 * an ID number, email, phone number, connection string or credential is refused before it is saved.
 */
export function Forged() {
  const [drafts, setDrafts] = useState<Draft[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [composing, setComposing] = useState(false)
  const [form, setForm] = useState({ db: 'estate', kind: 'Note', title: '', summary: '', detail: '' })
  const [formError, setFormError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setDrafts(await forgedList())
      setError(null)
    } catch (e) {
      setError(reason(e))
    }
  }, [])
  useEffect(() => {
    void load()
  }, [load])

  const save = async () => {
    try {
      await forgedDraft(form.db, form.kind, form.title, form.summary, form.detail)
      setForm({ db: 'estate', kind: 'Note', title: '', summary: '', detail: '' })
      setFormError(null)
      setComposing(false)
      void load()
    } catch (e) {
      setFormError(reason(e))
    }
  }

  const pending = (drafts ?? []).filter((d) => d.status === 'pending').length
  const approved = (drafts ?? []).filter((d) => d.status === 'approved').length
  const field = 'w-full rounded-[8px] bg-(--u-wash-on) px-3 py-2 text-[13px] text-(--u-ink) outline-none placeholder:text-(--u-ink-3)'

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-(--u-edge) px-5">
        <div className="min-w-0 flex-1">
          <h1 className="text-[15px] font-semibold leading-tight">Forged</h1>
          <p className="truncate text-[11.5px] text-(--u-ink-3)">{error ?? `${pending} waiting · ${approved} approved, not yet sent · nothing is sent from here`}</p>
        </div>
        <Button variant="tinted" onClick={() => setComposing((c) => !c)}>
          {composing ? 'Cancel' : 'New note'}
        </Button>
      </header>

      <div className="u-scroll min-h-0 flex-1 overflow-y-auto px-5 py-3">
        {composing && (
          <div className="mb-5 flex flex-col gap-2 rounded-[12px] bg-(--u-wash-on) p-4">
            <div className="flex gap-2">
              <select value={form.db} onChange={(e) => setForm({ ...form, db: e.target.value })} className={cn(field, 'w-auto')} aria-label="Database">
                {FORGED_SLUGS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })} className={cn(field, 'w-auto')} aria-label="Type">
                {FORGED_TYPES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Title (one line)" className={field} />
            <textarea value={form.summary} onChange={(e) => setForm({ ...form, summary: e.target.value })} placeholder="Summary in plain words for a non-technical reader" rows={3} className={cn(field, 'resize-none')} />
            <textarea value={form.detail} onChange={(e) => setForm({ ...form, detail: e.target.value })} placeholder="Detail: counts, errors, timings (optional). No patient data, IDs, emails, phone numbers or credentials." rows={3} className={cn(field, 'resize-none font-mono text-[12px]')} />
            {formError && <p className="text-[12.5px] text-(--u-danger)">{formError}</p>}
            <div className="flex justify-end">
              <Button variant="primary" disabled={!form.title.trim() || !form.summary.trim()} onClick={() => void save()}>
                Add to the list
              </Button>
            </div>
          </div>
        )}

        {drafts && drafts.length === 0 && !composing && <p className="py-10 text-center text-[13px] text-(--u-ink-3)">No notes yet. Use “Draft a note” on the Links page, or add one here.</p>}

        <div className="flex flex-col gap-3">
          {(drafts ?? []).map((d) => (
            <article key={d.id} className="rounded-[12px] border border-(--u-edge) p-4">
              <div className="flex items-center gap-2 text-[11.5px] text-(--u-ink-3)">
                <span className="rounded-full bg-(--u-wash-on) px-2 py-0.5">{d.db}</span>
                <span>{d.kind}</span>
                <span>· {when(d.createdMs)}</span>
                <span className={cn('ml-auto font-medium', d.status === 'approved' ? 'text-(--u-ok)' : d.status === 'rejected' ? 'text-(--u-danger)' : '')}>
                  {d.status === 'pending' ? 'Waiting for you' : d.status === 'approved' ? 'Approved, not sent' : 'Rejected'}
                </span>
              </div>
              <h3 className="mt-1.5 text-[13.5px] font-semibold">{d.title}</h3>
              <p className="mt-1 whitespace-pre-wrap text-[12.5px] text-(--u-ink-2)">{d.summary}</p>
              {d.detail && <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-[8px] bg-(--u-wash-on) p-2.5 font-mono text-[11.5px] text-(--u-ink-2)">{d.detail}</pre>}
              <div className="mt-3 flex gap-2">
                {d.status !== 'approved' && (
                  <Button size="sm" variant="ok" onClick={() => void forgedDecide(d.id, 'approved').then(load)}>
                    Approve
                  </Button>
                )}
                {d.status !== 'rejected' && (
                  <Button size="sm" variant="tinted" onClick={() => void forgedDecide(d.id, 'rejected').then(load)}>
                    Reject
                  </Button>
                )}
                {d.status !== 'pending' && (
                  <Button size="sm" variant="ghost" onClick={() => void forgedDecide(d.id, 'pending').then(load)}>
                    Back to waiting
                  </Button>
                )}
                <Button size="sm" variant="ghost" className="ml-auto" onClick={() => void forgedDelete(d.id).then(load)}>
                  Delete
                </Button>
              </div>
            </article>
          ))}
        </div>
      </div>
    </div>
  )
}
