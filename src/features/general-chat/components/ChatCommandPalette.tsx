import { useRef, useState } from 'react'
import { Command } from 'cmdk'
import { AnimatePresence, motion } from 'framer-motion'
import { cn } from '@/shared/lib/cn'
import { spring, duration, zIndex, prefersReducedMotion } from '@/shared/lib/motion'
import { SearchIcon, PlusIcon, ChatBubbleIcon } from '@/shared/icons'
import type { ChatSession } from '@/integrations/general-chat'

export interface ChatCommandPaletteProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  sessions: ChatSession[]
  onNewChat: () => void
  onSwitchSession: (id: string) => void
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
  onNewChat,
  onSwitchSession,
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
            transition={{ duration: reduced ? 0 : duration.backdrop }}
            onClick={() => onOpenChange(false)}
            className="fixed inset-0 bg-black/40 backdrop-blur-sm"
            style={{ zIndex: zIndex.overlay }}
          />
          <div
            className="fixed inset-0 flex items-start justify-center px-4 pt-[18vh]"
            style={{ zIndex: zIndex.overlayPanel }}
          >
            <motion.div
              initial={reduced ? { opacity: 0 } : { opacity: 0, y: -8, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={reduced ? { opacity: 0 } : { opacity: 0, y: -8, scale: 0.98 }}
              transition={spring.panel}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-lg overflow-hidden rounded-2xl border border-(--border-hairline)"
              style={{ background: 'var(--surface-overlay)', boxShadow: 'inset 0 1px 0 var(--highlight-inset), var(--shadow-modal)' }}
            >
              <div className="flex items-center gap-2 border-b border-(--border-hairline) px-3.5 py-3">
                <SearchIcon width={14} height={14} className="text-text-tertiary shrink-0" />
                <Command.Input
                  ref={inputRef}
                  value={search}
                  onValueChange={setSearch}
                  placeholder="Search commands and chats…"
                  className="text-text-primary placeholder:text-text-tertiary w-full bg-transparent text-base outline-none"
                />
                <kbd className="text-text-tertiary border-(--border-hairline) shrink-0 rounded-md border px-1.5 py-0.5 text-2xs">
                  Esc
                </kbd>
              </div>

              <Command.List className="max-h-80 overflow-y-auto p-1.5">
                <Command.Empty className="text-text-tertiary px-3 py-6 text-center text-sm">
                  No matching commands.
                </Command.Empty>

                <Command.Group
                  heading="Actions"
                  className="[&_[cmdk-group-heading]]:text-text-tertiary [&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-2xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:tracking-[0.06em] [&_[cmdk-group-heading]]:uppercase"
                >
                  <PaletteItem onSelect={() => run(onNewChat)}>
                    <PlusIcon width={13} height={13} />
                    New chat
                  </PaletteItem>
                  <PaletteItem onSelect={() => run(onFocusComposer)}>
                    <ChatBubbleIcon width={13} height={13} />
                    Focus composer
                  </PaletteItem>
                </Command.Group>

                {sessions.length > 0 && (
                  <Command.Group
                    heading="Recent chats"
                    className="[&_[cmdk-group-heading]]:text-text-tertiary [&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-2xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:tracking-[0.06em] [&_[cmdk-group-heading]]:uppercase"
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
        'text-text-secondary data-[selected=true]:bg-(--surface-raised) data-[selected=true]:text-text-primary flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-sm outline-none transition-colors duration-100',
        className,
      )}
      {...props}
    >
      {children}
    </Command.Item>
  )
}
