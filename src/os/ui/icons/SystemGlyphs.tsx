import { useId } from 'react'
import { UdaanMark } from './UdaanMark'

/** Udaan's mark for the menu bar: the wing, large enough to read on a 34px bar. */
export function StartGlyph({ size }: { size: number }) {
  return <UdaanMark size={Math.round(size * 1.2)} />
}

/**
 * The Start button: the Udaan wing on a graphite glass squircle, built like
 * the app icons (specular highlight, glow at the foot, light-catching edge)
 * so it sits in the dock as one of the family.
 */
export function StartTile({ size }: { size: number }) {
  return (
    <span style={{ display: 'inline-flex', color: 'var(--u-ink)', filter: 'drop-shadow(0 1px 2px rgb(0 0 0 / 0.35))' }}>
      <UdaanMark size={size} />
    </span>
  )
}

export function TrashGlyph({ size, full }: { size: number; full: boolean }) {
  const id = useId().replace(/:/g, '')
  return (
    <svg viewBox="0 0 48 48" width={size} height={size} aria-hidden style={{ filter: 'drop-shadow(0 2px 3px rgb(0 0 0 / 0.3))' }}>
      <defs>
        <linearGradient id={`${id}-bin`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f4f6f8" stopOpacity="0.95" />
          <stop offset="1" stopColor="#c3c8cf" stopOpacity="0.9" />
        </linearGradient>
        <pattern id={`${id}-mesh`} width="3" height="3" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="3" height="3" fill="none" />
          <path d="M0 0v3" stroke="#8d949d" strokeWidth="0.7" />
        </pattern>
      </defs>
      {full && (
        <g>
          <path d="M14 13c2-4 6-6 9-4s6-3 10 0 3 5 1 7H13c-1-1-1-2 1-3Z" fill="#fff" stroke="#b9bec5" strokeWidth="0.6" />
          <path d="M18 11l3 3M27 10l-2 4M31 12l-3 2" stroke="#c8ccd2" strokeWidth="0.7" />
        </g>
      )}
      <path d="M11 16h26l-2.4 25.2a3 3 0 0 1-3 2.8H16.4a3 3 0 0 1-3-2.8Z" fill={`url(#${id}-bin)`} />
      <path d="M11 16h26l-2.4 25.2a3 3 0 0 1-3 2.8H16.4a3 3 0 0 1-3-2.8Z" fill={`url(#${id}-mesh)`} opacity="0.55" />
      <rect x="9.5" y="13.5" width="29" height="4" rx="2" fill="#e9ecef" stroke="#aeb4bb" strokeWidth="0.6" />
    </svg>
  )
}

export function VolumeGlyph({ size }: { size: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 9.5h3.2L11.5 6v12l-4.3-3.5H4Z" fill="currentColor" />
      <path d="M15 9.2a4 4 0 0 1 0 5.6M17.6 6.8a7.4 7.4 0 0 1 0 10.4" />
    </svg>
  )
}

/** Battery that actually shows its level, green while charging, amber when low. */
export function BatteryGlyph({ size, percent, charging }: { size: number; percent: number; charging: boolean }) {
  const level = Math.max(0, Math.min(100, percent))
  const fill = charging ? '#34c759' : level <= 20 ? '#ff9f0a' : 'currentColor'
  return (
    <svg viewBox="0 0 28 16" width={size * 1.4} height={size * 0.8} aria-label={`Battery ${level}%${charging ? ', charging' : ''}`}>
      <rect x="1" y="2" width="23" height="12" rx="3.2" fill="none" stroke="currentColor" strokeOpacity="0.55" strokeWidth="1.3" />
      <rect x="25" y="5.5" width="2" height="5" rx="1" fill="currentColor" opacity="0.55" />
      <rect x="3" y="4" width={(19 * level) / 100} height="8" rx="1.8" fill={fill} />
      {charging && <path d="M13.5 3.5 9.5 9h3l-1 3.5 4-5.5h-3Z" fill="#fff" stroke="#1b1b1b" strokeWidth="0.4" />}
    </svg>
  )
}
