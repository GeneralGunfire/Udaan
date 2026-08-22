import { useState } from 'react'
import { pickPdfFiles, pickPdfSavePath, inspectPdf, stampPdfText } from '@/integrations/pdf-tool'
import type { PdfInfo } from '@/integrations/pdf-tool'
import { Button } from '@/shared/components/ui/button'

/**
 * Basic annotate: stamps one line of text onto a page. Full annotate (crop/arrow/free-draw)
 * needs a page-rendering layer (rasterize each page to preview it) which no lightweight Rust
 * crate in this dependency set provides — flagged as a follow-up in NOTES.md. This ships the
 * "at least text" fallback the brief explicitly allows.
 */
export function StampPanel() {
  const [input, setInput] = useState<PdfInfo | null>(null)
  const [text, setText] = useState('')
  const [page, setPage] = useState(1)
  const [x, setX] = useState(72)
  const [y, setY] = useState(72)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<PdfInfo | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function pickInput() {
    setError(null)
    const [path] = await pickPdfFiles(false)
    if (!path) return
    try {
      const info = await inspectPdf(path)
      setInput(info)
      setResult(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function runStamp() {
    if (!input || !text.trim()) return
    setError(null)
    setBusy(true)
    try {
      const outputPath = await pickPdfSavePath('annotated.pdf')
      if (!outputPath) return
      const info = await stampPdfText(input.path, outputPath, page, text, x, y, 18)
      setResult(info)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Button type="button" onClick={pickInput} variant="surface" size="pill-sm" className="rounded-md">
          Choose PDF
        </Button>
        {input && (
          <span className="text-text-tertiary truncate text-[11.5px]">
            {input.path.split(/[\\/]/).pop()} · {input.pageCount} page{input.pageCount === 1 ? '' : 's'}
          </span>
        )}
      </div>

      {input && (
        <div className="flex flex-col gap-2">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Text to stamp…"
            className="glass-surface text-text-primary placeholder:text-text-tertiary focus-visible:ring-brand-cyan/60 rounded-md px-2.5 py-1.5 text-[12px] outline-none focus-visible:ring-2"
          />
          <div className="flex items-center gap-3 text-[11px]">
            <label className="text-text-tertiary flex items-center gap-1.5">
              Page
              <input
                type="number"
                min={1}
                max={input.pageCount}
                value={page}
                onChange={(e) => setPage(Number(e.target.value) || 1)}
                className="glass-surface text-text-primary focus-visible:ring-brand-cyan/60 w-14 rounded px-1.5 py-1 outline-none focus-visible:ring-2"
              />
            </label>
            <label className="text-text-tertiary flex items-center gap-1.5">
              X
              <input
                type="number"
                value={x}
                onChange={(e) => setX(Number(e.target.value) || 0)}
                className="glass-surface text-text-primary focus-visible:ring-brand-cyan/60 w-16 rounded px-1.5 py-1 outline-none focus-visible:ring-2"
              />
            </label>
            <label className="text-text-tertiary flex items-center gap-1.5">
              Y
              <input
                type="number"
                value={y}
                onChange={(e) => setY(Number(e.target.value) || 0)}
                className="glass-surface text-text-primary focus-visible:ring-brand-cyan/60 w-16 rounded px-1.5 py-1 outline-none focus-visible:ring-2"
              />
            </label>
          </div>
          <Button
            type="button"
            disabled={busy || !text.trim()}
            onClick={runStamp}
            variant="surface"
            size="pill-sm"
            className="bg-brand-teal/20 hover:bg-brand-teal/30 self-start rounded-md disabled:opacity-50"
          >
            {busy ? 'Stamping…' : 'Stamp & Save'}
          </Button>
        </div>
      )}

      {error && <p className="text-[11.5px] text-red-400">{error}</p>}
      {result && (
        <p className="text-text-secondary text-[11.5px]">
          Saved: <span className="text-text-primary font-medium">{result.path.split(/[\\/]/).pop()}</span>
        </p>
      )}
    </div>
  )
}
