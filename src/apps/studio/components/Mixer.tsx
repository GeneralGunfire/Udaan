import { useCallback, useRef } from 'react'
import { cn } from '@/shared/lib/cn'
import { useStudioStore } from '../store/studioStore'
import { gainToDb, dbToGain } from '@/integrations/studio/client'
import type { Track } from '../model/project'

/**
 * The mixer: one channel strip per track, plus the master.
 *
 * Levels are set here rather than in the track headers because balancing
 * is inherently comparative — you set a kick against a bass, not in
 * isolation — and that only works when the faders are side by side at
 * the same scale.
 *
 * ## Faders are dB-scaled, not linear
 * A linear fader spends most of its travel in a range nobody uses: half
 * way is -6dB in gain terms, so the entire useful mixing region between
 * -12dB and 0dB is squeezed into the top fifth. Mapping travel to
 * decibels puts unity around three-quarters up and gives real resolution
 * where the hand actually works.
 */

/** Fader range in dB. -60 reads as silence; +6 is enough headroom to
 * push a quiet part without inviting clipping. */
const MIN_DB = -60
const MAX_DB = 6

function dbToFraction(db: number): number {
  return (db - MIN_DB) / (MAX_DB - MIN_DB)
}

function fractionToDb(fraction: number): number {
  return MIN_DB + fraction * (MAX_DB - MIN_DB)
}

export function Mixer() {
  const tracks = useStudioStore((s) => s.project.tracks)
  const masterGain = useStudioStore((s) => s.project.masterGain)
  const masterLevel = useStudioStore((s) => s.runtime.masterLevel)
  const selectedTrackId = useStudioStore((s) => s.selectedTrackId)
  const updateTrack = useStudioStore((s) => s.updateTrack)
  const selectTrack = useStudioStore((s) => s.selectTrack)
  const setMasterGain = useStudioStore((s) => s.setMasterGain)

  const anySoloed = tracks.some((t) => t.soloed)

  return (
    <div className="flex min-h-0 flex-1 gap-px overflow-x-auto p-3">
      {tracks.map((track) => (
        <ChannelStrip
          key={track.id}
          track={track}
          selected={track.id === selectedTrackId}
          dimmed={anySoloed && !track.soloed}
          onSelect={() => selectTrack(track.id)}
          onUpdate={(patch) => updateTrack(track.id, patch)}
        />
      ))}

      <div className="bg-border-hairline mx-2 w-px shrink-0" />

      <MasterStrip gain={masterGain} level={masterLevel} onGain={setMasterGain} />
    </div>
  )
}

function ChannelStrip({
  track,
  selected,
  dimmed,
  onSelect,
  onUpdate,
}: {
  track: Track
  selected: boolean
  dimmed: boolean
  onSelect: () => void
  onUpdate: (patch: Partial<Track>) => void
}) {
  return (
    <div
      onClick={onSelect}
      className={cn(
        'flex w-[88px] shrink-0 flex-col items-center gap-2 rounded-lg px-2 py-2.5 transition-colors',
        selected ? 'bg-white/[0.06]' : 'hover:bg-white/[0.03]',
        dimmed && 'opacity-45',
      )}
    >
      <div className="flex w-full items-center gap-1.5">
        <span
          aria-hidden
          className="h-2 w-2 shrink-0 rounded-full"
          style={{ backgroundColor: track.color }}
        />
        <span className="text-text-secondary min-w-0 flex-1 truncate text-2xs">{track.name}</span>
      </div>

      <Fader
        gain={track.gain}
        label={`${track.name} level`}
        onChange={(gain) => onUpdate({ gain })}
      />

      <PanKnob pan={track.pan} onChange={(pan) => onUpdate({ pan })} />

      <div className="flex gap-1">
        <MiniToggle
          letter="M"
          label={`Mute ${track.name}`}
          active={track.muted}
          tone="neutral"
          onClick={() => onUpdate({ muted: !track.muted })}
        />
        <MiniToggle
          letter="S"
          label={`Solo ${track.name}`}
          active={track.soloed}
          tone="accent"
          onClick={() => onUpdate({ soloed: !track.soloed })}
        />
      </div>
    </div>
  )
}

function MasterStrip({
  gain,
  level,
  onGain,
}: {
  gain: number
  level: { left: number; right: number }
  onGain: (gain: number) => void
}) {
  return (
    <div className="flex w-[88px] shrink-0 flex-col items-center gap-2 px-2 py-2.5">
      <span className="text-text-secondary text-2xs font-semibold tracking-wide uppercase">
        Master
      </span>
      <div className="flex items-end gap-1.5">
        <Fader gain={gain} label="Master level" onChange={onGain} />
        <StereoMeter left={level.left} right={level.right} />
      </div>
    </div>
  )
}

/**
 * Vertical fader. Drag anywhere on the track, not only on the handle —
 * requiring the user to grab a 12px cap is a needless precision test for
 * the control they touch most.
 */
function Fader({
  gain,
  label,
  onChange,
}: {
  gain: number
  label: string
  onChange: (gain: number) => void
}) {
  const trackRef = useRef<HTMLDivElement>(null)
  const draggingRef = useRef(false)

  const setFromPointer = useCallback(
    (clientY: number) => {
      const rect = trackRef.current?.getBoundingClientRect()
      if (!rect) return
      const fraction = 1 - (clientY - rect.top) / rect.height
      const db = fractionToDb(Math.max(0, Math.min(1, fraction)))
      onChange(db <= MIN_DB ? 0 : dbToGain(db))
    },
    [onChange],
  )

  const db = gain <= 0 ? MIN_DB : gainToDb(gain)
  const fraction = Math.max(0, Math.min(1, dbToFraction(db)))

  return (
    <div className="flex flex-col items-center gap-1">
      <div
        ref={trackRef}
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuenow={Math.round(db)}
        aria-valuemin={MIN_DB}
        aria-valuemax={MAX_DB}
        aria-valuetext={db <= MIN_DB ? 'Silent' : `${db.toFixed(1)} decibels`}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          draggingRef.current = true
          setFromPointer(e.clientY)
        }}
        onPointerMove={(e) => {
          if (draggingRef.current) setFromPointer(e.clientY)
        }}
        onPointerUp={() => {
          draggingRef.current = false
        }}
        onKeyDown={(e) => {
          const step = e.shiftKey ? 0.5 : 2
          if (e.key === 'ArrowUp') onChange(dbToGain(Math.min(MAX_DB, db + step)))
          else if (e.key === 'ArrowDown') {
            const next = db - step
            onChange(next <= MIN_DB ? 0 : dbToGain(next))
          } else return
          e.preventDefault()
        }}
        className="relative h-32 w-6 cursor-ns-resize rounded-full bg-white/[0.06] focus-visible:outline-accent focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        {/* Unity mark. A fader with no reference point gives the hand
            nothing to return to; 0dB is the position everything is set
            relative to. */}
        <span
          aria-hidden
          className="absolute inset-x-1 h-px bg-white/25"
          style={{ bottom: `${dbToFraction(0) * 100}%` }}
        />
        <span
          aria-hidden
          className="absolute inset-x-0 bottom-0 rounded-full bg-white/[0.14]"
          style={{ height: `${fraction * 100}%` }}
        />
        <span
          aria-hidden
          className="absolute inset-x-[-2px] h-2.5 rounded-sm bg-white shadow-[0_1px_4px_rgb(0_0_0/50%)]"
          style={{ bottom: `calc(${fraction * 100}% - 5px)` }}
        />
      </div>
      <span className="text-text-tertiary text-2xs tabular-nums">
        {db <= MIN_DB ? '-∞' : `${db > 0 ? '+' : ''}${db.toFixed(1)}`}
      </span>
    </div>
  )
}

function PanKnob({ pan, onChange }: { pan: number; onChange: (pan: number) => void }) {
  const dragRef = useRef<{ x: number; pan: number } | null>(null)

  return (
    <div className="flex w-full flex-col items-center gap-0.5">
      <div
        role="slider"
        tabIndex={0}
        aria-label="Pan"
        aria-valuenow={Math.round(pan * 100)}
        aria-valuemin={-100}
        aria-valuemax={100}
        aria-valuetext={pan === 0 ? 'Centre' : pan < 0 ? `${Math.round(-pan * 100)} left` : `${Math.round(pan * 100)} right`}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          dragRef.current = { x: e.clientX, pan }
        }}
        onPointerMove={(e) => {
          const drag = dragRef.current
          if (!drag) return
          onChange(Math.max(-1, Math.min(1, drag.pan + (e.clientX - drag.x) / 80)))
        }}
        onPointerUp={() => {
          dragRef.current = null
        }}
        onDoubleClick={() => onChange(0)}
        className="relative h-1.5 w-full cursor-ew-resize rounded-full bg-white/[0.08] focus-visible:outline-accent focus-visible:outline-2 focus-visible:outline-offset-2"
        title="Drag to pan, double-click to centre"
      >
        <span
          aria-hidden
          className="absolute top-[-2px] h-[10px] w-[3px] rounded-full bg-white"
          style={{ left: `calc(${((pan + 1) / 2) * 100}% - 1.5px)` }}
        />
      </div>
      <span className="text-text-tertiary text-2xs tabular-nums">
        {pan === 0 ? 'C' : pan < 0 ? `L${Math.round(-pan * 100)}` : `R${Math.round(pan * 100)}`}
      </span>
    </div>
  )
}

/**
 * Master output meter.
 *
 * The top segment turns red above roughly -1 dBFS, because the only
 * thing a meter needs to tell you at a glance is whether you are about
 * to clip. Precise levels are read from the fader's own number.
 */
function StereoMeter({ left, right }: { left: number; right: number }) {
  return (
    <div className="flex h-32 gap-0.5" aria-hidden>
      {[left, right].map((value, index) => {
        const clipping = value > 0.89
        return (
          <div key={index} className="relative w-1.5 overflow-hidden rounded-full bg-white/[0.06]">
            <div
              className={cn(
                'absolute inset-x-0 bottom-0 rounded-full transition-[height] duration-75',
                clipping ? 'bg-danger' : 'bg-white/55',
              )}
              style={{ height: `${Math.min(1, value) * 100}%` }}
            />
          </div>
        )
      })}
    </div>
  )
}

function MiniToggle({
  letter,
  label,
  active,
  tone,
  onClick,
}: {
  letter: string
  label: string
  active: boolean
  tone: 'neutral' | 'accent'
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        'flex h-5 w-5 items-center justify-center rounded text-3xs font-bold transition-colors',
        !active && 'text-text-tertiary hover:bg-white/[0.08]',
        active && tone === 'neutral' && 'bg-white/20 text-white',
        active && tone === 'accent' && 'bg-accent/25 text-accent',
      )}
    >
      {letter}
    </button>
  )
}
