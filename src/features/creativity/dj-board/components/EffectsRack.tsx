import type { EffectKind, EffectsRackState } from '../lib/audioEngine'
import { SparkleIcon } from '@/shared/icons'

interface EffectsRackProps {
  effects: EffectsRackState
  onToggle: (kind: EffectKind) => void
  onAmount: (kind: EffectKind, amount: number) => void
}

const EFFECT_LABELS: Record<EffectKind, string> = {
  reverb: 'Reverb',
  delay: 'Delay',
  filter: 'Filter',
  flanger: 'Flanger',
}

/**
 * Effects rack — UI + control state only. No audio DSP graph is wired up
 * yet (see lib/audioEngine.ts header for why); enabling a slot here changes
 * only the state shown in this panel, not the sound. Marked clearly in the
 * UI so it's never mistaken for working audio.
 */
export function EffectsRack({ effects, onToggle, onAmount }: EffectsRackProps) {
  return (
    <div className="glass-surface flex flex-col gap-3 rounded-xl p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <SparkleIcon width={12} height={12} className="text-accent-creativity" />
          <h2 className="text-text-primary text-[12.5px] font-semibold">Effects Rack</h2>
        </div>
        <span className="border-glass-border text-text-tertiary rounded-full border border-dashed px-2 py-0.5 text-[9px] font-medium tracking-wide uppercase">
          Mock DSP
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2.5">
        {(Object.keys(effects) as EffectKind[]).map((kind) => {
          const effect = effects[kind]
          return (
            <div
              key={kind}
              className={`border-glass-border rounded-lg border p-2.5 transition-colors duration-150 ${
                effect.enabled ? 'bg-glass-hover' : 'bg-glass'
              }`}
            >
              <div className="mb-2 flex items-center justify-between">
                <span className="text-text-secondary text-[11px] font-medium">
                  {EFFECT_LABELS[kind]}
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={effect.enabled}
                  onClick={() => onToggle(kind)}
                  className={`relative h-4 w-7 rounded-full transition-colors duration-150 ${
                    effect.enabled ? 'bg-accent-creativity' : 'bg-glass-bg-hover'
                  }`}
                >
                  <span
                    className="absolute top-0.5 h-3 w-3 rounded-full bg-white transition-transform duration-150"
                    style={{ transform: effect.enabled ? 'translateX(14px)' : 'translateX(2px)' }}
                  />
                </button>
              </div>
              <input
                type="range"
                aria-label={`${EFFECT_LABELS[kind]} amount`}
                min={0}
                max={1}
                step={0.01}
                value={effect.amount}
                onChange={(e) => onAmount(kind, Number(e.target.value))}
                disabled={!effect.enabled}
                className="dj-fader-horizontal w-full disabled:opacity-40"
              />
            </div>
          )
        })}
      </div>

      <p className="text-text-tertiary text-[10px] leading-relaxed">
        TODO: real DSP (convolution reverb, feedback delay lines, biquad sweep, LFO-modulated
        delay) — engine choice pending hardware input.
      </p>
    </div>
  )
}
