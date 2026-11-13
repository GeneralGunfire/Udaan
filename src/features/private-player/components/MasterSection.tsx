import { DjKnob } from './DjKnob'
import type { MasterSettings } from '../lib/audioGraph'

interface MasterSectionProps {
  settings: MasterSettings
  onChange: (patch: Partial<MasterSettings>) => void
}

/**
 * The master bus strip — EQ, limiter and output trim applied to the SUMMED
 * Deck A + Deck B signal, sitting alongside the crossfader because that's
 * where it belongs on a real mixer: after the two channels meet, before
 * the output.
 *
 * This is the one control group here that could not exist until both decks
 * moved onto a shared AudioContext (lib/audioGraph.ts). Per-deck limiters
 * are not a substitute — two independent limiters can't see each other's
 * peaks, so the actual summed output could still clip while both report
 * themselves clean.
 *
 * Like every knob in djEffects.ts, everything defaults to genuinely inert:
 * flat EQ, unity output, limiter OFF. A limiter is not transparent just
 * because the material is quiet — it changes dynamics whenever it engages
 * — so it is opt-in rather than a default-on "polish" (exactly the bug the
 * per-deck compressor already had once).
 */
export function MasterSection({ settings, onChange }: MasterSectionProps) {
  return (
    <div className="flex shrink-0 flex-col items-center gap-2">
      <span className="text-text-tertiary text-2xs-alt font-semibold tracking-wide uppercase">Master</span>

      <div className="flex items-end gap-2.5">
        <DjKnob
          label="Low"
          value={settings.low}
          min={-12}
          max={12}
          centerValue={0}
          onChange={(v) => onChange({ low: v })}
          formatValue={(v) => `${v > 0 ? '+' : ''}${Math.round(v)}dB`}
        />
        <DjKnob
          label="Mid"
          value={settings.mid}
          min={-12}
          max={12}
          centerValue={0}
          onChange={(v) => onChange({ mid: v })}
          formatValue={(v) => `${v > 0 ? '+' : ''}${Math.round(v)}dB`}
        />
        <DjKnob
          label="High"
          value={settings.high}
          min={-12}
          max={12}
          centerValue={0}
          onChange={(v) => onChange({ high: v })}
          formatValue={(v) => `${v > 0 ? '+' : ''}${Math.round(v)}dB`}
        />
        <DjKnob
          label="Out"
          value={settings.outputGain}
          min={0}
          max={1.5}
          centerValue={1}
          onChange={(v) => onChange({ outputGain: v })}
          formatValue={(v) => `${Math.round(v * 100)}%`}
        />
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onChange({ limiterEnabled: !settings.limiterEnabled })}
          title="Brickwall limiter on the summed output — prevents clipping when both decks and their effects stack up"
          className={`rounded-full px-3 py-1 text-2xs-alt font-semibold tracking-wide uppercase transition-colors ${
            settings.limiterEnabled ? 'bg-accent text-white' : 'bg-white/8 text-text-tertiary hover:bg-white/12'
          }`}
        >
          Limiter
        </button>
        {settings.limiterEnabled && (
          <label className="flex items-center gap-1.5">
            <span className="text-text-tertiary text-3xs">Ceiling</span>
            <input
              type="range"
              min={-12}
              max={0}
              step={0.5}
              value={settings.ceilingDb}
              onChange={(e) => onChange({ ceilingDb: Number(e.target.value) })}
              className="accent-(--color-accent) h-1 w-16"
            />
            <span className="text-text-tertiary w-9 text-right text-3xs tabular-nums">
              {settings.ceilingDb.toFixed(1)}dB
            </span>
          </label>
        )}
      </div>
    </div>
  )
}
