import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { SendIcon, StopIcon, PlusIcon, ChevronRightIcon, WindowCloseIcon, TrashIcon, NewspaperIcon, ChatBubbleIcon } from '@/shared/icons'
import { openNewsBrief } from '@/app/apps'
import { Button } from '@/shared/components/ui/button'
import { Skeleton } from '@/shared/components/ui/skeleton'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/shared/components/ui/dropdown-menu'
import { Tooltip, TooltipProvider } from '@/shared/components/ui/tooltip'
import { spring, duration, prefersReducedMotion } from '@/shared/lib/motion'
import { MODES, type ModeId } from './modes'
import { ChatMessage } from './ChatMessage'
import { ChatCommandPalette } from './ChatCommandPalette'
import { ChatWelcome } from './ChatWelcome'
import { WorkspacePanel } from './WorkspacePanel'
import { useGeneralChat } from '../hooks/useGeneralChat'
import { useStickyScroll } from '../hooks/useStickyScroll'
import { useOmniRouteControl } from '../hooks/useOmniRouteControl'
import { DaemonStatusControl } from './DaemonStatusControl'

/**
 * Home composer. Arc/Raycast-style rounded-rect surface with a single
 * hairline border and light backdrop-blur (so the wallpaper still reads
 * through). Messages themselves (ChatMessage.tsx) are rounded bubbles.
 *
 * A "flight path" signature element (a vertical gradient line threading
 * header -> messages -> composer, derived from the brand's own "set in
 * motion" line) was tried and reverted in this same session — it needs
 * its own properly-sized container to anchor to (the outer column here
 * is full-panel-height with `justify-center`, so an absolutely
 * positioned line anchored to it spans the whole panel, not just the
 * actual content) and rendered as a stray line across the whole screen
 * rather than a connective device. Worth retrying later with a
 * dedicated wrapper sized to just the content block, not attempted again
 * in this pass after it visibly failed once.
 *
 * Real chat layout: the message list fills the available height and is
 * the only scrolling region, anchored to the bottom (justify-end) so a
 * short conversation sits directly above the composer instead of
 * top-packed with dead space below it. The composer stays pinned at the
 * bottom and never moves as history grows. New messages auto-scroll the
 * list to bottom only while the user is already at (or near) the bottom.
 *
 * General Chat talks to OmniRoute exclusively — the local Ollama-backed
 * mode (and voice input, which ran through the same local runtime) was
 * removed.
 */
export function Composer() {
  const [value, setValue] = useState('')
  const [mode] = useState<ModeId>('omniroute')
  const [sessionListOpen, setSessionListOpen] = useState(false)
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
  const [omniRouteDialogOpen, setOmniRouteDialogOpen] = useState(false)
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

  function handleNewChat() {
    newChat()
    setSessionListOpen(false)
  }

  function handleSwitchSession(id: string) {
    switchSession(id)
    setSessionListOpen(false)
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

  return (
    <TooltipProvider delayDuration={400}>
    <div
      className={`mx-auto flex h-full min-h-0 w-full max-w-2xl flex-col lg:max-w-3xl xl:max-w-[52rem] ${
        isEmpty ? 'justify-center' : ''
      }`}
    >
      <ChatCommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        sessions={sessions}
        onNewChat={handleNewChat}
        onSwitchSession={handleSwitchSession}
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
            <ChatWelcome
              sessions={sessions}
              onSuggestion={(prompt) => handleSubmit(prompt)}
              onOpenSession={handleSwitchSession}
              onOpenPalette={() => setPaletteOpen(true)}
            />
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
            <div
              ref={containerRef}
              onScroll={handleScroll}
              className="flex min-h-0 flex-1 flex-col justify-end gap-2 overflow-y-auto px-1 pb-3"
            >
              {loadingHistory ? (
                // Shaped like the conversation that's about to land —
                // alternating sides at bubble proportions — so the view
                // settles into its final layout immediately instead of
                // jumping when the real messages arrive.
                <div className="flex flex-col gap-3 pb-2" role="status" aria-label="Loading conversation">
                  {[
                    { side: 'end', w: '45%', h: 38 },
                    { side: 'start', w: '70%', h: 64 },
                    { side: 'end', w: '35%', h: 38 },
                    { side: 'start', w: '60%', h: 52 },
                  ].map((row, i) => (
                    <div key={i} className={`flex ${row.side === 'end' ? 'justify-end' : 'justify-start'}`}>
                      <Skeleton
                        className="rounded-lg"
                        style={{ width: row.w, height: row.h }}
                      />
                    </div>
                  ))}
                </div>
              ) : (
                messages.map((m) => <ChatMessage key={m.id} message={m} />)
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {omniroute.error && (
          <motion.div
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: -4, height: 0 }}
            animate={{ opacity: 1, y: 0, height: 'auto' }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, y: -4, height: 0 }}
            transition={spring.standard}
            className="mb-2 flex shrink-0 items-center justify-between gap-2 overflow-hidden rounded-lg border px-3 py-2 text-xs"
            style={{
              background: 'color-mix(in srgb, var(--color-danger) 14%, var(--surface-raised))',
              borderColor: 'color-mix(in srgb, var(--color-danger) 25%, transparent)',
              color: 'var(--color-danger)',
            }}
          >
            <span>{omniroute.error}</span>
            <Button
              type="button"
              onClick={omniroute.clearError}
              aria-label="Dismiss"
              variant="ghost"
              size="icon-sm"
              className="rounded-lg opacity-70 hover:bg-transparent hover:opacity-100"
            >
              <WindowCloseIcon width={11} height={11} />
            </Button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Focus state is a real elevation lift (brighter border, deeper
          shadow, tiny scale) rather than a thin cyan outline ring — the
          composer is the single most-used control on this screen, so
          "you're typing here" should read as the surface itself coming
          forward, not a generic focus-ring afterthought. Plain CSS
          transitions (not Framer) since this is a pure :focus-within
          state with no orchestration needs. */}
      <div
        className="composer-surface relative w-full shrink-0 rounded-xl border p-3.5 transition-[border-color,box-shadow,transform] duration-200 ease-out"
        style={{
          borderColor: 'var(--border-hairline)',
          background: 'var(--surface-raised)',
        }}
      >
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
          className="text-text-primary placeholder:text-text-tertiary max-h-48 min-h-11 w-full resize-none overflow-y-auto bg-transparent text-base leading-relaxed outline-none disabled:cursor-not-allowed disabled:opacity-50"
        />
        <div className="mt-2.5 flex items-center justify-between border-t border-white/6 pt-2.5">
          <div className="flex items-center gap-1.5">
            {/* Not interactive — there's only ever one mode today — so it's
                styled as a quiet badge (no border, tinted background)
                rather than a bordered pill that visually competes with
                the genuinely clickable DaemonStatusControl beside it. */}
            <span className="text-text-tertiary bg-white/5 flex items-center gap-1.5 rounded-xl px-2.5 py-1 text-xs font-medium">
              {MODES[0].label}
            </span>
            <DaemonStatusControl
              daemonLabel="OmniRoute"
              startCommandLabel="omniroute serve --daemon --no-open"
              historyDescription="OmniRoute runtime & chat history"
              control={omniroute}
              open={omniRouteDialogOpen}
              onOpenChange={setOmniRouteDialogOpen}
              sessions={sessions}
              activeSessionId={sessionId}
              onSwitchSession={handleSwitchSession}
              onCloseSession={closeSession}
              onNewChat={handleNewChat}
            />

            <span aria-hidden="true" className="mx-0.5 h-4 w-px bg-white/10" />

            <Tooltip content="Daily news brief">
              <Button
                type="button"
                aria-label="Open daily news brief"
                onClick={openNewsBrief}
                variant="ghost"
                size="icon-sm"
                className="rounded-lg"
              >
                <NewspaperIcon width={14} height={14} />
              </Button>
            </Tooltip>

            <DropdownMenu
              open={sessionListOpen}
              onOpenChange={setSessionListOpen}
            >
              <Tooltip content="Chat history">
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    aria-label="Chat history"
                    variant="ghost"
                    size="pill-sm"
                    className="rounded-lg"
                  >
                    <ChatBubbleIcon width={12} height={12} />
                    <span className="text-xs">{sessions.length}</span>
                    <motion.span
                      animate={{ rotate: sessionListOpen ? 90 : 0 }}
                      transition={spring.micro}
                      className="flex"
                    >
                      <ChevronRightIcon width={10} height={10} />
                    </motion.span>
                  </Button>
                </DropdownMenuTrigger>
              </Tooltip>

              <DropdownMenuContent
                side="top"
                align="start"
                className="rounded-2xl"
              >
                <DropdownMenuItem
                  onSelect={handleNewChat}
                  className="text-text-primary rounded-none border-b border-white/6 px-3 py-2.5 text-sm font-medium"
                >
                  <PlusIcon width={13} height={13} />
                  New chat
                </DropdownMenuItem>
                <div className="flex flex-col overflow-y-auto">
                  {sessions.length === 0 ? (
                    <div className="text-text-tertiary px-3 py-3 text-xs">
                      No conversations yet.
                    </div>
                  ) : (
                    sessions.map((s) => (
                      <div
                        key={s.id}
                        className="group relative flex items-center gap-1 px-1.5 py-1"
                      >
                        {s.id === sessionId && (
                          <motion.div
                            layoutId="active-session-row"
                            transition={spring.standard}
                            className="bg-accent/10 absolute inset-0 rounded-lg"
                          />
                        )}
                        <DropdownMenuItem
                          onSelect={() => handleSwitchSession(s.id)}
                          className="hover:bg-accent/8 relative min-w-0 flex-1 truncate rounded-lg transition-colors duration-100"
                        >
                          {s.title || 'Untitled chat'}
                        </DropdownMenuItem>
                        <Button
                          type="button"
                          aria-label="Close chat"
                          variant="ghost"
                          size="icon-sm"
                          onClick={(e) => {
                            e.stopPropagation()
                            closeSession(s.id)
                          }}
                          className="relative rounded-lg opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 hover:text-red-400"
                        >
                          <WindowCloseIcon width={11} height={11} />
                        </Button>
                      </div>
                    ))
                  )}
                </div>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <div className="flex items-center gap-1">
            <div className="relative">
              <AnimatePresence mode="popLayout" initial={false}>
                {responding ? (
                  <motion.div
                    key="stop"
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.9 }}
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
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    transition={spring.micro}
                  >
                    <Tooltip content="Send">
                      <Button
                        type="button"
                        aria-label="Send"
                        onClick={() => handleSubmit()}
                        disabled={value.trim().length === 0}
                        variant="brand"
                        size="icon-lg"
                        className="rounded-lg disabled:opacity-30"
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
    </TooltipProvider>
  )
}
