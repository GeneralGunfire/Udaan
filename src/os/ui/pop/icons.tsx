import type { ReactNode, SVGProps } from 'react'

/** The pop kit's small stroke icons (24 grid). One place, one weight, so every popup and menu matches. */
const P: Record<string, ReactNode> = {
  wifi: (
    <>
      <path d="M2.5 9a14 14 0 0 1 19 0M5.5 12.5a9.5 9.5 0 0 1 13 0M8.8 16a5 5 0 0 1 6.4 0" />
      <circle cx="12" cy="19.2" r="1.1" fill="currentColor" stroke="none" />
    </>
  ),
  lock: <path d="M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3" />,
  volume: (
    <>
      <path d="M4 9.5h3.2L11.5 6v12l-4.3-3.5H4z" fill="currentColor" />
      <path d="M15 9.2a4 4 0 0 1 0 5.6M17.6 6.8a7.4 7.4 0 0 1 0 10.4" />
    </>
  ),
  mute: (
    <>
      <path d="M4 9.5h3.2L11.5 6v12l-4.3-3.5H4z" fill="currentColor" />
      <path d="M16 9.5l5 5M21 9.5l-5 5" />
    </>
  ),
  bell: <path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15ZM10 20.5a2 2 0 0 0 4 0" />,
  moon: <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />,
  calendar: <path d="M4 6.5h16v13H4zM4 10.5h16M8 4v4M16 4v4" />,
  layout: <path d="M3 4.5h18v15H3zM12 4.5v15M3 12h9" />,
  play: <path d="M8 5.5v13l11-6.5z" fill="currentColor" />,
  pause: <path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" fill="currentColor" />,
  next: <path d="M16 5h2v14h-2zM4 5v14l11-7z" fill="currentColor" />,
  prev: <path d="M6 5h2v14H6zM20 5v14L9 12z" fill="currentColor" />,
  chevron: <path d="M9 6l6 6-6 6" />,
  down: <path d="M6 9l6 6 6-6" />,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  x: <path d="M6 6l12 12M18 6L6 18" />,
  plus: <path d="M12 5v14M5 12h14" />,
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </>
  ),
  sliders: <path d="M4 7h10M18 7h2M4 17h2M10 17h10M14 4.5v5M6 14.5v5" />,
  power: <path d="M12 3v8M6.5 6.8a8 8 0 1 0 11 0" />,
  folder: <path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />,
  file: <path d="M7 3h7l5 5v13H7zM14 3v5h5" />,
  trash: <path d="M5 7h14M9 7V4.5h6V7M7 7l1 13h8l1-13" />,
  copy: <path d="M8 8h11v12H8zM5 16V4h11" />,
  cut: <path d="M6 9a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM6 20a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM20 4L8 16M20 20L8 8" />,
  paste: <path d="M9 5H6v16h12V5h-3M9 3h6v4H9z" />,
  pin: <path d="M9 4h6l-1 6 3 3H7l3-3zM12 13v7" />,
  external: <path d="M14 4h6v6M20 4l-9 9M18 14v5H5V6h5" />,
  user: <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4.5 20a7.5 7.5 0 0 1 15 0" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v4.5l3 1.5" />
    </>
  ),
  image: <path d="M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4" />,
  pencil: <path d="M4 20l1-4L16.5 4.5l3 3L8 19zM14.5 6.5l3 3" />,
  refresh: <path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7" />,
  mail: <path d="M3.5 6h17v12h-17zM3.5 7l8.5 6.5L20.5 7" />,
  message: <path d="M4 5h16v11H9l-5 4z" />,
  download: <path d="M12 4v11M7.5 11L12 15.5 16.5 11M5 20h14" />,
  monitor: <path d="M3 5h18v11H3zM8 20h8M12 16v4" />,
  eye: (
    <>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="2.6" />
    </>
  ),
  sort: <path d="M7 5v14M4 16l3 3 3-3M17 19V5M14 8l3-3 3 3" />,
  terminal: <path d="M4 5h16v14H4zM7.5 10l3 2.5-3 2.5M13 15h4" />,
  shield: <path d="M12 3l7 3v5.5c0 4.5-3 8-7 9.5-4-1.5-7-5-7-9.5V6z" />,
  camera: <path d="M4 8h3l1.5-2h7L17 8h3v11H4zM12 16.5a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4z" />,
  info: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5M12 8h.01" />
    </>
  ),
  alert: <path d="M12 4l9 16H3zM12 10v4.5M12 17.5h.01" />,
  window: <path d="M3 5h18v14H3zM3 9h18" />,
  minimize: <path d="M5 12h14" />,
  maximize: <path d="M5 5h14v14H5z" />,
  restore: <path d="M8 8h11v11H8zM5 16V5h11" />,
  home: <path d="M4 11l8-6.5 8 6.5v9H4zM10 20v-6h4v6" />,
  star: <path d="M12 4l2.5 5.2 5.7.8-4.1 4 1 5.7L12 17l-5.1 2.7 1-5.7-4.1-4 5.7-.8z" />,
}

export type PopIconName = keyof typeof P

export function PopIcon({ name, size = 18, strokeWidth = 1.7, ...rest }: { name: PopIconName; size?: number; strokeWidth?: number } & Omit<SVGProps<SVGSVGElement>, 'name'>) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden {...rest}>
      {P[name]}
    </svg>
  )
}

/** Signal strength as four rising bars (0 to 4 lit). */
export function SignalBars({ level, size = 16 }: { level: number; size?: number }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden>
      {[0, 1, 2, 3].map((i) => (
        <rect key={i} x={1 + i * 4} y={12 - (i + 1) * 3} width="2.6" height={(i + 1) * 3 + 1} rx="0.8" fill="currentColor" opacity={i < level ? 1 : 0.28} />
      ))}
    </svg>
  )
}
