import { useState } from 'react'
import { motion } from 'framer-motion'
import { ClipboardIcon } from '@/shared/icons'
import { Button } from '@/shared/components/ui/button'
import { Tooltip } from '@/shared/components/ui/tooltip'
import { MessageText } from './MessageText'
import { MODES, type ModeId } from './modes'

export interface ChatMessageData {
  id: string
  role: 'user' | 'assistant'
  mode: ModeId
  text: string
  createdAt?: string
}

function formatTime(iso?: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

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
 */
export function ChatMessage({ message }: { message: ChatMessageData }) {
  const isUser = message.role === 'user'
  const [copied, setCopied] = useState(false)
  const modeLabel = MODES.find((m) => m.id === message.mode)?.label

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
      initial={{ opacity: 0, y: 6, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: 'spring', stiffness: 420, damping: 36 }}
      className={`group flex flex-col ${isUser ? 'items-end' : 'items-start'}`}
    >
      <div
        className={`max-w-[75%] rounded-2xl px-3.5 py-2.5 text-[13.5px] leading-relaxed ${
          isUser ? 'rounded-br-[6px] text-white' : 'text-text-primary rounded-bl-[6px] border backdrop-blur-md'
        }`}
        style={
          isUser
            ? {
                background: 'var(--gradient-brand)',
                boxShadow: '0 4px 16px rgb(37 99 235 / 30%)',
              }
            : {
                background: 'color-mix(in srgb, var(--color-bg-elevated) 82%, transparent)',
                borderColor: 'var(--color-glass-border)',
                boxShadow: '0 2px 12px rgb(0 0 0 / 25%)',
              }
        }
      >
        {!isUser && message.text === '' ? (
          <span className="flex items-center gap-1 py-0.5">
            <span className="bg-text-tertiary h-1.5 w-1.5 animate-pulse rounded-full" />
            <span className="bg-text-tertiary h-1.5 w-1.5 animate-pulse rounded-full [animation-delay:150ms]" />
            <span className="bg-text-tertiary h-1.5 w-1.5 animate-pulse rounded-full [animation-delay:300ms]" />
          </span>
        ) : (
          <MessageText text={message.text} />
        )}
      </div>

      {message.text !== '' && (
        <div
          className={`text-text-tertiary mt-1 flex items-center gap-1.5 px-1 text-[12px] opacity-0 transition-opacity duration-150 group-hover:opacity-100 ${
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
                  initial={{ scale: 0.6, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ type: 'spring', stiffness: 500, damping: 30 }}
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
}
