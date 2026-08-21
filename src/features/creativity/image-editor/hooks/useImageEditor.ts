import { useCallback, useState } from 'react'
import { readAssetFileBytes, writeAssetFileBytes, pickSavePath } from '@/integrations/asset-library'
import {
  applyAdjustments,
  cropImage,
  loadImageBitmap,
  resizeImage,
  canvasToBytes,
  mimeTypeForFileName,
  defaultAdjustments,
  type Adjustments,
  type CropRect,
} from '../lib/imageOps'

export interface LoadedImage {
  path: string
  fileName: string
  original: ImageBitmap
  width: number
  height: number
}

export function useImageEditor() {
  const [image, setImage] = useState<LoadedImage | null>(null)
  const [adjustments, setAdjustments] = useState<Adjustments>(defaultAdjustments())
  const [crop, setCrop] = useState<CropRect | null>(null)
  const [targetSize, setTargetSize] = useState<{ width: number; height: number } | null>(null)
  const [loading, setLoading] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadFromPath = useCallback(async (path: string, fileName: string) => {
    setLoading(true)
    setError(null)
    try {
      const bytes = await readAssetFileBytes(path)
      const bitmap = await loadImageBitmap(bytes)
      setImage({ path, fileName, original: bitmap, width: bitmap.width, height: bitmap.height })
      setAdjustments(defaultAdjustments())
      setCrop(null)
      setTargetSize(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  const resetCrop = useCallback(() => setCrop(null), [])
  const resetAdjustments = useCallback(() => setAdjustments(defaultAdjustments()), [])
  const resetSize = useCallback(() => setTargetSize(null), [])

  /** Builds the final canvas: crop -> resize -> adjustments, in that order. */
  const renderFinal = useCallback((): HTMLCanvasElement | null => {
    if (!image) return null
    let stage: ImageBitmap | HTMLCanvasElement = image.original
    if (crop) stage = cropImage(stage, crop)
    if (targetSize) stage = resizeImage(stage, targetSize.width, targetSize.height)
    return applyAdjustments(stage, adjustments)
  }, [image, crop, targetSize, adjustments])

  const exportCurrent = useCallback(async (): Promise<string | null> => {
    if (!image) return null
    const canvas = renderFinal()
    if (!canvas) return null
    setExporting(true)
    setError(null)
    try {
      const savePath = await pickSavePath(image.fileName, ['png', 'jpg', 'jpeg', 'webp'])
      if (!savePath) return null
      const mime = mimeTypeForFileName(savePath)
      const bytes = await canvasToBytes(canvas, mime)
      await writeAssetFileBytes(savePath, bytes)
      return savePath
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      return null
    } finally {
      setExporting(false)
    }
  }, [image, renderFinal])

  return {
    image,
    adjustments,
    crop,
    targetSize,
    loading,
    exporting,
    error,
    loadFromPath,
    setAdjustments,
    setCrop,
    setTargetSize,
    resetCrop,
    resetAdjustments,
    resetSize,
    renderFinal,
    exportCurrent,
  }
}
