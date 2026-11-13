import { useRef } from 'react'

interface LiveWaveformProps {
  levelDbfs: number
  active: boolean
}

const BAR_COUNT = 32
const METER_FLOOR_DBFS = -60

/** A small live-reactive bar row driven by the recorder's own RMS level
 * readout — gives the recording view a genuine "something is happening"
 * pulse instead of a static icon, without needing a live audio graph tap
 * (the level already arrives from the backend once per second via the
 * progress event). Each bar holds a random-but-stable height offset so the
 * row reads as a real waveform shape rather than one repeated bar. */
export function LiveWaveform({ levelDbfs, active }: LiveWaveformProps) {
  const offsetsRef = useRef<number[]>([])
  if (offsetsRef.current.length === 0) {
    offsetsRef.current = Array.from({ length: BAR_COUNT }, () => 0.4 + Math.random() * 0.6)
  }

  const clamped = Math.max(METER_FLOOR_DBFS, Math.min(0, levelDbfs))
  const fraction = active ? (clamped - METER_FLOOR_DBFS) / -METER_FLOOR_DBFS : 0

  return (
    <div className="flex h-16 w-full items-center justify-center gap-[3px]">
      {offsetsRef.current.map((offset, i) => {
        const height = active ? Math.max(0.08, fraction * offset) : 0.08
        return (
          <div
            key={i}
            className={`w-1 rounded-full transition-all duration-150 ${active ? 'bg-brand-blue' : 'bg-surface-hover'}`}
            style={{ height: `${height * 100}%` }}
          />
        )
      })}
    </div>
  )
}
