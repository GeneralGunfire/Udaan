import { useState } from 'react'
import { Button } from '@/shared/components/ui/button'

interface NewTaskFormProps {
  onSubmit: (prompt: string, cwd: string) => Promise<unknown>
}

export function NewTaskForm({ onSubmit }: NewTaskFormProps) {
  const [prompt, setPrompt] = useState('')
  const [cwd, setCwd] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!prompt.trim() || !cwd.trim() || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      await onSubmit(prompt.trim(), cwd.trim())
      setPrompt('')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2.5">
      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="Prompt for Claude Code…"
        rows={3}
        className="glass-surface text-text-primary placeholder:text-text-tertiary focus-visible:ring-brand-cyan/60 resize-none rounded-lg px-3 py-2.5 text-[13px] outline-none focus-visible:ring-2"
      />
      <input
        value={cwd}
        onChange={(e) => setCwd(e.target.value)}
        placeholder="Working directory, e.g. C:\path\to\project"
        className="glass-surface text-text-primary placeholder:text-text-tertiary focus-visible:ring-brand-cyan/60 rounded-lg px-3 py-2 text-[13px] outline-none focus-visible:ring-2"
      />
      {error && <p className="text-[11.5px] text-red-400">{error}</p>}
      <Button
        type="submit"
        disabled={submitting || !prompt.trim() || !cwd.trim()}
        variant="brand"
        size="pill-sm"
        className="self-end rounded-lg disabled:opacity-40"
      >
        {submitting ? 'Queuing…' : 'Queue task'}
      </Button>
    </form>
  )
}
