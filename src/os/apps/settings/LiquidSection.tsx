import { useEffect, useRef, useState, type ReactNode } from 'react'
import { usePref } from '@/os/kernel/prefs'
import { Slider } from '@/os/ui/controls'
import { LIQUID_DEFAULTS, LIQUID_LOOKS, parseLiquid, type BarLiquid, type LiquidConfig, type LiquidLook, type LiquidRole } from '@/os/ui/liquid/config'
import { ActionButton, Group, Row, Segmented, Switch } from './ui'

/**
 * Settings for the liquid-glass dock and top bar. Both bars (every window, Personal and Work alike) follow
 * the stored values live while a slider is dragged, so you tune it by looking at the bars and the wallpaper.
 */

/** The numbers, with writes throttled while a slider is being dragged (each write reaches every window). */
function useLiquidDraft() {
  const [raw, setRaw] = usePref('bars.liquid.config')
  const [cfg, setCfg] = useState<LiquidConfig>(() => parseLiquid(raw))
  const dragging = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const latest = useRef(cfg)

  // Changes made elsewhere (a reset, another Settings window) arrive here, but never mid-drag.
  useEffect(() => {
    if (!dragging.current) setCfg(parseLiquid(raw))
  }, [raw])
  useEffect(() => () => clearTimeout(timer.current), [])

  const flush = () => {
    clearTimeout(timer.current)
    timer.current = undefined
    void setRaw(JSON.stringify(latest.current))
  }
  const change = (next: LiquidConfig, live = false) => {
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

function SliderRow({ title, description, value, min, max, step, onChange, onCommit }: { title: string; description?: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; onCommit: () => void }) {
  return (
    <Row title={title} description={description}>
      <div className="flex w-[270px] shrink-0 items-center gap-3">
        <Slider aria-label={title} value={value} min={min} max={max} step={step} onChange={onChange} onCommit={onCommit} className="flex-1" />
        <span className="w-9 text-right text-[12px] tabular-nums text-(--u-ink-3)">{value.toFixed(2)}</span>
      </div>
    </Row>
  )
}

function BarGroup({ title, footer, value, onChange, onCommit }: { title: string; footer: string; value: BarLiquid; onChange: (patch: Partial<BarLiquid>, live?: boolean) => void; onCommit: () => void }) {
  const set = (key: keyof Omit<BarLiquid, 'look' | 'solid'>) => (v: number) => onChange({ [key]: v }, true)
  return (
    <Group title={title} footer={footer}>
      <Row title="Solid" description="Opaque and still: nothing shows through and nothing moves. Costs nothing while idle.">
        <Switch checked={value.solid} onChange={(solid) => onChange({ solid })} label={`${title} solid`} />
      </Row>
      <Row stack title="Look" description={LIQUID_LOOKS.find((l) => l.value === value.look)?.blurb}>
        <Segmented<LiquidLook> value={value.look} options={LIQUID_LOOKS.map((l) => ({ value: l.value, label: l.label }))} onChange={(look) => onChange({ look })} />
      </Row>
      {!value.solid && <SliderRow title="Solidity" description="Lower lets the wallpaper show through." value={value.opacity} min={0.1} max={1} step={0.05} onChange={set('opacity')} onCommit={onCommit} />}
      <SliderRow title="Detail" description="Lower blends the bar into the desktop." value={value.contrast} min={0.1} max={1.2} step={0.05} onChange={set('contrast')} onCommit={onCommit} />
      {!value.solid && <SliderRow title="Speed" value={value.speed} min={0.1} max={2} step={0.05} onChange={set('speed')} onCommit={onCommit} />}
      <SliderRow title="Ripple size" value={value.amp} min={0.3} max={2} step={0.05} onChange={set('amp')} onCommit={onCommit} />
      <SliderRow title="Edge line" description="The thin highlight along the edge." value={value.edge} min={0} max={1.5} step={0.05} onChange={set('edge')} onCommit={onCommit} />
    </Group>
  )
}

export function LiquidGlassSettings(): ReactNode {
  const [enabled, setEnabled] = usePref('bars.liquid')
  const { cfg, change, commit } = useLiquidDraft()
  const patch = (role: LiquidRole) => (p: Partial<BarLiquid>, live?: boolean) => change({ ...cfg, [role]: { ...cfg[role], ...p } }, live)

  return (
    <div className="flex flex-col gap-6">
      <Group
        title="Liquid glass"
        footer="A slowly flowing glass surface behind the dock and top bar, drawn on the graphics card. On a bright wallpaper the bars darken themselves so text stays readable. It stops while the screen is locked, a full-screen app is open, or the PC is on Eco."
      >
        <Row title="Liquid glass" description="Off brings back the plain dock and top bar. This is separate from Solid surfaces (below), which still applies to menus and panels.">
          <Switch checked={enabled} onChange={(v) => void setEnabled(v)} label="Liquid glass" />
        </Row>
        {enabled && (
          <Row title="Freeze motion" description="Draws one still frame and nothing more. Costs nothing while the PC is idle.">
            <Switch checked={cfg.frozen} onChange={(frozen) => change({ ...cfg, frozen })} label="Freeze motion" />
          </Row>
        )}
      </Group>
      {enabled && (
        <>
          <BarGroup title="Dock" footer="The pill at the bottom. Livelier by default." value={cfg.dock} onChange={patch('dock')} onCommit={commit} />
          <BarGroup title="Top bar" footer="Calm by default so the menu text always wins." value={cfg.bar} onChange={patch('bar')} onCommit={commit} />
          <BarGroup title="Start menu" footer="The launcher. More solid by default because it holds a lot of text." value={cfg.start} onChange={patch('start')} onCommit={commit} />
          <BarGroup title="Popups, menus and notifications" footer="Every floating card: the top-bar popups, right-click menus and notification banners." value={cfg.panel} onChange={patch('panel')} onCommit={commit} />
          <Group>
            <Row title="Reset to defaults" description="Puts the look and every slider back to how they started.">
              <ActionButton onClick={() => change(LIQUID_DEFAULTS)}>Reset</ActionButton>
            </Row>
          </Group>
        </>
      )}
    </div>
  )
}
