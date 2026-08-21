import { invoke } from '@tauri-apps/api/core'
import { open, save } from '@tauri-apps/plugin-dialog'
import type { PdfInfo } from './types'

interface RawPdfInfo {
  path: string
  page_count: number
}

function fromRaw(raw: RawPdfInfo): PdfInfo {
  return { path: raw.path, pageCount: raw.page_count }
}

export async function pickPdfFiles(multiple = false): Promise<string[]> {
  const result = await open({ multiple, filters: [{ name: 'PDF', extensions: ['pdf'] }] })
  if (!result) return []
  return Array.isArray(result) ? result : [result]
}

export async function pickPdfSavePath(defaultName: string): Promise<string | null> {
  const result = await save({ defaultPath: defaultName, filters: [{ name: 'PDF', extensions: ['pdf'] }] })
  return result ?? null
}

export async function pickOutputDir(): Promise<string | null> {
  const result = await open({ directory: true, multiple: false })
  return typeof result === 'string' ? result : null
}

export async function inspectPdf(filePath: string): Promise<PdfInfo> {
  const raw = await invoke<RawPdfInfo>('pdf_tool_inspect', { filePath })
  return fromRaw(raw)
}

export async function mergePdfs(inputPaths: string[], outputPath: string): Promise<PdfInfo> {
  const raw = await invoke<RawPdfInfo>('pdf_tool_merge', { inputPaths, outputPath })
  return fromRaw(raw)
}

export async function splitPdf(
  inputPath: string,
  outputDir: string,
  ranges?: string[],
): Promise<PdfInfo[]> {
  const raw = await invoke<RawPdfInfo[]>('pdf_tool_split', { inputPath, outputDir, ranges: ranges ?? null })
  return raw.map(fromRaw)
}

export async function stampPdfText(
  inputPath: string,
  outputPath: string,
  pageNumber: number,
  text: string,
  x: number,
  y: number,
  fontSize: number,
): Promise<PdfInfo> {
  const raw = await invoke<RawPdfInfo>('pdf_tool_stamp_text', {
    inputPath,
    outputPath,
    pageNumber,
    text,
    x,
    y,
    fontSize,
  })
  return fromRaw(raw)
}

export async function generateSamplePdf(outputPath: string, pageCount: number, title: string): Promise<PdfInfo> {
  const raw = await invoke<RawPdfInfo>('pdf_tool_generate_sample', { outputPath, pageCount, title })
  return fromRaw(raw)
}
