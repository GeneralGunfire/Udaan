import { useCallback, useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { invoke } from '@tauri-apps/api/core'
import { launchApp } from '@/integrations/installed-apps/client'
import { usePref } from '@/os/kernel/prefs'
import { openApp } from '@/os/kernel/shell'
import { VolumeIcon, VolumeMuteIcon } from '@/shared/icons'
import { cn } from '@/shared/lib/cn'

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

/** System-wide sound modes. The curves live in Rust (sound_fx.rs). */
const PRESETS = [
  { id: 'flat', label: 'Flat', hint: 'No processing' },
  { id: 'music', label: 'Music', hint: 'Fuller low end, clearer vocals, a little air' },
  { id: 'cinematic', label: 'Cinematic', hint: 'Weighty lows and clear dialogue for films' },
  { id: 'bass', label: 'Bass', hint: 'Deep, punchy low end' },
  { id: 'vocal', label: 'Dialogue', hint: 'Speech and vocals up front' },
  { id: 'night', label: 'Night', hint: 'Softer lows and highs for late listening' },
  { id: 'clarity', label: 'Clarity', hint: 'Brighter, more detail' },
  { id: 'custom', label: 'Custom', hint: 'Set bass, voice and treble yourself' },
] as const

const AWAKE_LEVELS = [
  { id: 1, label: 'Low' },
  { id: 2, label: 'Medium' },
  { id: 3, label: 'High' },
] as const

const clamp01 = (n: number) => Math.min(1, Math.max(0, n))

function errorText(code: string, path: string | null): string {
  if (code === 'not-installed') return 'Equalizer APO was not found.'
  if (code === 'no-access') return `Udaan can't write to ${path ?? "Equalizer APO's config folder"}. Give your Windows user Modify permission on that folder once, then try again.`
  if (code.startsWith('download-failed')) return "Couldn't download the installer. Check your connection, or get it from the website."
  return code
}

function Row({ label, value, unit, min, max, step, onChange, wheel = false }: { label: string; value: number; unit: string; min: number; max: number; step: number; onChange: (v: number) => void; wheel?: boolean }) {
  const pct = ((value - min) / (max - min)) * 100
  return (
    <label className="flex items-center gap-3 text-[12px] text-[var(--os-menu-text-dim)]" data-no-wheel={wheel ? undefined : true}>
      <span className="w-14 shrink-0">{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} aria-label={label} onChange={(e) => onChange(Number(e.target.value))} className="os-slider min-w-0 flex-1" style={{ ['--fill' as string]: `${pct}%` }} />
      <span className="w-12 text-right tabular-nums text-[var(--os-menu-text)]">
        {value > 0 && unit === ' dB' ? '+' : ''}
        {Number.isInteger(value) ? value : value.toFixed(1)}
        {unit}
      </span>
    </label>
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
      className="flex flex-col gap-4 p-4 text-[var(--os-menu-text)]"
      onWheel={(e) => {
        // Scroll anywhere on the panel to change the volume.
        if (!(e.target as HTMLElement).closest('[data-no-wheel]')) nudge(e.deltaY < 0 ? 0.03 : -0.03)
      }}
    >
      {/* ---- Volume ---- */}
      <section>
        <div className="mb-2.5 flex items-baseline justify-between">
          <h2 className="text-[13px] font-semibold">Volume</h2>
          <span className="text-[22px] font-light tabular-nums leading-none">
            {v ? shown : '–'}
            <span className="text-[12px] text-[var(--os-menu-text-dim)]">%</span>
          </span>
        </div>
        <div className="flex items-center gap-2.5">
          <motion.button
            type="button"
            aria-label={v?.muted ? 'Unmute' : 'Mute'}
            title={v?.muted ? 'Unmute' : 'Mute'}
            disabled={!v}
            whileTap={{ scale: 0.9 }}
            onClick={() => v && apply({ muted: !v.muted })}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-colors"
            style={{ background: v && !v.muted ? 'var(--color-accent)' : 'var(--os-menu-item-hover)', color: v && !v.muted ? 'var(--color-accent-contrast)' : 'currentColor' }}
          >
            {v?.muted ? <VolumeMuteIcon width={18} height={18} /> : <VolumeIcon width={18} height={18} />}
          </motion.button>
          <button type="button" aria-label="Quieter" title="Quieter" disabled={!v} onClick={() => nudge(-0.05)} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[18px] leading-none text-[var(--os-menu-text-dim)] hover:bg-[var(--os-menu-item-hover)] hover:text-[var(--os-menu-text)] active:scale-90">
            −
          </button>
          <input
            type="range"
            min={0}
            max={100}
            value={shown}
            disabled={!v}
            aria-label="Volume"
            data-no-wheel
            onWheel={(e) => {
              e.stopPropagation()
              nudge(e.deltaY < 0 ? 0.03 : -0.03)
            }}
            onChange={(e) => apply({ level: Number(e.target.value) / 100, ...(v?.muted ? { muted: false } : {}) })}
            className="os-slider min-w-0 flex-1"
            style={{ ['--fill' as string]: `${shown}%` }}
          />
          <button type="button" aria-label="Louder" title="Louder" disabled={!v} onClick={() => nudge(0.05)} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[18px] leading-none text-[var(--os-menu-text-dim)] hover:bg-[var(--os-menu-item-hover)] hover:text-[var(--os-menu-text)] active:scale-90">
            +
          </button>
        </div>
      </section>

      {/* ---- Sound mode ---- */}
      <section>
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="text-[13px] font-semibold">Sound mode</h2>
          <span className="truncate pl-2 text-[11.5px] text-[var(--os-menu-text-dim)]">{active?.hint}</span>
        </div>

        <div className={cn('grid grid-cols-4 gap-1.5', busy && 'opacity-70')}>
          {PRESETS.map((p) => {
            const on = preset === p.id
            return (
              <motion.button
                key={p.id}
                type="button"
                title={p.hint}
                whileTap={{ scale: 0.94 }}
                onClick={() => choose(p.id)}
                className={cn('h-9 rounded-[10px] px-1 text-[12px] font-medium transition-colors', on ? 'bg-[var(--color-accent)] text-[var(--color-accent-contrast)]' : 'bg-[var(--os-menu-item-hover)] hover:bg-[var(--surface-hover)]')}
              >
                {p.label}
              </motion.button>
            )
          })}
        </div>

        {preset === 'custom' ? (
          <div className="mt-3 flex flex-col gap-2.5">
            <Row label="Bass" value={custom.bass} unit=" dB" min={-8} max={8} step={0.5} onChange={(x) => changeCustom({ bass: x })} />
            <Row label="Voice" value={custom.voice} unit=" dB" min={-8} max={8} step={0.5} onChange={(x) => changeCustom({ voice: x })} />
            <Row label="Treble" value={custom.treble} unit=" dB" min={-8} max={8} step={0.5} onChange={(x) => changeCustom({ treble: x })} />
            <button type="button" onClick={() => changeCustom(NO_EQ)} className="self-start rounded-full px-2.5 py-1 text-[11.5px] text-[var(--os-menu-text-dim)] hover:bg-[var(--os-menu-item-hover)]">
              Reset
            </button>
          </div>
        ) : (
          preset !== 'flat' && (
            <div className="mt-3">
              <Row label="Strength" value={Math.round(strength * 100)} unit="%" min={50} max={150} step={10} onChange={(x) => changeStrength(x / 100)} />
            </div>
          )
        )}
        {preset !== 'flat' && <p className="mt-2 text-[11px] leading-snug text-[var(--os-menu-text-dim)]">Levels are lowered automatically as you boost, so it never distorts. Set it once — it stays until you change it.</p>}

        {fx && !fx.installed && (
          <div className="mt-3 rounded-[12px] bg-[var(--os-menu-item-hover)] p-3 text-[12.5px] leading-snug">
            <p className="font-medium">One last step to hear your mode</p>
            <p className="mt-1 text-[var(--os-menu-text-dim)]">
              {setup === 'opened'
                ? 'The installer is open. Finish it, tick your speakers (or headphones) when it asks, then restart your PC once. This turns on by itself afterwards.'
                : 'Modes shape every app and film through Equalizer APO — free, with no delay, feedback or hiss. Udaan downloads and opens the official installer for you.'}
            </p>
            <div className="mt-2.5 flex flex-wrap gap-2">
              <button type="button" disabled={setup === 'downloading'} onClick={() => void install()} className="rounded-full bg-[var(--color-accent)] px-3.5 py-1.5 text-[12px] font-semibold text-[var(--color-accent-contrast)] active:scale-95 disabled:opacity-60">
                {setup === 'downloading' ? 'Downloading…' : setup === 'opened' ? 'Open installer again' : 'Download and install'}
              </button>
              <button type="button" onClick={refreshFx} className="rounded-full bg-black/20 px-3.5 py-1.5 text-[12px] font-medium hover:bg-black/30 active:scale-95">
                Check again
              </button>
              <button type="button" onClick={() => void launchApp('https://sourceforge.net/projects/equalizerapo/')} className="rounded-full px-2.5 py-1.5 text-[12px] text-[var(--os-menu-text-dim)] hover:bg-black/20">
                Website
              </button>
            </div>
          </div>
        )}
        {fxError && <p className="mt-2 text-[12px] leading-snug text-[var(--color-danger)]">{fxError}</p>}
      </section>

      {/* ---- Keep speakers awake ---- */}
      <section className="rounded-[12px] bg-[var(--os-menu-item-hover)] p-3" data-no-wheel>
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-[13px] font-semibold">Keep speakers awake</h2>
            <p className="mt-0.5 text-[11.5px] leading-snug text-[var(--os-menu-text-dim)]">Stops speakers switching off on quiet scenes, so soft sounds are always heard.</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={awake}
            aria-label="Keep speakers awake"
            onClick={() => keep(!awake)}
            className={cn('relative h-6 w-11 shrink-0 rounded-full transition-colors', awake ? 'bg-[var(--color-accent)]' : 'bg-white/20')}
          >
            <motion.span className="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow" animate={{ x: awake ? 20 : 0 }} transition={{ type: 'spring', stiffness: 600, damping: 32 }} />
          </button>
        </div>
        {awake && (
          <div className="mt-2.5 flex items-center gap-2 text-[11.5px] text-[var(--os-menu-text-dim)]">
            Strength
            <div className="flex flex-1 gap-1 rounded-full bg-black/20 p-0.5">
              {AWAKE_LEVELS.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  onClick={() => {
                    void setAwakeLevel(l.id)
                    keep(true, l.id)
                  }}
                  className={cn('h-6 flex-1 rounded-full text-[11.5px] font-medium transition-colors', awakeLevel === l.id ? 'bg-white/90 text-black' : 'hover:bg-white/10')}
                >
                  {l.label}
                </button>
              ))}
            </div>
          </div>
        )}
        {awake && <p className="mt-2 text-[11px] leading-snug text-[var(--os-menu-text-dim)]">If sound still cuts out on quiet parts, raise the strength one step.</p>}
      </section>

      <div className="flex gap-2" data-no-wheel>
        <button type="button" onClick={() => void openApp('live-dj')} className="flex-1 rounded-[10px] bg-[var(--os-menu-item-hover)] py-2 text-[12.5px] font-medium hover:bg-[var(--surface-hover)] active:scale-[0.98]">
          DJ board
        </button>
        <button type="button" onClick={() => void launchApp('ms-settings:sound')} className="flex-1 rounded-[10px] bg-[var(--os-menu-item-hover)] py-2 text-[12.5px] font-medium hover:bg-[var(--surface-hover)] active:scale-[0.98]">
          Sound settings…
        </button>
      </div>
    </div>
  )
}
