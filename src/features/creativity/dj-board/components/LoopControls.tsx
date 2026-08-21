import { motion } from 'framer-motion'
import type { LoopState } from '../lib/types'

interface LoopControlsProps {
  loop: LoopState
  accent: string
  onSetBeats: (beats: 4 | 8 | 16) => void
  onToggle: () => void
}

const BEAT_OPTIONS: (4 | 8 | 16)[] = [4, 8, 16]

/** Quick-select loop length + in/out toggle — real looped playback (seek-back interval), not a visual-only marker. */
export function LoopControls({ loop, accent, onSetBeats, onToggle }: LoopControlsProps) {
  return (
    <div className="flex items-center gap-1.5">
      <div className="flex overflow-hidden rounded-md">
        {BEAT_OPTIONS.map((beats) => (
          <motion.button
            key={beats}
            type="button"
            onClick={() => onSetBeats(beats)}
            animate={{ background: loop.beats === beats ? accent : 'var(--color-glass-bg-hover)' }}
            whileHover={{ scale: 1.08 }}
            whileTap={{ scale: 0.92 }}
            transition={{ type: 'spring', stiffness: 500, damping: 28 }}
            className="h-7 w-7 text-[10px] font-semibold"
            style={{ color: loop.beats === beats ? '#fff' : 'var(--color-text-tertiary)' }}
          >
            {beats}
          </motion.button>
        ))}
      </div>
      <motion.button
        type="button"
        onClick={onToggle}
        title={loop.active ? 'Exit loop' : `Loop ${loop.beats} beats from here`}
        animate={{
          background: loop.active ? accent : 'var(--color-glass-bg-hover)',
          scale: loop.active ? [1, 1.03, 1] : 1,
        }}
        transition={
          loop.active
            ? { scale: { repeat: Infinity, duration: 1.1, ease: 'easeInOut' }, background: { type: 'spring', stiffness: 400, damping: 30 } }
            : { type: 'spring', stiffness: 400, damping: 30 }
        }
        whileHover={{ scale: 1.04 }}
        whileTap={{ scale: 0.96 }}
        className="h-7 flex-1 rounded-md text-[10px] font-semibold tracking-wide uppercase"
        style={{ color: loop.active ? '#fff' : 'var(--color-text-secondary)' }}
      >
        {loop.active ? 'Loop On' : 'Loop'}
      </motion.button>
    </div>
  )
}
