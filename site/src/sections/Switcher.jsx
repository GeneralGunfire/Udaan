import { motion, useScroll, useTransform, useReducedMotion } from 'framer-motion'
import { useRef } from 'react'
import { Reveal, Wrap, Eyebrow, H2, Lead, win, shot } from '../ui.jsx'

/* Five real windows. Scrolling the section fans them out in depth, the way the real switcher does. */
const CARDS = [['studio', 'Studio'], ['news', 'News'], ['files', 'Files'], ['storage-after', 'Storage'], ['notes', 'Notes']]

function Card({ name, label, o, spread, still }) {
  const x = useTransform(spread, (v) => `${o * v * 56}%`)
  const rotateY = useTransform(spread, (v) => -o * v * 20)
  const z = useTransform(spread, (v) => -Math.abs(o) * v * 90)
  const y = useTransform(spread, (v) => Math.abs(o) * (1 - v) * -14)
  return (
    <motion.div style={still ? { x: `${o * 56}%`, rotateY: -o * 20, z: -Math.abs(o) * 90, zIndex: 10 - Math.abs(o) } : { x, rotateY, z, y, zIndex: 10 - Math.abs(o) }}
      className="absolute left-1/2 top-1/2 w-[34%] -translate-x-1/2 -translate-y-1/2">
      <img src={win(name)} alt={`${label} window`} className="w-full select-none" draggable={false} />
    </motion.div>
  )
}

export default function Switcher() {
  const ref = useRef(null)
  const reduce = useReducedMotion()
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start 88%', 'center 52%'] })
  const spread = useTransform(scrollYProgress, [0, 1], [0, 1])
  return (
    <section id="switcher" ref={ref} className="bg-white py-20 md:py-24">
      <Wrap className="text-center">
        <Reveal from="blur">
          <Eyebrow>Window switcher</Eyebrow>
          <H2 className="mt-3">Fly through your work.</H2>
          <Lead className="mx-auto mt-4 max-w-lg">Double-tap Ctrl and every open window fans out in depth. Move the mouse to turn through them, and let go to jump in.</Lead>
        </Reveal>
        <div className="relative mx-auto mt-10 aspect-[16/6.4] w-full max-w-[960px]" style={{ perspective: 1500 }}>
          <div className="absolute inset-0" style={{ transformStyle: 'preserve-3d' }}>
            {CARDS.map(([n, l], k) => <Card key={n} name={n} label={l} o={k - 2} spread={spread} still={reduce} />)}
          </div>
        </div>
        <Reveal className="mx-auto mt-4 flex max-w-xl flex-wrap items-center justify-center gap-x-6 gap-y-2 text-[13.5px] text-ink/50">
          <span>Double-tap <kbd className="rounded-md border border-black/10 bg-[#f6f6ef] px-1.5 py-0.5 font-sans text-[12px] text-ink/70">Ctrl</kbd></span>
          <span>or hold at the bottom edge and drag up</span>
          <span>Alt + ` cycles windows of one app</span>
        </Reveal>
        <Reveal from="clip" className="mx-auto mt-10 max-w-[620px]">
          <img src={shot('switcher-3d-proper')} alt="The real Udaan window switcher with three windows turned in 3D" className="w-full rounded-2xl shadow-[0_24px_50px_-24px_rgba(20,30,60,.4)]" />
        </Reveal>
      </Wrap>
    </section>
  )
}
