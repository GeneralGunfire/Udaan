import { useState } from 'react'
import { GlassPanel } from '@/shared/components/GlassPanel'
import { FileTextIcon, TrashIcon, ScissorsIcon } from '@/shared/icons'
import { usePdfTool } from './hooks/usePdfTool'
import { StampPanel } from './components/StampPanel'

type Tab = 'merge' | 'split' | 'annotate'

/**
 * Real PDF merge/split/basic-annotate backed by lopdf (not a stub). Merge stitches page trees
 * from multiple source PDFs; split clones the source per output and deletes the pages outside
 * each target range; annotate stamps a line of text onto a page's existing content stream.
 */
export function PdfToolView() {
  const [tab, setTab] = useState<Tab>('merge')
  const {
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
  } = usePdfTool()
  const [splitRangeText, setSplitRangeText] = useState('')

  return (
    <div className="flex w-full max-w-2xl flex-col gap-4 overflow-y-auto py-4">
      <div className="flex items-center gap-2">
        <FileTextIcon width={16} height={16} className="text-brand-teal" />
        <h1 className="font-display text-text-primary text-[16px] font-semibold">PDF Tool</h1>
      </div>

      <div className="flex gap-1.5">
        {(['merge', 'split', 'annotate'] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`rounded-md px-3 py-1.5 text-[11.5px] font-medium capitalize transition-colors duration-150 ${
              tab === t
                ? 'bg-brand-teal/20 text-text-primary'
                : 'bg-glass text-text-secondary hover:bg-glass-hover'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {error && (
        <GlassPanel className="border border-red-400/30">
          <p className="text-[12.5px] text-red-400">{error}</p>
        </GlassPanel>
      )}

      {tab === 'merge' && (
        <GlassPanel className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="text-text-primary text-[13px] font-semibold">Merge PDFs</h2>
            <button
              type="button"
              onClick={addMergeInputs}
              className="bg-glass hover:bg-glass-hover text-text-secondary hover:text-text-primary rounded-md px-2.5 py-1.5 text-[11.5px] font-medium transition-colors duration-150"
            >
              Add files
            </button>
          </div>

          {mergeInputs.length === 0 ? (
            <p className="text-text-secondary text-[12.5px]">
              Add two or more PDFs — they'll be merged in the order shown below.
            </p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {mergeInputs.map((f) => (
                <div
                  key={f.path}
                  className="bg-glass flex items-center justify-between gap-2 rounded-md px-2.5 py-1.5"
                >
                  <span className="text-text-primary truncate text-[11.5px]">
                    {f.path.split(/[\\/]/).pop()}
                  </span>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-text-tertiary text-[10.5px]">{f.pageCount}p</span>
                    <button
                      type="button"
                      onClick={() => removeMergeInput(f.path)}
                      aria-label="Remove"
                      className="text-text-tertiary hover:text-red-400 transition-colors duration-150"
                    >
                      <TrashIcon width={12} height={12} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <button
            type="button"
            disabled={busy || mergeInputs.length < 2}
            onClick={runMerge}
            className="bg-brand-teal/20 text-text-primary hover:bg-brand-teal/30 self-start rounded-md px-3 py-1.5 text-[11.5px] font-medium transition-colors duration-150 disabled:opacity-50"
          >
            {busy ? 'Merging…' : 'Merge & Save'}
          </button>

          {mergeResult && (
            <p className="text-text-secondary text-[11.5px]">
              Saved: <span className="text-text-primary font-medium">{mergeResult.path.split(/[\\/]/).pop()}</span>{' '}
              ({mergeResult.pageCount} pages)
            </p>
          )}
        </GlassPanel>
      )}

      {tab === 'split' && (
        <GlassPanel className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="text-text-primary text-[13px] font-semibold">Split PDF</h2>
            <button
              type="button"
              onClick={pickSplitInput}
              className="bg-glass hover:bg-glass-hover text-text-secondary hover:text-text-primary rounded-md px-2.5 py-1.5 text-[11.5px] font-medium transition-colors duration-150"
            >
              Choose PDF
            </button>
          </div>

          {splitInput && (
            <>
              <p className="text-text-secondary text-[12px]">
                {splitInput.path.split(/[\\/]/).pop()} · {splitInput.pageCount} pages
              </p>
              <div className="flex items-center gap-2">
                <ScissorsIcon width={12} height={12} className="text-text-tertiary shrink-0" />
                <input
                  value={splitRangeText}
                  onChange={(e) => setSplitRangeText(e.target.value)}
                  placeholder="Ranges e.g. 1-2,3-4 (blank = one file per page)"
                  className="glass-surface text-text-primary placeholder:text-text-tertiary min-w-0 flex-1 rounded-md px-2.5 py-1.5 text-[12px] outline-none"
                />
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  runSplit(
                    splitRangeText.trim()
                      ? splitRangeText.split(',').map((s) => s.trim())
                      : undefined,
                  )
                }
                className="bg-brand-teal/20 text-text-primary hover:bg-brand-teal/30 self-start rounded-md px-3 py-1.5 text-[11.5px] font-medium transition-colors duration-150 disabled:opacity-50"
              >
                {busy ? 'Splitting…' : 'Split & Save'}
              </button>
            </>
          )}

          {splitResults.length > 0 && (
            <div className="flex flex-col gap-1">
              {splitResults.map((r) => (
                <p key={r.path} className="text-text-secondary text-[11.5px]">
                  {r.path.split(/[\\/]/).pop()} ({r.pageCount}p)
                </p>
              ))}
            </div>
          )}
        </GlassPanel>
      )}

      {tab === 'annotate' && (
        <GlassPanel>
          <h2 className="text-text-primary mb-3 text-[13px] font-semibold">Basic Annotate</h2>
          <StampPanel />
        </GlassPanel>
      )}
    </div>
  )
}
