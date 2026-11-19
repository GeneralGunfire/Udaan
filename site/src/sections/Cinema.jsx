import { motion } from 'framer-motion'
import { Reveal, Stagger, Item, Wrap, Eyebrow, H2, Lead, shot, Parallax, ease } from '../ui.jsx'

const SERVICES = ['Netflix', 'YouTube', 'Disney+', 'Apple TV', 'BBC iPlayer', 'YouTube Music']

export default function Cinema() {
  return (
    <section id="tv" className="bg-white py-20 md:py-24">
      <Wrap className="text-center">
        <Reveal>
          <Eyebrow>TV</Eyebrow>
          <H2 className="mt-3">Cinema, built in.</H2>
          <Lead className="mx-auto mt-4 max-w-lg">A full-screen home for films, series and the streaming apps you already use, with no browser tabs to juggle.</Lead>
        </Reveal>
        <Reveal delay={0.05} from="zoom" className="relative mx-auto mt-10 max-w-[780px] pb-10 md:pb-12">
          <Parallax amount={12}><img src={shot('tv-1-home')} alt="The Udaan TV app home screen" className="w-full rounded-[20px] shadow-[0_30px_60px_-28px_rgba(20,30,60,.45)] ring-1 ring-black/5" /></Parallax>
          <Parallax amount={-18} className="absolute -bottom-0 right-3 z-10 w-[36%] md:right-[-3%]"><motion.div initial={{ opacity: 0, y: 40 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: '-40px' }} transition={{ duration: 0.8, delay: 0.5, ease }}><img src={shot('tv-6-home-multi')} alt="TV home with YouTube and YouTube Music running as tabs" className="w-full rounded-xl shadow-[0_22px_44px_-18px_rgba(20,30,60,.5)] ring-4 ring-white" /></motion.div></Parallax>
          <p className="absolute bottom-1 left-2 hidden max-w-[46%] text-left text-[13px] leading-relaxed text-ink/50 md:block">Keep YouTube and YouTube Music running right inside TV, and come back to them.</p>
        </Reveal>
        <Stagger gap={0.06} className="mx-auto mt-2 flex max-w-xl flex-wrap items-center justify-center gap-2">
          {SERVICES.map((s) => <Item key={s} from="scale"><span className="block rounded-full bg-[#f3f3ee] px-3.5 py-1.5 text-[13px] text-ink/65">{s}</span></Item>)}
        </Stagger>
      </Wrap>
    </section>
  )
}
