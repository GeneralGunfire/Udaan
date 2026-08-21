import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { SendIcon, ChevronRightIcon, MicIcon, StopIcon } from '@/shared/icons'
import { MODES, type ModeId } from './modes'
import { ChatMessage } from './ChatMessage'
import { ModeSessionPanel } from './ModeSessionPanel'
import { useGeneralChat } from '../hooks/useGeneralChat'
import { useMicTranscription } from '../hooks/useMicTranscription'

/**
 * Home composer. Single-row input with horizontal mode chips underneath.
 * Collapsed by default; once at least one exchange has happened, an expand
 * arrow appears below to open the full conversation view above the input.
 */
export function Composer() {
  const [value, setValue] = useState('')
  const [activeMode, setActiveMode] = useState<ModeId>('router')
  const [expanded, setExpanded] = useState(false)
  const { messages, responding, lastLatencyMs, send, stop } = useGeneralChat()
  const mic = useMicTranscription()

  const hasResponse = messages.some((m) => m.role === 'assistant')

  function handleSubmit() {
    const trimmed = value.trim()
    if (!trimmed || responding) return
    send(trimmed, activeMode)
    setValue('')
    setExpanded(true)
  }

  async function handleMicClick() {
    if (mic.recording) {
      const text = await mic.stop()
      if (text) setValue((v) => (v ? `${v} ${text}` : text))
    } else {
      try {
        await mic.start()
      } catch (err) {
        console.error('Microphone access failed:', err)
      }
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col items-center px-6">
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 380, damping: 36 }}
            className="glass-surface mb-3 w-full overflow-hidden rounded-[18px]"
          >
            <div className="flex max-h-96 flex-col gap-2 overflow-y-auto p-4">
              {messages.length === 0 ? (
                <div className="text-text-tertiary text-center text-[12px]">
                  No messages yet.
                </div>
              ) : (
                messages.map((m) => <ChatMessage key={m.id} message={m} />)
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex w-full items-start gap-2">
        <ModeSessionPanel mode={activeMode} latencyMs={lastLatencyMs} />

        <div className="flex min-w-0 flex-1 flex-col">
          <div
            className="glass-surface relative w-full rounded-[18px] p-4"
            style={{ boxShadow: 'var(--shadow-composer)' }}
          >
            <textarea
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  handleSubmit()
                }
              }}
              placeholder={mic.transcribing ? 'Transcribing…' : 'Type something to build…'}
              disabled={mic.transcribing}
              rows={2}
              className="text-text-primary placeholder:text-text-tertiary min-h-9 w-full resize-none bg-transparent text-[13px] outline-none disabled:opacity-50"
            />
            <div className="mt-2.5 flex items-center justify-between">
              <div className="flex items-center gap-1">
                {MODES.map((mode) => {
                  const isActive = mode.id === activeMode
                  return (
                    <button
                      key={mode.id}
                      type="button"
                      onClick={() => setActiveMode(mode.id)}
                      className="relative rounded-full px-2.5 py-1 text-[10.5px] font-medium"
                    >
                      {isActive && (
                        <motion.div
                          layoutId="composer-mode-pill"
                          transition={{
                            type: 'spring',
                            stiffness: 400,
                            damping: 32,
                          }}
                          className="bg-glass-hover absolute inset-0 rounded-full"
                        />
                      )}
                      <span
                        className={`relative ${isActive ? 'text-text-primary' : 'text-text-tertiary'}`}
                      >
                        {mode.label}
                      </span>
                    </button>
                  )
                })}
              </div>
              <div className="flex items-center gap-1.5">
                <motion.button
                  type="button"
                  aria-label={mic.recording ? 'Stop recording' : 'Record voice message'}
                  onClick={handleMicClick}
                  disabled={mic.transcribing}
                  whileTap={{ scale: 0.92 }}
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-colors duration-150 disabled:opacity-40 ${
                    mic.recording
                      ? 'bg-red-500/20 text-red-400'
                      : 'text-text-tertiary hover:text-text-primary hover:bg-glass-hover'
                  }`}
                >
                  {mic.recording ? (
                    <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-400" />
                  ) : (
                    <MicIcon width={13} height={13} />
                  )}
                </motion.button>
                {responding ? (
                  <motion.button
                    type="button"
                    aria-label="Stop response"
                    onClick={stop}
                    whileTap={{ scale: 0.92 }}
                    className="text-text-tertiary hover:text-text-primary flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-colors duration-150"
                  >
                    <StopIcon width={12} height={12} />
                  </motion.button>
                ) : (
                  <motion.button
                    type="button"
                    aria-label="Send"
                    onClick={handleSubmit}
                    disabled={value.trim().length === 0}
                    whileTap={{ scale: 0.92 }}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-white transition-opacity duration-150 disabled:opacity-30"
                    style={{ background: 'var(--gradient-brand)' }}
                  >
                    <SendIcon width={12} height={12} />
                  </motion.button>
                )}
              </div>
            </div>
          </div>

          {hasResponse && (
            <button
              type="button"
              aria-label={
                expanded ? 'Collapse conversation' : 'Expand conversation'
              }
              onClick={() => setExpanded((v) => !v)}
              className="text-text-tertiary hover:text-text-primary mt-2 flex h-6 w-6 items-center justify-center self-center rounded-full transition-colors duration-150"
            >
              <motion.span
                animate={{ rotate: expanded ? -90 : 90 }}
                transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                className="flex"
              >
                <ChevronRightIcon width={13} height={13} />
              </motion.span>
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
