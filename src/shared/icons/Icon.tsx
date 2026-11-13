import type { SVGProps } from 'react'

/**
 * The one shared shape every icon in src/shared/icons/index.tsx is drawn
 * against: 20x20 viewBox, 1.5px stroke, round caps/joins, currentColor,
 * no fill (a handful of filled glyphs — play/pause bars, small status
 * dots — override fill/stroke locally and that's a deliberate exception,
 * not a second system).
 *
 * This existed as a bare object literal (`base`) before; it's promoted to
 * its own module so the convention has a name and a single documented
 * home, and so a new icon can spread `ICON_BASE` instead of redefining the
 * numbers by hand. The path data for all ~107 existing icons stays
 * exactly as it was — every path was hand-plotted against this exact
 * 20x20 grid, so re-deriving them against a different viewBox (e.g. the
 * more common 24x24) would mean re-plotting each one by eye with no
 * visual-regression test to catch a mistake. Matching the existing grid
 * is the safe way to get one consistent icon system without corrupting
 * icons that already draw correctly.
 */
export const ICON_BASE = {
  width: 20,
  height: 20,
  viewBox: '0 0 20 20',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

export type IconProps = SVGProps<SVGSVGElement>

/** Thin wrapper for any new icon: `<Icon {...props}><path d="..." /></Icon>`.
 *  Existing icons keep spreading `base` from index.tsx directly — no need
 *  to migrate 107 call sites for a cosmetic rename — but this is the
 *  canonical entry point going forward. */
export function Icon({ children, ...props }: IconProps & { children: React.ReactNode }) {
  return (
    <svg {...ICON_BASE} {...props}>
      {children}
    </svg>
  )
}
