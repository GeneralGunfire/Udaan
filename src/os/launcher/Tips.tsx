import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'

interface Tip {
  title: string
  how: string
  detail: string
  art: string
}

/** Udaan's less obvious features, each with exactly how to trigger it. */
const TIPS: Tip[] = [
  { title: 'Start & search', how: 'Press the Windows key', detail: 'Open apps, files and settings, do quick maths, or search the web. "My Day" at the bottom shows your weather, calendar and news.', art: '⌘' },
  { title: 'The dock', how: 'Push the pointer to the bottom edge', detail: 'The dock hides until you need it. Dots under an icon show how many windows it has open; scroll over an icon to flip between them.', art: '▁' },
  { title: '3D window switcher', how: 'Tap Ctrl twice, or hold the left button at the bottom edge and drag up', detail: 'After a Ctrl double-tap, move the mouse to turn through your windows and click to open the one in front. The last card is always the desktop.', art: '◈' },
  { title: 'Switch windows of one app', how: 'Alt + `', detail: 'Cycles between windows of the same app, like two VS Code windows. Alt + Tab still works as usual for everything.', art: '⇄' },
  { title: 'Hot corners', how: 'Rest the pointer in a screen corner', detail: 'Top-left shows all windows; bottom-right shows the desktop. Change them in Settings → Windows.', art: '◰' },
  { title: 'Widgets', how: 'Settings → Widgets', detail: 'Add a clock, weather, calendar, system stats or now-playing to your desktop. Drag them anywhere; right-click to remove.', art: '▦' },
  { title: 'Lock Udaan', how: 'Udaan menu → Lock Screen', detail: 'A quick privacy screen with your PIN. You can also have it lock automatically after the screensaver.', art: '🔒' },
  { title: 'Notifications', how: 'Win + N, or the bell in the top bar', detail: 'Messages from Phone Link (WhatsApp and SMS) show up here too. Click one to reply in Phone Link.', art: '🔔' },
]

export function Tips({ onClose }: { onClose: () => void }) {
  const [i, setI] = useState(0)
  const tip = TIPS[i]
  const last = i === TIPS.length - 1
  return (
    <motion.div className="fixed inset-0 flex items-center justify-center bg-black/55" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={onClose}>
      <motion.div
        onMouseDown={(e) => e.stopPropagation()}
        initial={{ opacity: 0, scale: 0.96, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97 }}
        transition={{ type: 'spring', stiffness: 380, damping: 32 }}
        className="w-[560px] overflow-hidden rounded-[18px] u-surface"
      >
        <div className="flex h-44 items-center justify-center bg-gradient-to-br from-[#23324d] to-[#191a1f] text-[64px]">
          <AnimatePresence mode="wait">
            <motion.span key={i} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2 }}>
              {tip.art}
            </motion.span>
          </AnimatePresence>
        </div>
        <div className="px-8 pb-6 pt-6">
          <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-[var(--color-accent)]">
            Tip {i + 1} of {TIPS.length}
          </p>
          <h2 className="mt-1 text-[24px] font-semibold tracking-tight">{tip.title}</h2>
          <p className="mt-3 inline-block rounded-[8px] bg-(--os-hover) px-3 py-1.5 text-[13.5px] font-medium">{tip.how}</p>
          <p className="mt-3 text-[14px] leading-relaxed text-(--os-text-dim)">{tip.detail}</p>
          <div className="mt-6 flex items-center gap-2">
            <div className="flex flex-1 gap-1.5">
              {TIPS.map((_, k) => (
                <button key={k} type="button" aria-label={`Tip ${k + 1}`} onClick={() => setI(k)} className={`h-1.5 rounded-full transition-all ${k === i ? 'w-6 bg-(--os-text)' : 'w-1.5 bg-(--os-text-dim) hover:bg-(--os-text)'}`} />
              ))}
            </div>
            {i > 0 && (
              <button type="button" onClick={() => setI(i - 1)} className="h-9 rounded-[9px] px-4 text-[13px] font-medium text-(--os-text-dim) hover:bg-(--os-hover)">
                Back
              </button>
            )}
            <button type="button" onClick={() => (last ? onClose() : setI(i + 1))} className="h-9 rounded-[9px] bg-[var(--color-accent)] px-5 text-[13px] font-semibold text-white hover:brightness-110">
              {last ? 'Done' : 'Next'}
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  )
}
