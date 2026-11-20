import { useId, type ReactNode } from 'react'
import type { AppId } from '@/os/kernel/registry'

/**
 * Udaan's app icon set, rebuilt on the macOS 26 "Liquid Glass" model.
 *
 * WHAT MAKES THESE READ AS REAL APP ICONS
 * ---------------------------------------
 * A convincing icon is not a glyph on a coloured square. It is a glyph
 * *embedded in a piece of glass*, and glass does four things the old flat
 * plates did not:
 *
 *   1. REFRACTION. Light bends at the rim, so the edge is brighter than the
 *      face and the very bottom catches a warm bounce from the surface the
 *      icon sits on. Drawn as an inner rim stroke, not an outer border.
 *   2. DEPTH. The glyph floats *inside* the plate, above its floor. It casts
 *      a short contact shadow onto that floor. This is the single biggest
 *      difference between "flat" and "premium" — a glyph with no shadow is
 *      painted on; a glyph with one is held.
 *   3. SPECULARITY. One light source, upper-left, giving a tight highlight
 *      near the top-left rim and a broad soft wash across the upper face.
 *   4. AMBIENT OCCLUSION. Where the glyph meets the floor, the floor darkens
 *      slightly. Without it the glyph looks like a sticker.
 *
 * Every icon is drawn on a 100×100 grid inside a continuous-curvature
 * squircle (the macOS/iOS shape; a CSS border-radius gives visibly "pinched"
 * corners by comparison). The glyph lives in a 64×64 safe area centred on
 * the plate, so no icon's shape collides with the rim.
 */

/** Exact superellipse |x|^n + |y|^n = 1 on a 100×100 box, sampled finely enough to read as smooth. */
function superellipse(n = 5, steps = 180): string {
  const pts: string[] = []
  for (let i = 0; i < steps; i++) {
    const t = (i / steps) * Math.PI * 2
    const c = Math.cos(t)
    const s = Math.sin(t)
    const x = 50 + 50 * Math.sign(c) * Math.abs(c) ** (2 / n)
    const y = 50 + 50 * Math.sign(s) * Math.abs(s) ** (2 / n)
    pts.push(`${x.toFixed(2)} ${y.toFixed(2)}`)
  }
  return `M${pts.join('L')}Z`
}

export const SQUIRCLE = superellipse()
/** The same shape inset by 1.5 units, for the inner refraction rim. */
const SQUIRCLE_INNER = superellipse(5, 180)

interface Ctx {
  id: (name: string) => string
}

type Drawing = (c: Ctx) => ReactNode

/**
 * The glass plate every icon sits in.
 *
 * `from`/`to` are the plate's own colour, top to bottom. `tint` optionally
 * warms or cools the refracted bottom rim — glass picks up the colour of
 * what it is made of, so a red icon's rim bounces red, not white.
 */
function Plate({
  c,
  from,
  to,
  rim,
  children,
}: {
  c: Ctx
  from: string
  to: string
  /** Colour of the refracted light at the bottom rim. Defaults to white. */
  rim?: string
  children?: ReactNode
}) {
  return (
    <>
      <defs>
        {/* The plate body. Angled very slightly off-vertical: a perfectly
            vertical gradient reads as a web button, a 10° tilt reads as a
            real surface lit from the upper left. */}
        <linearGradient id={c.id('plate')} x1="0.1" y1="0" x2="0.9" y2="1">
          <stop offset="0" stopColor={from} />
          <stop offset="1" stopColor={to} />
        </linearGradient>

        <clipPath id={c.id('clip')}>
          <path d={SQUIRCLE} />
        </clipPath>

        {/* Broad specular wash across the upper face. */}
        <linearGradient id={c.id('spec')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.44" />
          <stop offset="0.55" stopColor="#fff" stopOpacity="0.06" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>

        {/* Refracted bounce at the foot of the plate, in the plate's own hue. */}
        <linearGradient id={c.id('bounce')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={rim ?? '#fff'} stopOpacity="0" />
          <stop offset="1" stopColor={rim ?? '#fff'} stopOpacity="0.22" />
        </linearGradient>

        {/* The rim itself: bright where light enters (top-left), dark where
            it leaves (bottom-right). This is what gives the plate an edge
            you can almost feel. */}
        <linearGradient id={c.id('rim')} x1="0.15" y1="0" x2="0.85" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.78" />
          <stop offset="0.38" stopColor="#fff" stopOpacity="0.14" />
          <stop offset="0.72" stopColor="#000" stopOpacity="0.1" />
          <stop offset="1" stopColor="#000" stopOpacity="0.34" />
        </linearGradient>

        {/* Ambient occlusion under the glyph: a soft dark pool on the floor. */}
        <radialGradient id={c.id('ao')} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#000" stopOpacity="0.2" />
          <stop offset="1" stopColor="#000" stopOpacity="0" />
        </radialGradient>
      </defs>

      <path d={SQUIRCLE} fill={`url(#${c.id('plate')})`} />

      <g clipPath={`url(#${c.id('clip')})`}>
        {/* Specular wash — an ellipse rising off the top edge so its falloff
            is smooth rather than a visible band. */}
        <ellipse cx="42" cy="-14" rx="74" ry="56" fill={`url(#${c.id('spec')})`} />
        {/* Tight catch-light near the top-left rim, where the source is. */}
        <ellipse cx="30" cy="8" rx="30" ry="12" fill="#fff" opacity="0.16" />
        {/* Refracted bounce along the foot. */}
        <rect x="0" y="58" width="100" height="42" fill={`url(#${c.id('bounce')})`} />
        {/* Occlusion pool, then the glyph above it. */}
        <ellipse cx="50" cy="58" rx="34" ry="24" fill={`url(#${c.id('ao')})`} />
        {children}
      </g>

      {/* Inner rim, inset so it sits just inside the silhouette — an outer
          stroke would fatten the shape and break the grid alignment. */}
      <g clipPath={`url(#${c.id('clip')})`}>
        <path d={SQUIRCLE_INNER} fill="none" stroke={`url(#${c.id('rim')})`} strokeWidth="2.6" />
      </g>
    </>
  )
}

/** Contact shadow for a glyph floating above the plate floor. */
const lift = 'drop-shadow(0 2px 2.5px rgb(0 0 0 / 0.28))'
/** A heavier lift for large solid glyphs that would otherwise look pasted on. */
const liftHeavy = 'drop-shadow(0 3px 4px rgb(0 0 0 / 0.34))'

const DRAWINGS: Record<AppId, Drawing> = {
  'file-explorer': (c) => (
    <Plate c={c} from="#5cbcff" to="#0a6ad8" rim="#8fd4ff">
      <defs>
        <linearGradient id={c.id('front')} x1="0.2" y1="0" x2="0.8" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#cfe4ff" />
        </linearGradient>
        <linearGradient id={c.id('back')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#d6ebff" />
          <stop offset="1" stopColor="#9ccbff" />
        </linearGradient>
      </defs>
      <g style={{ filter: liftHeavy }}>
        {/* Back leaf, tilted — a folder that is open, not a flat tab shape. */}
        <path d="M19 33a6 6 0 0 1 6-6h15.2a6 6 0 0 1 4.7 2.3l3.4 4.3H75a6 6 0 0 1 6 6v28a6 6 0 0 1-6 6H25a6 6 0 0 1-6-6Z" fill={`url(#${c.id('back')})`} />
        {/* Front leaf, offset down so the back one shows above it. */}
        <path d="M19 44a6 6 0 0 1 6-6h50a6 6 0 0 1 6 6v24a6 6 0 0 1-6 6H25a6 6 0 0 1-6-6Z" fill={`url(#${c.id('front')})`} />
        {/* The lip where the two leaves meet catches light. */}
        <path d="M19 44a6 6 0 0 1 6-6h50a6 6 0 0 1 6 6" fill="none" stroke="#fff" strokeWidth="1.4" strokeOpacity="0.9" />
      </g>
    </Plate>
  ),

  chat: (c) => (
    <Plate c={c} from="#5ee07f" to="#07933f" rim="#9cf0b5">
      <g style={{ filter: liftHeavy }}>
        <path
          d="M50 24c-17.3 0-31.4 11-31.4 24.6 0 7.1 3.9 13.5 10 18-.6 4-2.6 7.4-5.7 10 6.3.3 11.8-1.7 15.7-4.7a36.6 36.6 0 0 0 11.4 1.8c17.3 0 31.4-11 31.4-24.6S67.3 24 50 24Z"
          fill="#fff"
        />
        {/* Three dots: says "conversation" at 16px where a bare bubble says nothing. */}
        <g fill="#15a24f">
          <circle cx="38" cy="48" r="4" />
          <circle cx="50" cy="48" r="4" />
          <circle cx="62" cy="48" r="4" />
        </g>
      </g>
    </Plate>
  ),

  calendar: (c) => {
    const now = new Date()
    return (
      <Plate c={c} from="#ffffff" to="#e4e6ea" rim="#ffffff">
        {/* A torn-off day sheet: red header band, big numeral, like the real
            Calendar icon. The band is clipped by the plate so it runs rim
            to rim. */}
        <defs>
          <linearGradient id={c.id('band')} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#ff6054" />
            <stop offset="1" stopColor="#e8352a" />
          </linearGradient>
        </defs>
        <rect x="0" y="0" width="100" height="27" fill={`url(#${c.id('band')})`} />
        <text
          x="50"
          y="20"
          textAnchor="middle"
          fontSize="14"
          fontWeight="700"
          fill="#fff"
          fontFamily="SF Pro Display, Segoe UI Variable, Segoe UI, system-ui, sans-serif"
          letterSpacing="1.5"
        >
          {now.toLocaleDateString(undefined, { weekday: 'short' }).toUpperCase()}
        </text>
        <text
          x="50"
          y="78"
          textAnchor="middle"
          fontSize="52"
          fontWeight="300"
          fill="#1d1d1f"
          fontFamily="SF Pro Display, Segoe UI Variable, Segoe UI, system-ui, sans-serif"
          letterSpacing="-2.5"
        >
          {now.getDate()}
        </text>
      </Plate>
    )
  },


  'private-player': (c) => (
    <Plate c={c} from="#ff6b80" to="#d4003c" rim="#ffb3c0">
      <g style={{ filter: liftHeavy }} fill="#fff">
        <path d="M69 20.4v38.2a9.6 9.6 0 1 1-5.2-8.5V33l-25.6 5.6v28.8a9.6 9.6 0 1 1-5.2-8.5V27.3a3.1 3.1 0 0 1 2.5-3l29.8-6.5a3.1 3.1 0 0 1 3.7 3Z" />
      </g>
    </Plate>
  ),

  notes: (c) => (
    <Plate c={c} from="#fffdf6" to="#f0ece0" rim="#ffffff">
      <defs>
        <linearGradient id={c.id('band')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffdf5e" />
          <stop offset="1" stopColor="#f9bf00" />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="100" height="26" fill={`url(#${c.id('band')})`} />
      {/* The torn edge under the band — a straight line reads as a header
          bar, a perforation reads as a notepad. */}
      <g fill="#fff" opacity="0.85">
        {Array.from({ length: 13 }, (_, i) => (
          <circle key={i} cx={4 + i * 8} cy="26" r="2.2" />
        ))}
      </g>
      <g stroke="#d4cfc0" strokeWidth="2" strokeLinecap="round">
        <line x1="17" y1="46" x2="83" y2="46" />
        <line x1="17" y1="60" x2="83" y2="60" />
        <line x1="17" y1="74" x2="66" y2="74" />
      </g>
    </Plate>
  ),

  studio: (c) => (
    <Plate c={c} from="#3a3a42" to="#0e0e11" rim="#ff9a4d">
      <defs>
        <linearGradient id={c.id('bars')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffd08a" />
          <stop offset="0.5" stopColor="#ff9a3d" />
          <stop offset="1" stopColor="#ff5e1f" />
        </linearGradient>
      </defs>
      {/* A waveform, mirrored about the centre line as a real one is, rather
          than a bar chart sitting on a baseline. */}
      <g fill={`url(#${c.id('bars')})`} style={{ filter: lift }}>
        {[14, 26, 40, 30, 48, 34, 44, 22, 32].map((h, i) => (
          <rect key={i} x={15 + i * 8} y={50 - h / 2} width="4.6" height={h} rx="2.3" />
        ))}
      </g>
      {/* Glow under the waveform: the one place a soft light reads as a
          screen rather than a sticker. */}
      <ellipse cx="50" cy="50" rx="36" ry="12" fill="#ff7a2f" opacity="0.18" />
    </Plate>
  ),

  'omni-find': (c) => (
    <Plate c={c} from="#2c5bb8" to="#0c1735" rim="#8db0ff">
      <defs>
        <linearGradient id={c.id('lens')} x1="0.2" y1="0" x2="0.8" y2="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.34" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0.08" />
        </linearGradient>
      </defs>
      <g style={{ filter: liftHeavy }}>
        {/* The lens: a glass disc with a thin, even rim. */}
        <circle cx="44" cy="43" r="20" fill={`url(#${c.id('lens')})`} />
        <circle cx="44" cy="43" r="20" fill="none" stroke="#fff" strokeWidth="6" />
        {/* The handle, tapering into the rim. */}
        <path d="M59 58 77 76" stroke="#fff" strokeWidth="9" strokeLinecap="round" />
        {/* One clean four-point spark: this finds and reads, not just looks. */}
        <path d="M44 31.5c.9 6.4 3.1 8.6 9.5 9.5-6.4.9-8.6 3.1-9.5 9.5-.9-6.4-3.1-8.6-9.5-9.5 6.4-.9 8.6-3.1 9.5-9.5Z" fill="#cfe0ff" />
      </g>
    </Plate>
  ),

  'news-brief': (c) => (
    <Plate c={c} from="#ff6170" to="#c8102e" rim="#ffb0b8">
      <g style={{ filter: liftHeavy }}>
        {/* A sheet with a curled page behind it: says "paper", not "card". */}
        <path d="M24 24h48a5 5 0 0 1 5 5v42a5 5 0 0 1-5 5H24a5 5 0 0 1-5-5V29a5 5 0 0 1 5-5Z" fill="#f2f2f5" />
        <path d="M26 21h48a5 5 0 0 1 5 5v42a5 5 0 0 1-5 5H26a5 5 0 0 1-5-5V26a5 5 0 0 1 5-5Z" fill="#fff" />
        <rect x="28" y="29" width="39" height="7" rx="2" fill="#1d1d1f" />
        <rect x="28" y="42" width="17" height="16" rx="2" fill="#ffd2d7" />
        <g fill="#c4c4c9">
          <rect x="50" y="42" width="17" height="3.6" rx="1.8" />
          <rect x="50" y="48.5" width="17" height="3.6" rx="1.8" />
          <rect x="50" y="55" width="12" height="3.6" rx="1.8" />
          <rect x="28" y="63" width="39" height="3.6" rx="1.8" />
        </g>
      </g>
    </Plate>
  ),



  'cnc-mod-switcher': (c) => (
    <Plate c={c} from="#9aa3ae" to="#3f464f" rim="#d4dae1">
      <defs>
        <radialGradient id={c.id('disc')} cx="0.33" cy="0.28" r="0.85">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.45" stopColor="#dde3ea" />
          <stop offset="1" stopColor="#8e97a2" />
        </radialGradient>
      </defs>
      <g style={{ filter: liftHeavy }}>
        <circle cx="50" cy="50" r="29" fill={`url(#${c.id('disc')})`} />
        {/* Swap arrows on the disc — this is a *switcher*, and without them
            it is just a grey circle. */}
        <g fill="none" stroke="#5a626c" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M37 44h22l-5-5" />
          <path d="M63 57H41l5 5" />
        </g>
      </g>
    </Plate>
  ),


  clipboard: (c) => (
    <Plate c={c} from="#4b5b73" to="#1a2230" rim="#9db1cf">
      <defs>
        <linearGradient id={c.id('sheet')} x1="0.2" y1="0" x2="0.8" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#dde3ec" />
        </linearGradient>
        <linearGradient id={c.id('steel')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#d3dae6" />
          <stop offset="1" stopColor="#8e9bb0" />
        </linearGradient>
      </defs>
      <g style={{ filter: liftHeavy }}>
        {/* The sheet on its board. */}
        <rect x="27" y="23" width="46" height="58" rx="7" fill={`url(#${c.id('sheet')})`} />
        {/* A steel clip, a separate piece standing proud of the sheet. */}
        <rect x="38" y="15" width="24" height="14" rx="4.5" fill={`url(#${c.id('steel')})`} />
        <rect x="44.5" y="19.5" width="11" height="4.5" rx="2.25" fill="#5a677d" />
        {/* History: the newest copy leads, in the accent. */}
        <circle cx="36" cy="43" r="2.7" fill="#3072f0" />
        <circle cx="36" cy="54" r="2.7" fill="#9aa6ba" />
        <circle cx="36" cy="65" r="2.7" fill="#9aa6ba" />
        <g strokeLinecap="round" strokeWidth="4.2">
          <path d="M44 43h20" stroke="#3072f0" />
          <path d="M44 54h20M44 65h12" stroke="#b4bece" />
        </g>
      </g>
    </Plate>
  ),

  photos: (c) => (
    <Plate c={c} from="#ffd166" to="#f07800" rim="#ffe3a8">
      <g style={{ filter: liftHeavy }}>
        {/* Two stacked prints: a single frame reads as "image", a stack reads
            as "a library of them". */}
        <rect x="26" y="28" width="52" height="44" rx="7" fill="#ffe9c4" transform="rotate(-6 52 50)" />
        <rect x="23" y="27" width="54" height="46" rx="7" fill="#fff" />
        <circle cx="38" cy="42" r="6.5" fill="#ffc24d" />
        <path d="M28 66l15-17 11 12 8-7 9 12z" fill="#f4972b" />
        <rect x="23" y="27" width="54" height="46" rx="7" fill="none" stroke="#fff" strokeWidth="1.6" strokeOpacity="0.7" />
      </g>
    </Plate>
  ),

  anvil: (c) => (
    <Plate c={c} from="#6e8fff" to="#233a9e" rim="#a6bbff">
      <g style={{ filter: liftHeavy }} fill="none" stroke="#fff" strokeLinecap="round" strokeLinejoin="round">
        {/* One confident letter A built from two strokes: precise, calm, no ornament. */}
        <path d="M30 71L50 29L70 71" strokeWidth="8.5" />
        <path d="M39.500 58H60.500" strokeWidth="7" />
      </g>
    </Plate>
  ),
  storage: (c) => (
    <Plate c={c} from="#566478" to="#1c2430" rim="#a5b5cb">
      <defs>
        <linearGradient id={c.id('unit')} x1="0.2" y1="0" x2="0.8" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#d5dce8" />
        </linearGradient>
      </defs>
      <g style={{ filter: liftHeavy }}>
        {/* How full: a ring, read at a glance. */}
        <circle cx="50" cy="35" r="14" fill="none" stroke="#fff" strokeOpacity="0.28" strokeWidth="6.5" />
        <circle cx="50" cy="35" r="14" fill="none" stroke="#6ea4ff" strokeWidth="6.5" strokeLinecap="round" pathLength="1" strokeDasharray="0.64 0.36" transform="rotate(-90 50 35)" />
        {/* The drive: a flat unit with vents and an activity light. */}
        <rect x="23" y="58" width="54" height="21" rx="6.5" fill={`url(#${c.id('unit')})`} />
        <g stroke="#9aa7bb" strokeWidth="2.6" strokeLinecap="round">
          <path d="M31 65.5h14M31 71.5h14" />
        </g>
        <circle cx="68" cy="68.5" r="3" fill="#3072f0" />
      </g>
    </Plate>
  ),

  calculator: (c) => (
    <Plate c={c} from="#5a606b" to="#1c1f25" rim="#a9b2c2">
      <defs>
        <linearGradient id={c.id('screen')} x1="0.2" y1="0" x2="0.8" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#d7dde7" />
        </linearGradient>
      </defs>
      <g style={{ filter: liftHeavy }}>
        {/* The read-out, then a 3 by 3 keypad with the equals key in the accent. */}
        <rect x="24" y="20" width="52" height="17" rx="5" fill={`url(#${c.id('screen')})`} />
        <path d="M58 28.5h11" stroke="#2b303b" strokeWidth="3.6" strokeLinecap="round" />
        <g fill="#e3e8f0">
          <rect x="24" y="43" width="14" height="11" rx="3.5" />
          <rect x="43" y="43" width="14" height="11" rx="3.5" />
          <rect x="24" y="59" width="14" height="11" rx="3.5" />
          <rect x="43" y="59" width="14" height="11" rx="3.5" />
          <rect x="24" y="75" width="33" height="7" rx="3.5" />
        </g>
        <rect x="62" y="43" width="14" height="27" rx="3.5" fill="#f2a33a" />
        <rect x="62" y="75" width="14" height="7" rx="3.5" fill="#3072f0" />
      </g>
    </Plate>
  ),

  clock: (c) => (
    <Plate c={c} from="#4a505c" to="#15181d" rim="#9aa4b8">
      <defs>
        <radialGradient id={c.id('face')} cx="0.38" cy="0.3" r="0.8">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#d9dfe8" />
        </radialGradient>
      </defs>
      <g style={{ filter: liftHeavy }}>
        <circle cx="50" cy="50" r="30" fill={`url(#${c.id('face')})`} />
        <g stroke="#9aa4b4" strokeWidth="2.4" strokeLinecap="round">
          <path d="M50 24v4M50 72v4M24 50h4M72 50h4" />
        </g>
        <g stroke="#2b303b" strokeLinecap="round">
          <path d="M50 50V35" strokeWidth="4.2" />
          <path d="M50 50l11 7" strokeWidth="3.4" />
        </g>
        <path d="M50 50l-9 15" stroke="#3072f0" strokeWidth="1.8" strokeLinecap="round" />
        <circle cx="50" cy="50" r="3.2" fill="#3072f0" />
      </g>
    </Plate>
  ),

  tv: (c) => (
    <Plate c={c} from="#555b69" to="#101319" rim="#9aa4b8">
      <defs>
        <linearGradient id={c.id('screen')} x1="0.2" y1="0" x2="0.8" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#d2d8e4" />
        </linearGradient>
      </defs>
      <g style={{ filter: liftHeavy }}>
        <rect x="20" y="24" width="60" height="41" rx="7" fill={`url(#${c.id('screen')})`} />
        <path d="M44 36v17l15-8.5z" fill="#2b303b" />
        {/* Stand: a foot plus a neck, so the screen is standing rather than floating. */}
        <path d="M50 65v9" stroke="#e6eaf2" strokeWidth="5" strokeLinecap="round" />
        <path d="M37 77h26" stroke="#e6eaf2" strokeWidth="5" strokeLinecap="round" />
      </g>
    </Plate>
  ),

  settings: (c) => (
    <Plate c={c} from="#b4b9c2" to="#5c636d" rim="#e2e5ea">
      <defs>
        <linearGradient id={c.id('gear')} x1="0.2" y1="0" x2="0.8" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#c2c7cf" />
        </linearGradient>
      </defs>
      <g style={{ filter: liftHeavy }} fill={`url(#${c.id('gear')})`}>
        {/* Eight teeth, not twelve: at 16px twelve teeth alias into a blurred
            ring. Eight stay individually visible. */}
        {Array.from({ length: 8 }, (_, i) => (
          <rect key={i} x="45.5" y="15" width="9" height="15" rx="3" transform={`rotate(${i * 45} 50 50)`} />
        ))}
        <circle cx="50" cy="50" r="25" />
      </g>
      {/* The bore, shaded so the gear has thickness. */}
      <circle cx="50" cy="50" r="11" fill="#6b7178" />
      <circle cx="50" cy="50" r="11" fill="none" stroke="#000" strokeOpacity="0.2" strokeWidth="1.6" />
      <circle cx="50" cy="49" r="11" fill="none" stroke="#fff" strokeOpacity="0.35" strokeWidth="1.2" />
    </Plate>
  ),
}

export function AppIcon({ appId, size }: { appId: AppId; size: number }) {
  const uid = useId().replace(/:/g, '')
  const ctx: Ctx = { id: (name) => `${uid}-${name}` }
  return (
    <svg
      viewBox="-3 -3 106 108"
      width={size}
      height={size}
      aria-hidden
      style={{
        // Two-part shadow, as on every other surface: a tight contact shadow
        // anchoring the icon and a wide soft cast giving it height.
        filter: 'drop-shadow(0 1px 1px rgb(0 0 0 / 0.26)) drop-shadow(0 4px 8px rgb(0 0 0 / 0.2))',
        overflow: 'visible',
      }}
    >
      {/* An id saved before its app was removed must not take the whole shell down. */}
      {DRAWINGS[appId]?.(ctx) ?? <Plate c={ctx} from="#9499a2" to="#4e545d" />}
    </svg>
  )
}
