import { motion, AnimatePresence } from 'framer-motion'
import { useState } from 'react'
import { Reveal, Wrap, Eyebrow, H2, Lead, shot } from '../ui.jsx'

const VIEWS = [
  { id: 'b-desktop', label: 'Udaan dock', line: 'The default: a floating dock and a top bar.' },
  { id: 'windows-taskbar', label: 'Windows taskbar', line: 'Switch the Udaan dock off in Settings and the taskbar returns.' },
  { id: 'windows-start', label: 'Windows Start', line: 'And the Windows Start menu works exactly as it did.' },
]

export default function WindowsSection() {
  const [i, setI] = useState(0)
  const v = VIEWS[i]
  return (
    <section id="windows" className="bg-[#f6f6ef] py-20 md:py-24">
      <Wrap className="text-center">
        <Reveal from="down">
          <Eyebrow>Windows</Eyebrow>
          <H2 className="mt-3">Windows stays Windows.</H2>
          <Lead className="mx-auto mt-4 max-w-lg">Udaan sits on top of Windows 10 and 11. Your apps, files and settings are untouched, and the Windows taskbar and Start are one switch away.</Lead>
        </Reveal>
        <Reveal delay={0.1} from="wipe" className="mx-auto mt-10 max-w-[900px]">
          <div className="relative aspect-video overflow-hidden rounded-[20px] bg-[#dfe4ec] shadow-[0_30px_60px_-28px_rgba(20,30,60,.45)] ring-1 ring-black/5">
            <AnimatePresence initial={false}>
              <motion.img key={v.id} src={shot(v.id)} alt={v.label} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }}
                className="absolute inset-0 h-full w-full object-cover" />
            </AnimatePresence>
          </div>
          <div role="tablist" aria-label="Taskbar and Start" className="mx-auto mt-6 flex w-fit rounded-full bg-white p-1 shadow-[0_1px_2px_rgba(0,0,0,.08)]">
            {VIEWS.map((x, k) => (
              <button key={x.id} role="tab" aria-selected={k === i} onClick={() => setI(k)}
                className={`rounded-full px-4 py-1.5 text-[13px] font-semibold transition-colors ${k === i ? 'bg-ink text-white' : 'text-ink/60 hover:text-ink'}`}>{x.label}</button>
            ))}
          </div>
          <p className="mt-4 text-[14px] text-ink/55">{v.line}</p>
        </Reveal>
      </Wrap>
    </section>
  )
}
