interface FaderProps {
  label: string
  value: number
  min: number
  max: number
  step?: number
  onChange: (value: number) => void
  orientation?: 'vertical' | 'horizontal'
}

/** Native range input styled to look like a hardware channel fader. */
export function Fader({
  label,
  value,
  min,
  max,
  step = 0.01,
  onChange,
  orientation = 'vertical',
}: FaderProps) {
  const isVertical = orientation === 'vertical'
  return (
    <div
      className={`flex items-center gap-2 ${isVertical ? 'flex-col' : 'w-full flex-row'}`}
    >
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className={isVertical ? 'dj-fader-vertical' : 'dj-fader-horizontal w-full'}
        style={
          isVertical
            ? ({ writingMode: 'vertical-lr', direction: 'rtl' } as React.CSSProperties)
            : undefined
        }
      />
      {isVertical && (
        <span className="text-text-tertiary text-[9.5px] font-medium tracking-wide uppercase">
          {label}
        </span>
      )}
    </div>
  )
}
