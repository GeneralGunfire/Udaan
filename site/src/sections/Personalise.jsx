import { motion, AnimatePresence } from 'framer-motion'
import { useState } from 'react'
import { Reveal, Wrap, Eyebrow, H2, Lead, shot } from '../ui.jsx'

const GROUPS = [
  { id: 'wall', label: 'Wallpaper', note: 'Use your own pictures, in any folder. Udaan crops them to fit the screen.', items: [['b-desktop', 'Blue wave'], ['v1-desktop', 'Machu Picchu'], ['v2-desktop', 'Sunset'], ['desktop-racing', 'Pit lane']] },
  { id: 'saver', label: 'Screensaver', note: 'Eight scenes. Pick one, and choose when it starts.', items: [['saver-1-clock', 'Clock'], ['saver-aurora', 'Aurora'], ['saver-currents', 'Currents'], ['saver-veil', 'Veil'], ['saver-minimal', 'Minimal']] },
  { id: 'lock', label: 'Lock screen', note: 'A calm clock, then a PIN when you step away.', items: [['lockscreen-1', 'Locked'], ['lockscreen-2-pin', 'PIN']] },
]

export default function Personalise() {
  const [g, setG] = useState(0)
  const [k, setK] = useState(0)
  const group = GROUPS[g]
  const item = group.items[Math.min(k, group.items.length - 1)]
  return (
    <section id="yours" className="bg-white py-20 md:py-24">
      <Wrap className="grid items-center gap-10 md:grid-cols-[minmax(0,1.3fr)_minmax(0,0.7fr)] md:gap-14">
        <Reveal from="clip" className="order-2 md:order-1">
          <div className="relative aspect-video overflow-hidden rounded-[20px] bg-[#e9edf3] shadow-[0_30px_60px_-28px_rgba(20,30,60,.45)] ring-1 ring-black/5">
            <AnimatePresence initial={false}>
              <motion.img key={item[0]} src={shot(item[0])} alt={`${item[1]} (${group.label.toLowerCase()})`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }}
                className="absolute inset-0 h-full w-full object-cover" />
            </AnimatePresence>
          </div>
          <div className="mt-4 flex flex-wrap gap-2.5">
            {group.items.map(([id, name], i) => (
              <button key={id} onClick={() => setK(i)} aria-label={name} aria-pressed={i === k}
                className={`group overflow-hidden rounded-xl text-left ring-2 ring-offset-2 transition ${i === k ? 'ring-brand' : 'ring-transparent opacity-75 hover:opacity-100'}`}>
                <img src={shot(id)} alt="" className="h-14 w-24 object-cover" />
              </button>
            ))}
          </div>
        </Reveal>
        <Reveal delay={0.08} from="right" className="order-1 md:order-2">
          <Eyebrow>Make it yours</Eyebrow>
          <H2 className="mt-3">Looks like you.</H2>
          <Lead className="mt-4">Wallpapers, a dock in chrome, water or frost, screensavers, and a lock screen. All in Settings, all searchable.</Lead>
          <div role="tablist" aria-label="What to personalise" className="mt-7 flex w-fit rounded-full bg-[#f3f3ee] p-1">
            {GROUPS.map((x, i) => (
              <button key={x.id} role="tab" aria-selected={i === g} onClick={() => { setG(i); setK(0) }}
                className={`rounded-full px-4 py-1.5 text-[13px] font-semibold transition-colors ${i === g ? 'bg-white text-ink shadow-[0_1px_2px_rgba(0,0,0,.1)]' : 'text-ink/55 hover:text-ink'}`}>{x.label}</button>
            ))}
          </div>
          <p className="mt-4 max-w-sm text-[14px] leading-relaxed text-ink/55">{group.note}</p>
        </Reveal>
      </Wrap>
    </section>
  )
}
