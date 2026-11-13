import { memo, useState } from 'react'
import { ThinkingIndicator } from '@/shared/components/ThinkingIndicator'
import { AnimatePresence, motion } from 'framer-motion'
import { spring } from '@/shared/lib/motion'
import { ClipboardIcon, SyncIcon } from '@/shared/icons'
import { Button } from '@/shared/components/ui/button'
import { Tooltip } from '@/shared/components/ui/tooltip'
import { MessageText } from '@/shared/components/MessageText'
import type { ModeId } from './modes'

export interface ChatMessageStep {
  label: string
  ok: boolean
}

export interface ChatMessageData {
  id: string
  role: 'user' | 'assistant'
  mode: ModeId
  text: string
  createdAt?: string
  /** Tool-calling loop progress (e.g. "Reading notes.txt") — shown above the text while/after a multi-step task runs. */
  steps?: ChatMessageStep[]
}

function formatTime(iso?: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

/**
 * One message in the thread. Flat surfaces, no glossy inset shadows or
 * tail corners — a plain rounded rectangle per role, distinguished by
 * fill (user: solid accent) vs. a hairline border (assistant), matching
 * the flat-surface rule the rest of the app now follows (see the
 * Private Player website rebuild this mirrors). Memoized: a chat can
 * grow to hundreds of messages, and without this every settled one
 * would re-render whenever a new one is appended.
 */
export const ChatMessage = memo(function ChatMessage({
  message,
  isLastUserMessage,
  onSendAgain,
}: {
  message: ChatMessageData
  /** True for the most recent user turn — the only place "Send again" makes sense. */
  isLastUserMessage?: boolean
  onSendAgain?: (text: string) => void
}) {
  const isUser = message.role === 'user'
  const [copied, setCopied] = useState(false)
  const isThinking = !isUser && message.text === ''

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(message.text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard permission denied or unavailable — no user-facing error
      // needed for a convenience action like this.
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={spring.standard}
      className={`group flex flex-col ${isUser ? 'items-end' : 'items-start'}`}
    >
      <div
        className={
          isUser
            ? 'max-w-[75%] rounded-xl bg-accent px-4 py-2.5 text-[15px] leading-relaxed text-accent-contrast'
            : 'border-hairline max-w-[85%] rounded-xl border px-4 py-2.5 text-[15px] leading-relaxed text-text-primary'
        }
      >
        {/* A connected timeline rather than a bulleted list: a vertical
            rail links the steps so a multi-step task reads as one
            sequence with a current position. */}
        {message.steps && message.steps.length > 0 && (
          <div className="relative mb-2.5 flex flex-col gap-1.5 pl-4 text-xs">
            <span aria-hidden className="absolute top-1.5 bottom-3.5 left-0.75 w-px bg-(--border-hairline)" />
            <AnimatePresence initial={false}>
              {message.steps.map((step, i) => {
                const isCurrent = i === message.steps!.length - 1 && step.ok
                return (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={spring.micro}
                    className={`relative flex items-center gap-1.5 ${
                      step.ok ? (isCurrent ? 'text-text-secondary' : 'text-text-tertiary') : 'text-danger'
                    }`}
                  >
                    <span
                      aria-hidden
                      className={`absolute -left-4 h-1.5 w-1.5 shrink-0 rounded-full ${
                        step.ok ? (isCurrent ? 'bg-accent' : 'bg-text-tertiary') : 'bg-danger'
                      }`}
                    />
                    {step.label}
                  </motion.div>
                )
              })}
            </AnimatePresence>
          </div>
        )}
        <AnimatePresence mode="wait" initial={false}>
          {isThinking ? (
            <ThinkingIndicator key="thinking" />
          ) : (
            <motion.div key="text" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={spring.micro}>
              <MessageText text={message.text} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {message.text !== '' && (
        <div
          className={`text-text-tertiary mt-1 flex items-center gap-2 px-1 text-xs opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100 ${
            isUser ? 'flex-row-reverse' : ''
          }`}
        >
          {formatTime(message.createdAt) && (
            <span className="tabular-nums">{formatTime(message.createdAt)}</span>
          )}
          <Tooltip content={copied ? 'Copied' : 'Copy message'}>
            <Button
              type="button"
              aria-label="Copy message"
              variant="ghost"
              size="icon-sm"
              onClick={handleCopy}
              className="rounded-lg"
            >
              {copied ? (
                <svg width="10" height="10" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 10l4 4 8-8" />
                </svg>
              ) : (
                <ClipboardIcon width={11} height={11} />
              )}
            </Button>
          </Tooltip>
          {isUser && isLastUserMessage && onSendAgain && (
            <Tooltip content="Send again">
              <Button
                type="button"
                aria-label="Send again"
                variant="ghost"
                size="icon-sm"
                onClick={() => onSendAgain(message.text)}
                className="rounded-lg"
              >
                <SyncIcon width={11} height={11} />
              </Button>
            </Tooltip>
          )}
        </div>
      )}
    </motion.div>
  )
})
