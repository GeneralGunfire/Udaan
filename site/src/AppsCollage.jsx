import { motion, AnimatePresence, useMotionValue, useSpring, useTransform } from 'framer-motion'
import { useLayoutEffect, useRef, useState } from 'react'
// The real Udaan app icons (vector), straight from the OS source.
import { AppIcon, SQUIRCLE } from '../../src/os/ui/icons/AppIcon.tsx'

/* Each app: where it sits on the ring (angle, degrees, 0 = right), its pane size, its glass colours, and what it is. */
export const APPS = [
  { id: 'file-explorer', name: 'Files', line: 'Places, colour tags, an info panel and a duplicate finder.', a: -156, s: 196, c: ['#a9e6ff', '#3d9ff5'], shot: 'files' },
  { id: 'chat', name: 'Chat', line: 'An assistant that can read your files and check your calendar.', a: -127, s: 160, c: ['#c9f4c4', '#4cbf6a'] },
  { id: 'omni-find', name: 'OmniFind', line: 'Deep research that writes a cited report, then fact-checks it.', a: -102, s: 176, c: ['#d3dfff', '#5b7cff'] },
  { id: 'calendar', name: 'Calendar', line: 'Day, week, month and agenda, with reminders that repeat.', a: -78, s: 164, c: ['#ffd3c6', '#ff6d64'] },
  { id: 'notes', name: 'Notes', line: 'Markdown notes that save as you type, with tags and checklists.', a: -53, s: 150, c: ['#fff1bd', '#ffc53d'], shot: 'notes' },
  { id: 'studio', name: 'Studio', line: 'A music studio with its own audio engine. Coming soon in full.', a: -24, s: 190, c: ['#ffd9b8', '#ff8a3d'], shot: 'studio' },
  { id: 'tv', name: 'TV', line: 'Netflix, YouTube, Disney+ and more, in one full-screen place.', a: 24, s: 172, c: ['#dcd5ff', '#7d69ff'] },
  { id: 'news-brief', name: 'News', line: 'A magazine of the day’s stories you can save, summarise or hear.', a: 53, s: 160, c: ['#ffcbd6', '#ff5b79'], shot: 'news' },
  { id: 'photos', name: 'Photos', line: 'Albums, favourites, crop and a slideshow.', a: 78, s: 150, c: ['#ffe3b8', '#ffa64a'] },
  { id: 'clipboard', name: 'Clipboard', line: 'Everything you copied, with secrets hidden automatically.', a: 102, s: 166, c: ['#dde6f5', '#7f95ba'] },
  { id: 'storage', name: 'Storage', line: 'Finds what is safe to clear. Freed 8 GB on our test PC.', a: 127, s: 184, c: ['#dbe2ff', '#6d84ff'], shot: 'storage-after' },
  { id: 'settings', name: 'Settings', line: 'Wallpapers, liquid glass, screensavers and more, all searchable.', a: 156, s: 150, c: ['#e7e9ee', '#9ba3b1'], shot: 'settings' },
]

const W = 1200, H = 660, CX = W / 2, CY = H / 2, RX = 460, RY = 250

function LogoTile({ size }) {
  return (
    <svg viewBox="-3 -3 106 108" width={size} height={size} style={{ overflow: 'visible' }}>
      <defs>
        <linearGradient id="ulg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#62c0ff" /><stop offset=".55" stopColor="#2f6cf0" /><stop offset="1" stopColor="#5a3cf0" /></linearGradient>
        <linearGradient id="ulh" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#fff" stopOpacity=".55" /><stop offset=".55" stopColor="#fff" stopOpacity="0" /></linearGradient>
      </defs>
      <path d={SQUIRCLE} fill="url(#ulg)" />
      <path d={SQUIRCLE} fill="url(#ulh)" />
      <path d={SQUIRCLE} fill="none" stroke="#fff" strokeOpacity=".55" strokeWidth="1.6" />
      <image href="/logo/udaan.png" x="19" y="19" width="62" height="62" />
    </svg>
  )
}

function Tile({ app, i, mx, my, still, active, onPick }) {
  const rad = (app.a * Math.PI) / 180
  const cx = CX + RX * Math.cos(rad), cy = CY + RY * Math.sin(rad)
  const near = i % 2 === 0
  const depth = 0
  const x = useTransform(mx, (v) => v * depth), y = useTransform(my, (v) => v * depth)
  const rot = ((i * 37) % 17) - 8                      // -8..8 deg, stable per tile
  const s = app.s * (near ? 0.9 : 0.8)
  const icon = Math.round(s * 0.6)
  const ox = (i % 3 - 1) * s * 0.16, oy = ((i + 1) % 3 - 1) * s * 0.14   // icon breaks out of its pane a little
  return (
    <motion.div style={{ position: 'absolute', left: cx - s / 2, top: cy - s / 2, width: s, height: s, x, y, zIndex: near ? 3 : 2 }}
      {...(still ? {} : { initial: { opacity: 0, scale: 0.7 }, whileInView: { opacity: 1, scale: 1 }, viewport: { once: true, margin: '-80px' }, transition: { duration: 0.6, delay: 0.25 + i * 0.06, ease: [0.22, 1, 0.36, 1] } })}
      >
      <div style={{ position: 'absolute', inset: 0, borderRadius: s * 0.27, transform: `perspective(900px) rotateX(8deg) rotateY(${near ? -10 : 10}deg) rotateZ(${rot}deg)`,
        background: `linear-gradient(150deg, ${app.c[0]}, ${app.c[1]})`, opacity: near ? 0.88 : 0.7,
        boxShadow: 'inset 0 0 0 1.5px rgba(255,255,255,.6), inset 0 22px 44px rgba(255,255,255,.5), 0 28px 50px -24px rgba(40,60,120,.35)' }}>
        <div style={{ position: 'absolute', inset: 0, borderRadius: 'inherit', background: 'linear-gradient(125deg, rgba(255,255,255,.7), rgba(255,255,255,0) 48%)' }} />
      </div>
      <motion.button type="button" aria-label={app.name} onClick={() => onPick?.(app.id)} className="tile"
        whileHover={still ? undefined : { y: -4 }} transition={{ duration: 0.2, ease: 'easeOut' }}
        style={{ position: 'absolute', left: s / 2 - icon / 2 + ox, top: s / 2 - icon / 2 + oy, width: icon, height: icon, cursor: still ? 'default' : 'pointer', background: 'none', border: 0, padding: 0,
          filter: `drop-shadow(0 16px 16px rgba(30,40,90,.26)) drop-shadow(0 3px 4px rgba(30,40,90,.18))${active ? ' drop-shadow(0 0 0 #fff)' : ''}` }}>
        <AppIcon appId={app.id} size={icon} />
      </motion.button>
    </motion.div>
  )
}

/** The Udaan apps collage. `still` renders a static frame (used to export the PNG). */
export default function Collage({ still = false }) {
  const wrap = useRef(null)
  const [scale, setScale] = useState(1)
  const [sel, setSel] = useState(null)
  const mxRaw = useMotionValue(0), myRaw = useMotionValue(0)
  const mx = useSpring(mxRaw, { stiffness: 60, damping: 18 }), my = useSpring(myRaw, { stiffness: 60, damping: 18 })

  useLayoutEffect(() => {
    if (!wrap.current || still) return
    setScale(Math.min(1, wrap.current.clientWidth / W))
    const ro = new ResizeObserver(([e]) => setScale(Math.min(1, e.contentRect.width / W)))
    ro.observe(wrap.current)
    return () => ro.disconnect()
  }, [still])

  const app = APPS.find((a) => a.id === sel)
  return (
    <div>
      <div ref={wrap} style={{ width: '100%', height: H * scale, position: 'relative' }}
        onMouseMove={(e) => { if (still) return; const r = e.currentTarget.getBoundingClientRect(); mxRaw.set(((e.clientX - r.left) / r.width - 0.5) * 2); myRaw.set(((e.clientY - r.top) / r.height - 0.5) * 2) }}
        onMouseLeave={() => { mxRaw.set(0); myRaw.set(0) }}>
        <div style={{ position: 'absolute', left: '50%', top: 0, width: W, height: H, marginLeft: -W / 2, transform: `scale(${scale})`, transformOrigin: 'top center' }}>
          <div style={{ position: 'absolute', left: CX - 260, top: CY - 200, width: 520, height: 400, background: 'radial-gradient(closest-side, rgba(47,108,240,.16), rgba(47,108,240,0))' }} />
          {APPS.map((a, i) => <Tile key={a.id} app={a} i={i} mx={mx} my={my} still={still} active={sel === a.id} onPick={setSel} />)}
          <motion.div className="tile" {...(still ? {} : { initial: { opacity: 0, scale: 0.8 }, whileInView: { opacity: 1, scale: 1 }, viewport: { once: true, margin: '-80px' }, transition: { duration: 0.7, ease: [0.22, 1, 0.36, 1] } })} style={{ position: 'absolute', left: CX - 84, top: CY - 84, width: 168, height: 168, zIndex: 4, filter: 'drop-shadow(0 26px 30px rgba(40,50,160,.32)) drop-shadow(0 4px 6px rgba(40,50,160,.22))' }}>
            <LogoTile size={168} />
          </motion.div>
        </div>
        <style>{`.tile svg{filter:none !important}`}</style>
      </div>

      {!still && (
        <div className="mx-auto mt-6 h-[92px] max-w-xl px-6 text-center">
          <AnimatePresence mode="wait">
            {app ? (
              <motion.div key={app.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.25 }}>
                <p className="text-xl font-semibold tracking-tight">{app.name}</p>
                <p className="mt-1.5 text-[15px] text-ink/60">{app.line}</p>
              </motion.div>
            ) : (
              <motion.p key="hint" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="pt-3 text-sm text-ink/45">Pick an app to see what it does.</motion.p>
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  )
}
