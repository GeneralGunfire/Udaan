import { useCallback, useState } from 'react'
import { GlassPanel } from '@/shared/components/GlassPanel'
import { CameraIcon, CropIcon, DownloadIcon, ClipboardIcon } from '@/shared/icons'
import { useScreenshotTool } from './hooks/useScreenshotTool'
import { RegionSelector } from './components/RegionSelector'
import { readScreenshotBytes, captureScreen, captureRegion } from '@/integrations/screenshot-tool'
import type { ScreenshotEntry } from '@/integrations/screenshot-tool'

function formatTimestamp(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

async function bytesToDataUrl(bytes: Uint8Array): Promise<{ url: string; width: number; height: number }> {
  const blob = new Blob([bytes.slice().buffer], { type: 'image/png' })
  const bitmap = await createImageBitmap(blob)
  const url = URL.createObjectURL(blob)
  return { url, width: bitmap.width, height: bitmap.height }
}

/**
 * Real screen capture via a Rust `xcap`-backed backend — full monitor, one window, or a
 * region cropped from a captured frame. Saves PNGs to the app data dir under
 * `screenshots/YYYY-MM-DD/`. Annotate-after-capture (crop/arrow/text) is not built yet —
 * flagged as a follow-up in NOTES.md, per the brief's own fallback allowance.
 */
export function ScreenshotToolView() {
  const {
    monitors,
    windows,
    history,
    loading,
    capturing,
    error,
    lastCapture,
    captureFullScreen,
    captureOneWindow,
    copyToClipboard,
  } = useScreenshotTool()

  const [regionFrame, setRegionFrame] = useState<{
    monitorIndex: number
    url: string
    width: number
    height: number
  } | null>(null)
  const [regionBusy, setRegionBusy] = useState(false)
  const [regionResult, setRegionResult] = useState<ScreenshotEntry | null>(null)
  const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({})

  const loadPreview = useCallback(async (entry: ScreenshotEntry) => {
    if (previewUrls[entry.path]) return
    try {
      const bytes = await readScreenshotBytes(entry.path)
      const { url } = await bytesToDataUrl(bytes)
      setPreviewUrls((prev) => ({ ...prev, [entry.path]: url }))
    } catch (err) {
      console.error('Failed to load screenshot preview', err)
    }
  }, [previewUrls])

  async function startRegionCapture(monitorIndex: number) {
    setRegionBusy(true)
    setRegionResult(null)
    try {
      const frame = await captureScreen(monitorIndex)
      const bytes = await readScreenshotBytes(frame.path)
      const { url, width, height } = await bytesToDataUrl(bytes)
      setRegionFrame({ monitorIndex, url, width, height })
    } catch (err) {
      console.error('Failed to capture frame for region select', err)
    } finally {
      setRegionBusy(false)
    }
  }

  async function confirmRegion(region: { x: number; y: number; width: number; height: number }) {
    if (!regionFrame) return
    setRegionBusy(true)
    try {
      const entry = await captureRegion(
        regionFrame.monitorIndex,
        region.x,
        region.y,
        region.width,
        region.height,
      )
      setRegionResult(entry)
      setRegionFrame(null)
    } catch (err) {
      console.error('Failed to crop region', err)
    } finally {
      setRegionBusy(false)
    }
  }

  return (
    <div className="flex w-full max-w-2xl flex-col gap-4 overflow-y-auto py-4">
      <div className="flex items-center gap-2">
        <CameraIcon width={16} height={16} className="text-brand-teal" />
        <h1 className="font-display text-text-primary text-[16px] font-semibold">Screenshots</h1>
      </div>

      {error && (
        <GlassPanel className="border border-red-400/30">
          <p className="text-[12.5px] text-red-400">{error}</p>
        </GlassPanel>
      )}

      {regionFrame ? (
        <GlassPanel>
          <RegionSelector
            imageSrc={regionFrame.url}
            naturalWidth={regionFrame.width}
            naturalHeight={regionFrame.height}
            onConfirm={confirmRegion}
            onCancel={() => setRegionFrame(null)}
          />
        </GlassPanel>
      ) : (
        <GlassPanel className="flex flex-col gap-3">
          <h2 className="text-text-primary text-[13px] font-semibold">Capture</h2>

          <div className="flex flex-col gap-1.5">
            <p className="text-text-tertiary text-[11px]">Full screen</p>
            <div className="flex flex-wrap gap-2">
              {loading ? (
                <span className="text-text-tertiary text-[11.5px]">Loading displays…</span>
              ) : monitors.length === 0 ? (
                <span className="text-text-tertiary text-[11.5px]">No displays detected.</span>
              ) : (
                monitors.map((m, idx) => (
                  <button
                    key={m.id}
                    type="button"
                    disabled={capturing}
                    onClick={() => captureFullScreen(idx)}
                    className="bg-glass hover:bg-glass-hover text-text-secondary hover:text-text-primary flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11.5px] font-medium transition-colors duration-150 disabled:opacity-50"
                  >
                    <CameraIcon width={12} height={12} />
                    {m.name}
                    {m.isPrimary && <span className="text-text-tertiary">(primary)</span>}
                  </button>
                ))
              )}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <p className="text-text-tertiary text-[11px]">Window</p>
            <div className="flex flex-wrap gap-2">
              {windows.length === 0 ? (
                <span className="text-text-tertiary text-[11.5px]">No open windows found.</span>
              ) : (
                windows.map((w, idx) => (
                  <button
                    key={w.id}
                    type="button"
                    disabled={capturing}
                    onClick={() => captureOneWindow(idx)}
                    className="bg-glass hover:bg-glass-hover text-text-secondary hover:text-text-primary max-w-50 truncate rounded-md px-2.5 py-1.5 text-[11.5px] font-medium transition-colors duration-150 disabled:opacity-50"
                    title={w.title}
                  >
                    {w.title}
                  </button>
                ))
              )}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <p className="text-text-tertiary text-[11px]">Region</p>
            <div className="flex flex-wrap gap-2">
              {monitors.map((m, idx) => (
                <button
                  key={m.id}
                  type="button"
                  disabled={capturing || regionBusy}
                  onClick={() => startRegionCapture(idx)}
                  className="bg-glass hover:bg-glass-hover text-text-secondary hover:text-text-primary flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11.5px] font-medium transition-colors duration-150 disabled:opacity-50"
                >
                  <CropIcon width={12} height={12} />
                  Select on {m.name}
                </button>
              ))}
            </div>
          </div>
        </GlassPanel>
      )}

      {(lastCapture || regionResult) && (
        <GlassPanel className="flex items-center gap-3">
          <span className="text-text-secondary text-[12px]">Saved: </span>
          <span className="text-text-primary truncate text-[12px] font-medium">
            {(regionResult ?? lastCapture)!.fileName}
          </span>
          <button
            type="button"
            onClick={() => copyToClipboard((regionResult ?? lastCapture)!)}
            className="text-text-tertiary hover:text-text-primary ml-auto flex items-center gap-1 text-[11.5px] transition-colors duration-150"
          >
            <ClipboardIcon width={12} height={12} />
            Copy
          </button>
        </GlassPanel>
      )}

      <div className="flex flex-col gap-2">
        <h2 className="text-text-primary text-[13px] font-semibold">History</h2>
        {history.length === 0 ? (
          <GlassPanel>
            <p className="text-text-secondary text-[12.5px]">No captures yet.</p>
          </GlassPanel>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {history.map((entry) => (
              <button
                key={entry.path}
                type="button"
                onMouseEnter={() => loadPreview(entry)}
                onClick={() => copyToClipboard(entry)}
                title="Click to copy to clipboard"
                className="glass-surface flex flex-col gap-1 overflow-hidden rounded-lg p-1.5 text-left transition-colors duration-150 hover:bg-glass-hover"
              >
                <div className="bg-glass-hover flex h-20 w-full items-center justify-center overflow-hidden rounded-md">
                  {previewUrls[entry.path] ? (
                    <img src={previewUrls[entry.path]} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <DownloadIcon width={14} height={14} className="text-text-tertiary" />
                  )}
                </div>
                <p className="text-text-tertiary truncate text-[10px]">{formatTimestamp(entry.createdAt)}</p>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
