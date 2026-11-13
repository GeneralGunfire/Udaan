import { createElement, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { openApp } from '@/os/kernel/shell'
import { useShellMenu } from '@/os/ui/useShellMenu'
import { springs, staggerDelay } from '@/os/motion/systemMotion'
import { prefersReducedMotion } from '@/shared/lib/motion'
import { playSound } from '@/os/sound/sounds'
import { WIDGET_CATALOG, WIDGET_VIEWS, useWidgets, type PlacedWidget } from './widgets'

const SNAP = 8
/** How far the pointer must travel before a press becomes a drag. */
const DRAG_THRESHOLD = 4

/**
 * Widgets on the desktop, above the icons.
 *
 * WHAT MAKES DRAGGING FEEL PHYSICAL
 * ---------------------------------
 *  1. THE WIDGET LIFTS. Picking one up raises it off the desktop — it
 *     scales slightly and its shadow deepens, so it reads as being held
 *     above the surface rather than sliding along it.
 *  2. IT FOLLOWS EXACTLY. While dragging, position is written straight to
 *     the motion values with no spring. A spring between the cursor and the
 *     thing being carried feels like latency, not weight.
 *  3. IT SETTLES WHEN DROPPED. The spring is applied on release, so the
 *     widget visibly lands in its snapped slot instead of teleporting.
 *  4. THE GRID APPEARS WHILE DRAGGING. Snap targets are invisible until
 *     they matter, then fade in, so there is never an unexplained jump.
 */
export function WidgetLayer({ width, height }: { width: number; height: number }) {
  const [widgets, save] = useWidgets()
  const [drag, setDrag] = useState<{ id: string; x: number; y: number } | null>(null)
  const start = useRef<{ px: number; py: number; x: number; y: number; moved: boolean } | null>(null)
  const openMenu = useShellMenu()
  const reduced = prefersReducedMotion()

  const clamp = (w: PlacedWidget, x: number, y: number) => {
    const { w: ww, h } = WIDGET_CATALOG[w.kind]
    return {
      x: Math.max(8, Math.min(width - ww - 8, Math.round(x / SNAP) * SNAP)),
      y: Math.max(8, Math.min(height - h - 8, Math.round(y / SNAP) * SNAP)),
    }
  }

  return (
    <>
      {/* The snap grid, shown only while something is being dragged. */}
      <AnimatePresence>
        {drag && !reduced && (
          <motion.div
            className="pointer-events-none absolute inset-0 z-0"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            style={{
              backgroundImage:
                'radial-gradient(circle at 1px 1px, rgb(255 255 255 / 0.18) 1px, transparent 0)',
              backgroundSize: `${SNAP * 4}px ${SNAP * 4}px`,
              maskImage: 'radial-gradient(420px circle at var(--drag-x) var(--drag-y), black, transparent)',
              WebkitMaskImage: 'radial-gradient(420px circle at var(--drag-x) var(--drag-y), black, transparent)',
              ['--drag-x' as string]: `${drag.x}px`,
              ['--drag-y' as string]: `${drag.y}px`,
            }}
          />
        )}
      </AnimatePresence>

      {widgets.map((w, i) => {
        const { w: ww, h } = WIDGET_CATALOG[w.kind]
        const dragging = drag?.id === w.id
        const pos = dragging ? drag : clamp(w, w.x, w.y)
        return (
          <motion.div
            key={w.id}
            className="absolute cursor-default"
            style={{ width: ww, height: h, zIndex: dragging ? 20 : 10 }}
            initial={reduced ? false : { opacity: 0, scale: 0.9, y: 8 }}
            animate={{
              left: pos.x,
              top: pos.y,
              opacity: 1,
              // Lifting off the desktop: a little larger, and a deeper
              // shadow so the lift reads as height rather than zoom.
              scale: dragging ? 1.04 : 1,
              y: 0,
              filter: dragging ? 'drop-shadow(0 18px 36px rgb(0 0 0 / 0.42))' : 'drop-shadow(0 0px 0px rgb(0 0 0 / 0))',
            }}
            transition={
              dragging
                ? // No spring on position while carried: any lag between the
                  // cursor and the widget reads as the app being slow.
                  { left: { duration: 0 }, top: { duration: 0 }, scale: springs.micro, filter: { duration: 0.18 } }
                : { ...springs.settle, delay: reduced ? 0 : staggerDelay(i, 0.03, 6), opacity: { duration: 0.2 } }
            }
            onContextMenu={(e) => {
              e.preventDefault()
              e.stopPropagation()
              openMenu(e, [
                { label: `Remove ${WIDGET_CATALOG[w.kind].name}`, onSelect: () => void save(widgets.filter((o) => o.id !== w.id)) },
                { label: undefined },
                { label: 'Edit Widgets…', onSelect: () => void openApp('settings', { section: 'widgets' }) },
              ])
            }}
            onPointerDown={(e) => {
              if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return
              e.stopPropagation()
              e.currentTarget.setPointerCapture(e.pointerId)
              start.current = { px: e.clientX, py: e.clientY, x: pos.x, y: pos.y, moved: false }
            }}
            onPointerMove={(e) => {
              const s = start.current
              if (!s) return
              const dx = e.clientX - s.px
              const dy = e.clientY - s.py
              if (!s.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return
              if (!s.moved) playSound('tap')
              s.moved = true
              setDrag({ id: w.id, ...clamp(w, s.x + dx, s.y + dy) })
            }}
            onPointerUp={() => {
              const s = start.current
              start.current = null
              if (s?.moved && drag) {
                void save(widgets.map((o) => (o.id === w.id ? { ...o, x: drag.x, y: drag.y } : o)))
                playSound('drop')
              }
              setDrag(null)
            }}
            onPointerCancel={() => {
              start.current = null
              setDrag(null)
            }}
          >
            {createElement(WIDGET_VIEWS[w.kind])}
          </motion.div>
        )
      })}
    </>
  )
}
