import { AnimatePresence, motion } from 'framer-motion'
import type { ModeId } from './modes'
import { CodeEditorIcon, GaugeIcon, GlobeIcon } from '@/shared/icons'

interface ModeSessionPanelProps {
  mode: ModeId
  /** Round-trip time of the last local-model response, if any. */
  latencyMs: number | null
}

/**
 * Session/status card attached to the left of the composer input. Content
 * adapts to the active mode: Claude mode shows a Claude Code-style session
 * summary; Local mode shows local model runtime stats. Router mode has no
 * single session to report, so it shows a compact routing note instead.
 * Owns its own bounded glass surface so it reads as a real panel, not
 * loose text floating over the wallpaper.
 */
export function ModeSessionPanel({ mode, latencyMs }: ModeSessionPanelProps) {
  return (
    <div className="glass-surface flex w-40 shrink-0 flex-col overflow-hidden rounded-[16px]">
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={mode}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.16, ease: [0.2, 0, 0, 1] }}
        >
          {mode === 'claude' && <ClaudeSessionPanel />}
          {mode === 'local' && <LocalStatsPanel latencyMs={latencyMs} />}
          {mode === 'router' && <RouterPanel />}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}

function ClaudeSessionPanel() {
  return (
    <div className="flex flex-col gap-1.5 px-3 py-2.5">
      <div className="text-text-tertiary flex items-center gap-1.5 text-[10px] font-medium tracking-wide uppercase">
        <CodeEditorIcon width={12} height={12} />
        Session
      </div>
      <div className="text-text-secondary text-[11.5px] leading-snug">
        <div className="flex items-center gap-1.5">
          <span className="bg-success h-1.5 w-1.5 shrink-0 rounded-full shadow-[0_0_6px_var(--color-success)]" />
          Headless task
        </div>
        <div className="text-text-tertiary mt-1">via Claude Code</div>
      </div>
    </div>
  )
}

function LocalStatsPanel({ latencyMs }: { latencyMs: number | null }) {
  return (
    <div className="flex flex-col gap-1.5 px-3 py-2.5">
      <div className="text-text-tertiary flex items-center gap-1.5 text-[10px] font-medium tracking-wide uppercase">
        <GaugeIcon width={12} height={12} />
        Local model
      </div>
      <div className="text-text-secondary text-[11.5px] leading-snug">
        <div className="truncate font-medium">qwen2.5:1.5b</div>
        <div className="text-text-tertiary mt-1 tabular-nums">
          {latencyMs === null ? 'CPU · Ollama' : `${latencyMs}ms last reply`}
        </div>
      </div>
    </div>
  )
}

function RouterPanel() {
  return (
    <div className="flex flex-col gap-1.5 px-3 py-2.5">
      <div className="text-text-tertiary flex items-center gap-1.5 text-[10px] font-medium tracking-wide uppercase">
        <GlobeIcon width={12} height={12} />
        Router
      </div>
      <div className="text-text-tertiary text-[11.5px] leading-snug">
        Picks local or Claude per request.
      </div>
    </div>
  )
}
