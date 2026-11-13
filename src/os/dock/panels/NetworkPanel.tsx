import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { launchApp } from '@/integrations/installed-apps/client'

interface NetworkStatus {
  connected: boolean
  kind: 'ethernet' | 'wifi' | 'other' | 'none'
  name: string | null
  adapter: string | null
  speedMbps: number | null
  ipv4: string | null
  signal: number | null
}

function Glyph({ kind, connected }: { kind: NetworkStatus['kind']; connected: boolean }) {
  const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  if (kind === 'wifi')
    return (
      <svg viewBox="0 0 24 24" width="22" height="22" {...stroke}>
        <path d="M2.5 9a14 14 0 0 1 19 0M5.5 12.5a9.5 9.5 0 0 1 13 0M8.8 16a5 5 0 0 1 6.4 0" />
        <circle cx="12" cy="19.2" r="1.2" fill="currentColor" stroke="none" />
      </svg>
    )
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" {...stroke} opacity={connected ? 1 : 0.5}>
      <rect x="3" y="4" width="18" height="11" rx="2" />
      <path d="M8 20h8M12 15v5" />
    </svg>
  )
}

/** The menu bar's network popup: are you connected, and through what. */
export function NetworkPanel() {
  const [s, setS] = useState<NetworkStatus | null>(null)
  useEffect(() => {
    const load = () => void invoke<NetworkStatus>('shell_network_status').then(setS, () => {})
    load()
    const t = setInterval(load, 3000)
    return () => clearInterval(t)
  }, [])

  const title = !s ? 'Checking…' : s.connected ? 'Connected' : 'Not connected'
  const via = s?.connected ? (s.kind === 'wifi' ? s.name ?? 'Wi-Fi' : s.kind === 'ethernet' ? 'Ethernet' : s.name ?? 'Network') : 'No network connection'

  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex items-center gap-3">
        <span
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full"
          style={{ background: s?.connected ? 'var(--color-accent)' : 'var(--os-menu-item-hover)', color: s?.connected ? 'var(--color-accent-contrast)' : 'currentColor' }}
        >
          <Glyph kind={s?.kind ?? 'none'} connected={!!s?.connected} />
        </span>
        <div className="min-w-0">
          <p className="text-[15px] font-semibold leading-tight">{title}</p>
          <p className="truncate text-[13px] text-(--os-text-dim)">{via}</p>
        </div>
        {s?.connected && <span className="ml-auto h-2.5 w-2.5 shrink-0 rounded-full bg-[#30d158] shadow-[0_0_0_3px_rgb(48_209_88/20%)]" />}
      </div>

      {s?.connected && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-[10px] bg-(--os-hover) px-3.5 py-3 text-[12.5px]">
          {s.adapter && (
            <>
              <dt className="text-(--os-text-dim)">Adapter</dt>
              <dd className="truncate text-right">{s.adapter}</dd>
            </>
          )}
          {s.ipv4 && (
            <>
              <dt className="text-(--os-text-dim)">IP address</dt>
              <dd className="text-right tabular-nums">{s.ipv4}</dd>
            </>
          )}
          {s.speedMbps && (
            <>
              <dt className="text-(--os-text-dim)">Link speed</dt>
              <dd className="text-right tabular-nums">{s.speedMbps >= 1000 ? `${s.speedMbps / 1000} Gbps` : `${s.speedMbps} Mbps`}</dd>
            </>
          )}
          {s.signal != null && (
            <>
              <dt className="text-(--os-text-dim)">Signal</dt>
              <dd className="text-right tabular-nums">{s.signal}%</dd>
            </>
          )}
        </dl>
      )}

      <button
        type="button"
        onClick={() => void launchApp('ms-settings:network')}
        className="rounded-[9px] py-2 text-[13px] font-medium hover:bg-(--os-hover) active:bg-[var(--surface-hover)]"
      >
        Network settings…
      </button>
    </div>
  )
}
