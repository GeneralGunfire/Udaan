import { useState } from 'react'
import { cn } from '@/shared/lib/cn'
import { Tooltip } from '@/shared/components/ui/tooltip'
import { useStudioStore } from '../store/studioStore'
import { gainToDb, dbToGain } from '@/integrations/studio/client'
import type { Track } from '../model/project'

/**
 * Track headers down the left of the arrangement.
 *
 * Each row carries only what is needed *while arranging*: who the track
 * is, whether you can hear it, and whether it is armed. Level, pan,
 * sends and inserts live in the mixer, where they can be compared across
 * tracks side by side — which is the only way anyone actually sets them.
 * Duplicating faders here would make the row twice as tall for a control
 * that is worse in this position.
 *
 * Mute and solo are labelled M and S rather than icons. Every DAW uses
 * those two letters, they are unambiguous at 24px in a way a crossed-out
 * speaker is not, and they survive being small.
 */
export function TrackList() {
  const tracks = useStudioStore((s) => s.project.tracks)
  const selectedTrackId = useStudioStore((s) => s.selectedTrackId)
  const selectTrack = useStudioStore((s) => s.selectTrack)
  const updateTrack = useStudioStore((s) => s.updateTrack)
  const removeTrack = useStudioStore((s) => s.removeTrack)

  const anySoloed = tracks.some((t) => t.soloed)

  return (
    <div className="flex flex-col">
      {tracks.map((track) => (
        <TrackRow
          key={track.id}
          track={track}
          selected={track.id === selectedTrackId}
          dimmedBySolo={anySoloed && !track.soloed}
          onSelect={() => selectTrack(track.id)}
          onUpdate={(patch) => updateTrack(track.id, patch)}
          onRemove={() => removeTrack(track.id)}
        />
      ))}
    </div>
  )
}

const ROW_HEIGHTS: Record<Track['height'], number> = {
  compact: 40,
  normal: 60,
  tall: 96,
}

function TrackRow({
  track,
  selected,
  dimmedBySolo,
  onSelect,
  onUpdate,
  onRemove,
}: {
  track: Track
  selected: boolean
  dimmedBySolo: boolean
  onSelect: () => void
  onUpdate: (patch: Partial<Track>) => void
  onRemove: () => void
}) {
  const [renaming, setRenaming] = useState(false)
  const [draft, setDraft] = useState(track.name)

  return (
    <div
      onClick={onSelect}
      style={{ height: ROW_HEIGHTS[track.height] }}
      className={cn(
        'group relative flex items-center gap-2 border-b border-(--border-hairline) px-3',
        'transition-colors duration-150',
        selected ? 'bg-white/[0.06]' : 'hover:bg-white/[0.03]',
        // A track silenced by someone else's solo is dimmed rather than
        // marked, because that state is not something *this* track did —
        // showing it as a badge here would imply the user set it.
        dimmedBySolo && 'opacity-45',
      )}
    >
      {/* Colour spine. Also the selection cue — a full-row tint would
          fight with the clip colours in the lane beside it. */}
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 w-[3px]"
        style={{ backgroundColor: selected ? track.color : 'transparent' }}
      />

      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        {renaming ? (
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => {
              setRenaming(false)
              if (draft.trim()) onUpdate({ name: draft.trim() })
              else setDraft(track.name)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur()
              if (e.key === 'Escape') {
                setDraft(track.name)
                setRenaming(false)
              }
            }}
            className="text-text-primary w-full bg-transparent text-sm outline-none"
          />
        ) : (
          <button
            type="button"
            onDoubleClick={() => setRenaming(true)}
            className="text-text-primary truncate text-left text-sm"
            title="Double-click to rename"
          >
            {track.name}
          </button>
        )}

        {track.height !== 'compact' && (
          <span className="text-text-tertiary truncate text-2xs">
            {track.kind === 'instrument' ? (track.instrumentId ?? 'No instrument') : 'Audio'}
          </span>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <StateToggle
          label="Mute"
          letter="M"
          active={track.muted}
          tone="neutral"
          onClick={() => onUpdate({ muted: !track.muted })}
        />
        <StateToggle
          label="Solo"
          letter="S"
          active={track.soloed}
          tone="accent"
          onClick={() => onUpdate({ soloed: !track.soloed })}
        />
        {track.kind === 'audio' && (
          <StateToggle
            label="Record arm"
            letter="R"
            active={track.armed}
            tone="danger"
            onClick={() => onUpdate({ armed: !track.armed })}
          />
        )}
        <Tooltip content="Remove track" side="right">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onRemove()
            }}
            aria-label={`Remove ${track.name}`}
            className="text-text-tertiary hover:text-danger hover:bg-danger/10 flex h-6 w-6 items-center justify-center rounded opacity-0 transition-all duration-150 group-hover:opacity-100"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
              <path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </Tooltip>
      </div>
    </div>
  )
}

function StateToggle({
  label,
  letter,
  active,
  tone,
  onClick,
}: {
  label: string
  letter: string
  active: boolean
  tone: 'neutral' | 'accent' | 'danger'
  onClick: () => void
}) {
  return (
    <Tooltip content={label} side="bottom">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          onClick()
        }}
        aria-label={label}
        aria-pressed={active}
        className={cn(
          'flex h-6 w-6 items-center justify-center rounded text-2xs-alt font-bold transition-colors duration-150',
          'focus-visible:outline-accent focus-visible:outline-2 focus-visible:outline-offset-1',
          !active && 'text-text-tertiary hover:text-text-secondary hover:bg-white/[0.08]',
          active && tone === 'neutral' && 'bg-white/20 text-white',
          active && tone === 'accent' && 'bg-accent/25 text-accent',
          active && tone === 'danger' && 'bg-danger/25 text-danger',
        )}
      >
        {letter}
      </button>
    </Tooltip>
  )
}

/** dB label for a linear gain, for use anywhere a fader is shown. */
export function formatGain(gain: number): string {
  const db = gainToDb(gain)
  if (db <= -60) return '-∞'
  return `${db > 0 ? '+' : ''}${db.toFixed(1)}`
}

export { dbToGain }
