import { memo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { spring, prefersReducedMotion } from '@/shared/lib/motion'
import { ClipboardIcon } from '@/shared/icons'
import { Button } from '@/shared/components/ui/button'
import { Tooltip } from '@/shared/components/ui/tooltip'
import { MessageText } from './MessageText'
import { MODES, type ModeId } from './modes'

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

const BUBBLE_ENTER = { opacity: 0, y: 6, scale: 0.98 }
const BUBBLE_SETTLE = { opacity: 1, y: 0, scale: 1 }
const CHECK_ENTER = { scale: 0.6, opacity: 0 }
const CHECK_SETTLE = { scale: 1, opacity: 1 }

/**
 * Rounded, sender-side color-coded bubble. Assistant bubbles carry real
 * elevation (near-opaque fill + blur + border + shadow) rather than a
 * thin `bg-white/N` tint — a light tint alone loses all contrast against
 * a bright/busy wallpaper.
 *
 * Metadata row (timestamp, mode badge on assistant replies, copy button)
 * shows on hover only — present for real chat-app functionality (know
 * when something was sent, which provider answered, copy a reply) without
 * permanently cluttering every bubble.
 *
 * Memoized: a chat can grow to hundreds of bubbles, and without this every
 * already-settled message would re-render (and get fresh motion-prop
 * identity) whenever a new one is appended to the list above it.
 */
export const ChatMessage = memo(function ChatMessage({ message }: { message: ChatMessageData }) {
  const isUser = message.role === 'user'
  const [copied, setCopied] = useState(false)
  const modeLabel = MODES.find((m) => m.id === message.mode)?.label
  const isThinking = !isUser && message.text === ''
  const reducedMotion = prefersReducedMotion()

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
      initial={BUBBLE_ENTER}
      animate={BUBBLE_SETTLE}
      transition={spring.standard}
      className={`group flex flex-col ${isUser ? 'items-end' : 'items-start'}`}
    >
      <div
        className={`max-w-[75%] rounded-lg px-3.5 py-2.5 text-base leading-relaxed ${
          isUser ? 'rounded-br-sm text-white' : 'text-text-primary rounded-bl-sm border'
        }`}
        style={
          isUser
            ? {
                background: 'var(--gradient-brand)',
                boxShadow: 'var(--shadow-brand)',
              }
            : {
                // Opaque `surface-raised` rather than a translucent mix:
                // the panel behind it is opaque anyway, so the
                // transparency bought nothing while the backdrop-blur it
                // needed cost GPU work on every bubble in a long thread.
                background: 'var(--surface-raised)',
                borderColor: 'var(--border-hairline)',
                boxShadow: 'inset 0 1px 0 var(--highlight-inset), var(--shadow-raised)',
              }
        }
      >
        {/* A connected timeline rather than a bulleted list: a vertical
            rail links the steps so a multi-step task reads as one
            sequence with a current position, not several unrelated
            lines that happen to be stacked. */}
        {message.steps && message.steps.length > 0 && (
          <div className="relative mb-2 flex flex-col gap-1.5 border-b border-(--border-hairline) pb-2.5 pl-4 text-xs">
            <span
              aria-hidden
              className="absolute top-1.5 bottom-3.5 left-0.75 w-px bg-(--border-hairline)"
            />
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
                      step.ok ? (isCurrent ? 'text-text-secondary' : 'text-text-tertiary') : 'text-red-400'
                    }`}
                  >
                    <span
                      aria-hidden
                      className={`absolute -left-4 h-1.5 w-1.5 shrink-0 rounded-full ring-2 ring-(--surface-raised) ${
                        step.ok ? (isCurrent ? 'bg-accent' : 'bg-text-tertiary') : 'bg-red-400'
                      } ${isCurrent && !reducedMotion ? 'animate-pulse' : ''}`}
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
            <motion.span
              key="thinking"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={spring.micro}
              className="flex items-center gap-1 py-0.5"
              aria-label="Thinking"
              role="status"
            >
              {reducedMotion ? (
                <>
                  <span className="bg-text-tertiary h-1.5 w-1.5 animate-pulse rounded-full" />
                  <span className="bg-text-tertiary h-1.5 w-1.5 animate-pulse rounded-full [animation-delay:150ms]" />
                  <span className="bg-text-tertiary h-1.5 w-1.5 animate-pulse rounded-full [animation-delay:300ms]" />
                </>
              ) : (
                [0, 1, 2].map((i) => (
                  <motion.span
                    key={i}
                    className="bg-text-tertiary h-1.5 w-1.5 rounded-full"
                    animate={{ y: [0, -3, 0], opacity: [0.5, 1, 0.5] }}
                    transition={{
                      duration: 0.9,
                      repeat: Infinity,
                      ease: 'easeInOut',
                      delay: i * 0.15,
                    }}
                  />
                ))
              )}
            </motion.span>
          ) : (
            <motion.div
              key="text"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={spring.micro}
            >
              <MessageText text={message.text} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {message.text !== '' && (
        <div
          className={`text-text-tertiary mt-1 flex items-center gap-1.5 px-1 text-xs opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100 ${
            isUser ? 'flex-row-reverse' : ''
          }`}
        >
          {!isUser && modeLabel && <span className="font-medium">{modeLabel}</span>}
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
              className="rounded-md"
            >
              {copied ? (
                <motion.svg
                  initial={CHECK_ENTER}
                  animate={CHECK_SETTLE}
                  transition={spring.micro}
                  width="10"
                  height="10"
                  viewBox="0 0 20 20"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2.5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M4 10l4 4 8-8" />
                </motion.svg>
              ) : (
                <ClipboardIcon width={11} height={11} />
              )}
            </Button>
          </Tooltip>
        </div>
      )}
    </motion.div>
  )
})
