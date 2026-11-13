import { AnimatePresence, motion, Reorder } from 'framer-motion'
import { TrashIcon, WindowCloseIcon } from '@/shared/icons'
import { zIndex, spring, prefersReducedMotion } from '@/shared/lib/motion'
import { formatDuration, type AudioTrack } from '../lib/types'

interface QueueDrawerProps {
  open: boolean
  queue: AudioTrack[]
  currentIndex: number
  onReorder: (tracks: AudioTrack[]) => void
  onJumpTo: (index: number) => void
  onRemove: (index: number) => void
  onClose: () => void
}

/**
 * Drag-to-reorder queue, same `Reorder.Group` mechanic as the original.
 * No cover art (matches the rest of the app).
 *
 * Fixed slide-over panel with its own backdrop — this used to render as a
 * plain flex sibling inside PrivatePlayerView's row, with no
 * `position: fixed`. That meant opening the queue didn't overlay the
 * player at all: it physically squeezed the whole player column 320px
 * narrower, a real layout-shift bug rather than the slide-in drawer it
 * was meant to be.
 */
export function QueueDrawer({ open, queue, currentIndex, onReorder, onJumpTo, onRemove, onClose }: QueueDrawerProps) {
  const reduced = prefersReducedMotion()

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduced ? 0 : 0.15 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/40"
            style={{ zIndex: zIndex.overlay }}
          />
          <motion.div
            initial={reduced ? { opacity: 0 } : { x: 320 }}
            animate={{ x: 0 }}
            exit={reduced ? { opacity: 0 } : { x: 320 }}
            transition={spring.standard}
            className="border-hairline fixed inset-y-0 right-0 flex h-full w-80 flex-col border-l"
            style={{ backgroundColor: 'var(--surface-base)', zIndex: zIndex.overlayPanel }}
          >
            <div className="border-hairline flex items-center justify-between border-b px-4 py-3">
              <h3 className="text-text-primary text-[15px] font-semibold">Queue</h3>
              <button type="button" onClick={onClose} className="text-text-secondary hover:text-text-primary rounded-md p-1">
                <WindowCloseIcon width={14} height={14} />
              </button>
            </div>

            <Reorder.Group axis="y" values={queue} onReorder={onReorder} className="min-h-0 flex-1 overflow-y-auto p-2">
              {queue.map((track, index) => (
                <Reorder.Item key={track.path} value={track} className="mb-1">
                  <div
                    className={`group flex items-center gap-2 rounded-lg px-2 py-2.5 ${
                      index === currentIndex ? 'bg-[var(--os-menu-item-hover)]' : 'hover:bg-[var(--os-menu-item-hover)]'
                    }`}
                  >
                    <button type="button" onClick={() => onJumpTo(index)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                      <div className="min-w-0 flex-1">
                        <p className={`truncate text-[13px] font-medium ${index === currentIndex ? 'text-accent' : 'text-text-primary'}`}>
                          {track.title}
                        </p>
                        <p className="text-text-tertiary truncate text-2xs">{track.artist}</p>
                      </div>
                      <span className="text-text-tertiary shrink-0 text-2xs tabular-nums">{formatDuration(track.durationSeconds)}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onRemove(index)}
                      className="text-text-tertiary hover:text-danger shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
                    >
                      <TrashIcon width={14} height={14} />
                    </button>
                  </div>
                </Reorder.Item>
              ))}
            </Reorder.Group>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
