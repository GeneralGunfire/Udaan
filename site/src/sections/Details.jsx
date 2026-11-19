import { motion, AnimatePresence } from 'framer-motion'
import { useState } from 'react'
import { Reveal, Wrap, Eyebrow, H2, Lead, shot, pop, ease } from '../ui.jsx'

/* The real desktop is the backdrop (1920x1080). Each panel is placed exactly where it opens, using the original screen coordinates.
   panel: [x, y, w, h] of the panel on screen; the cutout carries 130px of shadow padding on every side.
   spot:  [x, y, w] of the top-bar control that opens it. */
const PAD = 130
const ITEMS = [
  {
    id: 'arrange-windows', title: 'Arrange windows', how: 'Layout icon in the top bar',
    text: 'Pick a layout, then choose a window for each slot. Nine layouts, from side by side to four corners, so a messy desktop becomes tidy in two clicks.',
    panel: [1458, 34, 348, 396], spot: [1632, 17, 34],
  },
  {
    id: 'sound', title: 'Sound', how: 'Speaker icon in the top bar',
    text: 'Volume plus a sound mode that shapes everything Udaan plays: Flat, Music, Cinematic, Bass, Dialogue, Night, Clarity or your own. It can also keep your speakers awake.',
    panel: [1522, 32, 342, 468], spot: [1694, 17, 34],
  },
  {
    id: 'notifications', title: 'Notifications', how: 'Bell in the top bar, or Win + N',
    text: 'Everything in one calm place, grouped by app. Turn on Do Not Disturb, choose how long banners stay, and clear it all in one go.',
    panel: [1552, 44, 346, 236], spot: [1725, 17, 34],
  },
  {
    id: 'clock', title: 'Calendar', how: 'Date and time in the top bar',
    text: 'Today at a glance: a month with your day marked, what is planned, and one click to open the full Calendar.',
    panel: [1568, 34, 340, 496], spot: [1832, 17, 168],
  },
  {
    id: 'udaan-menu', title: 'The Udaan menu', how: 'Udaan logo, top left',
    text: 'Settings, wallpaper, widgets and dock options in one menu, plus Task Manager, Switch to Work, Lock Screen, Sleep, Restart, Shut Down and Log Out.',
    panel: [8, 30, 250, 452], spot: [27, 17, 34],
  },
]
const SECONDS = 6

export default function Details() {
  const [i, setI] = useState(0)
  const [paused, setPaused] = useState(false)
  const it = ITEMS[i]
  const [px, py, pw, ph] = it.panel
  const [sx, sy, sw] = it.spot
  const next = () => setI((v) => (v + 1) % ITEMS.length)

  return (
    <section id="details" className="bg-white py-20 md:py-24">
      <Wrap>
        <Reveal from="blur" className="max-w-xl">
          <Eyebrow>Details</Eyebrow>
          <H2 className="mt-3">Everything at the top, in reach.</H2>
          <Lead className="mt-4">The top bar opens five quiet panels. Same glass, same type and same speed as the rest of Udaan.</Lead>
        </Reveal>

        <Reveal delay={0.05} className="mt-10 grid items-start gap-8 lg:grid-cols-[minmax(0,0.78fr)_minmax(0,1.22fr)] lg:gap-12">
          <div role="tablist" aria-label="Top bar panels" className="order-2 space-y-1 lg:order-1" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
            {ITEMS.map((x, k) => {
              const on = k === i
              return (
                <button key={x.id} role="tab" aria-selected={on} onClick={() => setI(k)}
                  className={`relative block w-full overflow-hidden rounded-2xl px-5 py-4 text-left transition-colors ${on ? 'bg-[#f6f6ef]' : 'hover:bg-[#fafaf7]'}`}>
                  <span className="flex items-baseline justify-between gap-3">
                    <span className={`text-[16px] font-semibold ${on ? 'text-ink' : 'text-ink/70'}`}>{x.title}</span>
                    <span className="text-[12px] text-ink/40">{x.how}</span>
                  </span>
                  <AnimatePresence initial={false}>
                    {on && (
                      <motion.span initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.3 }} className="block overflow-hidden">
                        <span className="mt-2 block pb-1 text-[14px] leading-relaxed text-ink/60">{x.text}</span>
                      </motion.span>
                    )}
                  </AnimatePresence>
                  {on && (
                    <span className="absolute inset-x-0 bottom-0 h-[2px] bg-black/5">
                      <span key={`${x.id}-${paused}`} onAnimationEnd={next} className="fill-bar block h-full origin-left bg-brand"
                        style={{ animationDuration: `${SECONDS}s`, animationPlayState: paused ? 'paused' : 'running' }} />
                    </span>
                  )}
                </button>
              )
            })}
          </div>

          <div className="order-1 lg:order-2" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
            <div className="relative aspect-video overflow-hidden rounded-[20px] bg-[#0a1a4a] shadow-[0_30px_60px_-28px_rgba(20,30,60,.45)] ring-1 ring-black/5">
              <motion.div className="absolute inset-0" initial={false} animate={{ scale: 1.7, originX: sx > 960 ? 1 : 0, originY: 0 }} transition={{ duration: 0.55, ease }}>
              <img src={shot('b-desktop')} alt="The Udaan desktop with its top bar" className="absolute inset-0 h-full w-full object-cover" />
              <div className="absolute inset-0 bg-black/10" />

              {/* a soft ring on the control that opens the panel */}
              <motion.span aria-hidden className="absolute rounded-md ring-[1.5px] ring-white/85"
                initial={false} animate={{ left: `${(sx / 1920) * 100}%`, top: `${(sy / 1080) * 100}%`, width: `${(sw / 1920) * 100}%`, height: `${(30 / 1080) * 100}%` }}
                transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }} style={{ transform: 'translate(-50%,-50%)' }} />

              <AnimatePresence>
                <motion.img key={it.id} src={pop(it.id)} alt={`${it.title} panel`} initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }}
                  className="pointer-events-none absolute max-w-none select-none"
                  style={{ left: `${((px - PAD) / 1920) * 100}%`, top: `${((py - PAD) / 1080) * 100}%`, width: `${((pw + PAD * 2) / 1920) * 100}%` }} />
              </AnimatePresence>
              </motion.div>
            </div>
            <p className="mt-4 text-center text-[13px] text-ink/45">Real panels, shown where they open on the screen.</p>
          </div>
        </Reveal>
      </Wrap>
    </section>
  )
}
