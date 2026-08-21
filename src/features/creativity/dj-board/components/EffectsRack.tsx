import { useCallback, useRef, useState } from 'react'
import type { EffectKind, EffectsRackState } from '../lib/audioEngine'
import { SparkleIcon, ChevronRightIcon } from '@/shared/icons'

interface EffectsRackProps {
  effects: EffectsRackState
  onEngage: (kind: EffectKind) => void
  onRelease: (kind: EffectKind) => void
  onAmount: (kind: EffectKind, amount: number) => void
}

const EFFECT_LABELS: Record<EffectKind, string> = {
  reverb: 'Reverb',
  delay: 'Delay',
  filter: 'Filter',
  flanger: 'Flanger',
}

/**
 * Effects rack — real DSP now (see lib/audioEngine.ts for the actual
 * node graph: convolution reverb, feedback delay, dedicated filter
 * sweep, LFO flanger). Hold-to-apply, GarageBand-style: press and hold a
 * pad to engage the effect, release to stop — it's not a toggle. While
 * held, scroll (wheel) up/down on the pad adjusts intensity live; the
 * bar underneath shows the current intensity and can also be
 * dragged directly. Collapsed by default (point 5 of the original
 * redesign) so it doesn't visually compete with transport/mixer.
 */
export function EffectsRack({ effects, onEngage, onRelease, onAmount }: EffectsRackProps) {
  const [expanded, setExpanded] = useState(false)
  const dragKind = useRef<EffectKind | null>(null)

  const handlePointerDown = useCallback(
    (kind: EffectKind, e: React.PointerEvent<HTMLDivElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId)
      dragKind.current = kind
      onEngage(kind)
    },
    [onEngage],
  )

  const handlePointerMove = useCallback(
    (kind: EffectKind, e: React.PointerEvent<HTMLDivElement>) => {
      if (dragKind.current !== kind) return
      const rect = e.currentTarget.getBoundingClientRect()
      const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
      onAmount(kind, ratio)
    },
    [onAmount],
  )

  const handlePointerUp = useCallback(
    (kind: EffectKind, e: React.PointerEvent<HTMLDivElement>) => {
      e.currentTarget.releasePointerCapture(e.pointerId)
      if (dragKind.current === kind) {
        dragKind.current = null
        onRelease(kind)
      }
    },
    [onRelease],
  )

  const handleWheel = useCallback(
    (kind: EffectKind, amount: number, e: React.WheelEvent<HTMLDivElement>) => {
      e.preventDefault()
      const delta = e.deltaY < 0 ? 0.05 : -0.05
      onAmount(kind, Math.max(0, Math.min(1, amount + delta)))
    },
    [onAmount],
  )

  return (
    <div className="glass-surface flex flex-col gap-3 rounded-xl p-3">
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="flex items-center justify-between"
      >
        <div className="flex items-center gap-1.5">
          <SparkleIcon width={12} height={12} className="text-accent-creativity" />
          <h2 className="text-text-secondary text-[11.5px] font-semibold">Effects Rack</h2>
          <span className="text-text-tertiary text-[9px] font-medium tracking-wide uppercase">
            Hold to apply
          </span>
        </div>
        <span
          className="text-text-tertiary flex transition-transform duration-150"
          style={{ transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)' }}
        >
          <ChevronRightIcon width={12} height={12} />
        </span>
      </button>

      {expanded && (
        <>
          <div className="grid grid-cols-4 gap-2.5">
            {(Object.keys(effects) as EffectKind[]).map((kind) => {
              const effect = effects[kind]
              return (
                <div key={kind} className="flex flex-col gap-1.5">
                  <div
                    onPointerDown={(e) => handlePointerDown(kind, e)}
                    onPointerMove={(e) => handlePointerMove(kind, e)}
                    onPointerUp={(e) => handlePointerUp(kind, e)}
                    onPointerLeave={(e) => {
                      if (dragKind.current === kind) handlePointerUp(kind, e)
                    }}
                    onWheel={(e) => handleWheel(kind, effect.amount, e)}
                    role="button"
                    tabIndex={0}
                    aria-pressed={effect.engaged}
                    title={`Hold to apply ${EFFECT_LABELS[kind]}. Scroll or drag to change intensity.`}
                    className="relative flex h-16 cursor-pointer touch-none items-center justify-center rounded-lg text-[11px] font-semibold transition-transform duration-75 select-none"
                    style={{
                      background: effect.engaged
                        ? 'var(--gradient-brand)'
                        : 'var(--color-glass-bg-hover)',
                      color: effect.engaged ? '#fff' : 'var(--color-text-secondary)',
                      transform: effect.engaged ? 'scale(0.97)' : 'scale(1)',
                    }}
                  >
                    {EFFECT_LABELS[kind]}
                  </div>
                  <div className="bg-glass-bg-hover h-1 w-full overflow-hidden rounded-full">
                    <div
                      className="h-full rounded-full transition-[width] duration-75"
                      style={{
                        width: `${effect.amount * 100}%`,
                        background: 'var(--color-accent-creativity)',
                      }}
                    />
                  </div>
                </div>
              )
            })}
          </div>

          <p className="text-text-tertiary text-[10px] leading-relaxed">
            Real DSP: convolution reverb, feedback delay, dedicated filter sweep, LFO flanger —
            applied to both decks while held (affects whatever's audible through the crossfader).
          </p>
        </>
      )}
    </div>
  )
}
