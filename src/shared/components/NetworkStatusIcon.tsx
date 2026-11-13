import { GlobeIcon, WifiOffIcon } from '@/shared/icons'
import { wifiBars } from '@/shared/hooks/useSystemStatus'
import type { WifiDetails } from '@/integrations/quick-settings/client'

interface NetworkStatusIconProps {
  wifi: WifiDetails | null
  online: boolean
  width?: number
  height?: number
  className?: string
}

/**
 * Network glyph that reflects the *actual* connection state.
 *
 * The shared `WifiIcon` bakes fixed opacities into its three arcs, so it
 * draws an identical icon at 5% signal and at 100% — which makes it
 * decorative rather than informative. This renders the arcs from measured
 * signal quality instead: an arc above the current strength is dimmed to
 * the same faint value used for a control's disabled state, so the glyph
 * reads as bars at a glance the way every OS taskbar does.
 *
 * Three distinct states, because they are three distinct problems:
 *  - No adapter, or radio off → a struck-through Wi-Fi glyph.
 *  - Wired (adapter present, not associated, but online) → a globe. A
 *    Wi-Fi icon on an Ethernet-only machine is simply wrong.
 *  - Associated → bars, dimmed overall when there is no internet route,
 *    which distinguishes "connected to a router that has no upstream"
 *    from "connected and working" — the single most common real-world
 *    confusion a network icon can resolve.
 */
export function NetworkStatusIcon({
  wifi,
  online,
  width = 20,
  height = 20,
  className,
}: NetworkStatusIconProps) {
  const hasWifiAdapter = Boolean(wifi?.hasAdapter)
  const radioOff = hasWifiAdapter && !wifi?.radioOn

  if (radioOff || (!hasWifiAdapter && !online)) {
    return <WifiOffIcon width={width} height={height} className={className} />
  }

  // Adapter present but not associated, yet still online: Ethernet.
  if (!wifi?.connected) {
    return <GlobeIcon width={width} height={height} className={className} />
  }

  const bars = wifiBars(wifi)
  // A connected network with no route still draws its real bars, but the
  // whole glyph is dimmed — the signal is genuinely fine, the internet is
  // not, and flattening both into one icon hides which is broken.
  const baseOpacity = online ? 1 : 0.45
  const arc = (index: number) => (bars >= index ? baseOpacity : baseOpacity * 0.22)

  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M4 8a8.5 8.5 0 0112 0" opacity={arc(4)} />
      <path d="M6.5 10.8a5 5 0 017 0" opacity={arc(3)} />
      <path d="M9 13.5a2 2 0 012 0" opacity={arc(2)} />
      <circle cx="10" cy="15.5" r="1" fill="currentColor" stroke="none" opacity={arc(1)} />
    </svg>
  )
}
