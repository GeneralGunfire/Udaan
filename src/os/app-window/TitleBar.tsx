import type { AppId } from '@/os/kernel/registry'
import { AppIcon } from '@/os/ui/icons/AppIcon'
import { useEffect, useRef, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import { cn } from '@/shared/lib/cn'
import { onHotkey } from '@/os/kernel/shell'
import { SnapLayouts } from './SnapLayouts'

interface TitleBarProps {
  title: string
  appId: AppId
  active: boolean
  maximized: boolean
  onClose: () => void
  onMinimize: () => void
  onToggleMaximize: () => void
}

const LIGHTS = [
  { key: 'close', label: 'Close', color: '#ff5f57' },
  { key: 'minimize', label: 'Minimize', color: '#febc2e' },
  { key: 'maximize', label: 'Maximize', color: '#28c840' },
] as const

function Glyph({ kind, maximized }: { kind: (typeof LIGHTS)[number]['key']; maximized: boolean }) {
  const common = { stroke: '#000', strokeWidth: 1.5, strokeLinecap: 'round' as const, fill: 'none' }
  if (kind === 'close') return <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" {...common} />
  if (kind === 'minimize') return <path d="M3.5 8h9" {...common} />
  return maximized ? (
    <g {...common}><rect x="2.5" y="5.5" width="7" height="7" rx="1" /><path d="M5.5 5.5V4a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H12" /></g>
  ) : (
    <rect x="3.5" y="3.5" width="9" height="9" rx="1.5" {...common} />
  )
}

/**
 * macOS-style window chrome: traffic lights on the left (glyphs appear
 * when the group is hovered, grey when the window is inactive), the app
 * name centred. The whole bar is a native drag region, so Windows handles
 * moving, Aero Snap, Win+Arrows, and double-click-to-maximize.
 */
export function TitleBar({ title, appId, active, maximized, onClose, onMinimize, onToggleMaximize }: TitleBarProps) {
  const handlers = { close: onClose, minimize: onMinimize, maximize: onToggleMaximize }
  const [snapOpen, setSnapOpen] = useState(false)
  const openTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const closeTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const hoverIn = () => {
    clearTimeout(closeTimer.current)
    openTimer.current = setTimeout(() => setSnapOpen(true), 450)
  }
  const hoverOut = () => {
    clearTimeout(openTimer.current)
    closeTimer.current = setTimeout(() => setSnapOpen(false), 250)
  }

  // Win+Z opens Snap Layouts for whichever Udaan window has focus.
  useEffect(() => {
    const un = onHotkey((id) => {
      if (id === 'snap-layouts' && document.hasFocus()) setSnapOpen(true)
    })
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setSnapOpen(false)
    window.addEventListener('keydown', onKey)
    return () => {
      void un.then((fn) => fn())
      window.removeEventListener('keydown', onKey)
      clearTimeout(openTimer.current)
      clearTimeout(closeTimer.current)
    }
  }, [])

  return (
    <header
      data-tauri-drag-region
      data-active={active}
      className="u-titlebar relative flex h-10 shrink-0 select-none items-center px-3.5"
    >
      <div className="group/lights z-10 flex items-center gap-2" onDoubleClick={(e) => e.stopPropagation()}>
        {LIGHTS.map((light) => (
          <button
            key={light.key}
            type="button"
            aria-label={light.label}
            onClick={() => {
              setSnapOpen(false)
              handlers[light.key]()
            }}
            onMouseEnter={light.key === 'maximize' ? hoverIn : undefined}
            onMouseLeave={light.key === 'maximize' ? hoverOut : undefined}
            onContextMenu={
              light.key === 'maximize'
                ? (e) => {
                    e.preventDefault()
                    setSnapOpen(true)
                  }
                : undefined
            }
            className="u-light relative flex h-3 w-3 items-center justify-center rounded-full"
            style={{ '--u-light-color': light.color } as React.CSSProperties}
          >
            <svg viewBox="0 0 16 16" width="8" height="8" className="u-light__glyph">
              <Glyph kind={light.key} maximized={maximized} />
            </svg>
          </button>
        ))}
      </div>
      <AnimatePresence>
        {snapOpen && (
          <div onMouseEnter={() => clearTimeout(closeTimer.current)} onMouseLeave={hoverOut}>
            <SnapLayouts onDone={() => setSnapOpen(false)} onMaximize={onToggleMaximize} />
          </div>
        )}
      </AnimatePresence>
      <div
        data-tauri-drag-region
        className={cn(
          'pointer-events-none absolute inset-x-24 flex items-center justify-center gap-2 text-[13px] font-medium transition-colors duration-150',
          active ? 'text-(--u-ink)' : 'text-(--u-ink-3)',
        )}
      >
        <span className={cn('flex transition-opacity', !active && 'opacity-50 grayscale')}>
          <AppIcon appId={appId} size={16} />
        </span>
        <span className="truncate">{title}</span>
      </div>
    </header>
  )
}
