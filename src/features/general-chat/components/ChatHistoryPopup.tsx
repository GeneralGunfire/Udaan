import { useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import { Popover, PopoverTrigger, PopoverContent } from '@/shared/components/ui/popover'
import { Button } from '@/shared/components/ui/button'
import { Tooltip } from '@/shared/components/ui/tooltip'
import { ClockIcon, PlusIcon, WindowCloseIcon } from '@/shared/icons'
import { cn } from '@/shared/lib/cn'
import type { ChatSession } from '@/integrations/general-chat'

interface ChatHistoryPopupProps {
  sessions: ChatSession[]
  activeSessionId: string | null
  onNewChat: () => void
  onSwitchSession: (id: string) => void
  onCloseSession: (id: string) => void
}

/**
 * Session history — a plain icon-button trigger, no badge counter (the
 * count is available the moment the popover opens; a permanent number
 * hovering over the icon was one more thing drawing the eye for no real
 * benefit). The popover header names the active session, where there's
 * room to actually show it.
 */
export function ChatHistoryPopup({
  sessions,
  activeSessionId,
  onNewChat,
  onSwitchSession,
  onCloseSession,
}: ChatHistoryPopupProps) {
  const [open, setOpen] = useState(false)
  const activeSession = sessions.find((s) => s.id === activeSessionId)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip content="Chat history">
        <PopoverTrigger asChild>
          <Button type="button" variant="ghost" aria-label="Chat history" size="icon" className="rounded-full">
            <ClockIcon width={15} height={15} />
          </Button>
        </PopoverTrigger>
      </Tooltip>
      <AnimatePresence>
        {open && (
          <PopoverContent side="top" align="start" sideOffset={10} className="w-72 p-2">
            <div className="flex items-center justify-between gap-2 px-1.5 pb-2">
              <div className="min-w-0">
                <p className="text-text-tertiary text-[11px] font-semibold tracking-[0.06em] uppercase">Conversations</p>
                <p className="text-text-primary truncate text-sm font-medium">{activeSession?.title || 'New chat'}</p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="New chat"
                onClick={() => { onNewChat(); setOpen(false) }}
                className="shrink-0 rounded-lg"
              >
                <PlusIcon width={13} height={13} />
              </Button>
            </div>

            <div className="border-hairline mb-1 border-t" />

            <div className="flex max-h-80 flex-col gap-0.5 overflow-y-auto">
              {sessions.length === 0 ? (
                <p className="text-text-tertiary px-2 py-3 text-xs">No conversations yet.</p>
              ) : (
                sessions.map((s) => {
                  const isActive = s.id === activeSessionId
                  return (
                    <div key={s.id} className="group relative flex items-center">
                      <button
                        type="button"
                        onClick={() => { onSwitchSession(s.id); setOpen(false) }}
                        className={cn(
                          'flex min-w-0 flex-1 items-center rounded-lg px-2 py-2 text-left text-sm outline-none transition-colors',
                          isActive ? 'bg-[var(--os-menu-item-hover)] text-text-primary' : 'text-text-secondary hover:bg-[var(--os-menu-item-hover)] hover:text-text-primary',
                        )}
                      >
                        <span className="truncate">{s.title || 'Untitled chat'}</span>
                      </button>
                      <button
                        type="button"
                        aria-label={`Delete ${s.title || 'Untitled chat'}`}
                        onClick={(e) => { e.stopPropagation(); onCloseSession(s.id) }}
                        className="text-text-tertiary hover:bg-[var(--os-menu-item-hover)] hover:text-danger absolute right-1 z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-md opacity-0 transition-opacity duration-150 group-hover:opacity-100"
                      >
                        <WindowCloseIcon width={10} height={10} />
                      </button>
                    </div>
                  )
                })
              )}
            </div>
          </PopoverContent>
        )}
      </AnimatePresence>
    </Popover>
  )
}
