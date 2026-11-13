import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { invoke } from '@tauri-apps/api/core'
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog'
import { openWithSystem } from '@/integrations/file-explorer/client'

type ToolId = 'merge' | 'split' | 'rotate' | 'delete' | 'compress' | 'stamp'

const TOOLS: { id: ToolId; name: string; desc: string; icon: string }[] = [
  { id: 'merge', name: 'Merge', desc: 'Combine several PDFs into one', icon: '⧉' },
  { id: 'split', name: 'Split', desc: 'Pull pages out into separate files', icon: '✂' },
  { id: 'rotate', name: 'Rotate', desc: 'Turn pages the right way up', icon: '↻' },
  { id: 'delete', name: 'Remove pages', desc: 'Delete pages you don’t need', icon: '⌫' },
  { id: 'compress', name: 'Compress', desc: 'Make the file smaller', icon: '⇲' },
  { id: 'stamp', name: 'Add text', desc: 'Write a line of text onto a page', icon: 'T' },
]

/** "1-3, 5" → [1,2,3,5] */
function parsePages(text: string): number[] {
  const out = new Set<number>()
  for (const part of text.split(',').map((p) => p.trim()).filter(Boolean)) {
    const [a, b] = part.split('-').map((n) => parseInt(n, 10))
    if (Number.isNaN(a)) continue
    for (let i = a; i <= (Number.isNaN(b) ? a : b); i++) out.add(i)
  }
  return [...out].sort((x, y) => x - y)
}

const name = (p: string) => p.split(/[\\/]/).pop() ?? p
const PDF = [{ name: 'PDF', extensions: ['pdf'] }]

/** PDF Toolkit: merge, split, rotate, remove pages, compress and add text. */
export function PdfApp(_props: { onClose: () => void }) {
  const [tool, setTool] = useState<ToolId | null>(null)
  const [files, setFiles] = useState<string[]>([])
  const [pages, setPages] = useState('')
  const [degrees, setDegrees] = useState(90)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; msg: string; path?: string } | null>(null)
  const [count, setCount] = useState<number | null>(null)

  const pick = async (multiple: boolean) => {
    const sel = await openDialog({ multiple, filters: PDF })
    const list = Array.isArray(sel) ? sel : sel ? [sel] : []
    setFiles((prev) => (multiple ? [...prev, ...list] : list))
    setResult(null)
    if (list[0]) void invoke<{ page_count: number }>('pdf_tool_inspect', { filePath: list[0] }).then((i) => setCount(i.page_count), () => setCount(null))
  }

  const outPath = async (suffix: string) => saveDialog({ defaultPath: files[0]?.replace(/\.pdf$/i, ` (${suffix}).pdf`), filters: PDF })

  const run = async () => {
    if (!tool || !files.length) return
    setBusy(true)
    setResult(null)
    try {
      if (tool === 'split') {
        const dir = await openDialog({ directory: true })
        if (typeof dir !== 'string') return
        const ranges = pages.trim() ? pages.split(',').map((r) => r.trim()) : null
        const made = await invoke<{ path: string }[]>('pdf_tool_split', { inputPath: files[0], outputDir: dir, ranges })
        setResult({ ok: true, msg: `Made ${made.length} files`, path: dir })
        return
      }
      const out = await outPath({ merge: 'merged', rotate: 'rotated', delete: 'edited', compress: 'compressed', stamp: 'with text' }[tool])
      if (!out) return
      if (tool === 'merge') {
        const r = await invoke<{ page_count: number }>('pdf_tool_merge', { inputPaths: files, outputPath: out })
        setResult({ ok: true, msg: `Merged into ${r.page_count} pages`, path: out })
      } else if (tool === 'rotate') {
        await invoke('pdf_tool_rotate', { inputPath: files[0], outputPath: out, pages: parsePages(pages), degrees })
        setResult({ ok: true, msg: 'Rotated', path: out })
      } else if (tool === 'delete') {
        const r = await invoke<{ page_count: number }>('pdf_tool_delete_pages', { inputPath: files[0], outputPath: out, pages: parsePages(pages) })
        setResult({ ok: true, msg: `Done — ${r.page_count} pages left`, path: out })
      } else if (tool === 'compress') {
        const [before, after] = await invoke<[number, number]>('pdf_tool_compress', { inputPath: files[0], outputPath: out })
        const saved = before ? Math.round((1 - after / before) * 100) : 0
        setResult({ ok: true, msg: saved > 0 ? `${saved}% smaller (${(after / 1e6).toFixed(1)} MB)` : 'Already about as small as it gets', path: out })
      } else if (tool === 'stamp') {
        const page = parsePages(pages)[0] ?? 1
        await invoke('pdf_tool_stamp_text', { inputPath: files[0], outputPath: out, pageNumber: page, text, x: 50, y: 50, fontSize: 14 })
        setResult({ ok: true, msg: `Text added to page ${page}`, path: out })
      }
    } catch (err) {
      setResult({ ok: false, msg: String(err) })
    } finally {
      setBusy(false)
    }
  }

  const current = TOOLS.find((t) => t.id === tool)
  const ready = files.length > 0 && (tool !== 'merge' || files.length > 1) && (tool !== 'delete' || parsePages(pages).length > 0) && (tool !== 'stamp' || text.trim())

  return (
    <div className="flex h-full flex-col bg-[var(--surface-base)] text-[var(--color-text-primary)]">
      <AnimatePresence mode="wait">
        {!current ? (
          <motion.div key="home" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex-1 overflow-y-auto px-8 py-7">
            <h1 className="text-[26px] font-bold tracking-tight">PDF Toolkit</h1>
            <p className="mt-1 text-[13.5px] text-[var(--color-text-tertiary)]">Everything happens on your PC — files never leave it.</p>
            <div className="mt-6 grid grid-cols-3 gap-3">
              {TOOLS.map((t, i) => (
                <motion.button
                  key={t.id}
                  type="button"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.04 }}
                  onClick={() => {
                    setTool(t.id)
                    setFiles([])
                    setPages('')
                    setResult(null)
                  }}
                  className="flex flex-col items-start gap-3 rounded-[16px] border border-[var(--border-hairline)] bg-white/[0.04] p-5 text-left transition-colors hover:bg-[var(--os-menu-item-hover)]"
                >
                  <span className="flex h-11 w-11 items-center justify-center rounded-[12px] bg-[#e5534b]/20 text-[20px] text-[#ff8a80]">{t.icon}</span>
                  <span>
                    <span className="block text-[15px] font-semibold">{t.name}</span>
                    <span className="block text-[12.5px] text-[var(--color-text-tertiary)]">{t.desc}</span>
                  </span>
                </motion.button>
              ))}
            </div>
          </motion.div>
        ) : (
          <motion.div key="tool" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} className="mx-auto w-full max-w-[640px] flex-1 overflow-y-auto px-8 py-7">
            <button type="button" onClick={() => setTool(null)} className="text-[13px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]">
              ‹ All tools
            </button>
            <h1 className="mt-2 text-[24px] font-bold">{current.name}</h1>
            <p className="text-[13.5px] text-[var(--color-text-tertiary)]">{current.desc}</p>

            <div className="mt-5 rounded-[14px] border border-dashed border-white/15 p-4">
              {files.length === 0 ? (
                <button type="button" onClick={() => void pick(tool === 'merge')} className="h-11 w-full rounded-[10px] bg-[var(--os-menu-item-hover)] text-[14px] font-medium hover:bg-white/[0.14]">
                  {tool === 'merge' ? 'Choose PDFs…' : 'Choose a PDF…'}
                </button>
              ) : (
                <>
                  {files.map((f, i) => (
                    <div key={f + i} className="flex items-center gap-2 py-1 text-[13.5px]">
                      <span className="text-[var(--color-text-tertiary)]">{i + 1}.</span>
                      <span className="min-w-0 flex-1 truncate">{name(f)}</span>
                      {tool === 'merge' && i > 0 && (
                        <button type="button" onClick={() => setFiles((l) => { const n = [...l]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; return n })} className="text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]">
                          ↑
                        </button>
                      )}
                      <button type="button" onClick={() => setFiles((l) => l.filter((_, k) => k !== i))} className="text-[var(--color-text-tertiary)] hover:text-[#ff6b6b]">
                        ×
                      </button>
                    </div>
                  ))}
                  {tool === 'merge' && (
                    <button type="button" onClick={() => void pick(true)} className="mt-1 text-[13px] text-[#8fbaff]">
                      + Add more
                    </button>
                  )}
                  {count !== null && tool !== 'merge' && <p className="mt-1 text-[12px] text-[var(--color-text-tertiary)]">{count} pages</p>}
                </>
              )}
            </div>

            {(tool === 'split' || tool === 'rotate' || tool === 'delete' || tool === 'stamp') && (
              <label className="mt-4 block text-[13px] text-[var(--color-text-secondary)]">
                {tool === 'split' ? 'Page ranges, one file each (e.g. 1-3, 4-6) — leave empty for one file per page' : tool === 'stamp' ? 'Page number' : tool === 'rotate' ? 'Pages (e.g. 1-3, 5) — leave empty for all' : 'Pages to remove (e.g. 2, 5-7)'}
                <input value={pages} onChange={(e) => setPages(e.target.value)} className="mt-1.5 h-10 w-full rounded-[10px] bg-[var(--os-menu-item-hover)] px-3 text-[14px] text-[var(--color-text-primary)] outline-none" />
              </label>
            )}
            {tool === 'rotate' && (
              <div className="mt-3 flex gap-2">
                {[90, 180, 270].map((d) => (
                  <button key={d} type="button" onClick={() => setDegrees(d)} className={`h-9 rounded-full px-4 text-[13px] font-medium ${degrees === d ? 'bg-white text-black' : 'bg-[var(--os-menu-item-hover)]'}`}>
                    {d === 270 ? '90° left' : d === 90 ? '90° right' : '180°'}
                  </button>
                ))}
              </div>
            )}
            {tool === 'stamp' && (
              <label className="mt-3 block text-[13px] text-[var(--color-text-secondary)]">
                Text
                <input value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. Tess — Grade 11" className="mt-1.5 h-10 w-full rounded-[10px] bg-[var(--os-menu-item-hover)] px-3 text-[14px] text-[var(--color-text-primary)] outline-none" />
              </label>
            )}

            <button type="button" disabled={!ready || busy} onClick={() => void run()} className="mt-6 h-11 w-full rounded-[11px] bg-[#e5534b] text-[14.5px] font-semibold transition-[filter] hover:brightness-110 disabled:opacity-40">
              {busy ? 'Working…' : current.name}
            </button>

            <AnimatePresence>
              {result && (
                <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className={`mt-4 flex items-center gap-3 rounded-[12px] px-4 py-3 text-[13.5px] ${result.ok ? 'bg-[#34c759]/12 text-[#8ee0a4]' : 'bg-[#ff453a]/12 text-[#ff8a80]'}`}>
                  <span className="flex-1">{result.msg}</span>
                  {result.path && (
                    <button type="button" onClick={() => void openWithSystem(result.path!)} className="rounded-[8px] bg-white/10 px-3 py-1 text-[12.5px] font-medium text-[var(--color-text-primary)]">
                      Open
                    </button>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
