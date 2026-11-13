import { useCallback, useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { cn } from '@/shared/lib/cn'
import { shell, useShell, type ShellWindow } from '@/os/kernel/shell'
import { curve, dur, springs, staggerDelay } from '@/os/motion/systemMotion'
import { prefersReducedMotion } from '@/shared/lib/motion'
import { useDwmThumbnails } from './useDwmThumbnails'
import { gridLayout, useViewport, useWindowSizes } from './windowLayout'
import { WindowPlaceholder } from './WindowPlaceholder'

const PAD = 64
const LABEL = 30

/**
 * Mission-Control-style overview of a set of windows (App Exposé for one
 * app, or every window for Task View). Previews are live DWM thumbnails;
 * the HTML underneath draws frames and labels and takes the clicks.
 */
export function Expose({ title, handles, onDone }: { title: string; handles: number[] | null; onDone: () => void }) {
  const all = useShell((s) => s.windows)
  const windows = useMemo(
    () => (handles ? handles.map((h) => all.find((w) => w.handle === h)).filter((w): w is ShellWindow => !!w) : all),
    [all, handles],
  )
  const sizes = useWindowSizes(windows.map((w) => w.handle))
  const vp = useViewport()
  const [selected, setSelected] = useState(0)
  const reduced = prefersReducedMotion()

  const tiles = useMemo(
    () => (sizes ? gridLayout(windows, sizes, { x: PAD, y: PAD + 20, w: vp.w - PAD * 2, h: vp.h - PAD * 2 - 60 }, { gap: 36, label: LABEL, maxScale: 0.6 }) : []),
    [windows, sizes, vp],
  )
  const release = useDwmThumbnails(useMemo(() => tiles.map((t) => ({ handle: t.w.handle, x: t.x, y: t.y, width: t.width, height: t.height, skip: t.w.isMinimized })), [tiles]))

  const choose = useCallback(
    (w: ShellWindow | undefined) => {
      release()
      onDone()
      if (w) void shell.focus(w.handle)
    },
    [onDone, release],
  )

  useEffect(() => {
    const perRow = tiles.length ? tiles.filter((t) => Math.abs(t.y - tiles[0].y) < 1).length : 1
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        release()
        onDone()
      } else if (e.key === 'Enter') choose(tiles[selected]?.w)
      else if (e.key === 'ArrowRight' || (e.key === 'Tab' && !e.shiftKey)) setSelected((s) => (s + 1) % tiles.length)
      else if (e.key === 'ArrowLeft' || (e.key === 'Tab' && e.shiftKey)) setSelected((s) => (s - 1 + tiles.length) % tiles.length)
      else if (e.key === 'ArrowDown') setSelected((s) => Math.min(tiles.length - 1, s + perRow))
      else if (e.key === 'ArrowUp') setSelected((s) => Math.max(0, s - perRow))
      else if (e.key === 'Delete' && tiles[selected]) void shell.close(tiles[selected].w.handle)
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [tiles, selected, choose, onDone, release])

  return (
    <motion.div
      className="fixed inset-0"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, transition: { duration: dur.fast, ease: curve.decelerate } }}
      exit={{ opacity: 0, transition: { duration: dur.fade } }}
      onClick={() => {
        release()
        onDone()
      }}
    >
      {/* The backdrop blurs in rather than appearing: the desktop visibly
          recedes behind the overview instead of being replaced by it. */}
      <motion.div
        className="absolute inset-0 bg-black/55"
        initial={{ backdropFilter: 'blur(0px)', opacity: 0 }}
        animate={{ backdropFilter: 'blur(18px)', opacity: 1 }}
        exit={{ backdropFilter: 'blur(0px)', opacity: 0 }}
        transition={{ duration: dur.normal, ease: curve.decelerate }}
      />
      <motion.p
        className="absolute inset-x-0 top-7 text-center text-[15px] font-semibold text-white/90"
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: dur.normal, ease: curve.decelerate, delay: 0.05 }}
      >
        {title}
      </motion.p>
      {!windows.length && <p className="absolute inset-0 flex items-center justify-center text-[14px] text-white/60">No open windows</p>}
      {tiles.map((t, i) => (
        <motion.button
          key={t.w.handle}
          type="button"
          onMouseEnter={() => setSelected(i)}
          onClick={(e) => {
            e.stopPropagation()
            choose(t.w)
          }}
          className="group absolute outline-none"
          style={{ left: t.x - 6, top: t.y - 6, width: t.width + 12, height: t.height + 12 + LABEL }}
          // Tiles rise into place in a quick cascade. Appearing all at once
          // reads as a screenshot; a short stagger reads as the windows
          // being gathered. Capped so twenty windows still land promptly.
          initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.88, y: 24 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={reduced ? { duration: dur.fast } : { ...springs.gentle, delay: staggerDelay(i, 0.028, 10) }}
          // The hovered tile lifts toward the viewer, so the selection is
          // felt as depth rather than only a border colour.
          whileHover={reduced ? undefined : { scale: 1.035 }}
          whileTap={reduced ? undefined : { scale: 0.99 }}
        >
          <motion.span
            className="absolute left-0 top-0 rounded-[12px] border-[3px]"
            style={{ width: t.width + 12, height: t.height + 12 }}
            animate={{
              borderColor: i === selected ? 'var(--color-accent)' : 'rgba(0,0,0,0)',
              boxShadow: i === selected ? '0 18px 48px rgb(0 0 0 / 0.5)' : '0 0px 0px rgb(0 0 0 / 0)',
            }}
            transition={{ duration: 0.16, ease: curve.decelerate }}
          />
          {t.w.isMinimized && <WindowPlaceholder w={t.w} width={t.width} height={t.height} />}
          <span className={cn('absolute inset-x-0 bottom-0 truncate px-2 text-center text-[12.5px] font-medium transition-colors duration-150', i === selected ? 'text-white' : 'text-white/70')} style={{ height: LABEL - 8 }}>
            {t.w.title}
          </span>
        </motion.button>
      ))}
    </motion.div>
  )
}
