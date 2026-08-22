import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import udaanMark from '@/assets/udaan-mark.png'
import {
  SendIcon,
  MicIcon,
  StopIcon,
  PlusIcon,
  ChevronRightIcon,
  WindowCloseIcon,
} from '@/shared/icons'
import { Button } from '@/shared/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/shared/components/ui/dropdown-menu'
import { Tooltip, TooltipProvider } from '@/shared/components/ui/tooltip'
import { spring, duration, prefersReducedMotion } from '@/shared/lib/motion'
import { useWallpaper } from '@/shared/hooks/useWallpaper'
import { getWallpaper } from '@/app/wallpapers'
import { MODES, type ModeId } from './modes'
import { ChatMessage } from './ChatMessage'
import { ChatCommandPalette } from './ChatCommandPalette'
import { useGeneralChat } from '../hooks/useGeneralChat'
import { useMicTranscription } from '../hooks/useMicTranscription'
import { useStickyScroll } from '../hooks/useStickyScroll'

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
 * Local and Claude are separate conversation spaces (own session list,
 * own history) — switching the mode control switches which space you're
 * in, it never merges the two.
 */
export function Composer() {
  const [value, setValue] = useState('')
  const [activeMode, setActiveMode] = useState<ModeId>('local')
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
  } = useGeneralChat(activeMode)
  const mic = useMicTranscription()
  const { containerRef, handleScroll } = useStickyScroll(messages)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const MAX_TEXTAREA_HEIGHT = 208

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

  async function handleMicClick() {
    if (mic.recording) {
      const text = await mic.stop()
      if (text) setValue((v) => (v ? `${v} ${text}` : text))
    } else {
      try {
        await mic.start()
      } catch {
        // useMicTranscription already set a user-visible error message.
      }
    }
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
  const { wallpaperId } = useWallpaper()
  // Lighter wallpapers need a stronger localized veil to keep text/controls
  // readable; darker ones need barely any — avoids a fixed-opacity overlay
  // that either washes out on light art or looks unnecessarily heavy on
  // dark art. Uses the wallpaper's own declared `mood`, not image analysis.
  const veilStrength = getWallpaper(wallpaperId).mood === 'light' ? 1 : 0.55

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
        activeMode={activeMode}
        onNewChat={handleNewChat}
        onSwitchSession={handleSwitchSession}
        onSwitchMode={setActiveMode}
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
            className="relative mb-8 flex shrink-0 flex-col items-center gap-6 px-1"
          >
            {/* Localized atmospheric contrast layer — a soft radial veil
                sized to just this content block (logo + tagline + hint),
                not a card and not the full panel. Keeps text readable
                over bright wallpapers without a hard-edged boundary;
                barely visible against dark wallpapers since it's a
                low-opacity dark radial, additive rather than a fixed
                tint. */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-[-25%] inset-y-[-30%] -z-10 transition-opacity duration-500"
              style={{
                opacity: veilStrength,
                background:
                  'radial-gradient(ellipse 65% 65% at 50% 40%, rgb(4 8 16 / 32%) 0%, rgb(4 8 16 / 14%) 55%, transparent 80%)',
              }}
            />

            <div className="flex flex-col items-center gap-2.5 text-center">
              <img
                src={udaanMark}
                alt=""
                className="h-11 w-11 object-contain"
                style={{ filter: 'drop-shadow(0 2px 10px rgb(0 0 0 / 55%))' }}
              />
              <div>
                <div
                  className="font-display text-text-primary text-[22px] font-semibold"
                  style={{ textShadow: '0 1px 10px rgb(0 0 0 / 50%)' }}
                >
                  Udaan
                </div>
                <div
                  className="font-display text-text-secondary text-[13.5px]"
                  style={{ textShadow: '0 1px 8px rgb(0 0 0 / 45%)' }}
                >
                  Your ideas, set in motion
                </div>
              </div>
            </div>

            <div className="text-text-tertiary/80 flex items-center gap-1.5 text-[11.5px]">
              <kbd className="border-glass-border rounded border px-1.5 py-0.5 font-mono text-[10.5px]">
                {navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'} K
              </kbd>
              <span>for commands</span>
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="messages"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: duration.standard }}
            ref={containerRef}
            onScroll={handleScroll}
            className="flex min-h-0 flex-1 flex-col justify-end gap-2 overflow-y-auto px-1 pb-3"
          >
            {loadingHistory ? (
              <div className="text-text-tertiary flex flex-1 items-center justify-center text-[13px]">
                Loading history…
              </div>
            ) : (
              messages.map((m) => <ChatMessage key={m.id} message={m} />)
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {mic.error && (
          <motion.div
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: -4, height: 0 }}
            animate={{ opacity: 1, y: 0, height: 'auto' }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, y: -4, height: 0 }}
            transition={spring.standard}
            className="mb-2 flex shrink-0 items-center justify-between gap-2 overflow-hidden rounded-xl border border-red-500/25 px-3 py-2 text-[12px] text-red-400 backdrop-blur-md"
            style={{ background: 'color-mix(in srgb, var(--color-bg-elevated) 75%, rgb(239 68 68 / 15%))' }}
          >
            <span>{mic.error}</span>
            <Button
              type="button"
              onClick={mic.clearError}
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

      <div
        className="focus-within:ring-brand-cyan/40 focus-within:border-glass-border relative w-full shrink-0 rounded-2xl border p-4 backdrop-blur-md transition-colors duration-200 focus-within:ring-2"
        style={{
          borderColor: 'var(--color-glass-border)',
          background: 'color-mix(in srgb, var(--color-bg-elevated) 74%, transparent)',
        }}
      >
        <textarea
          ref={textareaRef}
          value={value}
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
          placeholder={
            mic.transcribing ? 'Transcribing…' : 'Type something to build…'
          }
          disabled={mic.transcribing}
          rows={3}
          className="text-text-primary placeholder:text-text-tertiary max-h-52 min-h-12 w-full resize-none overflow-y-auto bg-transparent text-[14.5px] leading-relaxed outline-none disabled:opacity-50"
        />
        <div className="mt-3 flex items-center justify-between border-t border-white/6 pt-3">
          <div className="flex items-center gap-1.5">
            <div
              className="flex items-center gap-0.5 rounded-xl border p-0.5"
              style={{ borderColor: 'var(--color-glass-border)' }}
            >
              {MODES.map((mode) => {
                const isActive = mode.id === activeMode
                return (
                  <Button
                    key={mode.id}
                    type="button"
                    variant="ghost"
                    size="pill"
                    onClick={() => {
                      if (mode.id === activeMode) return
                      setActiveMode(mode.id)
                      setSessionListOpen(false)
                      // Local and Claude are separate conversation spaces —
                      // an unsent draft typed in one shouldn't silently
                      // carry over into the other; switching mode should
                      // feel like switching to a fresh input, not leaving
                      // stale text sitting there unexplained.
                      setValue('')
                      if (textareaRef.current) textareaRef.current.style.height = 'auto'
                    }}
                    className={`relative rounded-lg px-2.5 py-1 ${isActive ? 'hover:bg-transparent' : 'hover:bg-white/8'}`}
                  >
                    {isActive && (
                      <motion.div
                        layoutId="composer-mode-pill"
                        transition={spring.standard}
                        className="absolute inset-0 rounded-lg bg-white/12"
                      />
                    )}
                    <span
                      className={`relative text-[12px] font-medium transition-colors duration-150 ${isActive ? 'text-text-primary' : 'text-text-tertiary hover:text-text-primary'}`}
                    >
                      {mode.label}
                    </span>
                  </Button>
                )
              })}
            </div>

            <DropdownMenu
              open={sessionListOpen}
              onOpenChange={setSessionListOpen}
            >
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  aria-label="Chat history"
                  variant="ghost"
                  size="pill-sm"
                  className="rounded-lg"
                >
                  <span className="text-[12px]">{sessions.length}</span>
                  <motion.span
                    animate={{ rotate: sessionListOpen ? 90 : 0 }}
                    transition={spring.micro}
                    className="flex"
                  >
                    <ChevronRightIcon width={10} height={10} />
                  </motion.span>
                </Button>
              </DropdownMenuTrigger>

              <DropdownMenuContent
                side="top"
                align="start"
                className="rounded-2xl"
              >
                <DropdownMenuItem
                  onSelect={handleNewChat}
                  className="text-text-primary rounded-none border-b border-white/6 px-3 py-2.5 text-[12.5px] font-medium"
                >
                  <PlusIcon width={13} height={13} />
                  New chat
                </DropdownMenuItem>
                <div className="flex flex-col overflow-y-auto">
                  {sessions.length === 0 ? (
                    <div className="text-text-tertiary px-3 py-3 text-[12px]">
                      No conversations yet.
                    </div>
                  ) : (
                    sessions.map((s) => (
                      <div
                        key={s.id}
                        className={`group flex items-center gap-1 px-1.5 py-1 ${
                          s.id === sessionId ? 'bg-white/5' : ''
                        }`}
                      >
                        <DropdownMenuItem
                          onSelect={() => handleSwitchSession(s.id)}
                          className="min-w-0 flex-1 truncate rounded-lg"
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
                          className="rounded-lg opacity-0 group-hover:opacity-100 hover:text-red-400"
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
            <Tooltip
              content={
                mic.transcribing
                  ? 'Transcribing…'
                  : mic.recording
                    ? 'Stop recording'
                    : 'Record voice message'
              }
            >
              <Button
                type="button"
                aria-label={
                  mic.transcribing
                    ? 'Transcribing'
                    : mic.recording
                      ? 'Stop recording'
                      : 'Record voice message'
                }
                onClick={handleMicClick}
                disabled={mic.transcribing}
                variant={mic.recording ? 'danger' : 'ghost'}
                className="rounded-xl"
              >
                {mic.transcribing ? (
                  <motion.span
                    animate={reduced ? undefined : { rotate: 360 }}
                    transition={reduced ? undefined : { duration: 0.8, repeat: Infinity, ease: 'linear' }}
                    className="border-text-tertiary h-3 w-3 rounded-full border-[1.5px] border-t-transparent"
                  />
                ) : mic.recording ? (
                  <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-400" />
                ) : (
                  <MicIcon width={13} height={13} />
                )}
              </Button>
            </Tooltip>

            <div className="relative">
              <AnimatePresence mode="wait" initial={false}>
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
                        variant="ghost"
                        className="rounded-xl"
                      >
                        <StopIcon width={12} height={12} />
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
                        className="rounded-xl disabled:opacity-30"
                      >
                        <SendIcon width={12} height={12} />
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
