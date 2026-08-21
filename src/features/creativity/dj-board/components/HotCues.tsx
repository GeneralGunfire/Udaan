import type { HotCueSlot } from '../lib/types'

interface HotCuesProps {
  hotCues: HotCueSlot[]
  accent: string
  onTrigger: (slot: number) => void
  onSet: (slot: number) => void
  onClear: (slot: number) => void
}

/** 4 fixed hot-cue slots, triggerable via number keys 1-4 (wired in DjBoardView). Click sets/jumps; shift-click clears. */
export function HotCues({ hotCues, accent, onTrigger, onSet, onClear }: HotCuesProps) {
  return (
    <div className="grid grid-cols-4 gap-1.5">
      {hotCues.map((seconds, i) => {
        const isSet = seconds !== null
        return (
          <button
            key={i}
            type="button"
            onClick={(e) => {
              if (e.shiftKey && isSet) {
                onClear(i)
                return
              }
              if (isSet) onTrigger(i)
              else onSet(i)
            }}
            title={
              isSet
                ? `Hot cue ${i + 1} — click to jump, shift-click to clear`
                : `Set hot cue ${i + 1} at current position`
            }
            className="flex h-9 flex-col items-center justify-center gap-0.5 rounded-md text-[10px] font-bold transition-transform duration-100 active:scale-95"
            style={{
              background: isSet ? accent : 'var(--color-glass-bg-hover)',
              color: isSet ? '#fff' : 'var(--color-text-tertiary)',
            }}
          >
            {i + 1}
          </button>
        )
      })}
    </div>
  )
}
