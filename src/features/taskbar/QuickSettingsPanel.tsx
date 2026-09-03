import { useCallback, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import {
  VolumeIcon,
  VolumeMuteIcon,
  WifiIcon,
  BatteryIcon,
  BatteryChargingIcon,
} from '@/shared/icons'
import { cn } from '@/shared/lib/cn'
import { spring, staggerGroup, staggerItem, prefersReducedMotion } from '@/shared/lib/motion'
import {
  batteryStatus,
  sendVolumeCommand,
  wifiDetails,
  setWifiRadioEnabled,
  type BatteryStatus,
  type WifiDetails,
} from '@/integrations/quick-settings/client'
import { systemHealthStats, type SystemStats } from '@/integrations/system-health/client'

/**
 * Quick settings, opened from the taskbar's status cluster.
 *
 * The taskbar previously exposed exactly one system control — a mute
 * toggle — while the backend already supported volume up/down, Wi-Fi
 * radio state and detail, and live memory/disk stats. All of that was
 * built and unreachable. This surfaces it in one place, the way a real
 * desktop shell's quick-settings flyout does: toggles for the things you
 * flip, a slider for the thing you adjust, and passive readouts for the
 * things you only check.
 *
 * Polling only runs while the panel is actually open — a flyout that
 * keeps querying battery and disk state after it closes is pure
 * background cost on a machine this app is trying to stay light on.
 */

const STATS_POLL_MS = 4000

export function QuickSettingsPanel() {
  const reduced = prefersReducedMotion()
  const [battery, setBattery] = useState<BatteryStatus | null>(null)
  const [wifi, setWifi] = useState<WifiDetails | null>(null)
  const [stats, setStats] = useState<SystemStats | null>(null)
  const [muted, setMuted] = useState(false)
  const [wifiPending, setWifiPending] = useState(false)

  const refresh = useCallback(async () => {
    const [b, w, s] = await Promise.allSettled([batteryStatus(), wifiDetails(), systemHealthStats()])
    if (b.status === 'fulfilled') setBattery(b.value)
    if (w.status === 'fulfilled') setWifi(w.value)
    if (s.status === 'fulfilled') setStats(s.value)
  }, [])

  useEffect(() => {
    void refresh()
    const id = window.setInterval(() => void refresh(), STATS_POLL_MS)
    return () => window.clearInterval(id)
  }, [refresh])

  async function toggleWifi() {
    if (!wifi || wifiPending) return
    setWifiPending(true)
    const next = !wifi.radioOn
    // Optimistic: the radio toggle takes a moment to report back, and a
    // switch that visibly lags behind the click reads as broken.
    setWifi({ ...wifi, radioOn: next })
    try {
      await setWifiRadioEnabled(next)
    } catch {
      setWifi({ ...wifi, radioOn: !next })
    } finally {
      setWifiPending(false)
      void refresh()
    }
  }

  return (
    <motion.div
      variants={reduced ? undefined : staggerGroup}
      initial={reduced ? undefined : 'hidden'}
      animate={reduced ? undefined : 'show'}
      className="flex w-72 flex-col gap-3 p-3"
    >
      {/* Toggles — the things you flip. */}
      <motion.div variants={staggerItem} className="grid grid-cols-2 gap-2">
        <QuickToggle
          icon={WifiIcon}
          label={!wifi?.radioOn ? 'Wi-Fi off' : (wifi.ssid ?? 'Wi-Fi')}
          sublabel={
            wifi?.radioOn
              ? wifi.connected
                ? wifi.signalQuality != null
                  ? `${wifi.signalQuality}%`
                  : 'Connected'
                : 'Not connected'
              : undefined
          }
          active={!!wifi?.radioOn}
          // No adapter means there is nothing to toggle — disable rather
          // than offering a control that silently does nothing.
          disabled={!wifi || !wifi.hasAdapter || wifiPending}
          onClick={toggleWifi}
        />
        <QuickToggle
          icon={muted ? VolumeMuteIcon : VolumeIcon}
          label={muted ? 'Muted' : 'Sound'}
          active={!muted}
          onClick={() => {
            setMuted((m) => !m)
            void sendVolumeCommand('mute')
          }}
        />
      </motion.div>

      {/* Volume — the thing you adjust. The backend only exposes stepped
          up/down commands (there is no set-absolute-level command), so
          this is a pair of steppers rather than a slider pretending to
          have a value it cannot actually read back. */}
      <motion.div
        variants={staggerItem}
        className="flex items-center gap-2 rounded-lg border border-(--border-hairline) px-3 py-2.5"
        style={{ background: 'var(--surface-raised)' }}
      >
        <VolumeIcon width={15} height={15} className="text-text-tertiary shrink-0" />
        <span className="text-text-secondary flex-1 text-xs font-medium">Volume</span>
        <StepButton label="Volume down" onClick={() => void sendVolumeCommand('down')}>
          −
        </StepButton>
        <StepButton label="Volume up" onClick={() => void sendVolumeCommand('up')}>
          +
        </StepButton>
      </motion.div>

      {/* Readouts — the things you only check. */}
      <motion.div variants={staggerItem} className="flex flex-col gap-2">
        {battery?.hasBattery && (
          <StatRow
            icon={battery.isCharging ? BatteryChargingIcon : BatteryIcon}
            label={battery.isCharging ? 'Charging' : 'Battery'}
            value={`${battery.percent}%`}
            fill={battery.percent / 100}
          />
        )}
        {stats && (
          <>
            <StatRow
              label="Memory"
              value={`${formatGb(stats.memory.used_bytes)} / ${formatGb(stats.memory.total_bytes)}`}
              fill={stats.memory.used_bytes / Math.max(stats.memory.total_bytes, 1)}
            />
            {stats.disks[0] && (
              <StatRow
                label={`Disk ${stats.disks[0].name}`}
                value={`${formatGb(stats.disks[0].free_bytes)} free`}
                fill={
                  1 - stats.disks[0].free_bytes / Math.max(stats.disks[0].total_bytes, 1)
                }
              />
            )}
          </>
        )}
      </motion.div>
    </motion.div>
  )
}

function formatGb(bytes: number): string {
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`
}

function QuickToggle({
  icon: Icon,
  label,
  sublabel,
  active,
  disabled,
  onClick,
}: {
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>
  label: string
  sublabel?: string
  active: boolean
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={cn(
        'flex min-w-0 items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left',
        'transition-[background-color,border-color,transform] duration-150 ease-out',
        'disabled:pointer-events-none disabled:opacity-40',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
        'motion-reduce:transform-none',
        active
          ? 'border-transparent text-white'
          : 'border-(--border-hairline) bg-(--surface-raised) text-text-secondary hover:bg-(--surface-overlay) hover:-translate-y-px',
      )}
      style={active ? { background: 'var(--gradient-brand)' } : undefined}
    >
      <Icon width={16} height={16} className="shrink-0" />
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-xs font-medium">{label}</span>
        {sublabel && (
          <span className={cn('truncate text-2xs', active ? 'text-white/70' : 'text-text-tertiary')}>
            {sublabel}
          </span>
        )}
      </span>
    </button>
  )
}

function StepButton({
  children,
  label,
  onClick,
}: {
  children: React.ReactNode
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={cn(
        'text-text-secondary flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-sm font-medium',
        'border border-(--border-hairline) bg-(--surface-overlay)',
        'transition-colors duration-100 hover:text-text-primary hover:border-(--border-strong)',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
      )}
    >
      {children}
    </button>
  )
}

/** A passive readout with a thin fill bar — no background track, so a low
 *  value reads as a small mark rather than a mostly-empty container. */
function StatRow({
  icon: Icon,
  label,
  value,
  fill,
}: {
  icon?: React.ComponentType<React.SVGProps<SVGSVGElement>>
  label: string
  value: string
  fill: number
}) {
  const pct = Math.max(0, Math.min(1, fill)) * 100
  return (
    <div className="flex flex-col gap-1.5 px-1">
      <div className="flex items-center gap-2">
        {Icon && <Icon width={13} height={13} className="text-text-tertiary shrink-0" />}
        <span className="text-text-tertiary flex-1 truncate text-2xs font-medium">{label}</span>
        <span className="text-text-secondary shrink-0 text-2xs tabular-nums">{value}</span>
      </div>
      <div className="h-0.5 w-full overflow-hidden rounded-full bg-(--surface-overlay)">
        <motion.div
          className="h-full rounded-full"
          style={{ background: 'var(--gradient-brand)' }}
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={spring.gentle}
        />
      </div>
    </div>
  )
}
