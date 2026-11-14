import { useCallback, useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { invoke } from '@tauri-apps/api/core'
import { launchApp } from '@/integrations/installed-apps/client'
import { Button } from '@/os/ui/controls'
import { badgePop, springs, staggerDelay } from '@/os/motion/systemMotion'
import { prefersReducedMotion } from '@/shared/lib/motion'
import { playSound } from '@/os/sound/sounds'

interface NetworkStatus {
  connected: boolean
  kind: 'ethernet' | 'wifi' | 'other' | 'none'
  name: string | null
  adapter: string | null
  speedMbps: number | null
  ipv4: string | null
  signal: number | null
}

const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }

function Glyph({ kind, connected }: { kind: NetworkStatus['kind']; connected: boolean }) {
  if (kind === 'wifi')
    return (
      <svg viewBox="0 0 24 24" width="22" height="22" {...stroke} aria-hidden>
        <path d="M2.5 9a14 14 0 0 1 19 0M5.5 12.5a9.5 9.5 0 0 1 13 0M8.8 16a5 5 0 0 1 6.4 0" />
        <circle cx="12" cy="19.2" r="1.2" fill="currentColor" stroke="none" />
      </svg>
    )
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" {...stroke} opacity={connected ? 1 : 0.5} aria-hidden>
      <rect x="3" y="4" width="18" height="11" rx="2" />
      <path d="M8 20h8M12 15v5" />
    </svg>
  )
}

/** Plain-language quality, so "62%" means something at a glance. */
function quality(signal: number): { label: string; colour: string } {
  if (signal >= 75) return { label: 'Excellent', colour: '#30d158' }
  if (signal >= 50) return { label: 'Good', colour: '#30d158' }
  if (signal >= 30) return { label: 'Fair', colour: '#ffd60a' }
  return { label: 'Weak', colour: '#ff9f0a' }
}

/**
 * Four bars that fill to the signal strength.
 *
 * Scaled with transform rather than animating height: this popup lives in an
 * OS window that is resized to fit its content, so a height animation would
 * resize the window every frame.
 */
function SignalBars({ signal }: { signal: number }) {
  const lit = Math.max(1, Math.ceil((signal / 100) * 4))
  const { colour } = quality(signal)
  return (
    <span className="flex h-[18px] items-end gap-[3px]" aria-hidden>
      {[0, 1, 2, 3].map((i) => (
        <motion.span
          key={i}
          className="w-[4px] origin-bottom rounded-[1.5px]"
          style={{ height: 5 + i * 4, background: i < lit ? colour : 'var(--os-active)' }}
          initial={{ scaleY: 0.3, opacity: 0 }}
          animate={{ scaleY: 1, opacity: 1 }}
          transition={{ ...springs.gentle, delay: i * 0.05 }}
        />
      ))}
    </span>
  )
}

/** A value you can click to copy. Confirms in place, with a sound. */
function CopyValue({ value, children }: { value: string; children: React.ReactNode }) {
  const [done, setDone] = useState(false)
  const copy = useCallback(() => {
    void navigator.clipboard.writeText(value).then(() => {
      setDone(true)
      playSound('success')
      setTimeout(() => setDone(false), 1400)
    })
  }, [value])
  return (
    <button type="button" onClick={copy} title="Click to copy" className="relative min-w-0 truncate text-right tabular-nums outline-none hover:text-accent focus-visible:underline">
      <AnimatePresence mode="wait" initial={false}>
        <motion.span key={done ? 'done' : 'val'} initial={{ opacity: 0, y: 3 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -3 }} transition={{ duration: 0.12 }} className="block">
          {done ? 'Copied' : children}
        </motion.span>
      </AnimatePresence>
    </button>
  )
}

/** The menu bar's network popup: are you connected, and through what. */
export function NetworkPanel() {
  const [s, setS] = useState<NetworkStatus | null>(null)
  const reduced = prefersReducedMotion()
  useEffect(() => {
    const load = () => void invoke<NetworkStatus>('shell_network_status').then(setS, () => {})
    load()
    const t = setInterval(load, 3000)
    return () => clearInterval(t)
  }, [])

  const title = !s ? 'Checking…' : s.connected ? 'Connected' : 'Not connected'
  const via = s?.connected ? (s.kind === 'wifi' ? (s.name ?? 'Wi-Fi') : s.kind === 'ethernet' ? 'Ethernet' : (s.name ?? 'Network')) : 'No network connection'

  const rows: [string, React.ReactNode, string?][] = []
  if (s?.connected) {
    if (s.adapter) rows.push(['Adapter', <span key="a" className="block truncate text-right">{s.adapter}</span>])
    if (s.ipv4) rows.push(['IP address', <CopyValue key="ip" value={s.ipv4}>{s.ipv4}</CopyValue>])
    if (s.speedMbps) rows.push(['Link speed', <span key="sp" className="block text-right tabular-nums">{s.speedMbps >= 1000 ? `${s.speedMbps / 1000} Gbps` : `${s.speedMbps} Mbps`}</span>])
  }

  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex items-center gap-3">
        <span
          className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full"
          style={{
            background: s?.connected ? 'var(--color-accent)' : 'var(--os-hover)',
            color: s?.connected ? 'var(--color-accent-contrast)' : 'currentColor',
            boxShadow: s?.connected ? 'var(--os-edge), var(--os-shadow-sm)' : undefined,
          }}
        >
          <Glyph kind={s?.kind ?? 'none'} connected={!!s?.connected} />
        </span>
        <div className="min-w-0">
          <p className="text-[15px] font-semibold leading-tight">{title}</p>
          <p className="truncate text-[13px] text-(--os-text-dim)">{via}</p>
        </div>
        {s?.connected && (
          <span className="relative ml-auto flex h-2.5 w-2.5 shrink-0" aria-label="Online">
            {/* A ring that breathes outward, so "connected" reads as live. */}
            {!reduced && <motion.span className="absolute inset-0 rounded-full bg-[#30d158]" animate={{ scale: [1, 2.6], opacity: [0.5, 0] }} transition={{ duration: 1.8, repeat: Infinity, ease: 'easeOut' }} />}
            <motion.span {...(reduced ? {} : badgePop)} className="relative h-2.5 w-2.5 rounded-full bg-[#30d158]" />
          </span>
        )}
      </div>

      {s?.connected && s.signal != null && (
        <motion.div initial={reduced ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={springs.gentle} className="flex items-center gap-3 rounded-[10px] bg-(--os-hover) px-3.5 py-2.5">
          <SignalBars signal={s.signal} />
          <span className="text-[13px] font-medium" style={{ color: quality(s.signal).colour }}>{quality(s.signal).label}</span>
          <span className="ml-auto text-[12.5px] tabular-nums text-(--os-text-dim)">{s.signal}%</span>
        </motion.div>
      )}

      {rows.length > 0 && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-[10px] bg-(--os-hover) px-3.5 py-3 text-[12.5px]">
          {rows.map(([label, value], i) => (
            <motion.div key={label} className="col-span-2 grid grid-cols-subgrid" initial={reduced ? false : { opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: staggerDelay(i, 0.04), duration: 0.18 }}>
              <dt className="text-(--os-text-dim)">{label}</dt>
              <dd className="min-w-0">{value}</dd>
            </motion.div>
          ))}
        </dl>
      )}

      <div className="flex gap-2">
        <Button variant="tinted" size="lg" className="flex-1" onClick={() => void launchApp('ms-settings:network')}>
          Network settings…
        </Button>
        {s?.kind === 'wifi' && (
          <Button variant="tinted" size="lg" className="flex-1" onClick={() => void launchApp('ms-settings:network-wifi')}>
            Wi-Fi networks
          </Button>
        )}
      </div>
    </div>
  )
}
