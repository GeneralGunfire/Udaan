import { useDjBoard } from '../hooks/useDjBoard'
import { formatTime } from '../hooks/useDjBoard'
import { PlayIcon, PauseIcon, DiscIcon } from '@/shared/icons'

interface MiniPlayerProps {
  onOpenDjBoard: () => void
}

/**
 * Always-mounted transport strip for the DJ Board, shown in the app
 * shell (TopBar) regardless of which feature view is active. Reads the
 * same module-level engine singleton DjBoardView does (see
 * lib/boardEngineStore.ts) — play/pause here controls the exact same
 * live audio graph, not a separate instance. Only renders once a track
 * has been loaded on either deck, so it stays out of the way otherwise.
 */
export function MiniPlayer({ onOpenDjBoard }: MiniPlayerProps) {
  const board = useDjBoard()

  const activeDeck = board.deckA.isPlaying ? 'A' : board.deckB.isPlaying ? 'B' : board.deckA.track ? 'A' : board.deckB.track ? 'B' : null
  if (!activeDeck) return null

  const state = activeDeck === 'A' ? board.deckA : board.deckB
  const accent = activeDeck === 'A' ? 'var(--color-brand-cyan)' : 'var(--color-accent-creativity)'

  return (
    <button
      type="button"
      onClick={onOpenDjBoard}
      title="Open DJ Board"
      className="glass-surface flex h-11 shrink-0 items-center gap-2 rounded-full px-3 backdrop-blur-2xl transition-transform duration-100 hover:scale-[1.02]"
      style={{ boxShadow: 'var(--shadow-composer)' }}
    >
      <span
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-white"
        style={{ background: accent }}
      >
        <DiscIcon width={12} height={12} />
      </span>
      <div className="flex min-w-0 flex-col items-start">
        <span className="text-text-primary max-w-32 truncate text-[10.5px] font-medium">
          {state.track?.fileName ?? 'No track'}
        </span>
        <span className="text-text-tertiary text-[9px] tabular-nums">
          {formatTime(state.currentTime)} / {formatTime(state.duration)}
        </span>
      </div>
      <span
        onClick={(e) => {
          e.stopPropagation()
          board.togglePlay(activeDeck)
        }}
        role="button"
        aria-label={state.isPlaying ? 'Pause' : 'Play'}
        className="text-text-secondary hover:text-text-primary hover:bg-glass-hover flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-colors duration-100"
      >
        {state.isPlaying ? <PauseIcon width={12} height={12} /> : <PlayIcon width={12} height={12} />}
      </span>
    </button>
  )
}
