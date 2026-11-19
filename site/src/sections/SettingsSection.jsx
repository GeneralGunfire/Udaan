import { motion, AnimatePresence } from 'framer-motion'
import { useState } from 'react'
import { Reveal, Stagger, Item, Wrap, Eyebrow, H2, Lead, win } from '../ui.jsx'

const TABS = [
  { id: 'settings-wallpaper', label: 'Appearance', text: 'Pick a wallpaper from your own folders, then tune the liquid-glass dock and top bar: chrome, water or frost.' },
  { id: 'settings', label: 'Lock screen', text: 'Eight screensavers, a PIN lock, and a choice of when the screensaver starts and whether it locks.' },
  { id: 'settings-notifications', label: 'Notifications', text: 'Do Not Disturb, banner length and previews, per-app control, and a test banner so you can see your choices.' },
]
const GROUPS = ['Appearance & Wallpaper', 'Animations', 'Desktop & Dock', 'Widgets', 'Quickstarts', 'Notifications & Focus', 'Sound', 'Keyboard', 'Window Switcher', 'Lock Screen', 'Privacy & Security', 'AI', 'Windows & Hot Corners', 'Startup & Apps', 'Power & Performance']

/* Layout: centred heading, tabs, a large window that swaps with the tab, then the full list of pages as quiet chips. */
export default function SettingsSection() {
  const [i, setI] = useState(0)
  const t = TABS[i]
  return (
    <section id="settings" className="bg-[#f6f6ef] py-20 md:py-24">
      <Wrap className="text-center">
        <Reveal from="blur">
          <Eyebrow>Settings</Eyebrow>
          <H2 className="mt-3">Make it yours, in one place.</H2>
          <Lead className="mx-auto mt-4 max-w-lg">Everything is in one searchable window, so changing a look or a habit never means hunting.</Lead>
        </Reveal>
        <Reveal delay={0.05}>
          <div role="tablist" aria-label="Settings pages" className="mx-auto mt-8 flex w-fit rounded-full bg-white p-1 shadow-[0_1px_2px_rgba(0,0,0,.08)]">
            {TABS.map((x, k) => (
              <button key={x.id} role="tab" aria-selected={k === i} onClick={() => setI(k)}
                className={`rounded-full px-4 py-1.5 text-[13px] font-semibold transition-colors ${k === i ? 'bg-ink text-white' : 'text-ink/60 hover:text-ink'}`}>{x.label}</button>
            ))}
          </div>
          <p className="mx-auto mt-4 min-h-[44px] max-w-md text-[14px] leading-relaxed text-ink/55">{t.text}</p>
          <div className="relative mx-auto mt-2 w-full max-w-[860px]" style={{ aspectRatio: '1680/1147' }}>
            <AnimatePresence initial={false}>
              <motion.img key={t.id} src={win(t.id)} alt={`Settings: ${t.label}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }}
                className="absolute inset-0 h-full w-full" />
            </AnimatePresence>
          </div>
          <Stagger gap={0.03} className="mx-auto mt-2 flex max-w-[860px] flex-wrap justify-center gap-2">
            {GROUPS.map((g) => <Item key={g} from="scale"><span className="block rounded-full bg-white px-3 py-1 text-[12.5px] text-ink/55 shadow-[0_1px_2px_rgba(0,0,0,.05)]">{g}</span></Item>)}
          </Stagger>
        </Reveal>
      </Wrap>
    </section>
  )
}
