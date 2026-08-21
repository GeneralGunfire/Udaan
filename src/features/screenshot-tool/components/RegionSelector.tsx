import { useRef, useState } from 'react'

interface Rect {
  x: number
  y: number
  width: number
  height: number
}

interface RegionSelectorProps {
  imageSrc: string
  naturalWidth: number
  naturalHeight: number
  onConfirm: (region: Rect) => void
  onCancel: () => void
}

/**
 * Drag-to-select a rectangle over an already-captured full-screen image, then crop.
 * Trades a true click-drag-over-desktop overlay (a separate transparent always-on-top
 * window, out of scope for this pass — see NOTES.md) for "capture full frame, crop
 * in-app" — still a real region capture, just one extra step.
 */
export function RegionSelector({ imageSrc, naturalWidth, naturalHeight, onConfirm, onCancel }: RegionSelectorProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [start, setStart] = useState<{ x: number; y: number } | null>(null)
  const [current, setCurrent] = useState<{ x: number; y: number } | null>(null)

  function toLocal(e: React.MouseEvent): { x: number; y: number } | null {
    const el = containerRef.current
    if (!el) return null
    const rect = el.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  function handleMouseDown(e: React.MouseEvent) {
    const p = toLocal(e)
    if (!p) return
    setStart(p)
    setCurrent(p)
  }

  function handleMouseMove(e: React.MouseEvent) {
    if (!start) return
    const p = toLocal(e)
    if (p) setCurrent(p)
  }

  function handleMouseUp() {
    if (!start || !current || !containerRef.current) return
    const el = containerRef.current
    const scaleX = naturalWidth / el.clientWidth
    const scaleY = naturalHeight / el.clientHeight

    const x = Math.round(Math.min(start.x, current.x) * scaleX)
    const y = Math.round(Math.min(start.y, current.y) * scaleY)
    const width = Math.round(Math.abs(current.x - start.x) * scaleX)
    const height = Math.round(Math.abs(current.y - start.y) * scaleY)

    setStart(null)
    setCurrent(null)

    if (width < 4 || height < 4) return
    onConfirm({ x, y, width, height })
  }

  const selection =
    start && current
      ? {
          left: Math.min(start.x, current.x),
          top: Math.min(start.y, current.y),
          width: Math.abs(current.x - start.x),
          height: Math.abs(current.y - start.y),
        }
      : null

  return (
    <div className="flex flex-col gap-2">
      <p className="text-text-tertiary text-[11px]">Drag over the captured frame to select a region.</p>
      <div
        ref={containerRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        className="border-glass-border relative w-full cursor-crosshair overflow-hidden rounded-lg border select-none"
      >
        <img src={imageSrc} alt="Captured frame" className="pointer-events-none block w-full" draggable={false} />
        {selection && (
          <div
            className="border-brand-teal bg-brand-teal/15 absolute border-2"
            style={{
              left: selection.left,
              top: selection.top,
              width: selection.width,
              height: selection.height,
            }}
          />
        )}
      </div>
      <button
        type="button"
        onClick={onCancel}
        className="text-text-tertiary hover:text-text-primary self-start text-[11.5px] transition-colors duration-150"
      >
        Cancel
      </button>
    </div>
  )
}
