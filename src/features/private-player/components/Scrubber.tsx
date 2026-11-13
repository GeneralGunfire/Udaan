import { useRef, useState } from 'react'
import { formatDuration } from '../lib/types'

interface ScrubberProps {
  currentTime: number
  duration: number
  onSeek: (percent: number) => void
}

/** Hand-rolled progress bar with drag-to-seek, matching the original's
 * transform-based fill (cheap to animate) rather than animating `width`. */
export function Scrubber({ currentTime, duration, onSeek }: ScrubberProps) {
  const trackRef = useRef<HTMLDivElement | null>(null)
  const [dragging, setDragging] = useState(false)
  const [dragPercent, setDragPercent] = useState(0)

  const percent = duration > 0 ? (dragging ? dragPercent : (currentTime / duration) * 100) : 0

  function percentFromClientX(clientX: number): number {
    const track = trackRef.current
    if (!track) return 0
    const rect = track.getBoundingClientRect()
    return Math.min(100, Math.max(0, ((clientX - rect.left) / rect.width) * 100))
  }

  function handlePointerDown(e: React.PointerEvent) {
    e.currentTarget.setPointerCapture(e.pointerId)
    setDragging(true)
    setDragPercent(percentFromClientX(e.clientX))
  }
  function handlePointerMove(e: React.PointerEvent) {
    if (!dragging) return
    setDragPercent(percentFromClientX(e.clientX))
  }
  function handlePointerUp(e: React.PointerEvent) {
    if (!dragging) return
    setDragging(false)
    onSeek(percentFromClientX(e.clientX))
  }

  return (
    <div className="flex w-full items-center gap-3">
      <span className="text-text-tertiary w-10 shrink-0 text-right text-xs tabular-nums">{formatDuration(currentTime)}</span>
      <div
        ref={trackRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        className="group relative h-4 flex-1 cursor-pointer"
      >
        <div className="bg-border-hairline absolute top-1/2 h-1 w-full -translate-y-1/2 rounded-full" />
        <div
          className="bg-accent absolute top-1/2 h-1 origin-left -translate-y-1/2 rounded-full"
          style={{ width: '100%', transform: `translateY(-50%) scaleX(${percent / 100})` }}
        />
        <div
          className="absolute top-1/2 h-3 w-3 -translate-y-1/2 rounded-full bg-white opacity-0 shadow transition-opacity group-hover:opacity-100"
          style={{ left: `calc(${percent}% - 6px)`, opacity: dragging ? 1 : undefined }}
        />
      </div>
      <span className="text-text-tertiary w-10 shrink-0 text-xs tabular-nums">{formatDuration(duration)}</span>
    </div>
  )
}
