import { invoke } from '@tauri-apps/api/core'
import { motion } from 'framer-motion'
import { flyoutMotion } from '@/os/motion/systemMotion'

export interface Zone {
  x: number
  y: number
  w: number
  h: number
}

const third = 1 / 3
const LAYOUTS: { name: string; zones: Zone[] }[] = [
  { name: 'Halves', zones: [{ x: 0, y: 0, w: 0.5, h: 1 }, { x: 0.5, y: 0, w: 0.5, h: 1 }] },
  { name: 'Two-thirds', zones: [{ x: 0, y: 0, w: 2 * third, h: 1 }, { x: 2 * third, y: 0, w: third, h: 1 }] },
  { name: 'Thirds', zones: [{ x: 0, y: 0, w: third, h: 1 }, { x: third, y: 0, w: third, h: 1 }, { x: 2 * third, y: 0, w: third, h: 1 }] },
  {
    name: 'Quarters',
    zones: [
      { x: 0, y: 0, w: 0.5, h: 0.5 },
      { x: 0.5, y: 0, w: 0.5, h: 0.5 },
      { x: 0, y: 0.5, w: 0.5, h: 0.5 },
      { x: 0.5, y: 0.5, w: 0.5, h: 0.5 },
    ],
  },
  { name: 'Half and quarters', zones: [{ x: 0, y: 0, w: 0.5, h: 1 }, { x: 0.5, y: 0, w: 0.5, h: 0.5 }, { x: 0.5, y: 0.5, w: 0.5, h: 0.5 }] },
  { name: 'Focus', zones: [{ x: 0.125, y: 0.08, w: 0.75, h: 0.84 }] },
]

function snapSelf(zone: Zone) {
  return invoke('shell_snap_self', { zone })
}

/** Win11 Snap Layouts: each layout is a tiny screen; click a zone to go there. */
export function SnapLayouts({ onDone, onMaximize }: { onDone: () => void; onMaximize: () => void }) {
  return (
    <motion.div
      {...flyoutMotion}
      className="os-acrylic absolute left-2 top-11 z-50 w-[292px] rounded-[var(--os-radius-overlay)] p-2.5"
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="grid grid-cols-3 gap-2.5">
        {LAYOUTS.map((layout) => (
          <div key={layout.name} title={layout.name} className="relative h-[52px] rounded-[10px] border border-[var(--border-hairline)] bg-[var(--surface-base)] p-1">
            {layout.zones.map((z, i) => (
              <button
                key={i}
                type="button"
                aria-label={`${layout.name}, zone ${i + 1}`}
                onClick={() => {
                  onDone()
                  void snapSelf(z)
                }}
                className="absolute rounded-[5px] bg-[var(--surface-hover)] outline-none transition-[background-color,transform] duration-150 ease-out hover:bg-[var(--color-accent)] hover:scale-[1.03] focus-visible:bg-[var(--color-accent)]"
                style={{
                  left: `calc(${z.x * 100}% + 3px)`,
                  top: `calc(${z.y * 100}% + 3px)`,
                  width: `calc(${z.w * 100}% - 6px)`,
                  height: `calc(${z.h * 100}% - 6px)`,
                }}
              />
            ))}
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={() => {
          onDone()
          onMaximize()
        }}
        className="mt-2 w-full rounded-[6px] py-1.5 text-[12px] text-[var(--os-menu-text)] hover:bg-[var(--os-menu-item-hover)]"
      >
        Fill screen
      </button>
    </motion.div>
  )
}
