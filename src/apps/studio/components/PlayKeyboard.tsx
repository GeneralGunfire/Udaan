import { useCallback, useEffect, useRef, useState } from 'react'
import { cn } from '@/shared/lib/cn'
import { useStudioStore } from '../store/studioStore'
import { isBlackKey, isInScale, noteName } from '../model/theory'
import { slotForPitch } from '../instruments/instrumentLoader'
import * as engine from '@/integrations/studio/client'
import type { Track } from '../model/project'

/**
 * On-screen keyboard, playable by mouse or computer keyboard.
 *
 * This is not a convenience feature. Most people opening Studio own no
 * MIDI controller, so this is *the* way instruments get played, and it is
 * built as a first-class surface rather than a fallback: the computer
 * keyboard mapping is the standard tracker/DAW layout, octaves shift with
 * Z and X, and notes in the project key are marked so a beginner can find
 * something that sounds right without knowing what a scale is.
 *
 * ## Why keys are held rather than triggered
 * A note-on with no note-off gives every instrument an infinite sustain,
 * which sounds broken on anything with a release. Held state is tracked
 * per pitch and released on key-up, pointer-up, and — importantly — on
 * window blur, because a keyboard held down when you alt-tab away would
 * otherwise sound forever with no way to stop it.
 */

/** The standard two-row layout: home row is the white keys of an octave,
 * the row above holds the black keys in their physical positions. */
const KEY_MAP: Record<string, number> = {
  KeyA: 0,
  KeyW: 1,
  KeyS: 2,
  KeyE: 3,
  KeyD: 4,
  KeyF: 5,
  KeyT: 6,
  KeyG: 7,
  KeyY: 8,
  KeyH: 9,
  KeyU: 10,
  KeyJ: 11,
  KeyK: 12,
  KeyO: 13,
  KeyL: 14,
  KeyP: 15,
  Semicolon: 16,
}

const WHITE_SEMITONES = [0, 2, 4, 5, 7, 9, 11]

export function PlayKeyboard({ track }: { track: Track }) {
  const key = useStudioStore((s) => s.project.key)
  const [octave, setOctave] = useState(4)
  const [held, setHeld] = useState<Set<number>>(new Set())
  const heldRef = useRef<Set<number>>(new Set())

  const noteOn = useCallback(
    (pitch: number) => {
      if (heldRef.current.has(pitch)) return
      heldRef.current.add(pitch)
      setHeld(new Set(heldRef.current))
      if (!track.instrumentId) return
      const sample = slotForPitch(track.instrumentId, pitch)
      if (sample === null) return
      void engine.live.noteOn(track.slot, pitch, 0.8, sample).catch(() => {})
    },
    [track.instrumentId, track.slot],
  )

  const noteOff = useCallback(
    (pitch: number) => {
      if (!heldRef.current.delete(pitch)) return
      setHeld(new Set(heldRef.current))
      void engine.live.noteOff(track.slot, pitch).catch(() => {})
    },
    [track.slot],
  )

  const releaseAll = useCallback(() => {
    for (const pitch of [...heldRef.current]) noteOff(pitch)
  }, [noteOff])

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      ) {
        return
      }
      // Auto-repeat would re-trigger the note dozens of times a second.
      if (e.repeat) return

      if (e.code === 'KeyZ') {
        setOctave((o) => Math.max(0, o - 1))
        return
      }
      if (e.code === 'KeyX') {
        setOctave((o) => Math.min(8, o + 1))
        return
      }

      const offset = KEY_MAP[e.code]
      if (offset === undefined) return
      e.preventDefault()
      noteOn(octave * 12 + 12 + offset)
    }

    function onKeyUp(e: KeyboardEvent) {
      const offset = KEY_MAP[e.code]
      if (offset === undefined) return
      noteOff(octave * 12 + 12 + offset)
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    // A held key when focus leaves the window never produces a keyup, so
    // the note would sound indefinitely.
    window.addEventListener('blur', releaseAll)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', releaseAll)
      releaseAll()
    }
  }, [octave, noteOn, noteOff, releaseAll])

  // Two octaves, matching the computer-keyboard span so what you see is
  // what the keys play.
  const lowPitch = octave * 12 + 12
  const whites: number[] = []
  const blacks: { pitch: number; offset: number }[] = []
  for (let i = 0; i < 15; i += 1) {
    const semitone = WHITE_SEMITONES[i % 7] + Math.floor(i / 7) * 12
    whites.push(lowPitch + semitone)
  }
  for (let i = 0; i < whites.length - 1; i += 1) {
    const next = whites[i] + 1
    if (isBlackKey(next)) blacks.push({ pitch: next, offset: i })
  }

  return (
    <div className="flex flex-col gap-2 p-3">
      <div className="flex items-center justify-between">
        <span className="text-text-tertiary text-2xs">
          Play with your keyboard — A to L for white keys, W E T Y U for black. Z and X change
          octave.
        </span>
        <div className="flex items-center gap-1">
          <OctaveButton label="Octave down" onClick={() => setOctave((o) => Math.max(0, o - 1))}>
            −
          </OctaveButton>
          <span className="text-text-secondary w-10 text-center text-xs tabular-nums">
            C{octave}
          </span>
          <OctaveButton label="Octave up" onClick={() => setOctave((o) => Math.min(8, o + 1))}>
            +
          </OctaveButton>
        </div>
      </div>

      <div
        className="relative h-24 select-none"
        onPointerLeave={releaseAll}
        onPointerUp={releaseAll}
      >
        {whites.map((pitch, index) => {
          const inScale = isInScale(pitch, key)
          const isHeld = held.has(pitch)
          return (
            <button
              key={pitch}
              type="button"
              aria-label={noteName(pitch)}
              onPointerDown={() => noteOn(pitch)}
              onPointerEnter={(e) => {
                // Glissando: sweeping with the button down plays across
                // the keys, the way a hand does on a real keyboard.
                if (e.buttons === 1) noteOn(pitch)
              }}
              onPointerUp={() => noteOff(pitch)}
              style={{
                left: `${(index / whites.length) * 100}%`,
                width: `${(1 / whites.length) * 100}%`,
              }}
              className={cn(
                'absolute top-0 bottom-0 rounded-b-md border-r border-black/40 transition-colors duration-75',
                isHeld ? 'bg-accent' : inScale ? 'bg-white/85 hover:bg-white' : 'bg-white/45 hover:bg-white/65',
              )}
            >
              <span className="absolute inset-x-0 bottom-1 text-center text-3xs text-black/45">
                {pitch % 12 === 0 ? noteName(pitch) : ''}
              </span>
            </button>
          )
        })}

        {blacks.map(({ pitch, offset }) => {
          const isHeld = held.has(pitch)
          const inScale = isInScale(pitch, key)
          return (
            <button
              key={pitch}
              type="button"
              aria-label={noteName(pitch)}
              onPointerDown={(e) => {
                e.stopPropagation()
                noteOn(pitch)
              }}
              onPointerEnter={(e) => {
                if (e.buttons === 1) noteOn(pitch)
              }}
              onPointerUp={() => noteOff(pitch)}
              style={{
                left: `calc(${((offset + 1) / whites.length) * 100}% - ${100 / whites.length / 3.2}%)`,
                width: `${(1 / whites.length) * 64}%`,
              }}
              className={cn(
                'absolute top-0 z-10 h-[62%] rounded-b-md transition-colors duration-75',
                isHeld ? 'bg-accent' : inScale ? 'bg-black hover:bg-surface-overlay' : 'bg-black/70 hover:bg-surface-overlay/80',
              )}
            />
          )
        })}
      </div>
    </div>
  )
}

function OctaveButton({
  label,
  onClick,
  children,
}: {
  label: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="text-text-secondary hover:text-text-primary flex h-6 w-6 items-center justify-center rounded text-sm transition-colors hover:bg-white/[0.08]"
    >
      {children}
    </button>
  )
}
