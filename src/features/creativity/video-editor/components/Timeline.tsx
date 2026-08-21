import type { TimelineClip } from '../lib/types'
import { ScissorsIcon } from '@/shared/icons'

interface TimelineProps {
  clips: TimelineClip[]
  selectedClipId: string | null
  onSelectClip: (id: string) => void
  onRemoveClip: (id: string) => void
  playheadSeconds: number
  onScrub: (seconds: number) => void
  totalDuration: number
}

const PIXELS_PER_SECOND = 6

/**
 * Timeline — placeholder clip blocks laid out by mock duration, no real
 * trim/split/render. TODO(real video engine): trimming, multi-track
 * compositing, and scrubbing-to-actual-frame all need a real engine —
 * see NOTES.md.
 */
export function Timeline({
  clips,
  selectedClipId,
  onSelectClip,
  onRemoveClip,
  playheadSeconds,
  onScrub,
  totalDuration,
}: TimelineProps) {
  function handleTrackClick(e: React.MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    const seconds = (e.clientX - rect.left) / PIXELS_PER_SECOND
    onScrub(Math.max(0, Math.min(totalDuration, seconds)))
  }

  let cursor = 0

  return (
    <div className="glass-surface flex flex-col gap-2 rounded-xl p-3">
      <div className="flex items-center justify-between">
        <h2 className="text-text-primary text-[12.5px] font-semibold">Timeline</h2>
        <span className="border-glass-border text-text-tertiary rounded-full border border-dashed px-2 py-0.5 text-[9px] font-medium tracking-wide uppercase">
          Mock durations
        </span>
      </div>

      <div
        onClick={handleTrackClick}
        className="border-glass-border bg-glass relative h-16 cursor-pointer overflow-x-auto rounded-lg border"
      >
        <div
          className="relative h-full"
          style={{ width: Math.max(400, totalDuration * PIXELS_PER_SECOND) }}
        >
          {clips.length === 0 ? (
            <div className="text-text-tertiary flex h-full items-center justify-center text-[11px]">
              Add clips from the library to build your timeline
            </div>
          ) : (
            clips.map((clip) => {
              const left = cursor * PIXELS_PER_SECOND
              cursor += clip.durationSeconds
              const width = clip.durationSeconds * PIXELS_PER_SECOND
              const isSelected = clip.id === selectedClipId
              return (
                <div
                  key={clip.id}
                  onClick={(e) => {
                    e.stopPropagation()
                    onSelectClip(clip.id)
                  }}
                  className={`group absolute top-1.5 bottom-1.5 flex items-center gap-1.5 overflow-hidden rounded-md border px-2 transition-colors duration-150 ${
                    isSelected
                      ? 'border-accent-creativity bg-accent-creativity/20'
                      : 'border-glass-border bg-glass-hover hover:bg-glass-hover'
                  }`}
                  style={{ left, width: Math.max(40, width) }}
                >
                  <span className="text-text-secondary truncate text-[10.5px] font-medium">
                    {clip.fileName}
                  </span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      onRemoveClip(clip.id)
                    }}
                    aria-label={`Remove ${clip.fileName}`}
                    className="text-text-tertiary hover:text-danger ml-auto shrink-0 opacity-0 group-hover:opacity-100"
                  >
                    <ScissorsIcon width={11} height={11} />
                  </button>
                </div>
              )
            })
          )}
          <div
            className="bg-accent-creativity pointer-events-none absolute top-0 bottom-0 w-px"
            style={{ left: playheadSeconds * PIXELS_PER_SECOND }}
          />
        </div>
      </div>
    </div>
  )
}
