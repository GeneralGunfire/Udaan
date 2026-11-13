import type { SVGProps } from 'react'

/**
 * The Settings pane icons: one consistent stroke family on a 24px grid
 * (1.8 stroke, round caps and joins, one filled accent shape per icon),
 * drawn to sit inside a glass tile rather than borrowed from the app-wide set.
 */
function Glyph(props: SVGProps<SVGSVGElement>) {
  const { children, ...rest } = props
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden {...rest}>
      {children}
    </svg>
  )
}

export const AppearanceGlyph = (p: SVGProps<SVGSVGElement>) => (
  <Glyph {...p}>
    <circle cx="12" cy="12" r="8.2" />
    <path d="M12 3.8a8.2 8.2 0 0 1 0 16.4Z" fill="currentColor" stroke="none" />
  </Glyph>
)

export const DockGlyph = (p: SVGProps<SVGSVGElement>) => (
  <Glyph {...p}>
    <rect x="3" y="4" width="18" height="16" rx="3.5" />
    <rect x="6.6" y="14.2" width="10.8" height="3.4" rx="1.7" fill="currentColor" stroke="none" />
  </Glyph>
)

export const WidgetsGlyph = (p: SVGProps<SVGSVGElement>) => (
  <Glyph {...p}>
    <rect x="3.8" y="3.8" width="7" height="7" rx="2" fill="currentColor" stroke="none" />
    <rect x="13.2" y="3.8" width="7" height="7" rx="2" />
    <rect x="3.8" y="13.2" width="7" height="7" rx="2" />
    <rect x="13.2" y="13.2" width="7" height="7" rx="2" />
  </Glyph>
)

export const QuickstartsGlyph = (p: SVGProps<SVGSVGElement>) => (
  <Glyph {...p}>
    <path d="M13.2 2.8 5.2 13.4h5.9l-1 7.8 8-10.8h-5.9Z" fill="currentColor" />
  </Glyph>
)

export const NotificationsGlyph = (p: SVGProps<SVGSVGElement>) => (
  <Glyph {...p}>
    <path d="M6 16.2V11a6 6 0 0 1 12 0v5.2l1.6 2.2H4.4Z" />
    <path d="M10 20.8a2 2 0 0 0 4 0" />
  </Glyph>
)

export const SoundGlyph = (p: SVGProps<SVGSVGElement>) => (
  <Glyph {...p}>
    <path d="M4 9.6h3.4L12 5.6v12.8l-4.6-4H4Z" fill="currentColor" />
    <path d="M15.6 9.2a4 4 0 0 1 0 5.6" />
    <path d="M18.2 6.6a7.6 7.6 0 0 1 0 10.8" />
  </Glyph>
)

export const KeyboardGlyph = (p: SVGProps<SVGSVGElement>) => (
  <Glyph {...p}>
    <rect x="2.6" y="6" width="18.8" height="12" rx="3" />
    <path d="M6.6 10.2h.01M10.2 10.2h.01M13.8 10.2h.01M17.4 10.2h.01" strokeWidth="2.4" />
    <path d="M8 14.2h8" />
  </Glyph>
)

export const WindowsGlyph = (p: SVGProps<SVGSVGElement>) => (
  <Glyph {...p}>
    <rect x="3" y="4.6" width="18" height="14.8" rx="3" />
    <path d="M3 9.4h18" />
    <path d="M6.4 7h.01M9 7h.01" strokeWidth="2.2" />
  </Glyph>
)

export const GeneralGlyph = (p: SVGProps<SVGSVGElement>) => (
  <Glyph {...p}>
    <circle cx="12" cy="12" r="3.4" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="6.6" />
    <path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M18.5 5.5l-1.7 1.7M7.2 16.8l-1.7 1.7" />
  </Glyph>
)
