import { useEffect, useRef, useState, type ReactNode } from 'react'
import { usePref } from '@/os/kernel/prefs'
import { Slider } from '@/os/ui/controls'
import { MOTION_DEFAULTS, MOTION_PARTS, parseMotion, type MotionConfig, type MotionPart, type PartMotion } from '@/os/motion/config'
import { ActionButton, Group, Row, Select, Switch } from './ui'

/**
 * Settings → Animations. A global speed, then every part of the OS on its own: whether it animates, how, how fast and how
 * springy. Windows follow the values live while a slider is dragged (writes are throttled, since each reaches every window).
 */

function useMotionDraft() {
  const [raw, setRaw] = usePref('motion.config')
  const [cfg, setCfg] = useState<MotionConfig>(() => parseMotion(raw))
  const dragging = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const latest = useRef(cfg)

  useEffect(() => {
    if (!dragging.current) setCfg(parseMotion(raw))
  }, [raw])
  useEffect(() => () => clearTimeout(timer.current), [])

  const flush = () => {
    clearTimeout(timer.current)
    timer.current = undefined
    void setRaw(JSON.stringify(latest.current))
  }
  const change = (next: MotionConfig, live = false) => {
    latest.current = next
    setCfg(next)
    if (!live) return flush()
    dragging.current = true
    timer.current ??= setTimeout(flush, 100)
  }
  const commit = () => {
    dragging.current = false
    flush()
  }
  return { cfg, change, commit }
}

function Slide({ title, description, value, min, max, step, format, onChange, onCommit, disabled }: { title: string; description?: string; value: number; min: number; max: number; step: number; format: (v: number) => string; onChange: (v: number) => void; onCommit: () => void; disabled?: boolean }) {
  return (
    <Row title={title} description={description}>
      <div className={`flex w-[270px] shrink-0 items-center gap-3 ${disabled ? 'pointer-events-none opacity-40' : ''}`}>
        <Slider aria-label={title} value={value} min={min} max={max} step={step} onChange={onChange} onCommit={onCommit} className="flex-1" />
        <span className="w-12 text-right text-[12px] tabular-nums text-(--u-ink-3)">{format(value)}</span>
      </div>
    </Row>
  )
}

const times = (v: number) => `${v.toFixed(2)}×`
const percent = (v: number) => `${Math.round(v * 100)}%`

export function AnimationsSettings(): ReactNode {
  const [off, setOff] = usePref('motion.off')
  const { cfg, change, commit } = useMotionDraft()
  const patch = (id: MotionPart) => (p: Partial<PartMotion>, live = false) => change({ ...cfg, parts: { ...cfg.parts, [id]: { ...cfg.parts[id], ...p } } }, live)

  return (
    <div className="flex flex-col gap-6">
      <Group title="Everything" footer="Animations use only movement and fading, so they stay smooth on this PC. When the PC is short of memory or on Eco, ambient effects scale themselves down.">
        <Row title="Turn off all animations" description="Everything jumps straight to its end state. Overrides every setting below.">
          <Switch checked={off} onChange={(v) => void setOff(v)} label="Turn off all animations" />
        </Row>
        <Slide title="Overall speed" description="Faster or slower for every animation at once." value={cfg.speed} min={0.5} max={2} step={0.05} format={times} onChange={(speed) => change({ ...cfg, speed }, true)} onCommit={commit} disabled={off} />
        <Row title="Reset to defaults" description="Every style, speed and bounce back to how they started.">
          <ActionButton onClick={() => change(MOTION_DEFAULTS)}>Reset</ActionButton>
        </Row>
      </Group>

      {MOTION_PARTS.map((def) => {
        const p = cfg.parts[def.id]
        const set = patch(def.id)
        const dim = off || !p.on
        return (
          <Group key={def.id} title={def.label} footer={def.blurb}>
            <Row title="Animate" description={p.on ? undefined : 'Shown instantly, with no movement.'}>
              <Switch checked={p.on} onChange={(on) => set({ on })} label={`Animate ${def.label}`} />
            </Row>
            <Row title="Style">
              <div className={dim ? 'pointer-events-none opacity-40' : ''}>
                <Select value={p.style} options={def.styles} onChange={(style) => set({ style })} />
              </div>
            </Row>
            <Slide title="Speed" description="Relative to the overall speed." value={p.speed} min={0.5} max={2} step={0.05} format={times} onChange={(speed) => set({ speed }, true)} onCommit={commit} disabled={dim} />
            <Slide title="Bounce" description="How much it overshoots and settles. Zero is firm." value={p.bounce} min={0} max={1} step={0.05} format={percent} onChange={(bounce) => set({ bounce }, true)} onCommit={commit} disabled={dim} />
          </Group>
        )
      })}
    </div>
  )
}
