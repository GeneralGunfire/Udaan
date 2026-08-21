interface AdjustmentSliderProps {
  label: string
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
}

export function AdjustmentSlider({ label, value, onChange, min = -100, max = 100 }: AdjustmentSliderProps) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span className="text-text-secondary text-[11px] font-medium">{label}</span>
        <span className="text-text-tertiary text-[10.5px] tabular-nums">{value}</span>
      </div>
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="dj-fader-horizontal w-full"
      />
    </div>
  )
}
