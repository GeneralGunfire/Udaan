import { useCallback, useState } from 'react'
import {
  pickPdfFiles,
  pickPdfSavePath,
  pickOutputDir,
  inspectPdf,
  mergePdfs,
  splitPdf,
  generateSamplePdf,
  type PdfInfo,
} from '@/integrations/pdf-tool'

export function usePdfTool() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mergeInputs, setMergeInputs] = useState<PdfInfo[]>([])
  const [mergeResult, setMergeResult] = useState<PdfInfo | null>(null)
  const [splitInput, setSplitInput] = useState<PdfInfo | null>(null)
  const [splitResults, setSplitResults] = useState<PdfInfo[]>([])

  const addMergeInputs = useCallback(async () => {
    setError(null)
    try {
      const paths = await pickPdfFiles(true)
      const infos = await Promise.all(paths.map(inspectPdf))
      setMergeInputs((prev) => [...prev, ...infos])
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  const removeMergeInput = useCallback((path: string) => {
    setMergeInputs((prev) => prev.filter((p) => p.path !== path))
  }, [])

  const runMerge = useCallback(async () => {
    if (mergeInputs.length < 2) {
      setError('Add at least two PDFs to merge.')
      return
    }
    setError(null)
    setBusy(true)
    try {
      const outputPath = await pickPdfSavePath('merged.pdf')
      if (!outputPath) return
      const result = await mergePdfs(mergeInputs.map((f) => f.path), outputPath)
      setMergeResult(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }, [mergeInputs])

  const pickSplitInput = useCallback(async () => {
    setError(null)
    try {
      const [path] = await pickPdfFiles(false)
      if (!path) return
      const info = await inspectPdf(path)
      setSplitInput(info)
      setSplitResults([])
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  const runSplit = useCallback(
    async (ranges?: string[]) => {
      if (!splitInput) return
      setError(null)
      setBusy(true)
      try {
        const outputDir = await pickOutputDir()
        if (!outputDir) return
        const results = await splitPdf(splitInput.path, outputDir, ranges)
        setSplitResults(results)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setBusy(false)
      }
    },
    [splitInput],
  )

  const createSample = useCallback(async () => {
    setError(null)
    setBusy(true)
    try {
      const outputPath = await pickPdfSavePath('sample.pdf')
      if (!outputPath) return null
      const info = await generateSamplePdf(outputPath, 3, 'Udaan sample PDF')
      return info
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      return null
    } finally {
      setBusy(false)
    }
  }, [])

  return {
    busy,
    error,
    mergeInputs,
    mergeResult,
    addMergeInputs,
    removeMergeInput,
    runMerge,
    splitInput,
    splitResults,
    pickSplitInput,
    runSplit,
    createSample,
  }
}
