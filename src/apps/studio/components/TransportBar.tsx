import { useEffect, useRef, useState } from 'react'
import {
  PlayIcon,
  PauseIcon,
  StopIcon,
  RecordIcon,
  SkipBackIcon,
  LoopIcon,
  MetronomeIcon,
} from '@/shared/icons'
import { Tooltip } from '@/shared/components/ui/tooltip'
import { cn } from '@/shared/lib/cn'
import { useStudioStore } from '../store/studioStore'
import { formatKey, NOTE_NAMES, SCALE_LABELS } from '../model/theory'
import type { ScaleName } from '../model/project'
import { formatPosition, framesToBeats } from '@/integrations/studio/client'

/**
 * The transport bar: the controls that must be reachable at every moment,
 * regardless of which view or editor is open.
 *
 * Laid out as four groups reading left to right — move (transport), time
 * (tempo and position), music (key), and health (latency and dropouts).
 * They are separated by space rather than dividers: a bar of eleven
 * controls with a rule between each group reads as a toolbar from an old
 * audio application, and the grouping is legible from proximity alone.
 *
 * Sizing follows the accessibility floor the rest of the app now uses —
 * the primary transport buttons are 44px, not the 28px an icon button
 * would default to. These are pressed constantly, often in a hurry, and
 * often while looking at something else on screen.
 */
export function TransportBar() {
  const playing = useStudioStore((s) => s.runtime.playing)
  const recording = useStudioStore((s) => s.runtime.recording)
  const positionFrames = useStudioStore((s) => s.runtime.positionFrames)
  const xruns = useStudioStore((s) => s.runtime.xruns)
  const project = useStudioStore((s) => s.project)
  const latency = useStudioStore((s) => s.latency)
  const sampleRate = useStudioStore((s) => s.sampleRate)

  const togglePlay = useStudioStore((s) => s.togglePlay)
  const stopAndRewind = useStudioStore((s) => s.stopAndRewind)
  const toggleMetronome = useStudioStore((s) => s.toggleMetronome)
  const setBpm = useStudioStore((s) => s.setBpm)
  const setKey = useStudioStore((s) => s.setKey)
  const setLoop = useStudioStore((s) => s.setLoop)

  const [metronome, setMetronome] = useState(false)

  const beats = framesToBeats(positionFrames, project.bpm, sampleRate)
  const position = formatPosition(positionFrames, project.bpm, sampleRate, project.timeSignature.numerator)

  return (
    <div className="flex h-16 shrink-0 items-center gap-6 px-5">
      {/* Move */}
      <div className="flex items-center gap-1.5">
        <TransportButton
          label="Back to start"
          onClick={() => void stopAndRewind()}
          icon={<SkipBackIcon width={18} height={18} />}
        />
        <TransportButton
          label={playing ? 'Pause' : 'Play'}
          primary
          onClick={() => void togglePlay()}
          icon={playing ? <PauseIcon width={20} height={20} /> : <PlayIcon width={20} height={20} />}
        />
        <TransportButton
          label="Stop"
          onClick={() => void stopAndRewind()}
          icon={<StopIcon width={18} height={18} />}
        />
        <TransportButton
          label={recording ? 'Stop recording' : 'Record'}
          onClick={() => {
            /* Recording is armed per track; wired in RecordControls. */
          }}
          active={recording}
          activeTone="danger"
          icon={<RecordIcon width={18} height={18} />}
        />
      </div>

      {/* Time */}
      <div className="flex items-center gap-4">
        <TempoField bpm={project.bpm} onChange={setBpm} />

        <div className="flex flex-col">
          <span className="text-text-primary text-lg leading-none font-light tabular-nums">
            {position}
          </span>
          <span className="text-text-tertiary text-2xs tracking-wide uppercase">Bar · Beat</span>
        </div>

        <div className="flex items-center gap-1">
          <TransportButton
            label={project.loop ? 'Looping this region' : 'Loop the current region'}
            small
            active={project.loop !== null}
            onClick={() => {
              // Toggling on with no region yet loops the first eight bars —
              // a sensible unit to work in, and better than doing nothing
              // and leaving the user to wonder why the button did not stick.
              if (project.loop) setLoop(null)
              else setLoop({ start: 0, end: project.timeSignature.numerator * 8 })
            }}
            icon={<LoopIcon width={16} height={16} />}
          />
          <TransportButton
            label={metronome ? 'Click on' : 'Click off'}
            small
            active={metronome}
            onClick={() => {
              setMetronome((v) => !v)
              void toggleMetronome()
            }}
            icon={<MetronomeIcon width={16} height={16} />}
          />
        </div>
      </div>

      {/* Music */}
      <KeyField
        root={project.key.root}
        scale={project.key.scale}
        label={formatKey(project.key)}
        onChange={(root, scale) => setKey({ root, scale })}
      />

      <div className="flex-1" />

      {/* Health. Sits at the far end because it is a thing you glance at
          when something sounds wrong, not a control you reach for. */}
      <EngineHealth latencyMs={latency?.roundTripMs ?? null} rating={latency?.rating ?? null} xruns={xruns} beats={beats} />
    </div>
  )
}

function TransportButton({
  label,
  icon,
  onClick,
  primary = false,
  small = false,
  active = false,
  activeTone = 'accent',
}: {
  label: string
  icon: React.ReactNode
  onClick: () => void
  primary?: boolean
  small?: boolean
  active?: boolean
  activeTone?: 'accent' | 'danger'
}) {
  return (
    <Tooltip content={label} side="bottom">
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        aria-pressed={active || undefined}
        className={cn(
          'flex items-center justify-center rounded-xl transition-colors duration-150',
          'focus-visible:outline-accent focus-visible:outline-2 focus-visible:outline-offset-2',
          small ? 'h-9 w-9' : 'h-11 w-11',
          primary
            ? 'bg-white/12 text-white hover:bg-white/[0.18]'
            : active
              ? activeTone === 'danger'
                ? 'bg-danger/18 text-danger'
                : 'bg-accent/18 text-accent'
              : 'text-text-secondary hover:text-text-primary hover:bg-white/[0.07]',
        )}
      >
        {icon}
      </button>
    </Tooltip>
  )
}

/**
 * Tempo. Editable as text because typing "92" is faster than dragging to
 * it, but also draggable vertically, because nudging tempo by feel while
 * a loop plays is how a tempo is actually chosen.
 */
function TempoField({ bpm, onChange }: { bpm: number; onChange: (bpm: number) => void }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(String(bpm))
  const dragRef = useRef<{ y: number; bpm: number } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!editing) setDraft(String(Math.round(bpm)))
  }, [bpm, editing])

  useEffect(() => {
    if (editing) inputRef.current?.select()
  }, [editing])

  function commit() {
    const value = Number(draft)
    setEditing(false)
    if (Number.isFinite(value)) onChange(value)
    else setDraft(String(Math.round(bpm)))
  }

  return (
    <div className="flex flex-col">
      {editing ? (
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit()
            if (e.key === 'Escape') {
              setDraft(String(Math.round(bpm)))
              setEditing(false)
            }
          }}
          className="text-text-primary w-14 bg-transparent text-lg leading-none font-light tabular-nums outline-none"
          aria-label="Tempo in beats per minute"
        />
      ) : (
        <button
          type="button"
          onDoubleClick={() => setEditing(true)}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId)
            dragRef.current = { y: e.clientY, bpm }
          }}
          onPointerMove={(e) => {
            if (!dragRef.current) return
            // 3px per BPM: fine enough to land on a value, coarse enough
            // to cross a useful range without a long drag.
            const delta = (dragRef.current.y - e.clientY) / 3
            onChange(dragRef.current.bpm + delta)
          }}
          onPointerUp={() => {
            dragRef.current = null
          }}
          className="text-text-primary w-14 cursor-ns-resize text-left text-lg leading-none font-light tabular-nums"
          title="Drag to change tempo, double-click to type"
        >
          {Math.round(bpm)}
        </button>
      )}
      <span className="text-text-tertiary text-2xs tracking-wide uppercase">BPM</span>
    </div>
  )
}

/**
 * Key and scale. Presented together because they are one musical fact —
 * "A minor", not "A" and "minor" — and because every helper that uses
 * them (scale highlighting, chord pads, melody generation) needs both.
 */
function KeyField({
  root,
  scale,
  label,
  onChange,
}: {
  root: number
  scale: ScaleName
  label: string
  onChange: (root: number, scale: ScaleName) => void
}) {
  const [open, setOpen] = useState(false)

  return (
    <div className="relative flex flex-col">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="text-text-primary text-left text-lg leading-none font-light"
      >
        {label}
      </button>
      <span className="text-text-tertiary text-2xs tracking-wide uppercase">Key</span>

      {open && (
        <>
          {/* Click-away catcher. A menu this small does not warrant a
              portal and focus trap, but it must still close when the user
              looks elsewhere. */}
          <button
            type="button"
            aria-hidden
            tabIndex={-1}
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div
            className="border-hairline absolute top-full left-0 z-50 mt-2 flex gap-2 rounded-xl border p-2"
            style={{
              background: 'var(--surface-overlay)',
              boxShadow: 'var(--shadow-overlay)',
            }}
          >
            <div className="grid grid-cols-3 gap-0.5">
              {NOTE_NAMES.map((name, index) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => onChange(index, scale)}
                  className={cn(
                    'rounded-md px-2 py-1 text-xs transition-colors',
                    index === root
                      ? 'bg-accent/20 text-accent'
                      : 'text-text-secondary hover:text-text-primary hover:bg-white/[0.07]',
                  )}
                >
                  {name}
                </button>
              ))}
            </div>
            <div className="bg-border-hairline w-px" />
            <div className="flex max-h-56 flex-col gap-0.5 overflow-y-auto pr-1">
              {(Object.keys(SCALE_LABELS) as ScaleName[]).map((name) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => onChange(root, name)}
                  className={cn(
                    'rounded-md px-2.5 py-1 text-left text-xs whitespace-nowrap transition-colors',
                    name === scale
                      ? 'bg-accent/20 text-accent'
                      : 'text-text-secondary hover:text-text-primary hover:bg-white/[0.07]',
                  )}
                >
                  {SCALE_LABELS[name]}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

/**
 * Latency and dropout readout.
 *
 * Dropouts are shown only once they have actually happened. A permanent
 * "0 dropouts" counter trains the user to ignore the number, which is
 * precisely the wrong instinct for the one indicator that means "your
 * audio is broken, raise your buffer size".
 */
function EngineHealth({
  latencyMs,
  rating,
  xruns,
  beats,
}: {
  latencyMs: number | null
  rating: 'good' | 'ok' | 'high' | null
  xruns: number
  beats: number
}) {
  return (
    <div className="flex items-center gap-4">
      {xruns > 0 && (
        <Tooltip content="Audio dropouts detected. Raise the buffer size in Audio Settings." side="bottom">
          <span className="text-danger flex items-center gap-1.5 text-xs tabular-nums">
            <span className="bg-danger h-1.5 w-1.5 rounded-full" />
            {xruns} dropout{xruns === 1 ? '' : 's'}
          </span>
        </Tooltip>
      )}

      {latencyMs !== null && (
        <Tooltip
          content={
            rating === 'good'
              ? 'Low enough to play and record comfortably.'
              : rating === 'ok'
                ? 'Fine for mixing; you may feel a delay while playing.'
                : 'High. Lower the buffer size before recording.'
          }
          side="bottom"
        >
          <span
            className={cn(
              'text-xs tabular-nums',
              rating === 'high' ? 'text-danger' : 'text-text-tertiary',
            )}
          >
            {latencyMs.toFixed(1)} ms
          </span>
        </Tooltip>
      )}

      <span className="text-text-tertiary hidden text-xs tabular-nums lg:inline">
        {beats.toFixed(1)} beats
      </span>
    </div>
  )
}
