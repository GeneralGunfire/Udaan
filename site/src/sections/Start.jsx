import { motion, AnimatePresence } from 'framer-motion'
import { useState } from 'react'
import { Search, LayoutGrid, UserRound } from 'lucide-react'
import { Monitor } from '../Devices.jsx'
import { Reveal, Stagger, Item, Wrap, Eyebrow, H2, Lead, shot } from '../ui.jsx'

const VIEWS = [
  { id: 'pinned', label: 'Pinned', img: 'b-start', alt: 'Udaan Start menu showing pinned apps' },
  { id: 'all', label: 'All apps', img: 'b-allapps', alt: 'Udaan Start menu showing every app, with the Udaan apps first' },
]
const POINTS = [
  [Search, 'Search everything', 'Apps, settings, files and the web, from one box.'],
  [LayoutGrid, 'Your apps first', 'The Udaan apps sit at the top of All apps, then everything else installed.'],
  [UserRound, 'Two profiles', 'Switch between Personal and Work without leaving Start.'],
]

export default function Start() {
  const [view, setView] = useState(0)
  const v = VIEWS[view]
  return (
    <section id="start" className="bg-[#f6f6ef] py-20 md:py-24">
      <Wrap className="grid items-center gap-12 md:grid-cols-[0.8fr_1.2fr] md:gap-14">
        <Reveal from="left">
          <Eyebrow>Start</Eyebrow>
          <H2 className="mt-3">One keystroke to anything.</H2>
          <Lead className="mt-4 max-w-md">Press the Start key and a quiet glass panel opens over your wallpaper. No clutter, no tiles, just what you reach for.</Lead>
          <Stagger as="ul" className="mt-7 space-y-4" delay={0.15}>
            {POINTS.map(([Icon, t, d]) => (
              <Item as="li" key={t} className="flex gap-3.5">
                <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white text-ink/70 shadow-[0_1px_2px_rgba(0,0,0,.08)]"><Icon size={16} strokeWidth={1.8} /></span>
                <span><span className="block text-[15px] font-semibold">{t}</span><span className="block text-[14px] leading-relaxed text-ink/55">{d}</span></span>
              </Item>
            ))}
          </Stagger>
        </Reveal>
        <Reveal delay={0.1} from="clip">
          <Monitor>
            <AnimatePresence initial={false}>
              <motion.img key={v.id} src={shot(v.img)} alt={v.alt} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }}
                style={{ transform: 'scale(1.32)', transformOrigin: '50% 47%' }} className="absolute inset-0 h-full w-full object-cover" />
            </AnimatePresence>
          </Monitor>
          <div role="tablist" aria-label="Start view" className="mx-auto mt-6 flex w-fit rounded-full bg-white p-1 shadow-[0_1px_2px_rgba(0,0,0,.08)]">
            {VIEWS.map((x, k) => (
              <button key={x.id} role="tab" aria-selected={k === view} onClick={() => setView(k)}
                className={`rounded-full px-5 py-1.5 text-[13.5px] font-semibold transition-colors ${k === view ? 'bg-ink text-white' : 'text-ink/60 hover:text-ink'}`}>{x.label}</button>
            ))}
          </div>
        </Reveal>
      </Wrap>
    </section>
  )
}
