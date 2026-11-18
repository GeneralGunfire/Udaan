import { StrictMode, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { AnimatePresence, motion } from 'framer-motion'
import '@/styles/theme.css'
import { ThemeProvider } from '@/app/ThemeProvider'
import { WallpaperProvider } from '@/app/WallpaperProvider'
import { getWallpaper } from '@/app/wallpapers'
import { MotionRoot } from '@/os/kernel/MotionRoot'
import { useWallpaper } from '@/shared/hooks/useWallpaper'
import { AppIcon } from '@/os/ui/icons/AppIcon'
import { LiquidGlassSettings } from '@/os/apps/settings/LiquidSection'
import { Menu, usePopMenu, type MenuEntry } from '@/os/ui/pop/Menu'
import { BannerStack, NotificationCenter } from '@/os/ui/pop/Notifications'
import { CalendarPopup, MediaPopup, NetworkPopup, SoundPopup } from '@/os/ui/pop/TopbarPopups'
import { LayoutsPopup } from '@/os/ui/pop/LayoutsView'
import { StartMenu } from '@/os/ui/pop/Start'
import { PopIcon } from '@/os/ui/pop/icons'
import { SAMPLE_NOTES, type Note } from '@/os/ui/pop/samples'
import { cn } from '@/shared/lib/cn'
import { MotionLab } from './MotionLab'

/**
 * DESIGN GALLERY (browser preview only). The new notification, popup, menu and Start designs, live and clickable,
 * over whichever wallpaper the Preview button picks, with the same glass customisation Settings will have.
 * Nothing here touches the real OS surfaces until a design is approved and ported.
 */

type Tab = 'notifications' | 'popups' | 'menus' | 'start' | 'motion'
const TABS: { id: Tab; label: string }[] = [
  { id: 'notifications', label: 'Notifications' },
  { id: 'popups', label: 'Top bar popups' },
  { id: 'menus', label: 'Right-click menus' },
  { id: 'start', label: 'Start menu' },
  { id: 'motion', label: 'Motion lab' },
]

function Backdrop() {
  const { wallpaperId } = useWallpaper()
  const wp = getWallpaper(wallpaperId)
  return wp.src ? <img alt="" draggable={false} src={wp.src} className="absolute inset-0 h-full w-full select-none object-cover" /> : <div className="absolute inset-0" style={{ background: wp.color ?? '#0b0f16' }} />
}

/* ── menu definitions ─────────────────────────────────────────────── */

const noop = () => {}
const view = (): MenuEntry[] => [
  { label: 'Large icons', checked: false },
  { label: 'Medium icons', checked: true },
  { label: 'Small icons', checked: false },
  { type: 'sep' },
  { label: 'Auto-arrange', checked: true },
  { label: 'Align to grid', checked: true },
]
const sort = (): MenuEntry[] => [
  { label: 'Name', checked: true },
  { label: 'Size', checked: false },
  { label: 'Item type', checked: false },
  { label: 'Date modified', checked: false },
]
const MENUS: { title: string; note: string; items: MenuEntry[] }[] = [
  {
    title: 'Desktop',
    note: 'Right-click the desktop',
    items: [
      { label: 'View', icon: 'eye', items: view() },
      { label: 'Sort by', icon: 'sort', items: sort() },
      { label: 'Refresh', icon: 'refresh', shortcut: 'F5' },
      { type: 'sep' },
      { label: 'New', icon: 'plus', items: [{ label: 'Folder', icon: 'folder' }, { label: 'Text document', icon: 'file' }, { label: 'Shortcut', icon: 'external' }] },
      { label: 'Paste', icon: 'paste', shortcut: 'Ctrl V', disabled: true },
      { type: 'sep' },
      { label: 'Change wallpaper…', icon: 'image' },
      { label: 'Display settings', icon: 'monitor' },
      { label: 'Open terminal here', icon: 'terminal' },
    ],
  },
  {
    title: 'File or folder',
    note: 'Right-click a file',
    items: [
      { label: 'Open', icon: 'external', shortcut: 'Enter' },
      { label: 'Open with', icon: 'file', items: [{ label: 'Notes' }, { label: 'Visual Studio Code' }, { label: 'Choose another app…' }] },
      { type: 'sep' },
      { label: 'Cut', icon: 'cut', shortcut: 'Ctrl X' },
      { label: 'Copy', icon: 'copy', shortcut: 'Ctrl C' },
      { label: 'Rename', icon: 'pencil', shortcut: 'F2' },
      { label: 'Compress to ZIP', icon: 'folder' },
      { type: 'sep' },
      { label: 'Move to Recycle Bin', icon: 'trash', danger: true, shortcut: 'Del' },
      { type: 'sep' },
      { label: 'Properties', icon: 'info', shortcut: 'Alt Enter' },
    ],
  },
  {
    title: 'Dock icon',
    note: 'Right-click a dock icon',
    items: [
      { type: 'label', text: 'Open windows' },
      { label: 'Documents', icon: 'window' },
      { label: 'Downloads', icon: 'window' },
      { type: 'sep' },
      { label: 'New window', icon: 'plus' },
      { label: 'Pin to dock', icon: 'pin', checked: true },
      { type: 'sep' },
      { label: 'Minimize all', icon: 'minimize' },
      { label: 'Close all 2 windows', icon: 'x', danger: true },
    ],
  },
  {
    title: 'Window title bar',
    note: 'Right-click the title bar',
    items: [
      { label: 'Restore', icon: 'restore', disabled: true },
      { label: 'Move', icon: 'window' },
      { label: 'Snap layouts', icon: 'layout', items: [{ label: 'Left half' }, { label: 'Right half' }, { label: 'Centred' }, { label: 'Thirds' }] },
      { type: 'sep' },
      { label: 'Minimize', icon: 'minimize' },
      { label: 'Maximize', icon: 'maximize' },
      { type: 'sep' },
      { label: 'Close', icon: 'x', shortcut: 'Alt F4', danger: true },
    ],
  },
  {
    title: 'Top bar · Udaan menu',
    note: 'Click the Udaan logo',
    items: [
      { label: 'About Udaan', icon: 'info' },
      { type: 'sep' },
      { label: 'System Settings…', icon: 'sliders' },
      { label: 'Wallpaper…', icon: 'image' },
      { label: 'Widgets…', icon: 'star' },
      { type: 'sep' },
      { label: 'Lock Screen', icon: 'lock', shortcut: 'Win L' },
      { type: 'sep' },
      { label: 'Sleep', icon: 'moon' },
      { label: 'Restart…', icon: 'refresh' },
      { label: 'Shut Down…', icon: 'power', danger: true },
      { label: 'Log Out', icon: 'user' },
    ],
  },
]

/* ── tabs ─────────────────────────────────────────────────────────── */

function NotificationsDemo() {
  const [all, setAll] = useState<Note[]>(SAMPLE_NOTES)
  const [banners, setBanners] = useState<Note[]>(SAMPLE_NOTES.slice(0, 3))
  const [dnd, setDnd] = useState(false)
  const [center, setCenter] = useState(false)
  const seq = useRef(0)
  const fresh = useMemo(() => SAMPLE_NOTES, [])

  const send = (critical = false) => {
    const base = critical ? SAMPLE_NOTES[2] : fresh[seq.current++ % fresh.length]
    const n: Note = { ...base, id: `x${Date.now()}`, time: 'now', unread: true }
    setAll((a) => [n, ...a])
    if (!dnd) setBanners((b) => [n, ...b])
  }
  const dismiss = (id: string) => setBanners((b) => b.filter((n) => n.id !== id))

  return (
    <>
      {/* the banner stack: top right, under the menu bar */}
      <div className="absolute top-3 transition-[right] duration-300" style={{ right: center ? 392 + 28 : 16 }}>
        <BannerStack notes={banners} onDismiss={dismiss} seconds={16} />
      </div>

      <AnimatePresence>
        {center && (
          <motion.div initial={{ opacity: 0, x: 60 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 60 }} transition={{ type: 'spring', stiffness: 420, damping: 38 }} className="absolute right-3 top-3 bottom-3">
            <NotificationCenter notes={all} onChange={setAll} dnd={dnd} onDnd={setDnd} height="100%" />
          </motion.div>
        )}
      </AnimatePresence>

      <div className="absolute bottom-24 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full bg-black/55 p-1.5 backdrop-blur-md">
        <button type="button" className="pop-btn pop-btn--accent h-9 px-4" onClick={() => send()}>Send a notification</button>
        <button type="button" className="pop-btn h-9 px-4" onClick={() => send(true)}>Send an important one</button>
        <button type="button" className="pop-btn h-9 px-4" onClick={() => setBanners([])}>Clear banners</button>
        <button type="button" aria-pressed={center} className={cn('pop-btn h-9 px-4', center && 'bg-white !text-black')} onClick={() => setCenter((c) => !c)}>
          <PopIcon name="bell" size={14} /> Notification Center
        </button>
      </div>
      <p className="absolute bottom-[68px] left-1/2 -translate-x-1/2 rounded-full bg-black/45 px-3 py-1 text-[11.5px] text-white/70">Hover a banner for its actions · drag it right to dismiss · several fold into a deck</p>
    </>
  )
}

function Labeled({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <div className="px-1"><p className="text-[12px] font-semibold uppercase tracking-wider text-white [text-shadow:0_1px_6px_rgb(0_0_0/.7)]">{title}</p>{note && <p className="text-[11.5px] text-white/70 [text-shadow:0_1px_6px_rgb(0_0_0/.7)]">{note}</p>}</div>
      {children}
    </section>
  )
}

function PopupsDemo() {
  const [notes, setNotes] = useState<Note[]>(SAMPLE_NOTES.slice(0, 5))
  const [dnd, setDnd] = useState(false)
  return (
    <div className="absolute inset-0 overflow-y-auto px-10 pb-28 pt-14">
      <div className="mx-auto grid max-w-[1180px] grid-cols-3 items-start gap-x-8 gap-y-10">
        <Labeled title="Network" note="Wi-Fi icon"><NetworkPopup /></Labeled>
        <Labeled title="Sound" note="Speaker icon"><SoundPopup /></Labeled>
        <Labeled title="Now playing" note="Media pill"><MediaPopup /></Labeled>
        <Labeled title="Calendar" note="Date and time"><CalendarPopup /></Labeled>
        <Labeled title="Arrange windows" note="Layout icon"><LayoutsPopup /></Labeled>
        <Labeled title="Notification Center" note="Bell icon"><NotificationCenter notes={notes} onChange={setNotes} dnd={dnd} onDnd={setDnd} height={560} /></Labeled>
      </div>
    </div>
  )
}

function MenusDemo() {
  const { open, node } = usePopMenu()
  return (
    <div className="absolute inset-0 overflow-y-auto px-10 pb-40 pt-14" onContextMenu={(e) => open(e, MENUS[0].items)}>
      <div className="mx-auto flex max-w-[1240px] flex-wrap items-start justify-center gap-x-10 gap-y-10">
        {MENUS.map((m) => (
          <Labeled key={m.title} title={m.title} note={m.note}>
            <Menu items={m.items} autoFocus={false} onClose={noop} />
          </Labeled>
        ))}
      </div>

      {/* live targets: right-click them */}
      <div className="pointer-events-none fixed bottom-24 right-6 flex flex-col items-end gap-3">
        <button type="button" className="pointer-events-auto flex flex-col items-center gap-1.5 rounded-[16px] bg-black/50 p-3 backdrop-blur-md" onContextMenu={(e) => (e.stopPropagation(), open(e, MENUS[1].items))}>
          <span className="flex h-12 w-12 items-center justify-center rounded-[12px] bg-white/15"><PopIcon name="file" size={26} /></span>
          <span className="text-[12px] text-white">Quarterly report.pdf</span><span className="text-[10.5px] text-white/60">right-click me</span>
        </button>
        <button type="button" className="pointer-events-auto flex flex-col items-center gap-1.5 rounded-[16px] bg-black/50 p-3 backdrop-blur-md" onContextMenu={(e) => (e.stopPropagation(), open(e, MENUS[2].items))}>
          <AppIcon appId="file-explorer" size={48} />
          <span className="text-[12px] text-white">Files</span><span className="text-[10.5px] text-white/60">right-click me</span>
        </button>
        <p className="pointer-events-auto rounded-full bg-black/50 px-4 py-2 text-[12px] text-white/80 backdrop-blur-md">…or right-click anywhere on the wallpaper</p>
      </div>
      {node}
    </div>
  )
}

function StartDemo() {
  return (
    <div className="absolute inset-0">
      <div className="absolute bottom-[84px] left-1/2 -translate-x-1/2"><StartMenu /></div>
    </div>
  )
}

function Gallery() {
  const [tab, setTab] = useState<Tab>('notifications')
  const [drawer, setDrawer] = useState(false)
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const i = Number(e.key) - 1
      if (!e.ctrlKey && !e.altKey && i >= 0 && i < TABS.length && !(e.target instanceof HTMLInputElement)) setTab(TABS[i].id)
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [])

  return (
    <div className="fixed inset-0 overflow-hidden bg-black text-white">
      <Backdrop />
      <div key={tab} className="absolute inset-0">
        {tab === 'notifications' && <NotificationsDemo />}
        {tab === 'popups' && <PopupsDemo />}
        {tab === 'menus' && <MenusDemo />}
        {tab === 'start' && <StartDemo />}
        {tab === 'motion' && <MotionLab />}
      </div>

      {/* gallery chrome */}
      <div className="absolute left-3 top-2.5 z-50 flex items-center gap-1 rounded-full bg-black/60 p-1 backdrop-blur-md">
        {TABS.map((t, i) => (
          <button key={t.id} type="button" aria-pressed={tab === t.id} className={cn('h-8 rounded-full px-4 text-[12.5px] font-medium transition-colors', tab === t.id ? 'bg-white text-black' : 'text-white/80 hover:bg-white/10')} onClick={() => setTab(t.id)}>
            {t.label} <span className="ml-1 text-[10px] opacity-50">{i + 1}</span>
          </button>
        ))}
        <button type="button" aria-pressed={drawer} className={cn('ml-1 h-8 rounded-full px-4 text-[12.5px] font-medium', drawer ? 'bg-[#3072f0] text-white' : 'bg-white/10 text-white')} onClick={() => setDrawer((d) => !d)}>
          Customize glass
        </button>
      </div>

      <AnimatePresence>
        {drawer && (
          <motion.aside initial={{ x: 480 }} animate={{ x: 0 }} exit={{ x: 480 }} transition={{ type: 'spring', stiffness: 380, damping: 40 }} className="absolute bottom-3 right-3 top-14 z-50 w-[470px] overflow-y-auto rounded-[22px] border border-white/10 bg-[#141518]/95 p-5 shadow-2xl backdrop-blur-xl">
            <h2 className="mb-4 text-[20px] font-light">Glass settings</h2>
            <p className="mb-4 text-[12px] text-white/50">These are the same controls that will live in Settings, Appearance &amp; Wallpaper. Popups, menus and banners share the “Popups” group; Start has its own.</p>
            <LiquidGlassSettings />
          </motion.aside>
        )}
      </AnimatePresence>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <WallpaperProvider>
        <MotionRoot>
          <Gallery />
        </MotionRoot>
      </WallpaperProvider>
    </ThemeProvider>
  </StrictMode>,
)
