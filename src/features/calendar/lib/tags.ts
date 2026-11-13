import type { EventTag } from './types'

/**
 * Tag colours, taken from VS Code's own syntax palette.
 *
 * Two earlier versions of this failed for the same underlying reason —
 * they separated tags by LUMINANCE along a single hue:
 *
 *   1. Three opacities of white (90/60/35%). At the 6px a dot actually
 *      renders, nobody can tell 60% white from 35% white.
 *   2. Three steps of the accent ramp. Worse: `--brand-blue` (#0E639C)
 *      and `--brand-cyan` (#007ACC) sit 1.42:1 apart, which is not a
 *      distinction at all, and both are FILL colours — as chip text on
 *      the #252526 panel they measured 2.39:1 and 3.40:1, well under the
 *      4.5:1 needed to read.
 *
 * These separate by HUE instead, which is the axis that actually works
 * for categorical data. School and Work take VS Code's syntax FOREGROUND
 * blue and teal — colours that theme chose to be read as text on exactly
 * this ground. Personal is neutral grey: it is the catch-all/default
 * category, so the absence of hue is itself the right signal, and it
 * keeps colour meaningful for the two tags that are actual commitments.
 * Measured on the panel surface: 5.19:1, 7.52:1, 5.65:1.
 *
 * The accent blue is deliberately not among them: it means "selected"
 * everywhere else in the app, so a tag wearing it would read as a
 * selection state rather than as a category.
 */
export const TAG_CONFIG: Record<EventTag, { label: string; dot: string; chipBg: string; chipText: string }> = {
  school: {
    label: 'School',
    dot: 'bg-[var(--tag-school)]',
    chipBg: 'bg-[color-mix(in_srgb,var(--tag-school)_18%,transparent)]',
    chipText: 'text-[var(--tag-school)]',
  },
  work: {
    label: 'Work',
    dot: 'bg-[var(--tag-work)]',
    chipBg: 'bg-[color-mix(in_srgb,var(--tag-work)_18%,transparent)]',
    chipText: 'text-[var(--tag-work)]',
  },
  personal: {
    label: 'Personal',
    dot: 'bg-[var(--tag-personal)]',
    chipBg: 'bg-[color-mix(in_srgb,var(--tag-personal)_18%,transparent)]',
    chipText: 'text-[var(--tag-personal)]',
  },
}

export const TAG_ORDER: EventTag[] = ['school', 'work', 'personal']
