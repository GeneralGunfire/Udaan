import { useId } from 'react'

/**
 * Udaan's brand mark.
 *
 * "Udaan" means flight. The mark is a single bird-form chevron built from
 * three stacked blades that rise to the right — a shape that reads as both
 * a wing in motion and an upward arrow.
 *
 * WHY THIS SHAPE AND NOT THE PREVIOUS TWO-WING DRAWING
 * ----------------------------------------------------
 * The old mark was two mirrored wings with stepped feather tips: around
 * fourteen direction changes per wing. That resolves at 84px on the splash
 * screen and turns to grey mush at 16px in the menu bar, which is where it
 * is seen most. A logo has to be designed for its *smallest* use.
 *
 * This version is built from three straight-edged blades. At 16px they stay
 * three distinct strokes; at 200px the stepped offsets and the gradient
 * across them carry the detail. Everything is on a 24-unit grid with angles
 * locked to 35°, so the blades stay optically parallel.
 *
 * MONOCHROME BY DEFAULT
 * ---------------------
 * It paints with `currentColor`, so it sits correctly on the dock, the menu
 * bar, a light sheet or a dark one without a second asset. The three blades
 * are separated by opacity rather than hue, which survives being rendered
 * in a single flat colour — a mark that needs its gradient to be legible is
 * a mark that breaks the first time someone prints it.
 *
 * `tone="brand"` switches to the gradient treatment for hero placements.
 */

/* Three blades, longest and brightest at the top-right: the eye reads the
   stack as motion in that direction. Each is a parallelogram with a clipped
   inner corner, so they nest without touching. */
const BLADE_TOP = 'M21.6 4.2 13.1 9.1a1.4 1.4 0 0 1-1.4 0L9.2 7.7a.5.5 0 0 1 0-.87l8.5-4.9a1.4 1.4 0 0 1 1.4 0l2.5 1.44a.5.5 0 0 1 0 .87Z'
const BLADE_MID = 'M18.4 10.9 9.9 15.8a1.4 1.4 0 0 1-1.4 0L6 14.4a.5.5 0 0 1 0-.87l8.5-4.9a1.4 1.4 0 0 1 1.4 0l2.5 1.44a.5.5 0 0 1 0 .87Z'
const BLADE_LOW = 'M15.2 17.6 6.7 22.5a1.4 1.4 0 0 1-1.4 0l-2.5-1.44a.5.5 0 0 1 0-.87l8.5-4.9a1.4 1.4 0 0 1 1.4 0l2.5 1.44a.5.5 0 0 1 0 .87Z'

export function UdaanMark({
  size,
  className,
  tone = 'mono',
}: {
  size: number
  className?: string
  /** `brand` adds the gradient and edge light, for splash and hero use. */
  tone?: 'mono' | 'brand'
}) {
  const id = useId().replace(/:/g, '')
  const brand = tone === 'brand'

  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden className={className}>
      <defs>
        {/* Runs along the blades' axis, not vertically: a vertical gradient
            on a 35° shape makes the lower-left corner read as a shadow. */}
        <linearGradient id={`${id}-brand`} x1="0.1" y1="0.9" x2="0.9" y2="0.1">
          <stop offset="0" stopColor="var(--color-accent-alt, #7bb8ff)" />
          <stop offset="1" stopColor="var(--color-accent, #2b7fd4)" />
        </linearGradient>
        <linearGradient id={`${id}-sheen`} x1="0.2" y1="1" x2="0.8" y2="0">
          <stop offset="0" stopColor="#fff" stopOpacity="0" />
          <stop offset="0.55" stopColor="#fff" stopOpacity="0.5" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>

      <g fill={brand ? `url(#${id}-brand)` : 'currentColor'}>
        {/* Opacity, not hue, separates the blades — it survives a flat
            single-colour render, which a hue ramp does not. */}
        <path d={BLADE_LOW} opacity="0.45" />
        <path d={BLADE_MID} opacity="0.72" />
        <path d={BLADE_TOP} />
      </g>

      {brand && (
        <>
          {/* Light travelling across the stack. */}
          <g fill={`url(#${id}-sheen)`}>
            <path d={BLADE_LOW} />
            <path d={BLADE_MID} />
            <path d={BLADE_TOP} />
          </g>
          {/* The leading edge catches the light source directly. */}
          <path d={BLADE_TOP} fill="none" stroke="#fff" strokeOpacity="0.5" strokeWidth="0.4" strokeLinejoin="round" />
        </>
      )}
    </svg>
  )
}

/**
 * The full lockup: mark plus wordmark, for the splash screen and About.
 *
 * The wordmark is set in the app's display face at a weight light enough
 * that it does not compete with the mark, and tracked out slightly — at
 * display sizes, default tracking on a short word looks cramped.
 */
export function UdaanLockup({ size = 48, className }: { size?: number; className?: string }) {
  return (
    <span className={className} style={{ display: 'inline-flex', alignItems: 'center', gap: size * 0.32 }}>
      <UdaanMark size={size} tone="brand" />
      <span
        style={{
          fontSize: size * 0.72,
          fontWeight: 300,
          letterSpacing: size * 0.02,
          lineHeight: 1,
          // Optical centring: the mark's visual mass sits slightly below its
          // bounding box centre, so the word needs a nudge down to match.
          paddingBottom: size * 0.02,
        }}
      >
        Udaan
      </span>
    </span>
  )
}
