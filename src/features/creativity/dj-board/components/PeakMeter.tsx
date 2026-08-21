interface PeakMeterProps {
  level: number
  orientation?: 'vertical' | 'horizontal'
  accent?: string
}

/** Real-time peak level bar — reads from a real AnalyserNode (see audioEngine.ts getPeakLevel), not simulated. */
export function PeakMeter({ level, orientation = 'vertical', accent = 'var(--color-success)' }: PeakMeterProps) {
  const clamped = Math.max(0, Math.min(1, level))
  const isClipping = clamped > 0.92
  const color = isClipping ? 'var(--color-danger)' : accent

  if (orientation === 'horizontal') {
    return (
      <div className="bg-glass-bg-hover h-1.5 w-full overflow-hidden rounded-full">
        <div
          className="h-full rounded-full transition-[width] duration-75"
          style={{ width: `${clamped * 100}%`, backgroundColor: color }}
        />
      </div>
    )
  }

  return (
    <div className="bg-glass-bg-hover flex h-full w-1.5 flex-col-reverse overflow-hidden rounded-full">
      <div
        className="w-full rounded-full transition-[height] duration-75"
        style={{ height: `${clamped * 100}%`, backgroundColor: color }}
      />
    </div>
  )
}
