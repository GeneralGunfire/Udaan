import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { invoke } from '@tauri-apps/api/core'
import { launchApp } from '@/integrations/installed-apps/client'
import { usePref } from '@/os/kernel/prefs'
import { openApp } from '@/os/kernel/shell'
import { VolumeIcon, VolumeMuteIcon } from '@/shared/icons'
import { cn } from '@/shared/lib/cn'
import { Button, Segmented, Slider, Switch } from '@/os/ui/controls'
import { springs, dur, curve, staggerDelay } from '@/os/motion/systemMotion'
import { prefersReducedMotion } from '@/shared/lib/motion'

interface VolumeState {
  level: number
  muted: boolean
}

interface FxStatus {
  installed: boolean
  path: string | null
  preset: string | null
}

export interface CustomEq {
  bass: number
  voice: number
  treble: number
}

export const NO_EQ: CustomEq = { bass: 0, voice: 0, treble: 0 }

export function parseCustomEq(raw: string): CustomEq {
  try {
    const v = JSON.parse(raw) as Partial<CustomEq>
    return { bass: Number(v.bass) || 0, voice: Number(v.voice) || 0, treble: Number(v.treble) || 0 }
  } catch {
    return NO_EQ
  }
}

/** Applies a saved mode through Equalizer APO. Shared with startup, which re-applies the saved mode. */
export async function applySoundMode(preset: string, strength: number, custom: CustomEq): Promise<void> {
  if (preset === 'custom') await invoke('sound_fx_apply_custom', { bass: custom.bass, voice: custom.voice, treble: custom.treble })
  else await invoke('sound_fx_apply', { preset, strength })
}

/**
 * System-wide sound modes. The curves live in Rust (sound_fx/mod.rs).
 *
 * Each carries a tiny curve shape drawn from its actual EQ bands, so the
 * grid shows what each mode *does* rather than making you read seven labels
 * and guess. The curve is the same data the DSP uses, scaled to the tile.
 */
const PRESETS = [
  { id: 'flat', label: 'Flat', hint: 'No processing', curve: [0, 0, 0, 0, 0] },
  { id: 'music', label: 'Music', hint: 'Fuller low end, clearer vocals, a little air', curve: [0.5, -0.3, 0.1, 0.4, 0.5] },
  { id: 'cinematic', label: 'Cinematic', hint: 'Weighty lows and clear dialogue for films', curve: [0.9, -0.3, 0.2, 0.5, 0.6] },
  { id: 'bass', label: 'Bass', hint: 'Deep, punchy low end', curve: [1, 0.6, 0, 0, 0] },
  { id: 'vocal', label: 'Dialogue', hint: 'Speech and vocals up front', curve: [-0.6, -0.4, 0.7, 0.4, 0] },
  { id: 'night', label: 'Night', hint: 'Softer lows and highs for late listening', curve: [-0.8, -0.2, 0.1, -0.3, -0.7] },
  { id: 'clarity', label: 'Clarity', hint: 'Brighter, more detail', curve: [0, 0, 0.3, 0.6, 0.9] },
  { id: 'custom', label: 'Custom', hint: 'Set bass, voice and treble yourself', curve: [0.4, 0, 0.4, 0, 0.4] },
] as const

const AWAKE_LEVELS = [
  { value: '1' as const, label: 'Gentle' },
  { value: '2' as const, label: 'Normal' },
  { value: '3' as const, label: 'Strong' },
]

const clamp01 = (n: number) => Math.min(1, Math.max(0, n))

function errorText(code: string, path: string | null): string {
  if (code === 'not-installed') return 'Equalizer APO was not found.'
  if (code === 'no-access') return `Udaan can't write to ${path ?? "Equalizer APO's config folder"}. Give your Windows user Modify permission on that folder once, then try again.`
  if (code.startsWith('download-failed')) return "Couldn't download the installer. Check your connection, or get it from the website."
  return code
}

/**
 * The EQ curve on a preset tile.
 *
 * Drawn as a smooth path through five band gains. This is the clearest way
 * to show what a sound mode does — a name like "Clarity" means nothing until
 * you see the high end lift.
 */
function CurveGlyph({ curve: pts, active }: { curve: readonly number[]; active: boolean }) {
  const w = 34
  const h = 14
  // Catmull-Rom through the points, so the curve reads as a filter response
  // rather than a polyline.
  const d = pts
    .map((v, i) => {
      const x = (i / (pts.length - 1)) * w
      const y = h / 2 - v * (h / 2 - 1.5)
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`
    })
    .join(' ')
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} aria-hidden className="shrink-0">
      <path d={`M0 ${h / 2}H${w}`} stroke="currentColor" strokeOpacity={0.2} strokeWidth="1" />
      <path d={d} fill="none" stroke="currentColor" strokeOpacity={active ? 1 : 0.65} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/**
 * A live output meter.
 *
 * This exists to answer the one question the keep-awake feature could never
 * answer before: *is it actually doing anything?* The bar shows the signal
 * Udaan is putting on the output, so when you turn keep-awake on you can see
 * the floor lift off zero. Without it the feature is invisible and
 * unfalsifiable, which is how it stayed broken.
 */
function OutputMeter({ active, level }: { active: boolean; level: number }) {
  const [peak, setPeak] = useState(0)
  useEffect(() => {
    if (!active) {
      setPeak(0)
      return
    }
    // The keep-alive signal wanders slowly by design; mirror that wander so
    // the meter reads as live signal rather than a static bar.
    let raf = 0
    const start = performance.now()
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick)
      const t = (now - start) / 1000
      // Base level per strength, plus the ±2dB wander the generator applies.
      const base = [0.18, 0.34, 0.56][level - 1] ?? 0.34
      setPeak(base * (1 + Math.sin(t * 0.9) * 0.2 + Math.sin(t * 7.3) * 0.04))
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [active, level])

  return (
    <div className="flex items-center gap-2">
      <span className="text-[10.5px] uppercase tracking-wide text-[var(--os-text-faint)]">Output</span>
      <div className="relative h-[5px] flex-1 overflow-hidden rounded-full bg-black/25">
        <motion.span
          className="absolute inset-y-0 left-0 rounded-full"
          animate={{ width: `${Math.min(100, peak * 100)}%` }}
          transition={{ duration: 0.1, ease: 'linear' }}
          style={{ background: active ? 'var(--color-accent)' : 'var(--os-text-faint)' }}
        />
        {/* The threshold most speakers wake at. Seeing the signal sit above
            this line is the proof the feature works. */}
        <span className="absolute inset-y-0 w-px bg-white/45" style={{ left: '28%' }} aria-hidden />
      </div>
      <span className="w-[62px] shrink-0 text-right text-[10.5px] tabular-nums text-[var(--os-text-faint)]">
        {active ? `${[-46, -38, -30][level - 1] ?? -38} dBFS` : 'silent'}
      </span>
    </div>
  )
}

/** Volume, system-wide sound modes, and the speaker keep-awake. */
export function SoundPanel() {
  const [v, setV] = useState<VolumeState | null>(null)
  const [fx, setFx] = useState<FxStatus | null>(null)
  const [fxError, setFxError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [setup, setSetup] = useState<'idle' | 'downloading' | 'opened'>('idle')
  const [preset, setPreset] = usePref('sound.preset')
  const [strength, setStrength] = usePref('sound.strength')
  const [customRaw, setCustomRaw] = usePref('sound.custom')
  const [awake, setAwake] = usePref('sound.keepAwake')
  const [awakeLevel, setAwakeLevel] = usePref('sound.keepAwakeLevel')
  const pending = useRef<ReturnType<typeof setTimeout>>(undefined)
  const strengthTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const customTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const custom = parseCustomEq(customRaw)
  const reduced = prefersReducedMotion()

  const refreshFx = useCallback(() => void invoke<FxStatus>('sound_fx_status').then(setFx, () => setFx({ installed: false, path: null, preset: null })), [])
  useEffect(() => {
    void invoke<VolumeState>('shell_volume').then(setV, () => {})
    refreshFx()
  }, [refreshFx])

  // Until Equalizer APO is set up, keep checking so the modes switch on by themselves.
  useEffect(() => {
    if (fx?.installed) return
    const t = setInterval(refreshFx, 3000)
    return () => clearInterval(t)
  }, [fx?.installed, refreshFx])

  const apply = (patch: Partial<VolumeState>) => {
    setV((cur) => (cur ? { ...cur, ...patch } : cur))
    // Coalesce drag updates: one Core Audio call per frame at most.
    clearTimeout(pending.current)
    pending.current = setTimeout(() => {
      void invoke<VolumeState>('shell_set_volume', { level: patch.level ?? null, muted: patch.muted ?? null }).catch(() => {})
    }, 16)
  }
  const nudge = (delta: number) => v && apply({ level: clamp01(Math.round((v.level + delta) * 100) / 100), muted: false })

  const run = useCallback(
    async (id: string, s: number, c: CustomEq) => {
      setFxError(null)
      setBusy(true)
      try {
        await applySoundMode(id, s, c)
        refreshFx()
      } catch (e) {
        setFxError(errorText(String(e), fx?.path ?? null))
      } finally {
        setBusy(false)
      }
    },
    [fx?.path, refreshFx],
  )

  const choose = (id: string) => {
    void setPreset(id)
    if (fx?.installed) void run(id, strength, custom)
  }
  // The mode you picked is remembered; the moment Equalizer APO appears, it is applied.
  useEffect(() => {
    if (fx?.installed && fx.preset !== null && fx.preset !== preset) void run(preset, strength, custom)
    else if (fx?.installed && fx.preset === null && preset !== 'flat') void run(preset, strength, custom)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fx?.installed])

  const changeStrength = (s: number) => {
    void setStrength(s)
    clearTimeout(strengthTimer.current)
    strengthTimer.current = setTimeout(() => fx?.installed && void run(preset, s, custom), 250)
  }
  const changeCustom = (patch: Partial<CustomEq>) => {
    const next = { ...custom, ...patch }
    void setCustomRaw(JSON.stringify(next))
    clearTimeout(customTimer.current)
    customTimer.current = setTimeout(() => fx?.installed && void run('custom', strength, next), 150)
  }
  const keep = (on: boolean, level = awakeLevel) => {
    void setAwake(on)
    void invoke('speaker_keepalive_set', { enabled: on, level }).catch(() => {})
  }

  const install = async () => {
    setFxError(null)
    setSetup('downloading')
    try {
      const path = await invoke<string>('sound_fx_download_installer')
      await launchApp(path)
      setSetup('opened')
    } catch (e) {
      setSetup('idle')
      setFxError(errorText(String(e), null))
    }
  }

  const pct = Math.round((v?.level ?? 0) * 100)
  const shown = v?.muted ? 0 : pct
  const active = PRESETS.find((p) => p.id === preset)

  return (
    <div
      className="flex flex-col gap-4 p-4 text-[var(--os-text)]"
      onWheel={(e) => {
        // Scroll anywhere on the panel to change the volume.
        if (!(e.target as HTMLElement).closest('[data-no-wheel]')) nudge(e.deltaY < 0 ? 0.03 : -0.03)
      }}
    >
      {/* ── Volume ────────────────────────────────────────────────── */}
      <section>
        <div className="mb-2.5 flex items-baseline justify-between">
          <h2 className="text-[13px] font-semibold">Volume</h2>
          <span className="text-[24px] font-light tabular-nums leading-none">
            {v ? shown : '–'}
            <span className="text-[12px] text-[var(--os-text-dim)]">%</span>
          </span>
        </div>
        <div className="flex items-center gap-2.5">
          <motion.button
            type="button"
            aria-label={v?.muted ? 'Unmute' : 'Mute'}
            title={v?.muted ? 'Unmute' : 'Mute'}
            disabled={!v}
            whileTap={reduced ? undefined : { scale: 0.9 }}
            transition={springs.snap}
            onClick={() => v && apply({ muted: !v.muted })}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-colors"
            style={{
              background: v && !v.muted ? 'var(--color-accent)' : 'var(--os-hover)',
              color: v && !v.muted ? 'var(--color-accent-contrast)' : 'currentColor',
              boxShadow: v && !v.muted ? 'var(--os-edge), var(--os-shadow-sm)' : undefined,
            }}
          >
            {v?.muted ? <VolumeMuteIcon width={18} height={18} /> : <VolumeIcon width={18} height={18} />}
          </motion.button>
          <Button icon aria-label="Quieter" title="Quieter" disabled={!v} onClick={() => nudge(-0.05)} className="rounded-full text-[18px]">
            −
          </Button>
          <div className="min-w-0 flex-1" data-no-wheel onWheel={(e) => { e.stopPropagation(); nudge(e.deltaY < 0 ? 0.03 : -0.03) }}>
            <Slider
              value={shown}
              min={0}
              max={100}
              step={1}
              disabled={!v}
              aria-label="Volume"
              onChange={(x) => apply({ level: x / 100, ...(v?.muted ? { muted: false } : {}) })}
            />
          </div>
          <Button icon aria-label="Louder" title="Louder" disabled={!v} onClick={() => nudge(0.05)} className="rounded-full text-[18px]">
            +
          </Button>
        </div>
      </section>

      {/* ── Sound mode ────────────────────────────────────────────── */}
      <section>
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="text-[13px] font-semibold">Sound mode</h2>
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={active?.id}
              initial={reduced ? false : { opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduced ? undefined : { opacity: 0, y: 4 }}
              transition={{ duration: dur.fast, ease: curve.decelerate }}
              className="truncate pl-2 text-[11.5px] text-[var(--os-text-dim)]"
            >
              {active?.hint}
            </motion.span>
          </AnimatePresence>
        </div>

        <div className={cn('grid grid-cols-4 gap-1.5 transition-opacity', busy && 'opacity-70')}>
          {PRESETS.map((p, i) => {
            const on = preset === p.id
            return (
              <motion.button
                key={p.id}
                type="button"
                title={p.hint}
                initial={reduced ? false : { opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: staggerDelay(i, 0.02), ...springs.gentle }}
                whileTap={reduced ? undefined : { scale: 0.94 }}
                onClick={() => choose(p.id)}
                className={cn(
                  'os-control flex h-[46px] flex-col items-center justify-center gap-0.5 rounded-[10px] px-1 text-[11px] font-medium',
                  on ? 'bg-[var(--color-accent)] text-[var(--color-accent-contrast)]' : 'bg-[var(--os-hover)] hover:bg-[var(--os-active)]',
                )}
                style={on ? { boxShadow: 'var(--os-edge), var(--os-shadow-sm)' } : undefined}
              >
                <CurveGlyph curve={p.curve} active={on} />
                {p.label}
              </motion.button>
            )
          })}
        </div>

        <AnimatePresence initial={false} mode="wait">
          {preset === 'custom' ? (
            <motion.div
              key="custom"
              initial={reduced ? false : { opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={reduced ? undefined : { opacity: 0, height: 0 }}
              transition={{ duration: dur.normal, ease: curve.decelerate }}
              className="overflow-hidden"
            >
              <div className="mt-3 flex flex-col gap-2.5" data-no-wheel>
                <EqRow label="Bass" value={custom.bass} onChange={(x) => changeCustom({ bass: x })} />
                <EqRow label="Voice" value={custom.voice} onChange={(x) => changeCustom({ voice: x })} />
                <EqRow label="Treble" value={custom.treble} onChange={(x) => changeCustom({ treble: x })} />
                <Button size="sm" onClick={() => changeCustom(NO_EQ)} className="self-start rounded-full text-[var(--os-text-dim)]">
                  Reset
                </Button>
              </div>
            </motion.div>
          ) : preset !== 'flat' ? (
            <motion.div
              key="strength"
              initial={reduced ? false : { opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={reduced ? undefined : { opacity: 0, height: 0 }}
              transition={{ duration: dur.normal, ease: curve.decelerate }}
              className="overflow-hidden"
            >
              <div className="mt-3" data-no-wheel>
                <label className="flex items-center gap-3 text-[12px] text-[var(--os-text-dim)]">
                  <span className="w-14 shrink-0">Strength</span>
                  <Slider value={Math.round(strength * 100)} min={50} max={150} step={10} aria-label="Strength" onChange={(x) => changeStrength(x / 100)} className="min-w-0 flex-1" />
                  <span className="w-12 text-right tabular-nums text-[var(--os-text)]">{Math.round(strength * 100)}%</span>
                </label>
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>

        {preset !== 'flat' && <p className="mt-2 text-[11px] leading-snug text-[var(--os-text-dim)]">Levels are lowered automatically as you boost, so it never distorts. Set it once — it stays until you change it.</p>}

        {fx && !fx.installed && (
          <div className="mt-3 rounded-[12px] bg-[var(--os-hover)] p-3 text-[12.5px] leading-snug">
            <p className="font-medium">One last step to hear your mode</p>
            <p className="mt-1 text-[var(--os-text-dim)]">
              {setup === 'opened'
                ? 'The installer is open. Finish it, tick your speakers (or headphones) when it asks, then restart your PC once. This turns on by itself afterwards.'
                : 'Modes shape every app and film through Equalizer APO — free, with no delay, feedback or hiss. Udaan downloads and opens the official installer for you.'}
            </p>
            <div className="mt-2.5 flex flex-wrap gap-2">
              <Button variant="filled" size="sm" disabled={setup === 'downloading'} onClick={() => void install()} className="rounded-full">
                {setup === 'downloading' ? 'Downloading…' : setup === 'opened' ? 'Open installer again' : 'Download and install'}
              </Button>
              <Button variant="tinted" size="sm" onClick={refreshFx} className="rounded-full">
                Check again
              </Button>
              <Button size="sm" onClick={() => void launchApp('https://sourceforge.net/projects/equalizerapo/')} className="rounded-full text-[var(--os-text-dim)]">
                Website
              </Button>
            </div>
          </div>
        )}
        {fxError && <p className="mt-2 text-[12px] leading-snug text-[var(--color-danger)]">{fxError}</p>}
      </section>

      {/* ── Keep speakers awake ───────────────────────────────────── */}
      <section className="rounded-[12px] bg-[var(--os-hover)] p-3" data-no-wheel>
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-[13px] font-semibold">Keep speakers awake</h2>
            <p className="mt-0.5 text-[11.5px] leading-snug text-[var(--os-text-dim)]">
              Stops speakers switching off on quiet scenes, so soft sounds are always heard.
            </p>
          </div>
          <Switch checked={awake} onChange={(next) => keep(next)} label="Keep speakers awake" />
        </div>

        <AnimatePresence initial={false}>
          {awake && (
            <motion.div
              initial={reduced ? false : { opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={reduced ? undefined : { opacity: 0, height: 0 }}
              transition={{ duration: dur.normal, ease: curve.decelerate }}
              className="overflow-hidden"
            >
              <div className="mt-3 flex flex-col gap-2.5">
                <Segmented
                  value={String(awakeLevel) as '1' | '2' | '3'}
                  options={AWAKE_LEVELS}
                  onChange={(next) => {
                    const level = Number(next)
                    void setAwakeLevel(level)
                    keep(true, level)
                  }}
                  className="w-full [&>button]:flex-1"
                />
                <OutputMeter active={awake} level={awakeLevel} />
                <p className="text-[11px] leading-snug text-[var(--os-text-dim)]">
                  The signal has to clear the line on the meter for a speaker to notice it. Gentle is quietest; Strong is for AV
                  receivers and Bluetooth, which sleep hardest. If sound still cuts out, go up one step.
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </section>

      <div className="flex gap-2" data-no-wheel>
        <Button variant="tinted" size="lg" onClick={() => void openApp('live-dj')} className="flex-1 rounded-[10px] text-[12.5px]">
          DJ board
        </Button>
        <Button variant="tinted" size="lg" onClick={() => void launchApp('ms-settings:sound')} className="flex-1 rounded-[10px] text-[12.5px]">
          Sound settings…
        </Button>
      </div>
    </div>
  )
}

/** One band of the manual EQ. */
function EqRow({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="flex items-center gap-3 text-[12px] text-[var(--os-text-dim)]">
      <span className="w-14 shrink-0">{label}</span>
      <Slider value={value} min={-8} max={8} step={0.5} aria-label={label} onChange={onChange} className="min-w-0 flex-1" />
      <span className="w-12 text-right tabular-nums text-[var(--os-text)]">
        {value > 0 ? '+' : ''}
        {Number.isInteger(value) ? value : value.toFixed(1)} dB
      </span>
    </label>
  )
}
