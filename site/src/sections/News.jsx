import { Bookmark, Headphones, Sparkles, Newspaper } from 'lucide-react'
import { motion } from 'framer-motion'
import { Reveal, Stagger, Item, Wrap, Eyebrow, H2, Lead, win, ease } from '../ui.jsx'

const POINTS = [
  [Newspaper, 'A magazine, not a feed', 'Top stories, topics like Health and Technology, and a Saved shelf, laid out with big pictures.'],
  [Sparkles, 'A daily briefing', 'Written for you automatically at 5am, or whenever you ask.'],
  [Headphones, 'Read, listen or summarise', 'Open a story in a clean reader, have it read aloud, or get the short version.'],
  [Bookmark, 'Yours to shape', 'Save what matters and add your own topics.'],
]

/* Layout: pictures on the left (the magazine behind, the reader in front), text on the right. */
export default function News() {
  return (
    <section id="news" className="bg-[#f6f6ef] py-20 md:py-24">
      <Wrap className="grid items-center gap-12 md:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)] md:gap-10">
        <div className="relative order-2 aspect-[1.2/1] md:order-1">
          <motion.img initial={{ opacity: 0, x: -34 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true, margin: '-60px' }} transition={{ duration: 0.8, ease }} src={win('news')} alt="The News app showing top stories" className="absolute left-[-4%] top-[-3%] w-[88%]" />
          <motion.img initial={{ opacity: 0, y: 44 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: '-60px' }} transition={{ duration: 0.8, delay: 0.3, ease }} src={win('news-reader')} alt="A story open in the News reader, with Save, Listen and Summarise" className="absolute bottom-[-6%] right-[-4%] w-[70%]" />
        </div>
        <Reveal delay={0.08} from="right" className="order-1 md:order-2">
          <Eyebrow>News</Eyebrow>
          <H2 className="mt-3">Catch up, calmly.</H2>
          <Lead className="mt-4 max-w-md">The day’s stories in a quiet, magazine-style app, without the noise.</Lead>
          <Stagger as="ul" className="mt-7 space-y-4" delay={0.15}>
            {POINTS.map(([Icon, t, d]) => (
              <Item as="li" key={t} className="flex gap-3.5">
                <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white text-ink/70 shadow-[0_1px_2px_rgba(0,0,0,.08)]"><Icon size={16} strokeWidth={1.8} /></span>
                <span><span className="block text-[15px] font-semibold">{t}</span><span className="block text-[14px] leading-relaxed text-ink/55">{d}</span></span>
              </Item>
            ))}
          </Stagger>
        </Reveal>
      </Wrap>
    </section>
  )
}
