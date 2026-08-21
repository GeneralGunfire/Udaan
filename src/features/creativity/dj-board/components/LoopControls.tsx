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
          <button
            key={beats}
            type="button"
            onClick={() => onSetBeats(beats)}
            className="h-7 w-7 text-[10px] font-semibold transition-colors duration-100"
            style={{
              background: loop.beats === beats ? accent : 'var(--color-glass-bg-hover)',
              color: loop.beats === beats ? '#fff' : 'var(--color-text-tertiary)',
            }}
          >
            {beats}
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={onToggle}
        title={loop.active ? 'Exit loop' : `Loop ${loop.beats} beats from here`}
        className="h-7 flex-1 rounded-md text-[10px] font-semibold tracking-wide uppercase transition-colors duration-100"
        style={{
          background: loop.active ? accent : 'var(--color-glass-bg-hover)',
          color: loop.active ? '#fff' : 'var(--color-text-secondary)',
        }}
      >
        {loop.active ? 'Loop On' : 'Loop'}
      </button>
    </div>
  )
}
