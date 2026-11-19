import { Lock, Briefcase, KeyRound, EyeOff } from 'lucide-react'
import { Reveal, Stagger, Item, Wrap, Eyebrow, H2, Lead, shot } from '../ui.jsx'

const POINTS = [
  [Lock, 'A PIN lock', 'Cover the desktop when you step away. Set a 4 to 8 digit PIN, and lock after the screensaver if you like.'],
  [Briefcase, 'A separate Work profile', 'Its own pinned apps, wallpaper and lock. Switch from Start, and switch it off entirely if you do not want it.'],
  [KeyRound, 'Its own password', 'Change the Work password and wallpaper in Settings.'],
  [EyeOff, 'Locked apps', 'Choose which apps only open while Work is unlocked.'],
]

export default function Private() {
  return (
    <section id="private" className="bg-white py-20 md:py-24">
      <Wrap className="grid items-center gap-12 md:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] md:gap-14">
        <Stagger gap={0.2} className="grid grid-cols-2 gap-3 md:gap-4">
          <Item as="img" from="rise" src={shot('lockscreen-1')} alt="The Udaan lock screen with a large clock" className="aspect-[4/5] w-full rounded-[20px] object-cover object-[45%_50%] shadow-[0_24px_48px_-24px_rgba(20,30,60,.45)] ring-1 ring-black/5" />
          <Item as="img" from="rise" src={shot('lockscreen-2-pin')} alt="The Udaan PIN prompt" className="mt-8 aspect-[4/5] w-full rounded-[20px] object-cover object-[50%_40%] shadow-[0_24px_48px_-24px_rgba(20,30,60,.45)] ring-1 ring-black/5" />
        </Stagger>
        <Reveal delay={0.08} from="right">
          <Eyebrow>Private</Eyebrow>
          <H2 className="mt-3">Yours alone, and your work apart.</H2>
          <Lead className="mt-4">Udaan Lock is a courtesy lock for passers-by, not a replacement for your Windows password.</Lead>
          <Stagger as="ul" className="mt-7 space-y-4" delay={0.15}>
            {POINTS.map(([Icon, t, d]) => (
              <Item as="li" key={t} className="flex gap-3.5">
                <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#f3f3ee] text-ink/70"><Icon size={16} strokeWidth={1.8} /></span>
                <span><span className="block text-[15px] font-semibold">{t}</span><span className="block text-[14px] leading-relaxed text-ink/55">{d}</span></span>
              </Item>
            ))}
          </Stagger>
          <p className="mt-5 text-[12.5px] text-ink/40">Work profile settings arrive with the public release.</p>
        </Reveal>
      </Wrap>
    </section>
  )
}
