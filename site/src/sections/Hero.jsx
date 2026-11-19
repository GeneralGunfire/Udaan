import { motion, AnimatePresence } from 'framer-motion'
import { useEffect, useState } from 'react'
import { ArrowRight, ChevronLeft, ChevronRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Monitor } from '../Devices.jsx'
import { ease, shot, Stagger, Item } from '../ui.jsx'

const SLIDES = [
  { id: 'b-desktop', title: 'Desktop', line: 'A floating dock, a quiet top bar and liquid glass.' },
  { id: 'b-start', title: 'Start', line: 'Your apps, files and the web, one keystroke away.' },
  { id: 'switcher-3d-proper', title: 'Window switcher', line: 'Double-tap Ctrl and turn through your windows in 3D.' },
  { id: 'b-files', title: 'Files', line: 'Tabs, split panes, previews and a duplicate finder.' },
  { id: 'tv-1-home', title: 'TV', line: 'Netflix, YouTube and more, in one full-screen place.' },
  { id: 'storage-clean-5-after', title: 'Storage', line: 'Finds what is safe to clear. 8 GB back on our test PC.' },
  { id: 'news-1', title: 'News', line: 'The day’s stories, laid out like a magazine.' },
  { id: 'lockscreen-1', title: 'Lock screen', line: 'A calm clock, and a PIN when you step away.' },
]

function Arrow({ dir, onClick }) {
  const Icon = dir < 0 ? ChevronLeft : ChevronRight
  return (
    <button onClick={onClick} aria-label={dir < 0 ? 'Previous screen' : 'Next screen'}
      className={`absolute top-1/2 z-10 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full border border-black/10 bg-white text-ink shadow-[0_4px_14px_rgba(0,0,0,.12)] transition hover:bg-[#f3f4f6] ${dir < 0 ? '-left-5' : '-right-5'}`}>
      <Icon size={18} />
    </button>
  )
}

export default function Hero() {
  const [i, setI] = useState(0)
  const [paused, setPaused] = useState(false)
  const go = (d) => setI((v) => (v + d + SLIDES.length) % SLIDES.length)
  useEffect(() => {
    const on = (e) => { if (e.key === 'ArrowRight') go(1); if (e.key === 'ArrowLeft') go(-1) }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [])
  // Advance every 3.5 s. Restarts after any manual change, pauses while the pointer is on the screen, off for reduced motion.
  useEffect(() => {
    if (paused || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const t = setTimeout(() => go(1), 3500)
    return () => clearTimeout(t)
  }, [i, paused])
  const s = SLIDES[i]
  return (
    <section className="bg-[#f6f6ef] pb-16 pt-28 md:pb-20 md:pt-32">
      <div className="mx-auto grid max-w-[1200px] items-center gap-12 px-6 md:grid-cols-[0.8fr_1.2fr] md:px-10">
        <Stagger now gap={0.1} delay={0.05}>
          <Item><p className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white/70 px-3 py-1 text-[12.5px] text-ink/65">
            <span className="h-1.5 w-1.5 rounded-full bg-brand" />Early access · Windows 10 and 11
          </p></Item>
          <Item from="blur"><h1 className="mt-5 text-[clamp(36px,4.2vw,54px)] font-semibold leading-[1.05] tracking-[-0.03em]">Your desktop, rebuilt.</h1></Item>
          <Item><p className="mt-4 max-w-md text-[17px] leading-relaxed text-ink/60">A glass-smooth shell for Windows, with its own dock, Start and apps. Clean, fast and entirely yours.</p></Item>
          <Item><div className="mt-7 flex items-center gap-2">
            <Link to="/download" className="rounded-full bg-brand px-5 py-2.5 text-[14px] font-semibold text-white transition hover:bg-brand-dark">Get early access</Link>
            <Link to="/#apps" className="group inline-flex items-center gap-1 rounded-full px-4 py-2.5 text-[14px] font-semibold text-ink/75 transition hover:text-ink">
              See the apps <ArrowRight size={15} className="transition-transform group-hover:translate-x-0.5" />
            </Link>
          </div></Item>
        </Stagger>

        <motion.div initial={{ opacity: 0, scale: 0.97, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={{ duration: 0.9, delay: 0.3, ease }}>
          <div className="relative" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
            <Monitor>
              <AnimatePresence initial={false}>
                <motion.img key={s.id} src={shot(s.id)} alt={`Udaan: ${s.title}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                  transition={{ duration: 0.35 }} className="absolute inset-0 h-full w-full object-cover" />
              </AnimatePresence>
            </Monitor>
            <div className="absolute inset-x-0 top-0 aspect-video">
              <Arrow dir={-1} onClick={() => go(-1)} />
              <Arrow dir={1} onClick={() => go(1)} />
            </div>
          </div>
          <div className="mt-5 flex items-start justify-between gap-6">
            <div className="min-h-[48px]">
              <p className="text-[15px] font-semibold">{s.title}</p>
              <p className="text-[14px] text-ink/55">{s.line}</p>
            </div>
            <div className="flex shrink-0 items-center gap-1.5 pt-1.5">
              {SLIDES.map((x, k) => (
                <button key={x.id} onClick={() => setI(k)} aria-label={x.title}
                  className={`h-1.5 rounded-full transition-all ${k === i ? 'w-5 bg-ink' : 'w-1.5 bg-ink/20 hover:bg-ink/40'}`} />
              ))}
            </div>
          </div>
          <div className="hidden">{SLIDES.map((x) => <img key={x.id} src={shot(x.id)} alt="" />)}</div>
        </motion.div>
      </div>
    </section>
  )
}
