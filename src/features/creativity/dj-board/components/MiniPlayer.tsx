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
      className="flex h-9 shrink-0 items-center gap-2 rounded-lg border border-transparent px-2 transition-[background-color,border-color] duration-150 hover:border-white/10 hover:bg-white/10"
    >
      <span
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-white"
        style={{ background: accent }}
      >
        <DiscIcon width={11} height={11} />
      </span>
      <div className="flex min-w-0 flex-col items-start">
        <span className="text-text-primary max-w-32 truncate text-[12px] font-medium">
          {state.track?.fileName ?? 'No track'}
        </span>
        <span className="text-text-tertiary text-[12px] tabular-nums">
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
        className="text-text-secondary hover:text-text-primary hover:bg-white/10 flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition-colors duration-100"
      >
        {state.isPlaying ? <PauseIcon width={12} height={12} /> : <PlayIcon width={12} height={12} />}
      </span>
    </button>
  )
}
