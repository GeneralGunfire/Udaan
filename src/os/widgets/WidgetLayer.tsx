import { createElement, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { openApp } from '@/os/kernel/shell'
import { useShellMenu } from '@/os/ui/useShellMenu'
import { WIDGET_CATALOG, WIDGET_VIEWS, useWidgets, type PlacedWidget } from './widgets'

const SNAP = 8

/**
 * Widgets on the desktop, above the icons. Drag to move (they snap to an
 * 8px grid and stay on screen); right-click to remove or edit.
 */
export function WidgetLayer({ width, height }: { width: number; height: number }) {
  const [widgets, save] = useWidgets()
  const [drag, setDrag] = useState<{ id: string; x: number; y: number } | null>(null)
  const start = useRef<{ px: number; py: number; x: number; y: number; moved: boolean } | null>(null)
  const openMenu = useShellMenu()

  const clamp = (w: PlacedWidget, x: number, y: number) => {
    const { w: ww, h } = WIDGET_CATALOG[w.kind]
    return { x: Math.max(8, Math.min(width - ww - 8, Math.round(x / SNAP) * SNAP)), y: Math.max(8, Math.min(height - h - 8, Math.round(y / SNAP) * SNAP)) }
  }

  return (
    <>
      {widgets.map((w) => {
        const { w: ww, h } = WIDGET_CATALOG[w.kind]
        const pos = drag?.id === w.id ? drag : clamp(w, w.x, w.y)
        return (
          <motion.div
            key={w.id}
            className="absolute z-10 cursor-default"
            style={{ left: pos.x, top: pos.y, width: ww, height: h }}
            initial={{ opacity: 0, scale: 0.92 }}
            animate={{ opacity: 1, scale: drag?.id === w.id ? 1.03 : 1 }}
            transition={{ type: 'spring', stiffness: 420, damping: 32 }}
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
              if (!s.moved && Math.hypot(dx, dy) < 4) return
              s.moved = true
              setDrag({ id: w.id, ...clamp(w, s.x + dx, s.y + dy) })
            }}
            onPointerUp={() => {
              const s = start.current
              start.current = null
              if (s?.moved && drag) void save(widgets.map((o) => (o.id === w.id ? { ...o, x: drag.x, y: drag.y } : o)))
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
