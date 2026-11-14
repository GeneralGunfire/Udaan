import { useCallback, useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { launchApp } from '@/integrations/installed-apps/client'
import { Button } from '@/os/ui/controls'
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
function quality(signal: number): string {
  if (signal >= 75) return 'Excellent'
  if (signal >= 50) return 'Good'
  if (signal >= 30) return 'Fair'
  return 'Weak'
}

/** Four bars filled to the signal strength. */
function SignalBars({ signal }: { signal: number }) {
  const lit = Math.max(1, Math.ceil((signal / 100) * 4))
  return (
    <span className="flex h-[18px] items-end gap-[3px]" aria-hidden>
      {[0, 1, 2, 3].map((i) => (
        <span key={i} className="w-[4px] rounded-[1.5px]" style={{ height: 5 + i * 4, background: i < lit ? 'var(--u-ink)' : 'var(--u-wash-press)' }} />
      ))}
    </span>
  )
}

/** A value you can click to copy; confirms in place. */
function CopyValue({ value }: { value: string }) {
  const [done, setDone] = useState(false)
  const copy = useCallback(() => {
    void navigator.clipboard.writeText(value).then(() => {
      setDone(true)
      playSound('success')
      setTimeout(() => setDone(false), 1400)
    })
  }, [value])
  return (
    <button type="button" onClick={copy} title="Click to copy" className="min-w-0 truncate text-right tabular-nums hover:text-(--u-accent)">
      {done ? 'Copied' : value}
    </button>
  )
}

/** The menu bar's network popup: are you connected, and through what. */
export function NetworkPanel() {
  const [s, setS] = useState<NetworkStatus | null>(null)
  // Mounted only while the popup is open, so this stops with it.
  useEffect(() => {
    const load = () => void invoke<NetworkStatus>('shell_network_status').then(setS, () => {})
    load()
    const t = setInterval(load, 3000)
    return () => clearInterval(t)
  }, [])

  const title = !s ? 'Checking…' : s.connected ? 'Connected' : 'Not connected'
  const via = s?.connected ? (s.kind === 'wifi' ? (s.name ?? 'Wi-Fi') : s.kind === 'ethernet' ? 'Ethernet' : (s.name ?? 'Network')) : 'No network connection'

  const rows: [string, React.ReactNode][] = []
  if (s?.connected) {
    if (s.adapter) rows.push(['Adapter', <span key="a" className="block truncate text-right">{s.adapter}</span>])
    if (s.ipv4) rows.push(['IP address', <CopyValue key="ip" value={s.ipv4} />])
    if (s.speedMbps) rows.push(['Link speed', <span key="sp" className="block text-right tabular-nums">{s.speedMbps >= 1000 ? `${s.speedMbps / 1000} Gbps` : `${s.speedMbps} Mbps`}</span>])
  }

  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex items-center gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full" style={{ background: s?.connected ? 'var(--u-ink)' : 'var(--u-wash-on)', color: s?.connected ? 'var(--u-m-solid)' : 'var(--u-ink-2)' }}>
          <Glyph kind={s?.kind ?? 'none'} connected={!!s?.connected} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-semibold leading-tight">{title}</p>
          <p className="truncate text-[13px] text-(--u-ink-3)">{via}</p>
        </div>
        {s?.connected && <span className="h-2 w-2 shrink-0 rounded-full bg-(--u-ok)" aria-label="Online" />}
      </div>

      {s?.connected && s.signal != null && (
        <div className="u-surface--card flex items-center gap-3 px-3.5 py-2.5">
          <SignalBars signal={s.signal} />
          <span className="text-[13px] font-medium">{quality(s.signal)}</span>
          <span className="ml-auto text-[12.5px] tabular-nums text-(--u-ink-3)">{s.signal}%</span>
        </div>
      )}

      {rows.length > 0 && (
        <dl className="u-surface--card grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 px-3.5 py-3 text-[12.5px]">
          {rows.map(([label, value]) => (
            <div key={label} className="col-span-2 grid grid-cols-subgrid">
              <dt className="text-(--u-ink-3)">{label}</dt>
              <dd className="min-w-0">{value}</dd>
            </div>
          ))}
        </dl>
      )}

      <div className="flex gap-2">
        <Button variant="tinted" className="flex-1" onClick={() => void launchApp('ms-settings:network')}>
          Network settings…
        </Button>
        {s?.kind === 'wifi' && (
          <Button variant="tinted" className="flex-1" onClick={() => void launchApp('ms-settings:network-wifi')}>
            Wi-Fi networks
          </Button>
        )}
      </div>
    </div>
  )
}
