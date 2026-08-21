import { FilmIcon } from '@/shared/icons'

interface PreviewPaneProps {
  selectedClipName: string | null
  playheadSeconds: number
  totalDuration: number
}

/**
 * Preview pane — placeholder frame only, no real video decode/render.
 * TODO(real video engine): swap this static placeholder for an actual
 * <video> element or a frame-accurate renderer once the engine choice is
 * made (see NOTES.md).
 */
export function PreviewPane({ selectedClipName, playheadSeconds, totalDuration }: PreviewPaneProps) {
  return (
    <div className="glass-surface flex h-full flex-col rounded-xl p-3">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-text-primary text-[12.5px] font-semibold">Preview</h2>
        <span className="border-glass-border text-text-tertiary rounded-full border border-dashed px-2 py-0.5 text-[9px] font-medium tracking-wide uppercase">
          Placeholder frame
        </span>
      </div>
      <div className="border-glass-border bg-glass flex flex-1 flex-col items-center justify-center gap-2 rounded-lg border">
        <FilmIcon width={32} height={32} className="text-text-tertiary" />
        {selectedClipName ? (
          <p className="text-text-secondary text-[11.5px]">{selectedClipName}</p>
        ) : (
          <p className="text-text-tertiary text-[11.5px]">Add a clip to the timeline to preview it</p>
        )}
        <p className="text-text-tertiary text-[10px] tabular-nums">
          {formatTime(playheadSeconds)} / {formatTime(totalDuration)}
        </p>
      </div>
    </div>
  )
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}
