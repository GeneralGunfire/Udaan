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

  'live-dj': (c) => (
    <Plate c={c} from="#d24cf0" to="#5b1192" rim="#f0a6ff">
      <defs>
        <radialGradient id={c.id('vinyl')} cx="0.38" cy="0.32" r="0.75">
          <stop offset="0" stopColor="#3a2347" />
          <stop offset="1" stopColor="#140a1c" />
        </radialGradient>
      </defs>
      <g style={{ filter: liftHeavy }}>
        <circle cx="50" cy="50" r="29" fill={`url(#${c.id('vinyl')})`} />
        {/* Grooves. Spaced unevenly, as a record's are. */}
        <g fill="none" stroke="#fff" strokeOpacity="0.14" strokeWidth="1.2">
          <circle cx="50" cy="50" r="24" />
          <circle cx="50" cy="50" r="20.5" />
          <circle cx="50" cy="50" r="16.5" />
        </g>
        {/* Sheen sweeping across the disc, as light does on vinyl. */}
        <path d="M27 36a29 29 0 0 1 40-8l-4 6a22 22 0 0 0-30 6Z" fill="#fff" opacity="0.14" />
        <circle cx="50" cy="50" r="10" fill="#ff5ac8" />
        <circle cx="50" cy="50" r="2.6" fill="#140a1c" />
      </g>
      {/* Tonearm, crossing the rim as a real one does. */}
      <g style={{ filter: lift }}>
        <path d="M76 20 60 42" stroke="#f3eaff" strokeWidth="3.6" strokeLinecap="round" />
        <circle cx="77" cy="19" r="4.5" fill="#f3eaff" />
      </g>
    </Plate>
  ),

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
    <Plate c={c} from="#a88cff" to="#4a23d4" rim="#cbb8ff">
      <g style={{ filter: liftHeavy }}>
        <circle cx="45" cy="44" r="19" fill="#fff" fillOpacity="0.18" />
        <circle cx="45" cy="44" r="19" fill="none" stroke="#fff" strokeWidth="7.5" />
        <path d="M58.5 58.5 75 75" stroke="#fff" strokeWidth="9" strokeLinecap="round" />
        {/* The spark: this is the "intelligent" search, not plain find. */}
        <path d="M45 32.5l2.6 7.4 7.4 2.6-7.4 2.6-2.6 7.4-2.6-7.4-7.4-2.6 7.4-2.6Z" fill="#fff" />
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
  anvil: (c) => (
    <Plate c={c} from="#4a5568" to="#161a22" rim="#8794ab">
      <defs>
        <linearGradient id={c.id('steel')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.45" stopColor="#dbe2ee" />
          <stop offset="1" stopColor="#a9b4c6" />
        </linearGradient>
      </defs>
      <g style={{ filter: liftHeavy }}>
        {/* A side-on anvil: tapered horn on the left, flat face, narrow waist, wide foot. */}
        <path
          d="M14 44C22 41.5 33 41 41 41H84V52H69C69 58 66 61 66 66L77 70V80H31V70L42 66C42 61 39 58 39 55C32 53 21 50 14 44Z"
          fill={`url(#${c.id('steel')})`}
        />
        {/* The struck face catches the light. */}
        <path d="M41 41H84V44H41Z" fill="#fff" />
        {/* Sparks. */}
        <circle cx="58" cy="29" r="2.6" fill="#ffb347" />
        <circle cx="68" cy="22" r="1.9" fill="#ff8a3c" />
        <circle cx="49" cy="23" r="1.5" fill="#ffd27a" />
      </g>
    </Plate>
  ),
    <Plate c={c} from="#9b98ff" to="#3b2fc4" rim="#c7c5ff">
      <g style={{ filter: liftHeavy }}>
        <rect x="26" y="25" width="48" height="58" rx="8" fill="#fff" />
        {/* The clip, drawn as a separate piece above the board. */}
        <rect x="38" y="16" width="24" height="14" rx="6" fill="#d8d6ff" />
        <rect x="38" y="16" width="24" height="14" rx="6" fill="none" stroke="#fff" strokeWidth="1.4" strokeOpacity="0.8" />
        <g stroke="#6b66e8" strokeWidth="4.5" strokeLinecap="round">
          <path d="M37 48h26M37 59h26M37 70h15" />
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

  storage: (c) => (
    <Plate c={c} from="#5fe37b" to="#07802f" rim="#a6f5b8">
      <g style={{ filter: liftHeavy }}>
        {/* Three platters, so it reads as capacity rather than one drum. */}
        <path d="M27 62v6c0 4.6 10.3 8.3 23 8.3s23-3.7 23-8.3v-6" fill="#fff" fillOpacity="0.55" />
        <ellipse cx="50" cy="62" rx="23" ry="8.3" fill="#fff" fillOpacity="0.8" />
        <path d="M27 46v6c0 4.6 10.3 8.3 23 8.3s23-3.7 23-8.3v-6" fill="#fff" fillOpacity="0.7" />
        <ellipse cx="50" cy="46" rx="23" ry="8.3" fill="#fff" fillOpacity="0.9" />
        <path d="M27 30v6c0 4.6 10.3 8.3 23 8.3s23-3.7 23-8.3v-6" fill="#fff" fillOpacity="0.85" />
        <ellipse cx="50" cy="30" rx="23" ry="8.3" fill="#fff" />
        <circle cx="64" cy="30" r="2.6" fill="#07802f" opacity="0.5" />
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
