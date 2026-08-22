import type { ExportFormat, ExportResolution, ExportSettings } from '../lib/types'
import { DownloadIcon } from '@/shared/icons'
import { Button } from '@/shared/components/ui/button'
import { Tooltip, TooltipProvider } from '@/shared/components/ui/tooltip'

interface ExportPanelProps {
  settings: ExportSettings
  onChange: (settings: ExportSettings) => void
  hasClips: boolean
}

const FORMATS: ExportFormat[] = ['mp4', 'webm', 'mov']
const RESOLUTIONS: ExportResolution[] = ['720p', '1080p', '4k']

/**
 * Export panel — UI + settings state only, no real encode/render.
 * TODO(real video engine): wire this to an actual export pipeline (likely
 * ffmpeg via a Rust sidecar) once the engine choice is made — see NOTES.md.
 */
export function ExportPanel({ settings, onChange, hasClips }: ExportPanelProps) {
  return (
    <TooltipProvider delayDuration={400}>
    <div className="glass-surface flex flex-col gap-3 rounded-xl p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <DownloadIcon width={13} height={13} className="text-accent-creativity" />
          <h2 className="text-text-primary text-[12.5px] font-semibold">Export</h2>
        </div>
        <span className="border-glass-border text-text-tertiary rounded-full border border-dashed px-2 py-0.5 text-[9px] font-medium tracking-wide uppercase">
          Not wired up
        </span>
      </div>

      <div className="flex items-center justify-between">
        <label className="text-text-secondary text-[11px] font-medium">Format</label>
        <select
          value={settings.format}
          onChange={(e) => onChange({ ...settings, format: e.target.value as ExportFormat })}
          className="border-glass-border bg-glass text-text-primary focus-visible:ring-brand-cyan/60 rounded-md border px-2 py-1 text-[11px] uppercase outline-none focus-visible:ring-2"
        >
          {FORMATS.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
      </div>

      <div className="flex items-center justify-between">
        <label className="text-text-secondary text-[11px] font-medium">Resolution</label>
        <select
          value={settings.resolution}
          onChange={(e) => onChange({ ...settings, resolution: e.target.value as ExportResolution })}
          className="border-glass-border bg-glass text-text-primary focus-visible:ring-brand-cyan/60 rounded-md border px-2 py-1 text-[11px] outline-none focus-visible:ring-2"
        >
          {RESOLUTIONS.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </div>

      <Tooltip content="Not implemented — needs a real video engine (see NOTES.md)">
        {/* Tooltip wraps a span, not the disabled button directly — disabled
            native elements don't reliably dispatch the pointer events a
            hover tooltip needs. */}
        <span className="inline-block w-fit">
          <Button type="button" disabled variant="brand" size="pill-sm" className="rounded-md opacity-40">
            Export {hasClips ? '' : '(add clips first)'}
          </Button>
        </span>
      </Tooltip>

      <p className="text-text-tertiary text-[10px] leading-relaxed">
        TODO: real encode pipeline — likely an ffmpeg sidecar process invoked from Rust, chosen once
        hardware constraints are confirmed.
      </p>
    </div>
    </TooltipProvider>
  )
}
