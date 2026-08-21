import { readAssetFileBytes, writeAssetFileBytes } from '@/integrations/asset-library'
import {
  applyAdjustments,
  resizeImage,
  loadImageBitmap,
  canvasToBytes,
  mimeTypeForFileName,
  type Adjustments,
} from './imageOps'

export interface BatchJobResult {
  path: string
  outputPath: string
  ok: boolean
  error?: string
}

export interface BatchOptions {
  adjustments: Adjustments
  resizeTo: { width: number; height: number } | null
  outputSuffix: string
  outputFolder: string
}

function joinPath(folder: string, fileName: string): string {
  const sep = folder.includes('\\') ? '\\' : '/'
  return folder.endsWith(sep) ? `${folder}${fileName}` : `${folder}${sep}${fileName}`
}

function withSuffix(fileName: string, suffix: string): string {
  const dot = fileName.lastIndexOf('.')
  if (dot === -1) return `${fileName}${suffix}`
  return `${fileName.slice(0, dot)}${suffix}${fileName.slice(dot)}`
}

/** Applies the same resize + adjustments pipeline to a batch of local image files, one at a time. */
export async function runBatch(
  paths: string[],
  options: BatchOptions,
  onProgress?: (done: number, total: number) => void,
): Promise<BatchJobResult[]> {
  const results: BatchJobResult[] = []
  for (let i = 0; i < paths.length; i++) {
    const path = paths[i]
    const fileName = path.split(/[\\/]/).pop() ?? path
    const outputPath = joinPath(options.outputFolder, withSuffix(fileName, options.outputSuffix))
    try {
      const bytes = await readAssetFileBytes(path)
      const bitmap = await loadImageBitmap(bytes)
      let stage: ImageBitmap | HTMLCanvasElement = bitmap
      if (options.resizeTo) {
        stage = resizeImage(stage, options.resizeTo.width, options.resizeTo.height)
      }
      const finalCanvas = applyAdjustments(stage, options.adjustments)
      const mime = mimeTypeForFileName(outputPath)
      const outBytes = await canvasToBytes(finalCanvas, mime)
      await writeAssetFileBytes(outputPath, outBytes)
      results.push({ path, outputPath, ok: true })
    } catch (err) {
      results.push({
        path,
        outputPath,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      })
    }
    onProgress?.(i + 1, paths.length)
  }
  return results
}
