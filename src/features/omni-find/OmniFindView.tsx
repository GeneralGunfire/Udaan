import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { SettingsIcon, SearchIcon, ClipboardIcon } from '@/shared/icons'
import { Button } from '@/shared/components/ui/button'
import { Input, FieldLabel } from '@/shared/components/ui/input'
import { TooltipProvider, Tooltip } from '@/shared/components/ui/tooltip'
import { cn } from '@/shared/lib/cn'
import { spring, prefersReducedMotion } from '@/shared/lib/motion'
import { runResearch } from './lib/research'
import { allSources, flaggedClaims, DEFAULT_SETTINGS, type ResearchRun, type RunSettings } from './lib/types'
import { RunProgress } from './components/RunProgress'
import { ReportView } from './components/ReportView'

/**
 * OmniFind — deep research, then fact-checking.
 *
 * Built on the same footing as General Chat: content sits on the
 * wallpaper with no card around it, legibility comes from type weight
 * and shadow, and the composer is the one surface that earns a
 * container because it is what you aim at.
 *
 * What makes it a different app rather than a chat mode: a question here
 * runs a five-stage pipeline (plan, search, read, draft, verify) whose
 * every step is visible, and the answer arrives with each factual claim
 * checked against the sources that were actually fetched. See
 * lib/research.ts for why verification is a separate pass.
 */

const HISTORY_KEY = 'omnifind.history.v1'

function loadHistory(): ResearchRun[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    return raw ? (JSON.parse(raw) as ResearchRun[]) : []
  } catch {
    return []
  }
}

const SETTINGS_KEY = 'udaan.omnifind.settings'

// `onClose` is part of BaseAppProps (AppHost always passes it) but this
// view no longer needs its own close button — AppTitleBar is now the one
// shared close affordance every app view uses.
export function OmniFindView(_props: { onClose: () => void }) {
  const [question, setQuestion] = useState('')
  const [run, setRun] = useState<ResearchRun | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settings, setSettings] = useState<RunSettings>(DEFAULT_SETTINGS)
  const abortRef = useRef<AbortController | null>(null)
  const reduced = prefersReducedMotion()
  const [history, setHistory] = useState<ResearchRun[]>(loadHistory)
  const [mode, setMode] = useState<'quick' | 'deep'>('deep')

  // Finished research is kept (without the full page texts) so it can be reopened.
  useEffect(() => {
    if (run?.phase !== 'done' || !run.draft) return
    setHistory((prev) => {
      if (prev.some((h) => h.id === run.id)) return prev
      const slim: ResearchRun = {
        ...run,
        subQuestions: run.subQuestions.map((q) => ({ ...q, results: [], sources: q.sources.map((src) => ({ ...src, text: src.text.slice(0, 600) })) })),
      }
      const next = [slim, ...prev].slice(0, 40)
      try {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(next))
      } catch {
        // Storage full or blocked: history just won't persist this time.
      }
      return next
    })
  }, [run])

  // Settings persist locally rather than in the app's SQLite store: they
  // are a handful of per-machine preferences plus API keys, and keys in
  // particular should not travel with a synced or exported project.
  useEffect(() => {
    try {
      const stored = localStorage.getItem(SETTINGS_KEY)
      if (stored) setSettings({ ...DEFAULT_SETTINGS, ...JSON.parse(stored) })
    } catch {
      // Corrupt or blocked storage just means defaults.
    }
  }, [])

  const saveSettings = useCallback((next: RunSettings) => {
    setSettings(next)
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(next))
    } catch {
      // Private mode or blocked storage — settings still apply for this
      // session, they just will not persist.
    }
  }, [])

  const start = useCallback(
    (text: string) => {
      const trimmed = text.trim()
      if (!trimmed) return
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller
      setQuestion('')
      // A question asked under a finished report is a follow-up to it.
      const followUp = run?.phase === 'done' && run.draft ? `${trimmed}\n\n(Follow-up to an earlier research question: "${run.question}")` : trimmed
      const effective = mode === 'quick' ? { ...settings, breadth: 2, depth: 2, factCheck: false } : { ...settings, breadth: Math.max(settings.breadth, 5), depth: Math.max(settings.depth, 4) }
      void runResearch(followUp, effective, {
        onUpdate: setRun,
        signal: controller.signal,
      })
    },
    [settings, mode, run],
  )

  useEffect(() => () => abortRef.current?.abort(), [])

  const busy =
    run !== null && !['done', 'failed', 'cancelled'].includes(run.phase)
  const sources = run ? allSources(run) : []
  const flagged = run ? flaggedClaims(run) : []

  return (
    <TooltipProvider delayDuration={400}>
      <motion.div
        initial={reduced ? { opacity: 0 } : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={reduced ? { duration: 0 } : spring.gentle}
        className="flex h-full min-h-0 w-full"
      >
        <aside className="flex w-[250px] shrink-0 flex-col border-r border-white/[0.06] bg-[#232429]">
          <div className="p-3">
            <button
              type="button"
              onClick={() => {
                abortRef.current?.abort()
                setRun(null)
              }}
              className="flex h-10 w-full items-center justify-center gap-2 rounded-[10px] bg-[#8b6cf0] text-[13.5px] font-semibold text-white transition-[filter,transform] hover:brightness-110 active:scale-[0.98]"
            >
              New research
            </button>
            <div className="mt-3 flex rounded-[9px] bg-white/[0.06] p-0.5 text-[12px] font-medium">
              {(['quick', 'deep'] as const).map((m) => (
                <button key={m} type="button" onClick={() => setMode(m)} className={`relative flex-1 rounded-[7px] py-1.5 ${mode === m ? 'text-[var(--color-text-primary)]' : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'}`}>
                  {mode === m && <motion.span layoutId="of-mode" className="absolute inset-0 rounded-[7px] bg-white/[0.12]" transition={{ type: 'spring', stiffness: 500, damping: 38 }} />}
                  <span className="relative">{m === 'quick' ? 'Quick' : 'Deep research'}</span>
                </button>
              ))}
            </div>
            <p className="mt-1.5 px-1 text-[11px] leading-snug text-[var(--color-text-tertiary)]">{mode === 'quick' ? 'Fewer sources, no fact-check — faster.' : 'More sources, every claim fact-checked.'}</p>
          </div>
          <p className="px-4 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--color-text-tertiary)]">History</p>
          <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
            {history.length === 0 && <p className="px-3 py-2 text-[12px] text-[var(--color-text-tertiary)]">Finished research is kept here.</p>}
            {history.map((h) => (
              <div key={h.id} role="button" tabIndex={0} onClick={() => setRun(h)} className={`group mb-0.5 flex cursor-default items-center gap-2 rounded-[8px] px-3 py-2 text-[12.5px] transition-colors ${run?.id === h.id ? 'bg-white/[0.1]' : 'hover:bg-(--os-hover)'}`}>
                <span className="line-clamp-2 min-w-0 flex-1 leading-snug">{h.question.split('\n\n(Follow-up')[0]}</span>
                <button
                  type="button"
                  aria-label="Remove from history"
                  onClick={(e) => {
                    e.stopPropagation()
                    setHistory((prev) => {
                      const next = prev.filter((x) => x.id !== h.id)
                      try {
                        localStorage.setItem(HISTORY_KEY, JSON.stringify(next))
                      } catch {
                        /* storage unavailable */
                      }
                      return next
                    })
                  }}
                  className="hidden shrink-0 text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] group-hover:block"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex shrink-0 items-start justify-between gap-6 px-8 pt-8 pb-5">
          <div className="flex min-w-0 flex-col gap-1.5">
            <h1 className="font-display text-text-primary truncate text-xl font-light tracking-tight">
              OmniFind
            </h1>
            <p className="text-text-tertiary text-sm">
              Researches across the web, then checks every claim against what it read.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => setSettingsOpen((v) => !v)}
              aria-label="Research settings"
              aria-pressed={settingsOpen}
            >
              <SettingsIcon width={16} height={16} />
            </Button>
          </div>
        </header>

        <AnimatePresence>
          {settingsOpen && (
            <motion.div
              initial={reduced ? { opacity: 0 } : { height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={reduced ? { opacity: 0 } : { height: 0, opacity: 0 }}
              transition={reduced ? { duration: 0 } : spring.panel}
              className="shrink-0 overflow-hidden px-8"
            >
              <SettingsPanel settings={settings} onChange={saveSettings} />
            </motion.div>
          )}
        </AnimatePresence>

        <div data-overlay-scroll className="min-h-0 flex-1 overflow-y-auto px-8 pb-4">
          {!run ? (
            <EmptyState onPick={start} />
          ) : (
            <div className="flex flex-col gap-6 pt-2">
              <div className="flex flex-col gap-1">
                <motion.p initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="text-[24px] font-semibold leading-snug tracking-tight text-[var(--color-text-primary)]">
                  {run.question.split('\n\n(Follow-up')[0]}
                </motion.p>
              </div>

              {busy && <RunProgress run={run} />}

              {run.phase === 'failed' && (
                <div
                  className="u-surface flex flex-col gap-1.5 rounded-lg px-4 py-3"
                  role="alert"
                >
                  <p className="text-danger text-sm leading-relaxed font-medium">
                    Research failed
                  </p>
                  <p className="text-text-secondary text-xs leading-relaxed">
                    {run.error}
                  </p>
                  <p className="text-text-tertiary text-2xs leading-relaxed">
                    The AI gateway tries several free providers in turn. Open Settings > AI to check them or add a free key, then run the research again.
                  </p>
                </div>
              )}

              {run.phase === 'cancelled' && (
                <p className="text-text-tertiary text-sm">Stopped.</p>
              )}

              {run.draft && !busy && (
                <ReportOutput
                  run={run}
                  sources={sources}
                  flaggedCount={flagged.length}
                />
              )}
            </div>
          )}
        </div>

        <div className="shrink-0 px-8 pb-6">
          <Composer
            value={question}
            onChange={setQuestion}
            busy={busy}
            onSubmit={() => start(question)}
            onStop={() => abortRef.current?.abort()}
          />
        </div>
        </div>
      </motion.div>
    </TooltipProvider>
  )
}

function ReportOutput({
  run,
  sources,
  flaggedCount,
}: {
  run: ResearchRun
  sources: ReturnType<typeof allSources>
  flaggedCount: number
}) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    // Sources are appended so the copied text is self-contained — a
    // report pasted elsewhere with bare [3] markers is worthless.
    const withSources = `${run.draft}\n\n---\n\n${sources
      .map((s, i) => `[${i + 1}] ${s.title || s.url} — ${s.url}`)
      .join('\n')}`
    try {
      await navigator.clipboard.writeText(withSources)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard denied; nothing worth interrupting the user for.
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-3">
        <span className="text-text-tertiary text-2xs">{run.status}</span>
        <Tooltip content={copied ? 'Copied' : 'Copy report with sources'} side="left">
          <Button type="button" variant="ghost" size="icon-sm" onClick={() => void copy()} aria-label="Copy report">
            <ClipboardIcon width={13} height={13} />
          </Button>
        </Tooltip>
      </div>

      {flaggedCount > 0 && (
        <div className="border-danger/25 bg-danger/8 flex flex-col gap-1 rounded-lg border px-3.5 py-2.5">
          <p className="text-danger text-xs font-medium">
            {flaggedCount} claim{flaggedCount === 1 ? '' : 's'} could not be verified
          </p>
          <p className="text-text-tertiary text-2xs leading-snug">
            Marked in the text below. They may still be true — the sources read simply did not
            confirm them.
          </p>
        </div>
      )}

      <div className="text-text-secondary text-base">
        <ReportView markdown={run.draft ?? ''} sources={sources} claims={run.claims} />
      </div>

      <ClaimList claims={run.claims} />

      <SourceList sources={sources} />
    </div>
  )
}

function ClaimList({ claims }: { claims: ResearchRun['claims'] }) {
  const flagged = claims.filter((c) => c.verdict !== 'supported')
  if (flagged.length === 0) return null

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-text-tertiary text-2xs font-semibold tracking-wider uppercase">
        Unverified
      </h2>
      {flagged.map((claim) => (
        <div key={claim.id} className="flex flex-col gap-0.5 rounded-lg bg-white/[0.04] px-3 py-2">
          <div className="flex items-start gap-2">
            <span
              className={cn(
                'mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full',
                claim.verdict === 'contradicted' ? 'bg-danger' : 'bg-white/30',
              )}
              aria-hidden
            />
            <span className="text-text-secondary min-w-0 flex-1 text-xs leading-snug">
              {claim.text}
            </span>
            <span className="text-text-tertiary shrink-0 text-2xs-alt tracking-wide uppercase">
              {claim.verdict}
            </span>
          </div>
          {claim.reasoning && (
            <p className="text-text-tertiary pl-[14px] text-2xs leading-snug">{claim.reasoning}</p>
          )}
        </div>
      ))}
    </section>
  )
}

function SourceList({ sources }: { sources: ReturnType<typeof allSources> }) {
  if (sources.length === 0) return null
  return (
    <section className="flex flex-col gap-1.5">
      <h2 className="text-text-tertiary text-2xs font-semibold tracking-wider uppercase">
        Sources
      </h2>
      {sources.map((source, index) => (
        <a
          key={source.url}
          href={source.url}
          target="_blank"
          rel="noreferrer noopener"
          className="group flex items-baseline gap-2.5 rounded-lg px-2 py-1.5 transition-colors hover:bg-(--os-hover)"
        >
          <span className="text-text-tertiary shrink-0 text-2xs tabular-nums">{index + 1}</span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="text-text-secondary group-hover:text-text-primary truncate text-xs transition-colors">
              {source.title || source.url}
            </span>
            <span className="text-text-tertiary truncate text-2xs">
              {hostOf(source.url)}
              {source.published ? ` · ${source.published.slice(0, 10)}` : ''}
              {source.truncated ? ' · partial' : ''}
            </span>
          </span>
        </a>
      ))}
    </section>
  )
}

const EXAMPLES = [
  'What changed in EU AI regulation this year, and who opposes it?',
  'Is intermittent fasting supported by recent clinical evidence?',
  'Compare current approaches to grid-scale battery storage',
]

function EmptyState({ onPick }: { onPick: (question: string) => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-7 px-4">
      <div className="flex flex-col items-center gap-2 text-center">
        <h2 className="font-display text-text-primary text-xl leading-tight font-light tracking-[-0.02em]">
          What do you want to know?
        </h2>
        <p className="text-text-tertiary max-w-md text-base leading-relaxed font-light">
          Ask something that needs more than one source. OmniFind searches several angles, reads the
          pages, and checks what it wrote against them.
        </p>
      </div>

      <div className="flex w-full max-w-lg flex-col gap-1.5">
        {EXAMPLES.map((example) => (
          <button
            key={example}
            type="button"
            onClick={() => onPick(example)}
            className="text-text-secondary hover:text-text-primary rounded-lg px-3 py-2.5 text-left text-sm font-light transition-colors duration-200 hover:bg-(--os-hover)"
          >
            {example}
          </button>
        ))}
      </div>
    </div>
  )
}

function Composer({
  value,
  onChange,
  busy,
  onSubmit,
  onStop,
}: {
  value: string
  onChange: (value: string) => void
  busy: boolean
  onSubmit: () => void
  onStop: () => void
}) {
  return (
    <div
      className="relative flex w-full items-end gap-2 rounded-2xl border p-3"
      style={{
        borderColor: 'var(--border-hairline)',
        background: 'color-mix(in srgb, var(--surface-raised) 55%, transparent)',
        backdropFilter: 'blur(24px)',
        WebkitBackdropFilter: 'blur(24px)',
      }}
    >
      <SearchIcon width={16} height={16} className="text-text-tertiary mb-2 ml-1 shrink-0" />
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            onSubmit()
          }
        }}
        rows={1}
        disabled={busy}
        placeholder={busy ? 'Researching…' : 'Ask a research question'}
        className="text-text-primary placeholder:text-text-tertiary max-h-32 min-h-8 w-full resize-none bg-transparent py-1.5 text-base leading-relaxed outline-none disabled:opacity-60"
      />
      {busy ? (
        <Button type="button" variant="ghost" size="pill-sm" onClick={onStop}>
          Stop
        </Button>
      ) : (
        <Button
          type="button"
          variant="brand"
          size="pill-sm"
          disabled={!value.trim()}
          onClick={onSubmit}
        >
          Research
        </Button>
      )}
    </div>
  )
}

function SettingsPanel({
  settings,
  onChange,
}: {
  settings: RunSettings
  onChange: (next: RunSettings) => void
}) {
  return (
    <div className="mb-4 flex flex-col gap-4 rounded-xl bg-white/[0.04] px-4 py-4">
      <div className="grid grid-cols-2 gap-4">
        <Stepper
          label="Angles"
          hint="How many directions to investigate"
          value={settings.breadth}
          min={1}
          max={6}
          onChange={(breadth) => onChange({ ...settings, breadth })}
        />
        <Stepper
          label="Pages per angle"
          hint="More is slower but better sourced"
          value={settings.depth}
          min={1}
          max={6}
          onChange={(depth) => onChange({ ...settings, depth })}
        />
      </div>

      <label className="flex items-start gap-2.5">
        <input
          type="checkbox"
          checked={settings.factCheck}
          onChange={(e) => onChange({ ...settings, factCheck: e.target.checked })}
          className="accent-accent mt-0.5"
        />
        <span className="flex flex-col gap-0.5">
          <span className="text-text-secondary text-sm">Fact-check the report</span>
          <span className="text-text-tertiary text-2xs leading-snug">
            Extracts every claim and checks it against the sources. Roughly doubles the time, and is
            the thing that separates this from a chat reply.
          </span>
        </span>
      </label>

      <div className="flex flex-col gap-2">
        <FieldLabel>Search API keys — optional</FieldLabel>
        <p className="text-text-tertiary text-2xs leading-snug">
          Free search works without these. A key from Brave or Tavily gives noticeably better
          results and is stored only on this machine.
        </p>
        <div className="grid grid-cols-2 gap-2">
          <Input
            inputSize="sm"
            type="password"
            value={settings.braveKey}
            onChange={(e) => onChange({ ...settings, braveKey: e.target.value })}
            placeholder="Brave Search key"
            aria-label="Brave Search API key"
          />
          <Input
            inputSize="sm"
            type="password"
            value={settings.tavilyKey}
            onChange={(e) => onChange({ ...settings, tavilyKey: e.target.value })}
            placeholder="Tavily key"
            aria-label="Tavily API key"
          />
        </div>
      </div>
    </div>
  )
}

function Stepper({
  label,
  hint,
  value,
  min,
  max,
  onChange,
}: {
  label: string
  hint: string
  value: number
  min: number
  max: number
  onChange: (value: number) => void
}) {
  return (
    <div className="flex flex-col gap-1">
      <FieldLabel>{label}</FieldLabel>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled={value <= min}
          onClick={() => onChange(value - 1)}
          aria-label={`Decrease ${label}`}
        >
          −
        </Button>
        <span className="text-text-primary w-5 text-center text-base tabular-nums">{value}</span>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled={value >= max}
          onClick={() => onChange(value + 1)}
          aria-label={`Increase ${label}`}
        >
          +
        </Button>
      </div>
      <span className="text-text-tertiary text-2xs leading-snug">{hint}</span>
    </div>
  )
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}
