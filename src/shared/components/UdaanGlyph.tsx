import { motion } from 'framer-motion'
import { spring, duration, ease, prefersReducedMotion } from '@/shared/lib/motion'

interface UdaanGlyphProps {
  size?: number
  className?: string
  /** Plays the staggered facet entrance once on mount (each panel
   *  un-folding into place). Safe to combine with an external wrapper
   *  animation, since it only touches opacity/scale on the individual
   *  facets, not the outer `transform` a parent might also be driving. */
  entrance?: boolean
  /** Continuous idle bank+bob loop (a slow rotate/translateY, like a
   *  paper plane holding altitude) — on for hero contexts where the
   *  glyph is the only thing animating (splash screen at rest); off for
   *  small inline contexts (taskbar button, titlebar) where a
   *  constantly-moving icon next to static UI reads as distracting, and
   *  MUST stay off wherever a parent already animates this element's own
   *  `transform` (e.g. SplashScreen's CSS bank/climb keyframes) — both
   *  would otherwise fight for the same property. Hover/press motion
   *  always applies regardless of this flag. */
  idle?: boolean
}

const FACET_ENTER = {
  hidden: { opacity: 0, scale: 0.7 },
  show: { opacity: 1, scale: 1 },
}

/**
 * The app's glyph — a folded paper plane banking into a climb, replacing
 * the old four-petal blue/cyan gradient mark (src/assets/udaan-mark.png).
 * "Udaan" is Hindi for "flight/takeoff."
 *
 * Built from 5 independent facets (nose spine, underbody wing, top wing,
 * tail crease, cabin sliver near the nose) rather than a flat silhouette —
 * matching the app icon (src-tauri/icon-source.svg, same geometry) but as
 * separately-animatable layers here. Each facet gets its own opacity step
 * so the fold reads as a real physical object with a light source, the
 * same "raised, not painted" principle the Button variants use (lit top
 * edge, shaded facing planes, tonal separation) — flat single-tone facets
 * were tried first and read as an abstract triangle pair, not a plane.
 *
 * Motion is designed into the shape, not bolted on after: `entrance` runs
 * a staggered facet un-fold once on mount, `idle` is a continuous slow
 * bank+bob loop, and hover always adds a small climb (a lift plus a few
 * degrees of roll) with tap settling it back down — all on this app's own
 * spring/ease vocabulary (shared/lib/motion.ts). The two flags are
 * separate (not one combined "animated" toggle) because a composed
 * context like the splash screen wants the entrance but drives its own
 * settle/idle motion externally via CSS — running both this component's
 * `idle` loop and a parent's own transform animation at once would fight
 * over the same property instead of composing.
 */
export function UdaanGlyph({ size = 24, className, entrance = false, idle = false }: UdaanGlyphProps) {
  const reduced = prefersReducedMotion()
  const playIdle = idle && !reduced
  const playEntrance = entrance && !reduced

  return (
    <motion.svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      className={className}
      aria-hidden="true"
      initial={false}
      animate={
        playIdle
          ? {
              y: [0, -1.4, 0],
              rotate: [-2, 2, -2],
              transition: { duration: 3.6, repeat: Infinity, ease: 'easeInOut' },
            }
          : undefined
      }
      whileHover={reduced ? undefined : { scale: 1.08, y: -1.5, rotate: 4 }}
      whileTap={reduced ? undefined : { scale: 0.96, y: 0, rotate: 0 }}
      transition={spring.micro}
    >
      <motion.g
        variants={entrance ? { hidden: {}, show: { transition: { staggerChildren: 0.05 } } } : undefined}
        initial={playEntrance ? 'hidden' : 'show'}
        animate="show"
      >
        {/* Top wing — the shadowed topside, darkest. */}
        <motion.path
          variants={FACET_ENTER}
          transition={{ duration: duration.relaxed, ease: ease.out }}
          d="M11.5 15L29 15L20.5 11.5L11.5 15Z"
          fill="currentColor"
          opacity={0.32}
        />
        {/* Tail crease — the hinge where the underbody folds up into the
            tail. */}
        <motion.path
          variants={FACET_ENTER}
          transition={{ duration: duration.relaxed, ease: ease.out }}
          d="M11.5 15L19.5 20L29 15L11.5 15Z"
          fill="currentColor"
          opacity={0.5}
        />
        {/* Underbody wing — the larger lower panel, mid-tone. */}
        <motion.path
          variants={FACET_ENTER}
          transition={{ duration: duration.relaxed, ease: ease.out }}
          d="M11.5 15L4 26.5L19.5 20L11.5 15Z"
          fill="currentColor"
          opacity={0.62}
        />
        {/* Cabin sliver — a small bright accent at the fold near the
            nose, the one high-contrast detail that keeps the mark from
            reading as flat grey shapes at a glance. */}
        <motion.path
          variants={FACET_ENTER}
          transition={{ duration: duration.relaxed, ease: ease.out }}
          d="M11.5 15L4 3.5L7.5 12L11.5 15Z"
          fill="currentColor"
          opacity={0.85}
        />
        {/* Nose spine — the sharp forward edge, drawn last so it overlaps
            every wing panel at the fold, full opacity as the brightest,
            most forward-lit facet. */}
        <motion.path
          variants={FACET_ENTER}
          transition={{ duration: duration.relaxed, ease: ease.out }}
          d="M29 15L4 3.5L11.5 15L4 26.5L29 15Z"
          fill="currentColor"
        />
      </motion.g>
    </motion.svg>
  )
}
