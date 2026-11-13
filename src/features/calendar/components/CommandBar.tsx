import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Dialog, DialogContent, DialogTitle } from '@/shared/components/ui/dialog'
import { Button } from '@/shared/components/ui/button'
import { SendIcon, SparkleIcon } from '@/shared/icons'
import { cn } from '@/shared/lib/cn'
import { spring, prefersReducedMotion } from '@/shared/lib/motion'
import { processTurn, type EngineState } from '../lib/engine/conversationEngine'
import { formatTime12h, formatWeekdayMonthDay } from '../lib/dateUtils'
import { TAG_CONFIG } from '../lib/tags'
import type { CalendarEvent, EventDraft } from '../lib/types'

export interface CommandBarProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  today: Date
  events: CalendarEvent[]
  onCreate: (draft: EventDraft) => void
  onDelete: (id: string) => void
  onReschedule: (id: string, date: string, time: string | null) => void
}

interface ChatLine {
  id: string
  role: 'user' | 'assistant'
  text: string
  candidates?: CalendarEvent[]
  isLoading?: boolean
}

/**
 * Natural-language command bar for the calendar — "add dentist tomorrow at
 * 3pm", "what's on my schedule today", "delete the meeting with sarah".
 * Everything routes through `processTurn` (see lib/engine/conversationEngine.ts):
 * deterministic parsing does the vast majority of the work with zero
 * latency and zero dependency on Ollama being reachable at all; the LLM is
 * only ever invoked for genuine ambiguity, and never for anything
 * destructive without the user confirming first.
 */
export function CommandBar({
  open,
  onOpenChange,
  today,
  events,
  onCreate,
  onDelete,
  onReschedule,
}: CommandBarProps) {
  const [lines, setLines] = useState<ChatLine[]>([])
  const [input, setInput] = useState('')
  const [engineState, setEngineState] = useState<EngineState>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setLines([
        {
          id: 'welcome',
          role: 'assistant',
          text: 'Try "add dentist tomorrow at 3pm", "what\'s on my schedule today", or "delete the meeting with sarah".',
        },
      ])
      setEngineState(null)
      setInput('')
    }
  }, [open])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [lines])

  async function handleSubmit(rawText?: string) {
    const text = (rawText ?? input).trim()
    if (!text || isProcessing) return

    setLines((prev) => [...prev, { id: crypto.randomUUID(), role: 'user', text }])
    setInput('')
    setIsProcessing(true)

    const result = await processTurn(text, engineState, events, today)
    setEngineState(result.nextState)

    const reply = renderAction(result.action)
    if (reply) {
      setLines((prev) => [
        ...prev,
        { id: crypto.randomUUID(), role: 'assistant', text: reply.text, candidates: reply.candidates },
      ])
    }

    applySideEffect(result.action)
    setIsProcessing(false)
    inputRef.current?.focus()
  }

  function applySideEffect(action: Awaited<ReturnType<typeof processTurn>>['action']) {
    if (action.type === 'created') onCreate(action.event)
    if (action.type === 'deleted') onDelete(action.event.id)
    if (action.type === 'rescheduled') onReschedule(action.event.id, action.newDate, action.newTime)
  }

  function renderAction(
    action: Awaited<ReturnType<typeof processTurn>>['action'],
  ): { text: string; candidates?: CalendarEvent[] } | null {
    switch (action.type) {
      case 'created':
        return {
          text: `Added "${action.event.title}" on ${formatWeekdayMonthDay(new Date(`${action.event.date}T00:00:00`))}${
            action.event.allDay ? ', all day.' : ` at ${formatTime12h(action.event.time)}.`
          }`,
        }
      case 'deleted':
        return { text: `Deleted "${action.event.title}".` }
      case 'rescheduled':
        return {
          text: `Moved "${action.event.title}" to ${formatWeekdayMonthDay(new Date(`${action.newDate}T00:00:00`))}${
            action.newTime ? ` at ${formatTime12h(action.newTime)}` : ''
          }.`,
        }
      case 'query': {
        if (action.events.length === 0) return { text: `Nothing scheduled ${action.rangeLabel}.` }
        const lines = action.events
          .map((e) => `• ${e.allDay ? 'All day' : formatTime12h(e.time)} — ${e.title}`)
          .join('\n')
        return { text: `${capitalize(action.rangeLabel)}:\n${lines}` }
      }
      case 'ask':
        return { text: action.question }
      case 'confirm_needed':
        return { text: `${action.question} (yes/no)` }
      case 'choices_needed':
        return { text: action.question, candidates: action.candidates }
      case 'error':
        return { text: action.message }
      case 'noop':
        return action.message ? { text: action.message } : null
    }
  }

  function pickCandidate(index: number) {
    handleSubmit(String(index + 1))
  }

  const reduced = prefersReducedMotion()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open && (
          <DialogContent className="flex h-[560px] max-w-lg flex-col overflow-hidden p-0">
            <DialogTitle className="sr-only">Calendar command bar</DialogTitle>

            <div className="border-hairline flex shrink-0 items-center gap-3 border-b px-5 py-4">
              <span className="relative flex h-8 w-8 shrink-0 items-center justify-center">
                <span
                  className="bg-surface-hover absolute inset-0 rounded-full"
                  aria-hidden
                />
                <SparkleIcon
                  width={15}
                  height={15}
                  className={cn('relative transition-colors duration-200', isProcessing ? 'text-accent' : 'text-text-tertiary')}
                />
                {isProcessing && (
                  <motion.span
                    className="border-accent/40 absolute inset-0 rounded-full border"
                    animate={reduced ? undefined : { scale: [1, 1.35], opacity: [0.5, 0] }}
                    transition={reduced ? undefined : { duration: 2.2, repeat: Infinity, ease: 'easeOut' }}
                    aria-hidden
                  />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-display text-text-primary text-base font-semibold">
                  Ask the calendar
                </p>
                <p className="text-text-tertiary text-2xs">
                  Add, find, or move events by typing naturally
                </p>
              </div>
              <span className="flex items-center gap-1.5">
                <span
                  className={cn(
                    'h-1.5 w-1.5 rounded-full transition-colors duration-300',
                    isProcessing ? 'bg-accent' : 'bg-[var(--color-text-tertiary)]',
                  )}
                  aria-hidden
                />
                <span className="text-text-tertiary text-2xs-alt font-medium tracking-wide uppercase">
                  {isProcessing ? 'Thinking' : 'Ready'}
                </span>
              </span>
            </div>

            <div ref={scrollRef} className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-5 py-4">
              {lines.map((line) => (
                <motion.div
                  key={line.id}
                  initial={reduced ? { opacity: 0 } : { opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={spring.micro}
                  className={cn('flex flex-col gap-2', line.role === 'user' ? 'items-end' : 'items-start')}
                >
                  <div
                    className={cn(
                      'max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-line',
                      line.role === 'user'
                        ? 'bg-accent text-accent-contrast rounded-br-md'
                        : 'bg-[var(--surface-raised)] border-hairline rounded-bl-md border text-text-secondary',
                    )}
                  >
                    {line.text}
                  </div>

                  {line.candidates && (
                    <div className="flex w-full max-w-[85%] flex-col gap-1.5">
                      {line.candidates.map((event, i) => (
                        <button
                          key={event.id}
                          type="button"
                          onClick={() => pickCandidate(i)}
                          className="bg-[var(--surface-raised)] hover:bg-(--os-hover) hover:border-hairline flex items-center gap-2 rounded-xl border border-transparent px-3 py-2 text-left transition-colors duration-150"
                        >
                          <span className="text-text-tertiary flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[var(--surface-raised)] text-2xs-alt font-semibold">
                            {i + 1}
                          </span>
                          <span
                            className={cn('h-1.5 w-1.5 shrink-0 rounded-full', TAG_CONFIG[event.tag].dot)}
                            aria-hidden
                          />
                          <span className="text-text-primary min-w-0 flex-1 truncate text-xs font-medium">
                            {event.title}
                          </span>
                          <span className="text-text-tertiary shrink-0 text-2xs">
                            {formatWeekdayMonthDay(new Date(`${event.date}T00:00:00`))}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </motion.div>
              ))}

              {isProcessing && (
                <motion.div
                  initial={reduced ? { opacity: 0 } : { opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={spring.micro}
                  className="bg-[var(--surface-raised)] border-hairline flex w-fit items-center gap-1 rounded-2xl rounded-bl-md border px-3.5 py-3"
                >
                  {[0, 1, 2].map((i) => (
                    <motion.span
                      key={i}
                      className="bg-text-tertiary h-1.5 w-1.5 rounded-full"
                      animate={reduced ? undefined : { opacity: [0.3, 1, 0.3], y: [0, -2, 0] }}
                      transition={
                        reduced
                          ? undefined
                          : { duration: 1.1, repeat: Infinity, ease: 'easeInOut', delay: i * 0.15 }
                      }
                    />
                  ))}
                </motion.div>
              )}
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault()
                handleSubmit()
              }}
              className="border-hairline shrink-0 border-t px-4 py-3.5"
            >
              <div className="focus-within:border-accent/50 border-hairline bg-[var(--surface-raised)] flex items-center gap-1.5 rounded-full border py-1 pr-1 pl-4 transition-colors duration-150">
                <input
                  ref={inputRef}
                  autoFocus
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Add dentist tomorrow at 3pm…"
                  className="text-text-primary placeholder:text-text-tertiary flex-1 bg-transparent py-1.5 text-sm outline-none"
                />
                <Button
                  type="submit"
                  variant="brand"
                  size="icon-sm"
                  disabled={!input.trim() || isProcessing}
                  aria-label="Send"
                  className="rounded-full"
                >
                  <SendIcon width={13} height={13} />
                </Button>
              </div>
            </form>
          </DialogContent>
        )}
      </AnimatePresence>
    </Dialog>
  )
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}
