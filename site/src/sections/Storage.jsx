import { animate, useInView, useReducedMotion } from 'framer-motion'
import { useEffect, useRef, useState } from 'react'
import { Reveal, Wrap, Eyebrow, H2, Lead, win, CountUp, ease } from '../ui.jsx'

/* Drag (or use the arrow keys on) the handle to compare the real Storage app before and after a cleanup. */
export default function Storage() {
  const reduce = useReducedMotion()
  const ref = useRef(null)
  const inView = useInView(ref, { once: true, margin: '-80px' })
  const [p, setP] = useState(reduce ? 50 : 97)
  // On arrival the handle sweeps from the edge to the middle: 'before' first, then 'after' is revealed.
  useEffect(() => {
    if (!inView || reduce) return
    const c = animate(97, 50, { duration: 1.7, delay: 0.35, ease, onUpdate: setP })
    return () => c.stop()
  }, [inView])
  return (
    <section id="storage" className="bg-[#f6f6ef] py-20 md:py-24">
      <Wrap className="grid items-center gap-12 md:grid-cols-[1.25fr_0.75fr] md:gap-14">
        <Reveal from="left">
          <div ref={ref} className="relative mx-auto w-full select-none">
            <div className="relative aspect-[1280/960] w-full">
              <img src={win('storage-after')} alt="Storage app after cleaning: 22.3 GB free" className="absolute inset-0 h-full w-full" draggable={false} />
              <img src={win('storage')} alt="Storage app before cleaning: 14.3 GB free" className="absolute inset-0 h-full w-full" style={{ clipPath: `inset(0 ${100 - p}% 0 0)` }} draggable={false} />
              <div className="pointer-events-none absolute bottom-[15%] top-[15%] w-px bg-white/90 shadow-[0_0_0_1px_rgba(0,0,0,.08)]" style={{ left: `${p}%` }}>
                <span className="absolute left-1/2 top-1/2 grid h-9 w-9 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white text-[13px] text-ink shadow-[0_4px_14px_rgba(0,0,0,.25)]">⟷</span>
              </div>
              <span className="pointer-events-none absolute left-[12%] top-[10%] rounded-full bg-black/60 px-2.5 py-1 text-[11.5px] font-semibold text-white">Before</span>
              <span className="pointer-events-none absolute right-[12%] top-[10%] rounded-full bg-brand px-2.5 py-1 text-[11.5px] font-semibold text-white">After</span>
              <input type="range" min={0} max={100} value={p} onChange={(e) => setP(+e.target.value)} aria-label="Compare Storage before and after cleaning"
                className="absolute inset-0 h-full w-full cursor-ew-resize opacity-0" />
            </div>
          </div>
        </Reveal>
        <Reveal delay={0.08} from="right">
          <Eyebrow>Storage</Eyebrow>
          <H2 className="mt-3">Get your space back.</H2>
          <Lead className="mt-4">Storage finds caches and leftovers that are safe to clear, then does it in a click. On our test PC it took the drive from nearly full to comfortable.</Lead>
          <dl className="mt-7 grid grid-cols-2 gap-4">
            <div className="rounded-2xl bg-white p-4 shadow-[0_1px_2px_rgba(0,0,0,.06)]">
              <dt className="text-[12.5px] text-ink/50">Disk used</dt>
              <dd className="mt-1 text-[22px] font-semibold tracking-tight">94% <span className="text-ink/35">→</span> <CountUp from={94} to={91} suffix="%" /></dd>
            </div>
            <div className="rounded-2xl bg-white p-4 shadow-[0_1px_2px_rgba(0,0,0,.06)]">
              <dt className="text-[12.5px] text-ink/50">Free space</dt>
              <dd className="mt-1 text-[22px] font-semibold tracking-tight">14.3 <span className="text-ink/35">→</span> <CountUp from={14.3} to={22.3} decimals={1} /> GB</dd>
            </div>
          </dl>
          <p className="mt-4 text-[13px] text-ink/45">Real result from the Storage app. Nothing of yours is deleted without you choosing it.</p>
        </Reveal>
      </Wrap>
    </section>
  )
}
