import { useState } from 'react'
import type { Adjustments } from '../lib/imageOps'
import { runBatch, type BatchJobResult } from '../lib/batchOps'
import { pickAssetFolder } from '@/integrations/asset-library'
import { LayersIcon } from '@/shared/icons'

interface BatchPanelProps {
  selectedPaths: string[]
  adjustments: Adjustments
}

/** Runs the current adjustment settings across every selected asset, writing to a chosen output folder. */
export function BatchPanel({ selectedPaths, adjustments }: BatchPanelProps) {
  const [outputFolder, setOutputFolder] = useState<string | null>(null)
  const [suffix, setSuffix] = useState('-edited')
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [results, setResults] = useState<BatchJobResult[] | null>(null)
  const [resizeEnabled, setResizeEnabled] = useState(false)
  const [width, setWidth] = useState(1280)
  const [height, setHeight] = useState(720)

  async function pickOutput() {
    const chosen = await pickAssetFolder()
    if (chosen) setOutputFolder(chosen)
  }

  async function run() {
    if (!outputFolder || selectedPaths.length === 0) return
    setRunning(true)
    setResults(null)
    setProgress({ done: 0, total: selectedPaths.length })
    const outcome = await runBatch(
      selectedPaths,
      {
        adjustments,
        resizeTo: resizeEnabled ? { width, height } : null,
        outputSuffix: suffix,
        outputFolder,
      },
      (done, total) => setProgress({ done, total }),
    )
    setResults(outcome)
    setRunning(false)
  }

  return (
    <div className="glass-surface flex flex-col gap-3 rounded-xl p-4">
      <div className="flex items-center gap-1.5">
        <LayersIcon width={13} height={13} className="text-accent-creativity" />
        <h2 className="text-text-primary text-[12.5px] font-semibold">Batch Operations</h2>
        <span className="text-text-tertiary text-[10.5px]">
          ({selectedPaths.length} selected)
        </span>
      </div>

      <p className="text-text-tertiary text-[10.5px] leading-relaxed">
        Applies the current adjustment sliders (and optional resize) to every checked image in the
        Assets panel, writing new files to an output folder.
      </p>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={pickOutput}
          className="border-glass-border hover:bg-glass-hover text-text-secondary rounded-md border px-2.5 py-1.5 text-[11px] font-medium transition-colors duration-150"
        >
          {outputFolder ? 'Change output folder' : 'Pick output folder'}
        </button>
        {outputFolder && (
          <span className="text-text-tertiary truncate text-[10px]" title={outputFolder}>
            {outputFolder}
          </span>
        )}
      </div>

      <div className="flex items-center gap-3">
        <label className="text-text-secondary flex items-center gap-1.5 text-[11px]">
          <input
            type="checkbox"
            checked={resizeEnabled}
            onChange={(e) => setResizeEnabled(e.target.checked)}
            className="accent-accent-creativity"
          />
          Resize to
        </label>
        <input
          type="number"
          value={width}
          disabled={!resizeEnabled}
          onChange={(e) => setWidth(Number(e.target.value))}
          className="border-glass-border bg-glass text-text-primary w-16 rounded-md border px-2 py-1 text-[11px] tabular-nums disabled:opacity-40"
        />
        <span className="text-text-tertiary text-[11px]">×</span>
        <input
          type="number"
          value={height}
          disabled={!resizeEnabled}
          onChange={(e) => setHeight(Number(e.target.value))}
          className="border-glass-border bg-glass text-text-primary w-16 rounded-md border px-2 py-1 text-[11px] tabular-nums disabled:opacity-40"
        />
        <label className="text-text-secondary ml-auto flex items-center gap-1.5 text-[11px]">
          Suffix
          <input
            type="text"
            value={suffix}
            onChange={(e) => setSuffix(e.target.value)}
            className="border-glass-border bg-glass text-text-primary w-20 rounded-md border px-2 py-1 text-[11px]"
          />
        </label>
      </div>

      <button
        type="button"
        onClick={run}
        disabled={running || !outputFolder || selectedPaths.length === 0}
        className="text-white transition-transform duration-150 hover:scale-[1.01] active:scale-[0.99] disabled:opacity-40"
        style={{ background: 'var(--gradient-brand)', borderRadius: 'var(--radius-md)', padding: '8px 14px', fontSize: '11.5px', fontWeight: 600 }}
      >
        {running
          ? `Processing ${progress?.done ?? 0}/${progress?.total ?? selectedPaths.length}...`
          : `Run batch on ${selectedPaths.length} image${selectedPaths.length === 1 ? '' : 's'}`}
      </button>

      {results && (
        <div className="border-glass-border max-h-32 overflow-y-auto rounded-md border p-2">
          {results.map((r) => (
            <div key={r.path} className="flex items-center gap-1.5 text-[10.5px]">
              <span
                className={`h-1.5 w-1.5 shrink-0 rounded-full ${r.ok ? 'bg-success' : 'bg-danger'}`}
              />
              <span className="text-text-tertiary truncate">
                {r.path.split(/[\\/]/).pop()} {r.ok ? '→ done' : `→ ${r.error}`}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
