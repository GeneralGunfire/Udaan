import { KeyboardIcon } from '@/shared/icons'

interface ShortcutsOverlayProps {
  open: boolean
  onClose: () => void
}

const SHORTCUTS: { keys: string; label: string }[] = [
  { keys: 'Q', label: 'Play/pause Deck A' },
  { keys: 'P', label: 'Play/pause Deck B' },
  { keys: 'W', label: 'Add freeform cue — Deck A' },
  { keys: 'O', label: 'Add freeform cue — Deck B' },
  { keys: '1 – 4', label: 'Trigger hot cue (focused deck)' },
  { keys: 'Shift + 1–4', label: 'Clear hot cue (focused deck)' },
  { keys: 'A / D', label: 'Set hot cue focus to Deck A / B' },
  { keys: 'L', label: 'Toggle loop — focused deck' },
  { keys: '← / →', label: 'Nudge crossfader toward A / B' },
  { keys: '?', label: 'Toggle this shortcuts panel' },
]

/** Toggleable cheat-sheet — real current key mappings, not a static help image. */
export function ShortcutsOverlay({ open, onClose }: ShortcutsOverlayProps) {
  if (!open) return null
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="glass-surface w-80 rounded-xl p-4"
        style={{ boxShadow: 'var(--shadow-panel)' }}
      >
        <div className="mb-3 flex items-center gap-1.5">
          <KeyboardIcon width={14} height={14} className="text-accent-creativity" />
          <h2 className="text-text-primary text-[13px] font-semibold">Keyboard Shortcuts</h2>
        </div>
        <div className="flex flex-col gap-1.5">
          {SHORTCUTS.map((s) => (
            <div key={s.keys} className="flex items-center justify-between gap-3">
              <span className="text-text-secondary text-[11px]">{s.label}</span>
              <kbd className="border-glass-border bg-glass text-text-tertiary shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-medium">
                {s.keys}
              </kbd>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-text-tertiary hover:text-text-secondary mt-3 w-full text-center text-[10.5px]"
        >
          Close (Esc or click outside)
        </button>
      </div>
    </div>
  )
}
