/**
 * Real canvas-based image operations — genuine pixel processing via the
 * Canvas 2D API, not a mock. Crop/resize use drawImage; brightness/
 * contrast/saturation are per-pixel math over ImageData.
 */

export interface Adjustments {
  brightness: number // -100..100
  contrast: number // -100..100
  saturation: number // -100..100
}

export function defaultAdjustments(): Adjustments {
  return { brightness: 0, contrast: 0, saturation: 0 }
}

export interface CropRect {
  x: number
  y: number
  width: number
  height: number
}

export async function loadImageBitmap(bytes: Uint8Array): Promise<ImageBitmap> {
  const blob = new Blob([bytes.slice().buffer as ArrayBuffer])
  return await createImageBitmap(blob)
}

function makeCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width))
  canvas.height = Math.max(1, Math.round(height))
  return canvas
}

export function cropImage(source: ImageBitmap | HTMLCanvasElement, crop: CropRect): HTMLCanvasElement {
  const canvas = makeCanvas(crop.width, crop.height)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2D context unavailable')
  ctx.drawImage(source, crop.x, crop.y, crop.width, crop.height, 0, 0, crop.width, crop.height)
  return canvas
}

export function resizeImage(
  source: ImageBitmap | HTMLCanvasElement,
  targetWidth: number,
  targetHeight: number,
): HTMLCanvasElement {
  const canvas = makeCanvas(targetWidth, targetHeight)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2D context unavailable')
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(source, 0, 0, targetWidth, targetHeight)
  return canvas
}

/** Per-pixel brightness/contrast/saturation — real math, not a CSS filter preview trick. */
export function applyAdjustments(
  source: ImageBitmap | HTMLCanvasElement,
  adjustments: Adjustments,
): HTMLCanvasElement {
  const width = source instanceof HTMLCanvasElement ? source.width : source.width
  const height = source instanceof HTMLCanvasElement ? source.height : source.height
  const canvas = makeCanvas(width, height)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2D context unavailable')
  ctx.drawImage(source, 0, 0)

  const { brightness, contrast, saturation } = adjustments
  if (brightness === 0 && contrast === 0 && saturation === 0) return canvas

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const data = imageData.data

  const brightnessOffset = (brightness / 100) * 255
  const contrastFactor = (259 * (contrast + 255)) / (255 * (259 - contrast))
  const satFactor = 1 + saturation / 100

  for (let i = 0; i < data.length; i += 4) {
    let r = data[i]
    let g = data[i + 1]
    let b = data[i + 2]

    // Brightness
    r += brightnessOffset
    g += brightnessOffset
    b += brightnessOffset

    // Contrast
    r = contrastFactor * (r - 128) + 128
    g = contrastFactor * (g - 128) + 128
    b = contrastFactor * (b - 128) + 128

    // Saturation (luminance-preserving)
    const gray = 0.299 * r + 0.587 * g + 0.114 * b
    r = gray + (r - gray) * satFactor
    g = gray + (g - gray) * satFactor
    b = gray + (b - gray) * satFactor

    data[i] = clamp255(r)
    data[i + 1] = clamp255(g)
    data[i + 2] = clamp255(b)
  }

  ctx.putImageData(imageData, 0, 0)
  return canvas
}

function clamp255(v: number): number {
  return Math.max(0, Math.min(255, v))
}

export function canvasToBytes(
  canvas: HTMLCanvasElement,
  mimeType: string,
  quality = 0.92,
): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      async (blob) => {
        if (!blob) {
          reject(new Error('Canvas export failed'))
          return
        }
        const buf = await blob.arrayBuffer()
        resolve(new Uint8Array(buf))
      },
      mimeType,
      quality,
    )
  })
}

export function mimeTypeForFileName(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase()
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg'
  if (ext === 'webp') return 'image/webp'
  return 'image/png'
}
