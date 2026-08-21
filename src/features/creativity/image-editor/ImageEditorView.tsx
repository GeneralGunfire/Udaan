import { useMemo, useState } from 'react'
import { useImageEditor } from './hooks/useImageEditor'
import { useAssetFolder } from './hooks/useAssetFolder'
import { AssetBrowser } from './components/AssetBrowser'
import { CanvasPreview } from './components/CanvasPreview'
import { AdjustmentSlider } from './components/AdjustmentSlider'
import { BatchPanel } from './components/BatchPanel'
import type { AssetEntry } from '@/integrations/asset-library'
import { ImageIcon, PencilIcon } from '@/shared/icons'

/**
 * Image Editor — crop/resize/adjustments over a real Canvas 2D pipeline
 * (see lib/imageOps.ts), plus batch operations across a folder of local
 * images. Export writes real files via the native save dialog.
 */
export function ImageEditorView() {
  const editor = useImageEditor()
  const library = useAssetFolder()
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set())
  const [cropMode, setCropMode] = useState(false)
  const [widthInput, setWidthInput] = useState('')
  const [heightInput, setHeightInput] = useState('')
  const [exportedPath, setExportedPath] = useState<string | null>(null)

  const previewVersion = useMemo(
    () =>
      JSON.stringify([
        editor.image?.path,
        editor.adjustments,
        editor.crop,
        editor.targetSize,
      ]),
    [editor.image, editor.adjustments, editor.crop, editor.targetSize],
  )

  function handleOpenAsset(asset: AssetEntry) {
    editor.loadFromPath(asset.path, asset.fileName)
    setExportedPath(null)
  }

  function toggleSelect(path: string) {
    setSelectedPaths((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  function applyResize() {
    const w = Number(widthInput)
    const h = Number(heightInput)
    if (w > 0 && h > 0) editor.setTargetSize({ width: w, height: h })
  }

  async function handleExport() {
    const path = await editor.exportCurrent()
    if (path) setExportedPath(path)
  }

  const displayWidth = editor.targetSize?.width ?? editor.crop?.width ?? editor.image?.width ?? 0
  const displayHeight = editor.targetSize?.height ?? editor.crop?.height ?? editor.image?.height ?? 0

  return (
    <div className="flex h-full w-full max-w-[1400px] flex-col gap-3 overflow-y-auto py-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <PencilIcon width={16} height={16} className="text-accent-creativity" />
          <h1 className="font-display text-text-primary text-[16px] font-semibold">
            Image Editor
          </h1>
        </div>
        {exportedPath && (
          <span className="text-success text-[11px]">Exported to {exportedPath}</span>
        )}
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[240px_1fr_280px] gap-3">
        <AssetBrowser
          folderPath={library.folderPath}
          assets={library.assets}
          loading={library.loading}
          selectedPaths={selectedPaths}
          onPickFolder={library.pickFolder}
          onPickFiles={library.pickFiles}
          onOpenAsset={handleOpenAsset}
          onToggleSelect={toggleSelect}
        />

        <div className="glass-surface flex min-h-0 flex-col rounded-xl p-3">
          {editor.loading ? (
            <div className="flex flex-1 items-center justify-center">
              <p className="text-text-tertiary text-[12px]">Loading image...</p>
            </div>
          ) : editor.image ? (
            <>
              <div className="mb-2 flex items-center justify-between">
                <p className="text-text-secondary truncate text-[11px] font-medium">
                  {editor.image.fileName}
                </p>
                <button
                  type="button"
                  onClick={() => setCropMode((c) => !c)}
                  className={`rounded-md px-2 py-1 text-[10.5px] font-medium transition-colors duration-150 ${
                    cropMode
                      ? 'bg-accent-creativity text-white'
                      : 'text-text-secondary hover:bg-glass-hover'
                  }`}
                >
                  {cropMode ? 'Drag to crop' : 'Crop'}
                </button>
              </div>
              <div className="min-h-0 flex-1">
                <CanvasPreview
                  renderFinal={editor.renderFinal}
                  version={previewVersion.length}
                  cropMode={cropMode}
                  crop={editor.crop}
                  onCropChange={editor.setCrop}
                  sourceWidth={editor.image.width}
                  sourceHeight={editor.image.height}
                />
              </div>
            </>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-2">
              <ImageIcon width={28} height={28} className="text-text-tertiary" />
              <p className="text-text-tertiary text-[12px]">
                Pick a folder, then click an image to start editing.
              </p>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-3 overflow-y-auto">
          <div className="glass-surface flex flex-col gap-3 rounded-xl p-4">
            <h2 className="text-text-primary text-[12.5px] font-semibold">Adjustments</h2>
            <AdjustmentSlider
              label="Brightness"
              value={editor.adjustments.brightness}
              onChange={(v) => editor.setAdjustments((a) => ({ ...a, brightness: v }))}
            />
            <AdjustmentSlider
              label="Contrast"
              value={editor.adjustments.contrast}
              onChange={(v) => editor.setAdjustments((a) => ({ ...a, contrast: v }))}
            />
            <AdjustmentSlider
              label="Saturation"
              value={editor.adjustments.saturation}
              onChange={(v) => editor.setAdjustments((a) => ({ ...a, saturation: v }))}
            />
            <button
              type="button"
              onClick={editor.resetAdjustments}
              className="text-text-tertiary hover:text-text-secondary self-start text-[10.5px]"
            >
              Reset adjustments
            </button>
          </div>

          <div className="glass-surface flex flex-col gap-2.5 rounded-xl p-4">
            <h2 className="text-text-primary text-[12.5px] font-semibold">Resize</h2>
            <div className="flex items-center gap-2">
              <input
                type="number"
                placeholder={String(displayWidth || 'W')}
                value={widthInput}
                onChange={(e) => setWidthInput(e.target.value)}
                className="border-glass-border bg-glass text-text-primary w-full rounded-md border px-2 py-1.5 text-[11px]"
              />
              <span className="text-text-tertiary text-[11px]">×</span>
              <input
                type="number"
                placeholder={String(displayHeight || 'H')}
                value={heightInput}
                onChange={(e) => setHeightInput(e.target.value)}
                className="border-glass-border bg-glass text-text-primary w-full rounded-md border px-2 py-1.5 text-[11px]"
              />
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={applyResize}
                className="border-glass-border hover:bg-glass-hover text-text-secondary flex-1 rounded-md border px-2.5 py-1.5 text-[11px] font-medium transition-colors duration-150"
              >
                Apply
              </button>
              <button
                type="button"
                onClick={editor.resetSize}
                className="text-text-tertiary hover:text-text-secondary rounded-md px-2.5 py-1.5 text-[11px]"
              >
                Reset
              </button>
            </div>
          </div>

          <button
            type="button"
            onClick={handleExport}
            disabled={!editor.image || editor.exporting}
            className="text-white transition-transform duration-150 hover:scale-[1.01] active:scale-[0.99] disabled:opacity-40"
            style={{
              background: 'var(--gradient-brand)',
              borderRadius: 'var(--radius-md)',
              padding: '10px 14px',
              fontSize: '12px',
              fontWeight: 600,
            }}
          >
            {editor.exporting ? 'Exporting...' : 'Export Image'}
          </button>

          {editor.error && <p className="text-danger text-[11px]">{editor.error}</p>}
        </div>
      </div>

      <BatchPanel selectedPaths={Array.from(selectedPaths)} adjustments={editor.adjustments} />
    </div>
  )
}
