import { useId } from 'react'

/**
 * Udaan's brand mark. "Udaan" means flight: a pair of wings lifting from one
 * point, each with stepped feather tips, the right wing brighter and higher so
 * the mark leans up and forward. Two shapes only, so it holds together at
 * 16px. Monochrome by design: it paints with the surrounding text colour, so
 * it sits correctly on the dock, the menu bar, the splash screen and any theme.
 *
 * Glass comes from translucency (the wings overlap at the root and read
 * brighter there), a white-to-clear sheen across each wing, and a hairline
 * highlight on the leading wing's edge.
 */
const LEFT = 'M12 20.4C10.2 17.4 6.6 15.2 2 14.6c1-1.2 2.6-2 4.6-2.2C5 11.4 3.8 10.2 3 8.6c3.4.2 6 1.4 7.6 3.4C10.8 14.6 11.4 17.4 12 20.4Z'
const RIGHT = 'M12 20.4C13.8 17 17.6 14 22.4 12.8c-.8-1.4-2.2-2.4-4-3 1.8-.6 3.2-1.8 4.2-3.6-3.8.4-7.2 1.8-9 4.6C12.4 13.8 11.8 17 12 20.4Z'

export function UdaanMark({ size, className }: { size: number; className?: string }) {
  const id = useId().replace(/:/g, '')
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden className={className}>
      <defs>
        <linearGradient id={`${id}-sheen`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.6" />
          <stop offset="0.65" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={LEFT} fill="currentColor" opacity="0.62" />
      <path d={LEFT} fill={`url(#${id}-sheen)`} />
      <path d={RIGHT} fill="currentColor" opacity="0.95" />
      <path d={RIGHT} fill={`url(#${id}-sheen)`} />
      <path d={RIGHT} fill="none" stroke="#fff" strokeOpacity="0.4" strokeWidth="0.45" strokeLinejoin="round" />
    </svg>
  )
}
