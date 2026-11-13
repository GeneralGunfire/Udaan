import { useCallback, useMemo, useRef, useState } from 'react'
import { cn } from '@/shared/lib/cn'
import { useStudioStore } from '../store/studioStore'
import { isBlackKey, isInScale, noteName } from '../model/theory'
import type { MidiClip, Note, Track } from '../model/project'

/**
 * The piano roll: notes as rectangles on a pitch-by-time grid.
 *
 * ## Scale highlighting is the beginner feature that matters most
 * Rows outside the project key are dimmed. That single cue turns "which
 * of these 88 notes sound right together" — the question that stops most
 * beginners — into something you can see. It is not a constraint: any
 * note can still be drawn, because a scale is a starting point and not a
 * rule, and locking users out of chromatic notes would make the tool
 * lie about music.
 *
 * ## Why row height is fixed and pitch range is windowed
 * Rendering 128 pitches at a readable height is a 4000px-tall element
 * that must scroll, and most of it is empty for any real part. The roll
 * shows a two-octave window around the notes actually present (or around
 * middle C for an empty clip), which keeps the useful range on screen
 * without a scroll hunt.
 */

const ROW_HEIGHT = 18
/** Pitches visible at once. Two octaves plus a note, so both a root and
 * its octave are reachable without scrolling. */
const VISIBLE_PITCHES = 25

interface PianoRollProps {
  track: Track
  clip: MidiClip
}

export function PianoRoll({ track, clip }: PianoRollProps) {
  const setNotes = useStudioStore((s) => s.setNotes)
  const snap = useStudioStore((s) => s.snap)
  const pixelsPerBeat = useStudioStore((s) => s.pixelsPerBeat)
  const key = useStudioStore((s) => s.project.key)
  const tool = useStudioStore((s) => s.tool)
  const beatsPerBar = useStudioStore((s) => s.project.timeSignature.numerator)

  const [scrollPitch, setScrollPitch] = useState<number | null>(null)
  const dragRef = useRef<{ noteId: string; mode: 'move' | 'resize'; startX: number; startY: number; original: Note } | null>(null)

  // Centre the window on the clip's own content so opening a bass part
  // does not show a treble range with everything below the fold.
  const lowPitch = useMemo(() => {
    if (scrollPitch !== null) return scrollPitch
    if (clip.notes.length === 0) return 60 - Math.floor(VISIBLE_PITCHES / 2)
    const pitches = clip.notes.map((n) => n.pitch)
    const centre = Math.round((Math.min(...pitches) + Math.max(...pitches)) / 2)
    return Math.max(0, centre - Math.floor(VISIBLE_PITCHES / 2))
  }, [clip.notes, scrollPitch])

  const pitches = useMemo(
    () => Array.from({ length: VISIBLE_PITCHES }, (_, i) => lowPitch + VISIBLE_PITCHES - 1 - i),
    [lowPitch],
  )

  const snapBeats = useCallback((beats: number) => Math.round(beats / snap) * snap, [snap])

  const addNote = useCallback(
    (pitch: number, startBeats: number) => {
      const note: Note = {
        id: `n-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        pitch,
        start: Math.max(0, snapBeats(startBeats)),
        duration: snap,
        velocity: 0.8,
      }
      setNotes(track.id, clip.id, [...clip.notes, note])
    },
    [clip.id, clip.notes, setNotes, snap, snapBeats, track.id],
  )

  const gridWidth = clip.length * pixelsPerBeat

  return (
    <div className="flex min-h-0 flex-1">
      {/* Keyboard. Doubles as the pitch legend and as a way to audition a
          row before writing to it. */}
      <div className="w-16 shrink-0 overflow-hidden border-r border-(--border-hairline)">
        {pitches.map((pitch) => {
          const black = isBlackKey(pitch)
          const inScale = isInScale(pitch, key)
          return (
            <button
              key={pitch}
              type="button"
              aria-label={noteName(pitch)}
              style={{ height: ROW_HEIGHT }}
              className={cn(
                'flex w-full items-center justify-end pr-2 text-2xs transition-colors',
                black ? 'bg-black/40' : 'bg-white/[0.06]',
                inScale ? 'text-text-secondary' : 'text-text-tertiary/50',
                'hover:bg-white/[0.14]',
              )}
            >
              {/* Only C is labelled. Naming every row turns the keyboard
                  into a column of text; one label per octave is how a
                  player finds their place. */}
              {pitch % 12 === 0 ? noteName(pitch) : ''}
            </button>
          )
        })}
      </div>

      {/* Note grid */}
      <div
        className="relative min-w-0 flex-1 overflow-auto"
        onWheel={(e) => {
          // Vertical wheel moves the pitch window rather than scrolling a
          // container, so the keyboard and grid can never drift apart.
          if (e.shiftKey) return
          const delta = e.deltaY > 0 ? -2 : 2
          setScrollPitch(Math.max(0, Math.min(127 - VISIBLE_PITCHES, lowPitch + delta)))
        }}
      >
        <div className="relative" style={{ width: gridWidth, height: pitches.length * ROW_HEIGHT }}>
          {/* Rows */}
          {pitches.map((pitch, index) => {
            const inScale = isInScale(pitch, key)
            return (
              <div
                key={pitch}
                onPointerDown={(e) => {
                  if (tool === 'erase') return
                  const rect = e.currentTarget.getBoundingClientRect()
                  addNote(pitch, (e.clientX - rect.left) / pixelsPerBeat)
                }}
                style={{ top: index * ROW_HEIGHT, height: ROW_HEIGHT }}
                className={cn(
                  'absolute inset-x-0 border-b border-white/[0.03]',
                  // Out-of-scale rows recede. This is the whole feature:
                  // the notes that will sound right are simply the ones
                  // that look brighter.
                  inScale ? 'bg-transparent' : 'bg-black/25',
                )}
              />
            )
          })}

          {/* Bar lines. Drawn over the rows so they read as one grid
              rather than as stripes inside each row. */}
          {Array.from({ length: Math.ceil(clip.length / beatsPerBar) + 1 }, (_, bar) => (
            <div
              key={bar}
              className="pointer-events-none absolute inset-y-0 w-px bg-white/[0.10]"
              style={{ left: bar * beatsPerBar * pixelsPerBeat }}
            />
          ))}
          {Array.from({ length: Math.ceil(clip.length / snap) + 1 }, (_, i) => (
            <div
              key={`s${i}`}
              className="pointer-events-none absolute inset-y-0 w-px bg-white/[0.03]"
              style={{ left: i * snap * pixelsPerBeat }}
            />
          ))}

          {/* Notes */}
          {clip.notes.map((note) => {
            const rowIndex = pitches.indexOf(note.pitch)
            if (rowIndex === -1) return null
            return (
              <div
                key={note.id}
                role="button"
                tabIndex={0}
                aria-label={`${noteName(note.pitch)} at beat ${note.start.toFixed(2)}`}
                onPointerDown={(e) => {
                  e.stopPropagation()
                  if (tool === 'erase') {
                    setNotes(
                      track.id,
                      clip.id,
                      clip.notes.filter((n) => n.id !== note.id),
                    )
                    return
                  }
                  const rect = e.currentTarget.getBoundingClientRect()
                  // The last 6px of a note resizes it; anywhere else moves
                  // it. A separate resize tool would mean a mode switch for
                  // the most common edit there is.
                  const mode = e.clientX > rect.right - 6 ? 'resize' : 'move'
                  e.currentTarget.setPointerCapture(e.pointerId)
                  dragRef.current = {
                    noteId: note.id,
                    mode,
                    startX: e.clientX,
                    startY: e.clientY,
                    original: note,
                  }
                }}
                onPointerMove={(e) => {
                  const drag = dragRef.current
                  if (!drag || drag.noteId !== note.id) return
                  const dxBeats = (e.clientX - drag.startX) / pixelsPerBeat
                  const dRows = Math.round((e.clientY - drag.startY) / ROW_HEIGHT)

                  const updated: Note =
                    drag.mode === 'resize'
                      ? {
                          ...drag.original,
                          duration: Math.max(snap, snapBeats(drag.original.duration + dxBeats)),
                        }
                      : {
                          ...drag.original,
                          start: Math.max(0, snapBeats(drag.original.start + dxBeats)),
                          pitch: Math.max(0, Math.min(127, drag.original.pitch - dRows)),
                        }
                  setNotes(
                    track.id,
                    clip.id,
                    clip.notes.map((n) => (n.id === note.id ? updated : n)),
                  )
                }}
                onPointerUp={() => {
                  dragRef.current = null
                }}
                onKeyDown={(e) => {
                  if (e.key !== 'Delete' && e.key !== 'Backspace') return
                  e.preventDefault()
                  setNotes(
                    track.id,
                    clip.id,
                    clip.notes.filter((n) => n.id !== note.id),
                  )
                }}
                style={{
                  top: rowIndex * ROW_HEIGHT + 1,
                  height: ROW_HEIGHT - 2,
                  left: note.start * pixelsPerBeat,
                  width: Math.max(4, note.duration * pixelsPerBeat - 1),
                  backgroundColor: track.color,
                  opacity: 0.55 + note.velocity * 0.45,
                }}
                className="absolute cursor-grab rounded-sm active:cursor-grabbing"
              />
            )
          })}
        </div>
      </div>
    </div>
  )
}
