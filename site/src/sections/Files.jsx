import { FolderTree, Tag, PanelRight, Copy } from 'lucide-react'
import { Reveal, Wrap, Eyebrow, H2, Lead, shot, Parallax } from '../ui.jsx'

const FEATURES = [
  [FolderTree, 'Places and drives', 'Home, Desktop, Downloads and your drives, with free space shown right in the sidebar.'],
  [Tag, 'Colour tags', 'Mark files Important, Work, Personal or To review, and find them again in a click.'],
  [PanelRight, 'An info panel', 'Size, counts and file types at a glance, plus Open terminal here.'],
  [Copy, 'Clean-up tools', 'A Recycle Bin and a duplicate finder, one click from the sidebar.'],
]

/* Layout: heading left, a wide real screenshot (the app on the desktop), then four short columns. */
export default function Files() {
  return (
    <section id="files" className="bg-white py-20 md:py-24">
      <Wrap>
        <Reveal from="blur" className="max-w-xl">
          <Eyebrow>Files</Eyebrow>
          <H2 className="mt-3">Your files, in order.</H2>
          <Lead className="mt-4">A file manager rebuilt for Udaan. Calm, quick, and clear about where everything is.</Lead>
        </Reveal>
        <Reveal delay={0.05} from="clip" className="mx-auto mt-10 max-w-[920px]">
          <Parallax amount={14}><img src={shot('b-files')} alt="The Udaan Files app open on the desktop" className="w-full rounded-[20px] shadow-[0_30px_60px_-28px_rgba(20,30,60,.45)] ring-1 ring-black/5" /></Parallax>
        </Reveal>
        <dl className="mx-auto mt-10 grid max-w-[920px] gap-x-8 gap-y-7 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map(([Icon, t, d], i) => (
            <Reveal key={t} delay={i * 0.08}>
              <Icon size={20} strokeWidth={1.7} className="text-brand" />
              <dt className="mt-3 text-[15px] font-semibold">{t}</dt>
              <dd className="mt-1 text-[13.5px] leading-relaxed text-ink/55">{d}</dd>
            </Reveal>
          ))}
        </dl>
      </Wrap>
    </section>
  )
}
