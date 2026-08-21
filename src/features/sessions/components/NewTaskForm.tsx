import { useState } from 'react'

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
        className="glass-surface text-text-primary placeholder:text-text-tertiary resize-none rounded-lg px-3 py-2.5 text-sm outline-none"
      />
      <input
        value={cwd}
        onChange={(e) => setCwd(e.target.value)}
        placeholder="Working directory, e.g. C:\path\to\project"
        className="glass-surface text-text-primary placeholder:text-text-tertiary rounded-lg px-3 py-2 text-sm outline-none"
      />
      {error && <p className="text-xs text-red-400">{error}</p>}
      <button
        type="submit"
        disabled={submitting || !prompt.trim() || !cwd.trim()}
        className="bg-brand-cyan/20 hover:bg-brand-cyan/30 text-text-primary self-end rounded-lg px-4 py-1.5 text-sm font-medium transition-colors duration-150 disabled:opacity-40"
      >
        {submitting ? 'Queuing…' : 'Queue task'}
      </button>
    </form>
  )
}
