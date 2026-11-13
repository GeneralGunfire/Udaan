import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { emit } from '@tauri-apps/api/event'
import { cn } from '@/shared/lib/cn'
import { EDGE_PRESETS, useEdgeLight, type EdgeColorMode, type EdgeLightConfig, type EdgePreset, type EdgeStyle } from '@/features/edge-light/config'

type Tab = 'style' | 'layout' | 'color' | 'motion'
const TABS: { id: Tab; label: string }[] = [
  { id: 'style', label: 'Style' },
  { id: 'layout', label: 'Layout' },
  { id: 'color', label: 'Colour' },
  { id: 'motion', label: 'Motion' },
]

const COLOR_MODES: { id: EdgeColorMode; label: string }[] = [
  { id: 'solid', label: 'Solid' },
  { id: 'gradient', label: 'Gradient' },
  { id: 'rainbow', label: 'Rainbow' },
  { id: 'level', label: 'By level' },
]

const STYLES: { id: EdgeStyle; label: string; hint: string }[] = [
  { id: 'bars', label: 'Bars', hint: 'Equaliser bars with falling peaks' },
  { id: 'wave', label: 'Wave', hint: 'One smooth, flowing curve' },
  { id: 'glow', label: 'Glow', hint: 'A soft ambient wash of light' },
]

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'rounded-full px-3 py-1 text-[12px] font-medium transition-colors active:scale-95',
        active ? 'bg-(--os-text) text-[var(--surface-base)]' : 'bg-(--os-hover) hover:bg-[var(--surface-hover)]',
      )}
    >
      {children}
    </button>
  )
}

function Slider({ label, value, min, max, step = 1, unit = '', onChange }: { label: string; value: number; min: number; max: number; step?: number; unit?: string; onChange: (v: number) => void }) {
  const pct = ((value - min) / (max - min)) * 100
  return (
    <label className="flex items-center gap-3">
      <span className="w-[74px] shrink-0 text-[12.5px] text-(--os-text-dim)">{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} aria-label={label} onChange={(e) => onChange(Number(e.target.value))} className="os-slider flex-1" style={{ ['--fill' as string]: `${pct}%` }} />
      <span className="w-11 text-right text-[12px] tabular-nums text-(--os-text-dim)">
        {Number.isInteger(step) ? value : value.toFixed(2)}
        {unit}
      </span>
    </label>
  )
}

const SWATCHES = ['#000000', '#ffffff', '#4cc9f0', '#3a86ff', '#8b5cf6', '#b5179e', '#ff4d6d', '#ff9f1c', '#ffd166', '#2dd4bf', '#80ed99']

/** Swatches plus a hex field, not a native colour input: the native picker
 * is a separate OS popup that steals focus, which closes this flyout. */
function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const [text, setText] = useState(value)
  const commit = (v: string) => /^#[0-9a-f]{6}$/i.test(v) && onChange(v.toLowerCase())
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[12.5px] text-(--os-text-dim)">{label}</span>
        <input
          value={text}
          aria-label={`${label} hex`}
          maxLength={7}
          onChange={(e) => {
            setText(e.target.value)
            commit(e.target.value)
          }}
          className="w-[84px] rounded-[7px] bg-(--os-hover) px-2 py-1 text-right text-[12px] tabular-nums outline-none"
        />
      </div>
      <div className="flex gap-1.5">
        {SWATCHES.map((c) => (
          <button
            key={c}
            type="button"
            aria-label={c}
            onClick={() => {
              setText(c)
              onChange(c)
            }}
            className="h-6 w-6 rounded-full border border-white/20 transition-transform hover:scale-110"
            style={{ background: c, outline: value.toLowerCase() === c ? '2px solid var(--os-menu-text)' : 'none', outlineOffset: 2 }}
          />
        ))}
      </div>
    </div>
  )
}

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className="relative h-[22px] w-[38px] shrink-0 rounded-full transition-colors"
      style={{ background: on ? 'var(--color-accent)' : 'var(--os-menu-item-hover)' }}
    >
      <motion.span className="absolute left-[2px] top-[2px] h-[18px] w-[18px] rounded-full bg-white shadow" animate={{ x: on ? 16 : 0 }} transition={{ type: 'spring', stiffness: 600, damping: 32 }} />
    </button>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[12.5px] text-(--os-text-dim)">{label}</span>
      {children}
    </div>
  )
}

/** A little picture of what a preset looks like: its colours. */
function swatchOf(patch: Partial<EdgeLightConfig>): string {
  if (patch.colorMode === 'rainbow') return 'conic-gradient(#ff4d6d, #ffd166, #80ed99, #4cc9f0, #8b5cf6, #ff4d6d)'
  if (patch.colorMode === 'gradient') return `linear-gradient(135deg, ${patch.color1 ?? '#4cc9f0'}, ${patch.color2 ?? '#b5179e'})`
  return patch.color1 ?? '#ffffff'
}

/** Whether the current settings are this preset (every setting it defines matches). */
function isActive(cfg: EdgeLightConfig, preset: EdgePreset): boolean {
  return (Object.keys(preset.patch) as (keyof EdgeLightConfig)[]).every((k) => JSON.stringify(cfg[k]) === JSON.stringify(preset.patch[k]))
}

/** Pretend music for the preview: a bass-heavy spectrum that moves, with a kick every half second. */
function fakeSpectrum(t: number): number[] {
  return Array.from({ length: 64 }, (_, i) => {
    const body = 0.74 * Math.exp(-i / 24)
    const shimmer = 0.3 * Math.abs(Math.sin(t * 2.1 + i * 0.37)) * (1 - i / 90)
    const kick = (t * 2) % 1 < 0.14 ? 0.4 * Math.exp(-i / 10) : 0
    return Math.round(Math.min(1, body + shimmer + kick) * 255)
  })
}

/** Easy-reach settings for the audio-reactive edge light. */
export function EdgeLightPanel() {
  const { cfg, update, reset } = useEdgeLight()
  const [tab, setTab] = useState<Tab>('style')
  const [preview, setPreview] = useState(false)
  const enabledRef = useRef(cfg.enabled)
  enabledRef.current = cfg.enabled
  const side = (k: keyof EdgeLightConfig['sides']) => update({ sides: { ...cfg.sides, [k]: !cfg.sides[k] } })

  // Preview: feeds the overlay a pretend spectrum so changes can be seen without music.
  useEffect(() => {
    if (!preview) return
    if (!enabledRef.current) update({ enabled: true })
    const started = performance.now()
    const timer = setInterval(() => void emit('edge-light:frame', { bands: fakeSpectrum((performance.now() - started) / 1000) }).catch(() => {}), 33)
    const stop = setTimeout(() => setPreview(false), 15_000)
    return () => {
      clearInterval(timer)
      clearTimeout(stop)
      void emit('edge-light:frame', { bands: new Array(64).fill(0) }).catch(() => {})
    }
    // `update` is stable; the preview should only restart when toggled.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview])

  return (
    <div className="flex flex-col gap-3.5 p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13px] font-semibold">Edge light</p>
          <p className="text-[11.5px] text-(--os-text-dim)">Reacts to whatever is playing</p>
        </div>
        <motion.button
          type="button"
          whileTap={{ scale: 0.95 }}
          onClick={() => setPreview((p) => !p)}
          className={cn('shrink-0 rounded-full px-3 py-1 text-[12px] font-medium transition-colors', preview ? 'bg-[var(--color-accent)] text-[var(--color-accent-contrast)]' : 'bg-(--os-hover) hover:bg-[var(--surface-hover)]')}
        >
          {preview ? 'Stop preview' : 'Preview'}
        </motion.button>
        <Toggle on={cfg.enabled} onChange={(v) => update({ enabled: v })} label="Edge light" />
      </div>

      <div className="grid grid-cols-4 gap-1.5" role="group" aria-label="Presets">
        {EDGE_PRESETS.map((p) => {
          const on = isActive(cfg, p)
          return (
            <motion.button
              key={p.name}
              type="button"
              aria-pressed={on}
              whileTap={{ scale: 0.94 }}
              onClick={() => update({ ...p.patch, enabled: true })}
              className={cn('flex flex-col items-center gap-1.5 rounded-[11px] px-1 py-2 text-[11.5px] font-medium transition-colors', on ? 'bg-[var(--surface-hover)] ring-1 ring-[var(--color-accent)]' : 'bg-(--os-hover) hover:bg-[var(--surface-hover)]')}
            >
              <span className="h-5 w-5 rounded-full border border-white/20" style={{ background: swatchOf(p.patch) }} />
              {p.name}
            </motion.button>
          )
        })}
      </div>

      <div className="flex gap-1 rounded-[10px] bg-(--os-hover) p-0.5" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={cn('flex-1 rounded-[8px] py-1 text-[12px] font-medium transition-colors', tab === t.id ? 'bg-[var(--surface-hover)]' : 'text-(--os-text-dim)')}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-3">
        {tab === 'style' && (
          <>
            <div className="grid grid-cols-3 gap-1.5">
              {STYLES.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  title={s.hint}
                  aria-pressed={cfg.style === s.id}
                  onClick={() => update({ style: s.id })}
                  className={cn('flex flex-col items-center gap-1.5 rounded-[11px] px-1 py-2 text-[12px] font-medium transition-colors active:scale-95', cfg.style === s.id ? 'bg-[var(--surface-hover)] ring-1 ring-[var(--color-accent)]' : 'bg-(--os-hover) hover:bg-[var(--surface-hover)]')}
                >
                  <svg viewBox="0 0 36 16" width="36" height="16" fill="currentColor" aria-hidden>
                    {s.id === 'bars' && [3, 9, 15, 21, 27].map((x, i) => <rect key={x} x={x} y={16 - [6, 11, 14, 9, 5][i]} width="4" height={[6, 11, 14, 9, 5][i]} rx="2" />)}
                    {s.id === 'wave' && <path d="M0 16 L0 10 Q6 2 12 9 T24 8 T36 6 L36 16Z" opacity="0.9" />}
                    {s.id === 'glow' && <path d="M0 16 L0 11 Q18 -2 36 11 L36 16Z" opacity="0.45" />}
                  </svg>
                  {s.label}
                </button>
              ))}
            </div>
            <Slider label="Height" value={cfg.height} min={10} max={400} unit="px" onChange={(v) => update({ height: v })} />
            <Slider label="Thickness" value={cfg.thickness} min={1} max={30} unit="px" onChange={(v) => update({ thickness: v })} />
            {cfg.style === 'bars' && <Slider label="Spacing" value={cfg.gap} min={0} max={2} step={0.05} onChange={(v) => update({ gap: v })} />}
            <Slider label="Softness" value={cfg.softness} min={0} max={30} unit="px" onChange={(v) => update({ softness: v })} />
            <Slider label="Opacity" value={cfg.opacity} min={0.1} max={1} step={0.05} onChange={(v) => update({ opacity: v })} />
            {cfg.style === 'bars' && (
              <>
                <Row label="Round ends">
                  <Toggle on={cfg.rounded} onChange={(v) => update({ rounded: v })} label="Round ends" />
                </Row>
                <Row label="Falling peak caps">
                  <Toggle on={cfg.peaks} onChange={(v) => update({ peaks: v })} label="Peak caps" />
                </Row>
              </>
            )}
          </>
        )}

        {tab === 'layout' && (
          <>
            <div>
              <p className="mb-1.5 text-[12.5px] text-(--os-text-dim)">Edges</p>
              <div className="flex gap-1.5">
                {(['top', 'right', 'bottom', 'left'] as const).map((k) => (
                  <Chip key={k} active={cfg.sides[k]} onClick={() => side(k)}>
                    {k[0].toUpperCase() + k.slice(1)}
                  </Chip>
                ))}
              </div>
            </div>
            <div>
              <p className="mb-1.5 text-[12.5px] text-(--os-text-dim)">Direction</p>
              <div className="flex gap-1.5">
                <Chip active={cfg.direction === 'clockwise'} onClick={() => update({ direction: 'clockwise' })}>
                  Clockwise
                </Chip>
                <Chip active={cfg.direction === 'anticlockwise'} onClick={() => update({ direction: 'anticlockwise' })}>
                  Anti-clockwise
                </Chip>
              </div>
            </div>
            <Row label="Mirror the spectrum">
              <Toggle on={cfg.mirror} onChange={(v) => update({ mirror: v })} label="Mirror" />
            </Row>
            <Slider label="Corner fade" value={cfg.cornerRadius} min={0} max={200} unit="px" onChange={(v) => update({ cornerRadius: v })} />
          </>
        )}

        {tab === 'color' && (
          <>
            <div className="flex flex-wrap gap-1.5">
              {COLOR_MODES.map((m) => (
                <Chip key={m.id} active={cfg.colorMode === m.id} onClick={() => update({ colorMode: m.id })}>
                  {m.label}
                </Chip>
              ))}
            </div>
            {cfg.colorMode !== 'rainbow' && <ColorField label={cfg.colorMode === 'solid' ? 'Colour' : 'From'} value={cfg.color1} onChange={(v) => update({ color1: v })} />}
            {(cfg.colorMode === 'gradient' || cfg.colorMode === 'level') && <ColorField label="To" value={cfg.color2} onChange={(v) => update({ color2: v })} />}
            {(cfg.colorMode === 'gradient' || cfg.colorMode === 'rainbow') && <Slider label="Drift" value={cfg.hueSpeed} min={0} max={60} onChange={(v) => update({ hueSpeed: v })} />}
          </>
        )}

        {tab === 'motion' && (
          <>
            <Row label="Auto level (quiet and loud look alike)">
              <Toggle on={cfg.autoGain} onChange={(v) => update({ autoGain: v })} label="Auto level" />
            </Row>
            <Slider label="Sensitivity" value={cfg.sensitivity} min={0.3} max={3} step={0.05} onChange={(v) => update({ sensitivity: v })} />
            <Slider label="Smoothing" value={cfg.smoothing} min={0} max={0.95} step={0.05} onChange={(v) => update({ smoothing: v })} />
            <Slider label="Beat flash" value={cfg.beatPulse} min={0} max={1} step={0.05} onChange={(v) => update({ beatPulse: v })} />
            <Slider label="Spin" value={cfg.spin} min={-6} max={6} step={0.25} onChange={(v) => update({ spin: v })} />
          </>
        )}
      </div>

      <button type="button" onClick={reset} className="self-start rounded-[8px] px-2.5 py-1 text-[12px] text-(--os-text-dim) hover:bg-(--os-hover)">
        Reset to defaults
      </button>
    </div>
  )
}
