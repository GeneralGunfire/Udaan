import { motion } from 'framer-motion'
import udaanMark from '@/assets/udaan-mark.png'
import { CalendarIcon, FolderIcon, SparkleIcon, ChatBubbleIcon, ChevronRightIcon } from '@/shared/icons'
import { spring, staggerGroup, staggerItem, prefersReducedMotion } from '@/shared/lib/motion'
import type { ChatSession } from '@/integrations/general-chat'

/**
 * The screen you land on with an empty conversation.
 *
 * The version this replaces showed a logo, a wordmark, a tagline and a
 * keyboard hint — nothing to look at and nothing to do, which is why it
 * read as dead no matter how much the surfaces underneath it were
 * polished. An empty state is an invitation to act, so this one offers
 * three real things: what the assistant can actually do (prompts derived
 * from the tools it genuinely has — file operations and calendar
 * management, see integrations/agent-workspace/tools.ts and
 * integrations/schedule/scheduleActions.ts), where you left off (recent
 * conversations, which already existed but were buried in a dropdown),
 * and how to move faster (the command palette).
 *
 * Suggestions are deliberately capability-derived rather than invented
 * marketing copy: every one maps to a tool call the assistant can really
 * make, so clicking one never produces "I can't do that".
 */

interface Suggestion {
  icon: typeof CalendarIcon
  label: string
  prompt: string
}

const SUGGESTIONS: Suggestion[] = [
  {
    icon: CalendarIcon,
    label: 'Plan my week',
    prompt: "What's on my calendar this week?",
  },
  {
    icon: FolderIcon,
    label: 'Read a file',
    prompt: 'List the files in my workspace and summarise what you find.',
  },
  {
    icon: SparkleIcon,
    label: 'Draft something',
    prompt: 'Help me draft a short message. Ask me what it needs to say first.',
  },
]

export function ChatWelcome({
  sessions,
  onSuggestion,
  onOpenSession,
  onOpenPalette,
}: {
  sessions: ChatSession[]
  onSuggestion: (prompt: string) => void
  onOpenSession: (id: string) => void
  onOpenPalette: () => void
}) {
  const reduced = prefersReducedMotion()
  const recent = sessions.slice(0, 3)

  return (
    <motion.div
      variants={reduced ? undefined : staggerGroup}
      initial={reduced ? undefined : 'hidden'}
      animate={reduced ? undefined : 'show'}
      className="mb-6 flex shrink-0 flex-col items-center gap-7 px-1"
    >
      <motion.div variants={staggerItem} className="flex flex-col items-center gap-3 text-center">
        <img src={udaanMark} alt="" className="h-11 w-11 object-contain" />
        <div className="flex flex-col gap-1">
          <h1 className="font-display text-text-primary text-lg font-semibold">
            What are we working on?
          </h1>
          <p className="text-text-tertiary text-sm">
            Ask anything, or pick up where you left off.
          </p>
        </div>
      </motion.div>

      {/* Capability prompts. Three, not six: a wall of suggestions is its
          own kind of noise, and three fits one row without wrapping at
          every window width this app is used at. */}
      <motion.div variants={staggerItem} className="flex w-full flex-wrap justify-center gap-2">
        {SUGGESTIONS.map((s) => (
          <button
            key={s.label}
            type="button"
            onClick={() => onSuggestion(s.prompt)}
            className={[
              'group flex items-center gap-2 rounded-full border px-3.5 py-2 text-sm',
              'border-(--border-hairline) bg-(--surface-raised) text-text-secondary',
              'shadow-[inset_0_1px_0_var(--highlight-inset)]',
              'transition-[background-color,border-color,color,transform] duration-150 ease-out',
              'hover:bg-(--surface-overlay) hover:border-(--border-strong) hover:text-text-primary hover:-translate-y-px',
              'active:translate-y-0',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
              'motion-reduce:transform-none',
            ].join(' ')}
          >
            <s.icon
              width={14}
              height={14}
              className="text-text-tertiary group-hover:text-accent shrink-0 transition-colors duration-150"
            />
            {s.label}
          </button>
        ))}
      </motion.div>

      {/* Recent conversations. These already existed but were reachable
          only through a dropdown in the composer's footer — surfacing the
          three most recent here turns "resume what I was doing" from a
          two-click hunt into a single visible choice. */}
      {recent.length > 0 && (
        <motion.div variants={staggerItem} className="flex w-full max-w-md flex-col gap-1.5">
          <p className="text-text-tertiary px-1 text-2xs font-medium tracking-wide uppercase">
            Recent
          </p>
          {recent.map((session) => (
            <button
              key={session.id}
              type="button"
              onClick={() => onOpenSession(session.id)}
              className={[
                'group flex items-center gap-2.5 rounded-md border border-transparent px-2.5 py-2 text-left',
                'transition-[background-color,border-color] duration-150',
                'hover:bg-(--surface-raised) hover:border-(--border-hairline)',
                'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
              ].join(' ')}
            >
              <ChatBubbleIcon
                width={13}
                height={13}
                className="text-text-tertiary group-hover:text-accent shrink-0 transition-colors duration-150"
              />
              <span className="text-text-secondary group-hover:text-text-primary min-w-0 flex-1 truncate text-sm transition-colors duration-150">
                {session.title || 'Untitled chat'}
              </span>
              <ChevronRightIcon
                width={12}
                height={12}
                className="text-text-tertiary shrink-0 opacity-0 transition-opacity duration-150 group-hover:opacity-100"
              />
            </button>
          ))}
        </motion.div>
      )}

      <motion.button
        variants={staggerItem}
        type="button"
        onClick={onOpenPalette}
        transition={reduced ? { duration: 0 } : spring.standard}
        className="text-text-tertiary hover:text-text-secondary flex items-center gap-1.5 rounded-md px-2 py-1 text-2xs transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        <kbd className="rounded-sm border border-(--border-hairline) bg-(--surface-overlay) px-1.5 py-0.5 font-mono text-2xs">
          {navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'} K
        </kbd>
        <span>for commands</span>
      </motion.button>
    </motion.div>
  )
}
