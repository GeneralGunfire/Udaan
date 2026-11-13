interface CrossfaderProps {
  /** -1 = full Deck A, 0 = center (both full), 1 = full Deck B. */
  value: number
  onChange: (v: number) => void
}

/**
 * A/B crossfader — a real DJ mixer's center control, not two independent
 * volume sliders pretending to be one. Center (0) plays both decks at
 * full volume (a true mixer crossfader doesn't dip the middle — a linear
 * "equal power" law would, but for two whole songs rather than a
 * beat-matched transition, keeping both audible at center is the more
 * useful default here). Sliding fully to either side takes the OTHER
 * deck to silence, matching how a physical crossfader actually behaves.
 */
export function Crossfader({ value, onChange }: CrossfaderProps) {
  return (
    <div className="flex w-full flex-col items-center gap-1.5">
      <div className="flex w-full items-center justify-between text-2xs-alt font-semibold tracking-wide uppercase">
        <span className="text-accent">A</span>
        <span className="text-text-tertiary">Crossfader</span>
        <span className="text-brand-cyan">B</span>
      </div>
      <input
        type="range"
        min={-100}
        max={100}
        step={1}
        value={Math.round(value * 100)}
        onChange={(e) => onChange(Number(e.target.value) / 100)}
        className="dj-fader-horizontal w-full"
      />
    </div>
  )
}
