import { useCallback, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import type { EffectKind, EffectsRackState } from '../lib/audioEngine'
import {
  SparkleIcon,
  ChevronRightIcon,
  ReverbIcon,
  DelayIcon,
  FilterSweepIcon,
  FlangerIcon,
  BitcrushIcon,
  PhaserIcon,
} from '@/shared/icons'

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
  bitcrush: 'Bitcrush',
  phaser: 'Phaser',
}

const EFFECT_HINTS: Record<EffectKind, string> = {
  reverb: 'Wash of space — hold for a big room, ease off for a small one.',
  delay: 'Feedback echo — higher intensity means longer, more repeats.',
  filter: 'Classic filter-down sweep, build or breakdown either direction.',
  flanger: 'Jet-swoosh modulation — deeper and faster at high intensity.',
  bitcrush: 'Lo-fi crunch — quantizes the signal, harsher as you push it.',
  phaser: 'Sweeping notch cascade — wide, slow swirl at high intensity.',
}

const EFFECT_ICONS: Record<EffectKind, (props: { width: number; height: number }) => React.ReactElement> = {
  reverb: ReverbIcon,
  delay: DelayIcon,
  filter: FilterSweepIcon,
  flanger: FlangerIcon,
  bitcrush: BitcrushIcon,
  phaser: PhaserIcon,
}

/**
 * Effects rack — real DSP (see lib/audioEngine.ts: convolution reverb,
 * feedback delay, dedicated filter sweep, LFO flanger, WaveShaper
 * bitcrush, cascaded-allpass phaser). Hold-to-apply, GarageBand-style:
 * press and hold a pad to engage, release to stop — not a toggle.
 *
 * Redesigned for easier use: expanded by default (no extra click to see
 * what's available), compact pads sized to avoid crowding/overlap in a
 * 3-column grid, a live percentage readout on the pad itself (no need
 * to squint at a thin bar underneath), a short plain-language hint per
 * effect, and the same scroll/drag intensity control as before. Hover
 * feedback is opacity/press-scale only (never scale-up) so a hovered
 * pad never grows into its neighbors.
 */
export function EffectsRack({ effects, onEngage, onRelease, onAmount }: EffectsRackProps) {
  const [expanded, setExpanded] = useState(true)
  const [hovered, setHovered] = useState<EffectKind | null>(null)
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

  const engagedCount = (Object.values(effects) as { engaged: boolean }[]).filter((e) => e.engaged).length

  return (
    <div className="glass-surface flex flex-col gap-3 rounded-xl p-3">
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="flex items-center justify-between"
      >
        <div className="flex min-w-0 items-center gap-1.5">
          <SparkleIcon width={12} height={12} className="text-brand-cyan shrink-0" />
          <h2 className="text-text-secondary truncate text-[11.5px] font-semibold">Effects Rack</h2>
          <AnimatePresence>
            {engagedCount > 0 && (
              <motion.span
                initial={{ opacity: 0, scale: 0.7 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.7 }}
                className="bg-brand-cyan flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[9px] font-bold text-white"
              >
                {engagedCount}
              </motion.span>
            )}
          </AnimatePresence>
        </div>
        <span
          className="text-text-tertiary flex transition-transform duration-150"
          style={{ transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)' }}
        >
          <ChevronRightIcon width={12} height={12} />
        </span>
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 400, damping: 38 }}
            className="overflow-hidden"
          >
            <div className="mx-auto grid max-w-140 grid-cols-6 justify-items-center gap-2">
              {(Object.keys(effects) as EffectKind[]).map((kind) => {
                const effect = effects[kind]
                const Icon = EFFECT_ICONS[kind]
                return (
                  <motion.div
                    key={kind}
                    onPointerDown={(e) => handlePointerDown(kind, e)}
                    onPointerMove={(e) => handlePointerMove(kind, e)}
                    onPointerUp={(e) => handlePointerUp(kind, e)}
                    onPointerLeave={(e) => {
                      if (dragKind.current === kind) handlePointerUp(kind, e)
                    }}
                    onPointerEnter={() => setHovered(kind)}
                    onMouseLeave={() => setHovered((h) => (h === kind ? null : h))}
                    onWheel={(e) => handleWheel(kind, effect.amount, e)}
                    role="button"
                    tabIndex={0}
                    aria-pressed={effect.engaged}
                    aria-label={`${EFFECT_LABELS[kind]}: hold to apply, scroll to adjust intensity`}
                    title={`Hold to apply ${EFFECT_LABELS[kind]}. Scroll or drag to change intensity.`}
                    animate={{ scale: effect.engaged ? 0.95 : 1 }}
                    transition={{ type: 'spring', stiffness: 500, damping: 26 }}
                    className="relative flex h-16 max-w-32 cursor-pointer touch-none flex-col items-center justify-center gap-0.5 overflow-hidden rounded-lg select-none"
                    style={{
                      background: effect.engaged ? 'var(--gradient-brand)' : 'var(--color-glass-bg-hover)',
                      color: effect.engaged ? '#fff' : 'var(--color-text-secondary)',
                      boxShadow: effect.engaged
                        ? '0 0 0 2px color-mix(in srgb, var(--color-brand-cyan) 45%, transparent)'
                        : 'none',
                    }}
                  >
                    <div
                      className="absolute inset-x-0 bottom-0 rounded-lg opacity-20 transition-[height] duration-75"
                      style={{
                        height: `${effect.amount * 100}%`,
                        background: effect.engaged ? '#fff' : 'var(--color-brand-cyan)',
                      }}
                    />
                    <Icon width={12} height={12} />
                    <span className="relative text-[10px] font-semibold">{EFFECT_LABELS[kind]}</span>
                    <span className="relative text-[8.5px] font-semibold tabular-nums opacity-75">
                      {Math.round(effect.amount * 100)}%
                    </span>
                  </motion.div>
                )
              })}
            </div>

            <AnimatePresence mode="wait">
              <motion.p
                key={hovered ?? 'default'}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.12 }}
                className="text-text-tertiary mt-2.5 text-[10px] leading-relaxed"
              >
                {hovered
                  ? EFFECT_HINTS[hovered]
                  : 'Press and hold a pad to apply live; scroll or drag across it to dial intensity. Affects whatever is audible through the crossfader.'}
              </motion.p>
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
