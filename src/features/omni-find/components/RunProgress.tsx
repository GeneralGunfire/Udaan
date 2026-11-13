import { AnimatePresence, motion } from 'framer-motion'
import { cn } from '@/shared/lib/cn'
import { spring } from '@/shared/lib/motion'
import type { ResearchRun, RunPhase } from '../lib/types'

/**
 * The live view of a research run in progress.
 *
 * ## Why the process is shown rather than a spinner
 * A run takes tens of seconds and makes a dozen network calls. A spinner
 * over that reads as a hang, and — more importantly — it hides the thing
 * that makes the output trustworthy: which angles were chosen, which
 * sources were actually read, and which failed. A reader who watched the
 * search happen can judge the answer; one handed a finished essay cannot.
 */

const PHASES: { id: RunPhase; label: string }[] = [
  { id: 'planning', label: 'Planning' },
  { id: 'searching', label: 'Searching' },
  { id: 'reading', label: 'Reading' },
  { id: 'drafting', label: 'Writing' },
  { id: 'verifying', label: 'Checking' },
]

export function RunProgress({ run }: { run: ResearchRun }) {
  const activeIndex = PHASES.findIndex((p) => p.id === run.phase)
  const finished = run.phase === 'done'

  return (
    <div className="flex flex-col gap-4">
      {/* Phase rail */}
      <div className="flex items-center gap-1.5">
        {PHASES.map((phase, index) => {
          const done = finished || (activeIndex > index && activeIndex !== -1)
          const active = phase.id === run.phase
          return (
            <div key={phase.id} className="flex min-w-0 flex-1 flex-col gap-1.5">
              <div
                className={cn(
                  'h-0.5 w-full rounded-full transition-colors duration-500',
                  done ? 'bg-accent/70' : active ? 'bg-accent' : 'bg-[var(--border-hairline)]',
                )}
              >
                {active && (
                  <motion.div
                    className="bg-accent h-full rounded-full"
                    initial={{ width: '0%' }}
                    animate={{ width: '100%' }}
                    transition={{ duration: 8, ease: 'linear' }}
                  />
                )}
              </div>
              <span
                className={cn(
                  'truncate text-2xs-alt tracking-wide transition-colors duration-300',
                  done || active ? 'text-text-secondary' : 'text-text-tertiary/60',
                )}
              >
                {phase.label}
              </span>
            </div>
          )
        })}
      </div>

      {/* Live status */}
      <AnimatePresence mode="wait">
        <motion.p
          key={run.status}
          initial={{ opacity: 0, y: 3 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -3 }}
          transition={spring.micro}
          className="text-text-secondary text-sm"
        >
          {run.status}
        </motion.p>
      </AnimatePresence>

      {/* Angles, with their sources as they arrive. This is the part
          worth watching — it shows the shape of the investigation. */}
      {run.subQuestions.length > 0 && (
        <div className="flex flex-col gap-2.5">
          {run.subQuestions.map((sub) => (
            <motion.div
              key={sub.id}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={spring.gentle}
              className="flex flex-col gap-1.5"
            >
              <div className="flex items-start gap-2.5">
                <StatusDot status={sub.status} />
                <span className="text-text-secondary min-w-0 flex-1 text-sm leading-snug">
                  {sub.text}
                </span>
                {sub.sources.length > 0 && (
                  <span className="text-text-tertiary shrink-0 text-2xs tabular-nums">
                    {sub.sources.length}
                  </span>
                )}
              </div>

              {sub.sources.length > 0 && (
                <div className="flex flex-wrap gap-1 pl-[18px]">
                  {sub.sources.map((source) => (
                    <a
                      key={source.url}
                      href={source.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      title={source.title || source.url}
                      className="text-text-tertiary hover:text-text-secondary max-w-[180px] truncate rounded bg-[var(--surface-raised)] px-1.5 py-0.5 text-2xs-alt transition-colors hover:bg-(--os-hover)"
                    >
                      {hostOf(source.url)}
                    </a>
                  ))}
                </div>
              )}

              {sub.note && (
                <p className="text-text-tertiary pl-[18px] text-2xs leading-snug">{sub.note}</p>
              )}
            </motion.div>
          ))}
        </div>
      )}
    </div>
  )
}

function StatusDot({ status }: { status: 'pending' | 'searching' | 'reading' | 'done' | 'failed' }) {
  const working = status === 'searching' || status === 'reading'
  return (
    <span
      aria-hidden
      className={cn(
        'mt-[6px] h-1.5 w-1.5 shrink-0 rounded-full',
        status === 'done' && 'bg-accent',
        status === 'failed' && 'bg-danger/70',
        status === 'pending' && 'bg-[var(--border-hairline)]',
        working && 'bg-accent animate-pulse',
      )}
    />
  )
}

/** Domain only. A full URL in a chip is unreadable at this size, and the
 * domain is what tells you whether to trust the source. */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}
