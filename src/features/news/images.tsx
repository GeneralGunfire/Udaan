import { useEffect, useRef, useState } from 'react'
import { resolveStoryImage } from '@/os/launcher/newsImages'
import { cn } from '@/shared/lib/cn'
import { categoryLabel, type Article } from './types'

/**
 * Every story has a picture. A real photo is used only when one is found that loads at a good size
 * (the launcher's resolver upgrades thumbnails, falls back to the page's own share picture, and rejects
 * anything small or broken). Until then, and whenever none is good enough, the story wears an
 * Udaan News cover: a dark, patterned card with the wordmark and its section. The cover shows at once, so a
 * card is never empty, and the photo replaces it when it arrives.
 */

const hash = (s: string) => {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

/** A different pattern per section, so a page of covers still reads as a page of different things. */
function Pattern({ kind, seed }: { kind: number; seed: number }) {
  const line = 'rgb(255 255 255 / 0.07)'
  switch (kind) {
    case 0: // diagonals
      return (
        <g stroke={line} strokeWidth="1">
          {Array.from({ length: 22 }, (_, i) => (
            <path key={i} d={`M${-60 + i * 22} 190L${40 + i * 22} -10`} />
          ))}
        </g>
      )
    case 1: // arcs from the corner
      return (
        <g stroke={line} strokeWidth="1" fill="none">
          {Array.from({ length: 9 }, (_, i) => (
            <circle key={i} cx="330" cy="190" r={30 + i * 26} />
          ))}
        </g>
      )
    case 2: // dots
      return (
        <g fill="rgb(255 255 255 / 0.1)">
          {Array.from({ length: 8 * 15 }, (_, i) => (
            <circle key={i} cx={14 + (i % 15) * 22} cy={14 + Math.floor(i / 15) * 22} r="1.3" />
          ))}
        </g>
      )
    case 3: // bars
      return (
        <g fill="rgb(255 255 255 / 0.06)">
          {Array.from({ length: 16 }, (_, i) => {
            const h = 30 + ((seed >> (i % 12)) % 90) + (i % 5) * 8
            return <rect key={i} x={i * 21 + 4} y={190 - h} width="14" height={h} rx="2" />
          })}
        </g>
      )
    case 4: // horizon lines
      return (
        <g stroke={line} strokeWidth="1">
          {Array.from({ length: 14 }, (_, i) => (
            <path key={i} d={`M0 ${10 + i * 13}H340`} />
          ))}
        </g>
      )
    default: // crosshatch grid
      return (
        <g stroke={line} strokeWidth="1">
          {Array.from({ length: 16 }, (_, i) => (
            <path key={`v${i}`} d={`M${i * 22} 0V190`} />
          ))}
          {Array.from({ length: 9 }, (_, i) => (
            <path key={`h${i}`} d={`M0 ${i * 22}H340`} />
          ))}
        </g>
      )
  }
}

export function Cover({ a, className }: { a: Pick<Article, 'id' | 'category' | 'publishedMs'>; className?: string }) {
  const seed = hash(a.id)
  const kind = hash(a.category) % 6
  const label = categoryLabel(a.category).toUpperCase()
  const date = new Date(a.publishedMs ?? Date.now()).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }).toUpperCase()
  const gid = `c${seed.toString(36)}`
  return (
    <svg viewBox="0 0 320 180" preserveAspectRatio="xMidYMid slice" className={cn('block h-full w-full', className)} aria-hidden>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#1b1f27" />
          <stop offset="1" stopColor="#0d0f13" />
        </linearGradient>
      </defs>
      <rect width="320" height="180" fill={`url(#${gid})`} />
      <Pattern kind={kind} seed={seed} />
      <rect x="20" y="104" width="34" height="4" rx="2" fill="#3072f0" />
      <text x="20" y="140" fontFamily="Montserrat, 'Segoe UI', sans-serif" fontSize="30" fontWeight="800" letterSpacing="4" fill="#f4f2ee">
        UDAAN
      </text>
      <text x="21" y="162" fontFamily="Montserrat, 'Segoe UI', sans-serif" fontSize="14" fontWeight="300" letterSpacing="9" fill="rgb(244 242 238 / 0.7)">
        NEWS
      </text>
      <text x="20" y="28" fontFamily="Montserrat, 'Segoe UI', sans-serif" fontSize="9.5" fontWeight="600" letterSpacing="2.4" fill="rgb(244 242 238 / 0.55)">
        {label}
      </text>
      <text x="300" y="28" textAnchor="end" fontFamily="Montserrat, 'Segoe UI', sans-serif" fontSize="9.5" fontWeight="500" letterSpacing="1.6" fill="rgb(244 242 238 / 0.4)">
        {date}
      </text>
    </svg>
  )
}

/* ── resolving real pictures, a few at a time, only for what is on screen ── */

const resolved = new Map<string, string | null>()
let active = 0
const waiting: (() => void)[] = []
const LIMIT = 3

function schedule<T>(job: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const run = () => {
      active++
      job().then(resolve, reject).finally(() => {
        active--
        waiting.shift()?.()
      })
    }
    if (active < LIMIT) run()
    else waiting.push(run)
  })
}

/** The story's picture: its cover at once, the real photo when a good one is found. */
export function StoryImage({ a, className }: { a: Article; className?: string }) {
  const [src, setSrc] = useState<string | null>(resolved.get(a.id) ?? null)
  const [shown, setShown] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setSrc(resolved.get(a.id) ?? null)
    setShown(false)
    if (resolved.has(a.id)) return
    const el = box.current
    if (!el) return
    let live = true
    const go = () =>
      void schedule(() => resolveStoryImage({ headline: a.title, image: a.image, link: a.link || null })).then(
        (u) => {
          resolved.set(a.id, u)
          if (live) setSrc(u)
        },
        () => resolved.set(a.id, null),
      )
    // Only stories near the screen are resolved; a long list would otherwise fetch every picture at once.
    const io = new IntersectionObserver(
      (e) => {
        if (e[0].isIntersecting) (io.disconnect(), go())
      },
      { rootMargin: '300px' },
    )
    io.observe(el)
    return () => {
      live = false
      io.disconnect()
    }
  }, [a.id, a.image, a.link, a.title])

  return (
    <div ref={box} className={cn('relative overflow-hidden bg-[#14171d]', className)}>
      <Cover a={a} className="absolute inset-0" />
      {src && (
        <img
          src={src}
          alt=""
          referrerPolicy="no-referrer"
          decoding="async"
          draggable={false}
          onLoad={() => setShown(true)}
          onError={() => (resolved.set(a.id, null), setSrc(null))}
          className={cn('absolute inset-0 h-full w-full object-cover transition-opacity duration-200', shown ? 'opacity-100' : 'opacity-0')}
        />
      )}
    </div>
  )
}
