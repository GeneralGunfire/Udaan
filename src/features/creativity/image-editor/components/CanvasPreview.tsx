import { useEffect, useRef, useState } from 'react'
import type { CropRect } from '../lib/imageOps'

interface CanvasPreviewProps {
  renderFinal: () => HTMLCanvasElement | null
  version: number
  cropMode: boolean
  crop: CropRect | null
  onCropChange: (crop: CropRect | null) => void
  sourceWidth: number
  sourceHeight: number
}

/** Live preview canvas — re-renders the crop/resize/adjustment pipeline whenever `version` changes. */
export function CanvasPreview({
  renderFinal,
  version,
  cropMode,
  crop,
  onCropChange,
  sourceWidth,
  sourceHeight,
}: CanvasPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null)
  const [displayScale, setDisplayScale] = useState(1)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const result = renderFinal()
    if (!result) return
    canvas.width = result.width
    canvas.height = result.height
    const ctx = canvas.getContext('2d')
    ctx?.drawImage(result, 0, 0)

    const container = containerRef.current
    if (container) {
      const scale = Math.min(
        container.clientWidth / result.width,
        container.clientHeight / result.height,
        1,
      )
      setDisplayScale(scale)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version])

  function toImageCoords(e: React.MouseEvent): { x: number; y: number } {
    const canvas = canvasRef.current
    if (!canvas) return { x: 0, y: 0 }
    const rect = canvas.getBoundingClientRect()
    const scaleX = canvas.width / rect.width
    const scaleY = canvas.height / rect.height
    return {
      x: Math.max(0, Math.min(canvas.width, (e.clientX - rect.left) * scaleX)),
      y: Math.max(0, Math.min(canvas.height, (e.clientY - rect.top) * scaleY)),
    }
  }

  function handleMouseDown(e: React.MouseEvent) {
    if (!cropMode) return
    const pt = toImageCoords(e)
    setDragStart(pt)
    onCropChange({ x: pt.x, y: pt.y, width: 0, height: 0 })
  }

  function handleMouseMove(e: React.MouseEvent) {
    if (!cropMode || !dragStart) return
    const pt = toImageCoords(e)
    onCropChange({
      x: Math.min(dragStart.x, pt.x),
      y: Math.min(dragStart.y, pt.y),
      width: Math.abs(pt.x - dragStart.x),
      height: Math.abs(pt.y - dragStart.y),
    })
  }

  function handleMouseUp() {
    setDragStart(null)
  }

  return (
    <div
      ref={containerRef}
      className="relative flex h-full w-full items-center justify-center overflow-hidden"
    >
      <div className="relative" style={{ lineHeight: 0 }}>
        <canvas
          ref={canvasRef}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          className="rounded-md shadow-lg"
          style={{
            width: sourceWidth * displayScale || undefined,
            height: sourceHeight * displayScale || undefined,
            cursor: cropMode ? 'crosshair' : 'default',
            maxWidth: '100%',
            maxHeight: '100%',
          }}
        />
        {cropMode && crop && crop.width > 0 && crop.height > 0 && (
          <div
            className="border-accent-creativity pointer-events-none absolute border-2"
            style={{
              left: crop.x * displayScale,
              top: crop.y * displayScale,
              width: crop.width * displayScale,
              height: crop.height * displayScale,
              boxShadow: '0 0 0 2000px rgb(0 0 0 / 45%)',
            }}
          />
        )}
      </div>
    </div>
  )
}
