import { useCallback, useMemo, useRef } from 'react'
import { cn } from '@/shared/lib/cn'
import { useStudioStore } from '../store/studioStore'
import { instrumentById } from '../instruments/definitions'
import type { MidiClip, Note, Track } from '../model/project'

/**
 * The drum step sequencer: a grid of rows (one per drum sound) by steps
 * (one per sixteenth note).
 *
 * This is the single most important input surface in Studio, because it
 * is the one that needs no musical knowledge and no MIDI hardware. A
 * beginner making their first beat will do it here. Everything else —
 * piano roll, chord pads — assumes at least the idea of pitch; this
 * assumes only that you can hear a pattern.
 *
 * ## Why steps are toggled, not drawn
 * A step is on or off, and clicking it flips it. Drag-painting is
 * supported (press and sweep sets a run of steps to whatever the first
 * one became) because programming a hi-hat line one click at a time is
 * tedious, but the mental model stays "this step, on or off" rather than
 * "draw a note of some length", which is what a piano roll is for.
 *
 * ## Velocity without a second mode
 * Real drum programming needs accents — a hat pattern with every hit at
 * full velocity sounds like a machine, which is why every drum machine
 * has velocity. But a separate velocity lane doubles the interface for
 * something beginners never touch. Here a step has three levels, cycled
 * by right-click or shift-click, shown by fill strength. It is
 * discoverable through the tooltip, ignorable, and enough.
 */

/** Steps shown at once. Sixteen sixteenths is one bar of 4/4 — the unit
 * drum patterns are actually written in. */
const STEPS = 16

/** Beats per step. A sixteenth note. */
const STEP_BEATS = 0.25

/** The three velocity levels a step cycles through. Ghost notes at 0.35
 * are audibly softer without vanishing; accents at 1.0 cut through. */
const VELOCITY_LEVELS = [0.7, 1.0, 0.35] as const

interface StepSequencerProps {
  track: Track
  clip: MidiClip
}

export function StepSequencer({ track, clip }: StepSequencerProps) {
  const setNotes = useStudioStore((s) => s.setNotes)
  const positionFrames = useStudioStore((s) => s.runtime.positionFrames)
  const playing = useStudioStore((s) => s.runtime.playing)
  const bpm = useStudioStore((s) => s.project.bpm)
  const sampleRate = useStudioStore((s) => s.sampleRate)

  const def = track.instrumentId ? instrumentById(track.instrumentId) : undefined
  const rows = def?.drumMap ?? []

  // Paint state for drag-toggling. Held in a ref rather than state: it
  // changes on every pointermove and re-rendering a 16x8 grid at pointer
  // rate for a value nothing displays would be pure waste.
  const paintRef = useRef<{ active: boolean; value: boolean } | null>(null)

  /** Notes indexed by "pitch:step" for O(1) lookup while rendering. */
  const grid = useMemo(() => {
    const map = new Map<string, Note>()
    for (const note of clip.notes) {
      const step = Math.round(note.start / STEP_BEATS)
      map.set(`${note.pitch}:${step}`, note)
    }
    return map
  }, [clip.notes])

  const playingStep = useMemo(() => {
    if (!playing) return -1
    const framesPerBeat = (60 / bpm) * sampleRate
    const beat = positionFrames / framesPerBeat
    // Relative to the clip's placement, wrapped to the pattern length, so
    // the indicator tracks a looped one-bar pattern correctly.
    const withinClip = beat - clip.start
    if (withinClip < 0) return -1
    return Math.floor(withinClip / STEP_BEATS) % STEPS
  }, [playing, positionFrames, bpm, sampleRate, clip.start])

  const writeStep = useCallback(
    (pitch: number, step: number, on: boolean, velocity?: number) => {
      const key = `${pitch}:${step}`
      const existing = grid.get(key)
      let next: Note[]

      if (!on) {
        next = clip.notes.filter((n) => n.id !== existing?.id)
      } else if (existing) {
        next = clip.notes.map((n) =>
          n.id === existing.id ? { ...n, velocity: velocity ?? n.velocity } : n,
        )
      } else {
        next = [
          ...clip.notes,
          {
            id: `${pitch}-${step}-${Date.now().toString(36)}`,
            pitch,
            start: step * STEP_BEATS,
            // Drums are one-shots: the sample plays to its own end
            // regardless of note length, so a short fixed duration keeps
            // the data honest rather than implying a sustain that is not
            // there.
            duration: STEP_BEATS,
            velocity: velocity ?? VELOCITY_LEVELS[0],
          },
        ]
      }
      setNotes(track.id, clip.id, next)
    },
    [clip.notes, clip.id, grid, setNotes, track.id],
  )

  if (rows.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-text-tertiary text-sm">
          This track's instrument has no drum sounds to sequence.
        </p>
      </div>
    )
  }

  return (
    <div
      className="flex min-h-0 flex-1 flex-col overflow-auto p-4"
      onPointerUp={() => {
        paintRef.current = null
      }}
      onPointerLeave={() => {
        paintRef.current = null
      }}
    >
      {/* Step numbers. Only beats are labelled — numbering all sixteen
          makes a wall of digits that nobody reads, whereas marking 1/2/3/4
          gives the eye the downbeats it actually navigates by. */}
      <div className="mb-1.5 flex gap-1 pl-28">
        {Array.from({ length: STEPS }, (_, step) => (
          <div key={step} className="flex-1 text-center">
            <span
              className={cn(
                'text-2xs tabular-nums',
                step % 4 === 0 ? 'text-text-secondary' : 'text-transparent',
              )}
            >
              {step / 4 + 1}
            </span>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-1">
        {rows.map((row) => (
          <div key={row.pitch} className="flex items-center gap-1">
            <div className="flex w-28 shrink-0 items-center gap-2 pr-2">
              <span className="text-text-secondary truncate text-xs">{row.name}</span>
            </div>

            {Array.from({ length: STEPS }, (_, step) => {
              const note = grid.get(`${row.pitch}:${step}`)
              const on = note !== undefined
              const isDownbeat = step % 4 === 0
              const isCurrent = step === playingStep

              return (
                <button
                  key={step}
                  type="button"
                  aria-label={`${row.name}, step ${step + 1}${on ? ', on' : ', off'}`}
                  aria-pressed={on}
                  title={
                    on
                      ? 'Click to clear · shift-click or right-click to change accent'
                      : 'Click to add'
                  }
                  onPointerDown={(e) => {
                    if (e.button === 2) return
                    if (e.shiftKey && note) {
                      // Cycle accent rather than clearing.
                      const index = VELOCITY_LEVELS.indexOf(
                        note.velocity as (typeof VELOCITY_LEVELS)[number],
                      )
                      const nextLevel =
                        VELOCITY_LEVELS[(index + 1 + VELOCITY_LEVELS.length) % VELOCITY_LEVELS.length]
                      writeStep(row.pitch, step, true, nextLevel)
                      return
                    }
                    const value = !on
                    paintRef.current = { active: true, value }
                    writeStep(row.pitch, step, value)
                  }}
                  onPointerEnter={() => {
                    const paint = paintRef.current
                    if (!paint?.active) return
                    if (paint.value === on) return
                    writeStep(row.pitch, step, paint.value)
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    if (!note) return
                    const index = VELOCITY_LEVELS.indexOf(
                      note.velocity as (typeof VELOCITY_LEVELS)[number],
                    )
                    writeStep(
                      row.pitch,
                      step,
                      true,
                      VELOCITY_LEVELS[(index + 1) % VELOCITY_LEVELS.length],
                    )
                  }}
                  className={cn(
                    'h-9 flex-1 rounded-md border transition-[background-color,border-color,transform] duration-100',
                    'focus-visible:outline-accent focus-visible:outline-2 focus-visible:outline-offset-1',
                    // The playhead column is marked by a border rather
                    // than a fill, so it never obscures whether a step is
                    // on — which is the thing you are reading while it
                    // plays.
                    isCurrent ? 'border-white/45' : 'border-transparent',
                    on
                      ? 'bg-accent'
                      : isDownbeat
                        ? 'bg-white/[0.09] hover:bg-white/[0.14]'
                        : 'bg-white/[0.04] hover:bg-white/[0.09]',
                  )}
                  style={
                    on
                      ? {
                          // Velocity as opacity: a ghost note reads as a
                          // faint step, an accent as a solid one, with no
                          // extra lane to look at.
                          opacity: 0.45 + (note?.velocity ?? 1) * 0.55,
                        }
                      : undefined
                  }
                />
              )
            })}
          </div>
        ))}
      </div>

      <p className="text-text-tertiary mt-4 pl-28 text-2xs">
        Click to toggle · drag to paint a run · shift-click or right-click an active step to change
        its accent
      </p>
    </div>
  )
}
