import { useRef, useState } from 'react'
import { Command } from 'cmdk'
import { AnimatePresence, motion } from 'framer-motion'
import { cn } from '@/shared/lib/cn'
import { spring, prefersReducedMotion } from '@/shared/lib/motion'
import { SearchIcon, PlusIcon, ChatBubbleIcon, SparkleIcon } from '@/shared/icons'
import { MODES, type ModeId } from './modes'
import type { ChatSession } from '@/integrations/general-chat'

export interface ChatCommandPaletteProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  sessions: ChatSession[]
  activeMode: ModeId
  onNewChat: () => void
  onSwitchSession: (id: string) => void
  onSwitchMode: (mode: ModeId) => void
  onFocusComposer: () => void
}

/**
 * The chat page's fast-path for everything the sidebar/composer chrome can
 * already do, without leaving the keyboard. Scoped to General Chat only —
 * not an app-wide navigator, since this pass is chat-page-only per the
 * brief. Built on cmdk (filtering/grouping/roving-focus already correct)
 * rather than hand-rolling that logic on top of the existing Radix
 * dropdown, which isn't designed for a fuzzy-searchable list.
 *
 * Opening/closing motion is deliberately restrained (opacity + tiny
 * scale/translate, ~panel-speed spring) — the palette should feel faster
 * than the thought that opened it, not showcase an entrance.
 */
export function ChatCommandPalette({
  open,
  onOpenChange,
  sessions,
  activeMode,
  onNewChat,
  onSwitchSession,
  onSwitchMode,
  onFocusComposer,
}: ChatCommandPaletteProps) {
  const [search, setSearch] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  function run(action: () => void) {
    action()
    onOpenChange(false)
  }

  const reduced = prefersReducedMotion()

  return (
    <AnimatePresence>
      {open && (
        <Command.Dialog
          open={open}
          onOpenChange={onOpenChange}
          label="Chat commands"
          shouldFilter
          loop
          className="contents"
        >
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduced ? 0 : 0.15 }}
            onClick={() => onOpenChange(false)}
            className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
          />
          <div className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[18vh]">
            <motion.div
              initial={reduced ? { opacity: 0 } : { opacity: 0, y: -8, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={reduced ? { opacity: 0 } : { opacity: 0, y: -8, scale: 0.98 }}
              transition={spring.panel}
              onClick={(e) => e.stopPropagation()}
              className="glass-surface border-glass-border w-full max-w-lg overflow-hidden rounded-2xl border"
              style={{ boxShadow: 'var(--shadow-panel)' }}
            >
              <div className="border-glass-border flex items-center gap-2 border-b px-3.5 py-3">
                <SearchIcon width={14} height={14} className="text-text-tertiary shrink-0" />
                <Command.Input
                  ref={inputRef}
                  value={search}
                  onValueChange={setSearch}
                  placeholder="Search commands and chats…"
                  className="text-text-primary placeholder:text-text-tertiary w-full bg-transparent text-[13.5px] outline-none"
                />
                <kbd className="text-text-tertiary border-glass-border shrink-0 rounded-md border px-1.5 py-0.5 text-[10px]">
                  Esc
                </kbd>
              </div>

              <Command.List className="max-h-80 overflow-y-auto p-1.5">
                <Command.Empty className="text-text-tertiary px-3 py-6 text-center text-[12.5px]">
                  No matching commands.
                </Command.Empty>

                <Command.Group
                  heading="Actions"
                  className="[&_[cmdk-group-heading]]:text-text-tertiary [&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:tracking-[0.06em] [&_[cmdk-group-heading]]:uppercase"
                >
                  <PaletteItem onSelect={() => run(onNewChat)}>
                    <PlusIcon width={13} height={13} />
                    New chat
                  </PaletteItem>
                  <PaletteItem onSelect={() => run(onFocusComposer)}>
                    <ChatBubbleIcon width={13} height={13} />
                    Focus composer
                  </PaletteItem>
                  {MODES.filter((m) => m.id !== activeMode).map((m) => (
                    <PaletteItem key={m.id} onSelect={() => run(() => onSwitchMode(m.id))}>
                      <SparkleIcon width={13} height={13} />
                      Switch to {m.label}
                    </PaletteItem>
                  ))}
                </Command.Group>

                {sessions.length > 0 && (
                  <Command.Group
                    heading="Recent chats"
                    className="[&_[cmdk-group-heading]]:text-text-tertiary [&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:tracking-[0.06em] [&_[cmdk-group-heading]]:uppercase"
                  >
                    {sessions.map((s) => (
                      <PaletteItem key={s.id} onSelect={() => run(() => onSwitchSession(s.id))}>
                        <ChatBubbleIcon width={13} height={13} className="text-text-tertiary shrink-0" />
                        <span className="truncate">{s.title || 'Untitled chat'}</span>
                      </PaletteItem>
                    ))}
                  </Command.Group>
                )}
              </Command.List>
            </motion.div>
          </div>
        </Command.Dialog>
      )}
    </AnimatePresence>
  )
}

function PaletteItem({
  children,
  className,
  ...props
}: React.ComponentProps<typeof Command.Item>) {
  return (
    <Command.Item
      className={cn(
        'text-text-secondary data-[selected=true]:bg-glass-hover data-[selected=true]:text-text-primary flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] outline-none transition-colors duration-100',
        className,
      )}
      {...props}
    >
      {children}
    </Command.Item>
  )
}
