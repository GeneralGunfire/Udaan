
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

export function UdaanMark({
  size,
  className,
}: {
  size: number
  className?: string
  /** Kept for existing callers: the mark is always the real full-colour logo now. */
  tone?: 'mono' | 'brand'
}) {
  return <img src="/logo/udaan-128.png" alt="" aria-hidden draggable={false} width={size} height={size} className={className} style={{ width: size, height: size, objectFit: 'contain' }} />
}
