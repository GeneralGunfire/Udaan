import { useCallback, useMemo, useRef } from 'react'
import { cn } from '@/shared/lib/cn'
import { useStudioStore } from '../store/studioStore'
import { framesToBeats, beatsToFrames } from '@/integrations/studio/client'
import { TrackList } from './TrackList'
import type { Clip, MidiClip, Track } from '../model/project'

/**
 * The arrangement: tracks down the side, time across the top, clips in
 * the middle. The linear half of the workflow — Session view is the
 * loop-based half.
 *
 * ## Why the ruler and lanes scroll as one element
 * A separate ruler synchronised by scroll events drifts by a frame under
 * load, and a ruler that disagrees with the grid beneath it by even two
 * pixels makes every edit feel imprecise. One scroll container with the
 * ruler pinned inside it cannot desynchronise.
 *
 * ## Clips show their content, not just their name
 * A MIDI clip draws its notes as a miniature. This is what lets you find
 * the chorus by eye instead of by reading eight identically-named blocks
 * — a named rectangle tells you nothing about what is inside it.
 */

const TRACK_PANEL_WIDTH = 224
const RULER_HEIGHT = 28

const ROW_HEIGHTS: Record<Track['height'], number> = {
  compact: 40,
  normal: 60,
  tall: 96,
}

export function Arrangement() {
  const project = useStudioStore((s) => s.project)
  const pixelsPerBeat = useStudioStore((s) => s.pixelsPerBeat)
  const positionFrames = useStudioStore((s) => s.runtime.positionFrames)
  const sampleRate = useStudioStore((s) => s.sampleRate)
  const selectedClipId = useStudioStore((s) => s.selectedClipId)
  const selectClip = useStudioStore((s) => s.selectClip)
  const selectTrack = useStudioStore((s) => s.selectTrack)
  const seekBeats = useStudioStore((s) => s.seekBeats)
  const updateClip = useStudioStore((s) => s.updateClip)

  const beatsPerBar = project.timeSignature.numerator
  const playheadBeats = framesToBeats(positionFrames, project.bpm, sampleRate)

  // Always show a few bars past the last clip, so there is somewhere to
  // drag to. A timeline that ends exactly where the music does cannot be
  // extended without first extending it.
  const totalBeats = useMemo(() => {
    const end = project.tracks.reduce(
      (max, t) => Math.max(max, ...t.clips.map((c) => c.start + c.length), 0),
      0,
    )
    return Math.max(end + beatsPerBar * 4, beatsPerBar * 16)
  }, [project.tracks, beatsPerBar])

  const laneWidth = totalBeats * pixelsPerBeat
  const dragRef = useRef<{ clipId: string; trackId: string; startX: number; startBeat: number } | null>(null)

  const handleRulerClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const rect = e.currentTarget.getBoundingClientRect()
      void seekBeats(Math.max(0, (e.clientX - rect.left) / pixelsPerBeat))
    },
    [pixelsPerBeat, seekBeats],
  )

  return (
    <div className="flex min-h-0 flex-1">
      {/* Track headers. Fixed width, own scroll suppressed — they scroll
          vertically with the lanes via the shared container below. */}
      <div
        className="shrink-0 border-r border-(--border-hairline)"
        style={{ width: TRACK_PANEL_WIDTH }}
      >
        <div style={{ height: RULER_HEIGHT }} className="border-b border-(--border-hairline)" />
        <TrackList />
      </div>

      <div className="relative min-w-0 flex-1 overflow-auto">
        <div style={{ width: laneWidth }}>
          {/* Ruler */}
          <div
            onClick={handleRulerClick}
            style={{ height: RULER_HEIGHT }}
            className="sticky top-0 z-20 cursor-pointer border-b border-(--border-hairline)"
            role="slider"
            aria-label="Playhead position"
            aria-valuenow={Math.round(playheadBeats)}
            aria-valuemin={0}
            aria-valuemax={Math.round(totalBeats)}
            tabIndex={0}
          >
            <div className="absolute inset-0" style={{ background: 'var(--surface-base)' }} />
            {Array.from({ length: Math.ceil(totalBeats / beatsPerBar) + 1 }, (_, bar) => (
              <div
                key={bar}
                className="absolute top-0 bottom-0 flex items-center pl-1.5"
                style={{ left: bar * beatsPerBar * pixelsPerBeat }}
              >
                <span className="pointer-events-none absolute inset-y-0 left-0 w-px bg-white/12" />
                <span className="text-text-tertiary pointer-events-none text-2xs tabular-nums">
                  {bar + 1}
                </span>
              </div>
            ))}
          </div>

          {/* Lanes */}
          <div className="relative">
            {project.tracks.map((track) => (
              <div
                key={track.id}
                style={{ height: ROW_HEIGHTS[track.height] }}
                className="relative border-b border-(--border-hairline)"
                onDoubleClick={(e) => {
                  // Double-clicking empty lane space creates a bar-long
                  // clip there, which is how a part gets started without
                  // hunting for an "add clip" button.
                  if (e.target !== e.currentTarget) return
                  const rect = e.currentTarget.getBoundingClientRect()
                  const beat = Math.max(0, (e.clientX - rect.left) / pixelsPerBeat)
                  const store = useStudioStore.getState()
                  store.addClip(track.id, {
                    kind: 'midi',
                    id: `c-${Date.now().toString(36)}`,
                    name: 'Pattern',
                    start: Math.floor(beat / beatsPerBar) * beatsPerBar,
                    length: beatsPerBar,
                    color: track.color,
                    muted: false,
                    looped: true,
                    notes: [],
                  })
                }}
              >
                {/* Bar lines behind the clips. */}
                {Array.from({ length: Math.ceil(totalBeats / beatsPerBar) + 1 }, (_, bar) => (
                  <div
                    key={bar}
                    className="pointer-events-none absolute inset-y-0 w-px bg-white/[0.05]"
                    style={{ left: bar * beatsPerBar * pixelsPerBeat }}
                  />
                ))}

                {track.clips.map((clip) => (
                  <ClipBlock
                    key={clip.id}
                    clip={clip}
                    track={track}
                    selected={clip.id === selectedClipId}
                    pixelsPerBeat={pixelsPerBeat}
                    height={ROW_HEIGHTS[track.height]}
                    onSelect={() => {
                      selectTrack(track.id)
                      selectClip(clip.id)
                    }}
                    onDragStart={(startX) => {
                      dragRef.current = {
                        clipId: clip.id,
                        trackId: track.id,
                        startX,
                        startBeat: clip.start,
                      }
                    }}
                    onDragMove={(x) => {
                      const drag = dragRef.current
                      if (!drag || drag.clipId !== clip.id) return
                      const delta = (x - drag.startX) / pixelsPerBeat
                      // Clips snap to the bar. A clip half a beat off the
                      // grid is almost always a slip rather than an
                      // intention, and fixing one by hand is fiddly.
                      const next = Math.max(
                        0,
                        Math.round((drag.startBeat + delta) / beatsPerBar) * beatsPerBar,
                      )
                      if (next !== clip.start) updateClip(track.id, clip.id, { start: next })
                    }}
                    onDragEnd={() => {
                      dragRef.current = null
                    }}
                  />
                ))}
              </div>
            ))}

            {/* Playhead. Drawn over everything, and deliberately thin and
                bright rather than a wide translucent bar — you are reading
                its exact position against the grid. */}
            <div
              aria-hidden
              className="pointer-events-none absolute top-0 bottom-0 z-30 w-px bg-white"
              style={{ left: playheadBeats * pixelsPerBeat }}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

function ClipBlock({
  clip,
  track,
  selected,
  pixelsPerBeat,
  height,
  onSelect,
  onDragStart,
  onDragMove,
  onDragEnd,
}: {
  clip: Clip
  track: Track
  selected: boolean
  pixelsPerBeat: number
  height: number
  onSelect: () => void
  onDragStart: (startX: number) => void
  onDragMove: (x: number) => void
  onDragEnd: () => void
}) {
  const isMidi = clip.kind === 'midi'

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`${clip.name} on ${track.name}`}
      onPointerDown={(e) => {
        e.stopPropagation()
        e.currentTarget.setPointerCapture(e.pointerId)
        onSelect()
        onDragStart(e.clientX)
      }}
      onPointerMove={(e) => onDragMove(e.clientX)}
      onPointerUp={onDragEnd}
      style={{
        left: clip.start * pixelsPerBeat,
        width: Math.max(8, clip.length * pixelsPerBeat - 2),
        top: 3,
        height: height - 7,
        // The clip's own colour at low alpha, so a lane of clips reads as
        // one track without any of them shouting.
        // Clips inherit their track's colour unless given one of their
        // own, so a lane reads as a single part at a glance.
        backgroundColor: `color-mix(in srgb, ${clip.color ?? track.color} 26%, transparent)`,
        borderColor: selected ? (clip.color ?? track.color) : 'transparent',
      }}
      className={cn(
        'absolute cursor-grab overflow-hidden rounded-md border active:cursor-grabbing',
        clip.muted && 'opacity-40',
      )}
    >
      <span className="text-text-primary pointer-events-none absolute top-1 left-1.5 text-2xs">
        {clip.name}
      </span>

      {isMidi && (
        <NotePreview
          clip={clip}
          pixelsPerBeat={pixelsPerBeat}
          height={height - 7}
          color={clip.color ?? track.color}
        />
      )}
    </div>
  )
}

/**
 * Miniature of a MIDI clip's notes. Rendered as absolutely-positioned
 * divs rather than a canvas: a clip holds tens of notes, not thousands,
 * and staying in the DOM means it inherits theming and needs no redraw
 * plumbing on zoom.
 */
function NotePreview({
  clip,
  pixelsPerBeat,
  height,
  color,
}: {
  clip: MidiClip
  pixelsPerBeat: number
  height: number
  color: string
}) {
  const { low, span } = useMemo(() => {
    if (clip.notes.length === 0) return { low: 60, span: 12 }
    const pitches = clip.notes.map((n) => n.pitch)
    const min = Math.min(...pitches)
    const max = Math.max(...pitches)
    // A one-note clip would otherwise divide by zero; a floor of an
    // octave also stops a two-note part drawing as two fat bars.
    return { low: min, span: Math.max(12, max - min + 1) }
  }, [clip.notes])

  const usable = height - 14
  const rowHeight = Math.max(1.5, usable / span)

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-1 top-[14px]">
      {clip.notes.map((note) => (
        <div
          key={note.id}
          className="absolute rounded-[1px]"
          style={{
            left: note.start * pixelsPerBeat,
            width: Math.max(2, note.duration * pixelsPerBeat - 1),
            bottom: (note.pitch - low) * rowHeight,
            height: rowHeight,
            backgroundColor: color,
            opacity: 0.85,
          }}
        />
      ))}
    </div>
  )
}

export { beatsToFrames }
