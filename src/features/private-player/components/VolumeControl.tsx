import { useRef, useState } from 'react'
import { VolumeIcon, VolumeMuteIcon } from '@/shared/icons'

interface VolumeControlProps {
  volume: number
  onChange: (v: number) => void
}

/** The original app had no volume UI at all (keyboard-only). Adding one is
 * the one explicitly-approved deviation from a pure port. */
export function VolumeControl({ volume, onChange }: VolumeControlProps) {
  const trackRef = useRef<HTMLDivElement | null>(null)
  const [lastNonZero, setLastNonZero] = useState(volume || 0.8)

  function percentFromClientX(clientX: number): number {
    const track = trackRef.current
    if (!track) return 0
    const rect = track.getBoundingClientRect()
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
  }

  function handlePointerDown(e: React.PointerEvent) {
    e.currentTarget.setPointerCapture(e.pointerId)
    const v = percentFromClientX(e.clientX)
    onChange(v)
    if (v > 0) setLastNonZero(v)
  }
  function handlePointerMove(e: React.PointerEvent) {
    if (e.buttons !== 1) return
    const v = percentFromClientX(e.clientX)
    onChange(v)
    if (v > 0) setLastNonZero(v)
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => onChange(volume > 0 ? 0 : lastNonZero)}
        className="text-text-secondary hover:text-text-primary shrink-0 transition-colors"
      >
        {volume > 0 ? <VolumeIcon width={18} height={18} /> : <VolumeMuteIcon width={18} height={18} />}
      </button>
      <div
        ref={trackRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        className="relative h-3 w-24 cursor-pointer"
      >
        <div className="bg-border-hairline absolute top-1/2 h-1 w-full -translate-y-1/2 rounded-full" />
        <div
          className="bg-text-secondary absolute top-1/2 h-1 origin-left -translate-y-1/2 rounded-full"
          style={{ width: '100%', transform: `translateY(-50%) scaleX(${volume})` }}
        />
      </div>
    </div>
  )
}
