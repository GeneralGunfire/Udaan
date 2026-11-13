import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { SendIcon, StopIcon, WindowCloseIcon, PlusIcon } from '@/shared/icons'
import { Button } from '@/shared/components/ui/button'
import { Skeleton } from '@/shared/components/ui/skeleton'
import { Tooltip, TooltipProvider } from '@/shared/components/ui/tooltip'
import { spring, duration, prefersReducedMotion } from '@/shared/lib/motion'
import type { ModeId } from './modes'
import { ChatMessage } from './ChatMessage'
import { ChatCommandPalette } from './ChatCommandPalette'
import { ChatWelcome } from './ChatWelcome'
import { WorkspacePanel } from './WorkspacePanel'
import { ChatHistoryPopup } from './ChatHistoryPopup'
import { useGeneralChat } from '../hooks/useGeneralChat'
import { useStickyScroll } from '../hooks/useStickyScroll'
import { useOmniRouteControl } from '../hooks/useOmniRouteControl'

/**
 * Home chat — rebuilt ground-up for real visual clarity, matching the
 * brightness/weight Sidebar.tsx's active-tile treatment already had (solid
 * accent fills with an inset highlight + real shadow, high-contrast text)
 * instead of the low-opacity/washed-out language the rest of this page had
 * drifted toward. A real header now carries session context (title + a
 * genuine "New chat" button) above the thread, replacing bare chrome with
 * nothing to anchor to.
 *
 * The message list fills the available height and is the only scrolling
 * region, anchored to the bottom (via `mt-auto`, not `justify-end` —
 * see the scroll container's own comment for the CSS trap that avoids)
 * so a short conversation sits directly above the composer. New messages
 * auto-scroll to bottom only while the user is already near the bottom.
 *
 * General Chat talks to OmniRoute exclusively — the local Ollama-backed
 * mode (and voice input, which ran through the same local runtime) was
 * removed. The daily-news shortcut that used to sit in the composer
 * footer moved to the Sidebar (see Sidebar.tsx) — a standing navigation
 * entry, not a button buried in a chat toolbar.
 */
export function Composer() {
  const [value, setValue] = useState('')
  const [mode] = useState<ModeId>('omniroute')
  const [paletteOpen, setPaletteOpen] = useState(false)
  const {
    messages,
    responding,
    loadingHistory,
    sessions,
    sessionId,
    send,
    stop,
    newChat,
    switchSession,
    closeSession,
  } = useGeneralChat(mode)
  const omniroute = useOmniRouteControl()
  const { containerRef, handleScroll } = useStickyScroll(messages, sessionId)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const MAX_TEXTAREA_HEIGHT = 192

  function autoGrow(el: HTMLTextAreaElement) {
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, MAX_TEXTAREA_HEIGHT)}px`
  }

  function handleSubmit(override?: string) {
    const trimmed = (override ?? value).trim()
    if (!trimmed || responding) return
    send(trimmed)
    setValue('')
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
  }

  const isEmpty = !loadingHistory && messages.length === 0
  const reduced = prefersReducedMotion()

  // Cmd/Ctrl+K opens the chat command palette from anywhere on this page —
  // the keyboard-first entry point the brief asks for, scoped to what
  // General Chat can actually do (new chat, switch session/mode, focus the
  // composer) rather than app-wide navigation, which is out of scope for
  // this pass.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const activeSession = sessions.find((s) => s.id === sessionId)

  return (
    <TooltipProvider delayDuration={400}>
      <div className="flex h-full min-h-0 w-full justify-center overflow-hidden">
        <div className={`flex h-full min-h-0 w-full max-w-2xl flex-col px-6 pt-6 pb-5 ${isEmpty ? 'justify-center' : ''}`}>

          {!isEmpty && (
            <div className="border-hairline mb-3 flex shrink-0 items-center justify-between gap-3 border-b pb-3">
              <h1 className="text-text-primary min-w-0 truncate text-sm font-semibold">
                {activeSession?.title || 'New chat'}
              </h1>
              <Tooltip content="New chat">
                <Button
                  type="button"
                  aria-label="New chat"
                  variant="ghost"
                  size="icon-sm"
                  onClick={newChat}
                  className="shrink-0 rounded-lg"
                >
                  <PlusIcon width={13} height={13} />
                </Button>
              </Tooltip>
            </div>
          )}

          <ChatCommandPalette
            open={paletteOpen}
            onOpenChange={setPaletteOpen}
            sessions={sessions}
            onNewChat={newChat}
            onSwitchSession={switchSession}
            onFocusComposer={() => textareaRef.current?.focus()}
          />

          <AnimatePresence mode="wait">
            {isEmpty ? (
              <motion.div
                key="empty"
                initial={reduced ? { opacity: 0 } : { opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduced ? { opacity: 0 } : { opacity: 0, y: -6 }}
                transition={reduced ? { duration: duration.instant } : spring.emphasis}
                className="relative flex shrink-0 flex-col items-center px-1"
              >
                <ChatWelcome />
              </motion.div>
            ) : (
              <motion.div
                key="messages"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: duration.standard }}
                className="flex min-h-0 flex-1 flex-col"
              >
                <WorkspacePanel />
                {/* The scroll container must NOT use `justify-end`.
                    Combining it with `overflow-y-auto` is a well-known CSS
                    trap: when content grows taller than a flex container
                    that justifies to the end, the overflow spills past the
                    TOP edge, and a scroll container cannot scroll to a
                    negative offset — the earliest messages sit in
                    permanently unreachable space. Bottom-anchoring a short
                    conversation is still wanted, so it's done with
                    `mt-auto` on the inner wrapper instead: the margin
                    collapses to zero once content is taller than the
                    viewport, leaving a normal, fully scrollable block. */}
                <div
                  ref={containerRef}
                  onScroll={handleScroll}
                  className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-1 pb-3"
                >
                  <div className="mt-auto flex flex-col gap-3">
                    {loadingHistory ? (
                      <div className="flex flex-col gap-3 pb-2" role="status" aria-label="Loading conversation">
                        {[
                          { side: 'end', w: '40%', h: 40 },
                          { side: 'start', w: '78%', h: 72 },
                          { side: 'end', w: '30%', h: 40 },
                          { side: 'start', w: '64%', h: 56 },
                        ].map((row, i) => (
                          <div key={i} className={`flex ${row.side === 'end' ? 'justify-end' : 'justify-start'}`}>
                            <Skeleton
                              className="rounded-2xl"
                              style={{ width: row.w, height: row.h, opacity: row.side === 'end' ? 1 : 0.5 }}
                            />
                          </div>
                        ))}
                      </div>
                    ) : (
                      messages.map((m, i) => {
                        const isLastUserMessage =
                          m.role === 'user' && !messages.slice(i + 1).some((later) => later.role === 'user')
                        return (
                          <ChatMessage
                            key={m.id}
                            message={m}
                            isLastUserMessage={isLastUserMessage}
                            onSendAgain={!responding ? (text) => handleSubmit(text) : undefined}
                          />
                        )
                      })
                    )}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {omniroute.error && (
              <motion.div
                initial={reduced ? { opacity: 0 } : { opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={reduced ? { opacity: 0 } : { opacity: 0, height: 0 }}
                transition={spring.standard}
                className="border-hairline text-danger mb-2 flex shrink-0 items-center justify-between gap-2 overflow-hidden rounded-lg border px-3 py-2 text-xs"
              >
                <span>{omniroute.error}</span>
                <Button
                  type="button"
                  onClick={omniroute.clearError}
                  aria-label="Dismiss"
                  variant="ghost"
                  size="icon-sm"
                  className="rounded-lg"
                >
                  <WindowCloseIcon width={11} height={11} />
                </Button>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Flat surface, hairline border — a solid fill and a border
              color change on focus is enough signal that this is
              interactive; no glow, no lift, no gradient shadow. */}
          <div className="border-hairline focus-within:border-text-tertiary bg-surface-raised relative w-full shrink-0 rounded-xl border p-3.5 transition-colors duration-150">
            <textarea
              ref={textareaRef}
              value={value}
              disabled={responding}
              onChange={(e) => {
                setValue(e.target.value)
                autoGrow(e.target)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  handleSubmit()
                }
              }}
              placeholder="What's on your mind?"
              rows={3}
              className="text-text-primary placeholder:text-text-tertiary max-h-48 min-h-11 w-full resize-none overflow-y-auto bg-transparent text-[15px] leading-relaxed outline-none disabled:cursor-not-allowed disabled:opacity-50"
            />
            <div className="border-hairline mt-2.5 flex items-center justify-between border-t pt-2.5">
              <div className="flex items-center gap-1.5">
                {/* Connecting is automatic now (OmniRoute, else Claude); this just says which is answering. */}
                <span
                  title={omniroute.running ? 'Answering through OmniRoute; falls back to Claude if it fails' : 'Answering through your Claude login'}
                  className="text-text-tertiary flex h-7 items-center gap-1.5 rounded-lg px-2 text-xs"
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  {omniroute.running ? 'AI ready' : 'AI ready · Claude'}
                </span>
                <ChatHistoryPopup
                  sessions={sessions}
                  activeSessionId={sessionId}
                  onNewChat={newChat}
                  onSwitchSession={switchSession}
                  onCloseSession={closeSession}
                />
              </div>

              <div className="flex items-center gap-1">
                <div className="relative">
                  <AnimatePresence mode="popLayout" initial={false}>
                    {responding ? (
                      <motion.div
                        key="stop"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={spring.micro}
                      >
                        <Tooltip content="Stop response">
                          <Button
                            type="button"
                            aria-label="Stop response"
                            onClick={stop}
                            variant="secondary"
                            size="icon-lg"
                            className="rounded-lg"
                          >
                            <StopIcon width={14} height={14} />
                          </Button>
                        </Tooltip>
                      </motion.div>
                    ) : (
                      <motion.div
                        key="send"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={spring.micro}
                      >
                        <Tooltip content="Send">
                          <Button
                            type="button"
                            aria-label="Send"
                            onClick={() => handleSubmit()}
                            disabled={value.trim().length === 0}
                            variant="secondary"
                            size="icon-lg"
                            className="rounded-lg"
                          >
                            <SendIcon width={15} height={15} />
                          </Button>
                        </Tooltip>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </TooltipProvider>
  )
}
