import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { CLOCK_STYLES } from '@/os/widgets/clocks'
import { UdaanMark } from '@/os/ui/icons/UdaanMark'

/**
 * Udaan's guided tutorial: a self-playing, chaptered walkthrough in the spirit of a short video. A scene on the
 * left shows what is being described (a miniature desktop that animates), and the narration on the right
 * reveals one line at a time. It plays by itself, and every control is one click or key: space pauses,
 * the arrow keys move between chapters, Escape leaves.
 */

type Scene = 'welcome' | 'topbar' | 'dock' | 'start' | 'switch' | 'widgets' | 'settings' | 'personal' | 'windows' | 'system' | 'finish'

interface Chapter {
  id: Scene
  title: string
  /** Short label for the chapter list. */
  short: string
  lines: ReactNode[]
}

const Key = ({ children }: { children: ReactNode }) => (
  <span className="mx-0.5 inline-flex min-w-[26px] items-center justify-center rounded-[6px] bg-white/12 px-1.5 py-0.5 text-[12.5px] font-semibold text-white shadow-[inset_0_0_0_1px_rgb(255_255_255/0.18),0_1px_0_rgb(0_0_0/0.4)]">{children}</span>
)

const CHAPTERS: Chapter[] = [
  {
    id: 'welcome',
    short: 'Welcome',
    title: 'Welcome to Udaan',
    lines: [
      'Udaan is your desktop: a top bar, a dock, a Start menu and your own widgets, all in one calm layer on top of Windows.',
      'Everything is meant to be quiet and quick. Nothing is locked, and every part can be changed or switched off.',
      'This tour takes about three minutes. Press space to pause, or Escape to leave at any time.',
    ],
  },
  {
    id: 'topbar',
    short: 'Top bar',
    title: 'The top bar',
    lines: [
      <>The Udaan menu on the left holds Lock Screen, Settings and power. Next to it are the menus of whichever app is in front.</>,
      'On the right are the status items: network, sound, battery, notifications, and the clock. Click any of them to open its panel.',
      'Click the clock to open the calendar. In Settings you can switch to 24-hour time and show seconds.',
    ],
  },
  {
    id: 'dock',
    short: 'Dock',
    title: 'The dock',
    lines: [
      'The dock holds your apps. Click an icon to open it, or to bring its window to the front.',
      'Small dots under an icon show how many windows it has open. Scroll over an icon to flip between them.',
      <>Push the pointer to the bottom edge and the dock slides in; move away and it hides. Drag icons to reorder them. Right-click to pin or unpin.</>,
    ],
  },
  {
    id: 'start',
    short: 'Start & search',
    title: 'Start and search',
    lines: [
      <>Press <Key>Win</Key> or <Key>Ctrl</Key> <Key>Space</Key> to open Start.</>,
      'Type to find apps, files and settings, to do quick sums, or to search the web.',
      'Underneath, My Day shows the weather, your calendar and the news, so Start is also the quickest look at your day.',
    ],
  },
  {
    id: 'switch',
    short: 'Switching windows',
    title: 'Moving between windows',
    lines: [
      <>Tap <Key>Ctrl</Key> twice for the 3D switcher. Move the mouse to turn through your windows and click the one in front. The last card is always the desktop.</>,
      <><Key>Alt</Key> <Key>`</Key> cycles through windows of the same app. <Key>Alt</Key> <Key>Tab</Key> still switches between everything.</>,
      'Hot corners do a job when you rest the pointer in a corner. Choose what each one does in Settings, Windows.',
    ],
  },
  {
    id: 'widgets',
    short: 'Widgets & clocks',
    title: 'Widgets and clocks',
    lines: [
      'Widgets live on your desktop: clocks, weather, calendar, system stats, notes, a focus timer and more. Add them in Settings, Widgets.',
      `The clock alone has ${CLOCK_STYLES.length} faces: classic, minimal, bold, rings, orbit, digital, flip and words.`,
      'Drag a widget anywhere. Right-click it to change its face, size and colour, or to remove it. Each one remembers its own choices.',
    ],
  },
  {
    id: 'settings',
    short: 'Settings tour',
    title: 'A tour of Settings',
    lines: [
      'Open Settings from the Udaan menu, or search for it in Start. The sidebar groups everything.',
      'Personalization holds wallpaper, colours and glass. Desktop and Dock holds the dock, top bar and display size. Widgets, Keyboard and Windows hold the rest of how Udaan behaves.',
      'Notifications, Sound, Lock, Startup, Power and Privacy are there too. Use the search box at the top to jump straight to a setting by name.',
    ],
  },
  {
    id: 'personal',
    short: 'Make it yours',
    title: 'Make it yours',
    lines: [
      'Pick a wallpaper in Personalization. Choose Light or Dark and every Udaan app follows.',
      'Display size makes the bars, dock and apps larger or smaller. Auto chooses the right size for each screen you connect.',
      'Turn on Turn off animations for a calmer, instant desktop. The clock screensaver and Lock Screen are in Settings too.',
    ],
  },
  {
    id: 'windows',
    short: 'Windows 10 and 11',
    title: 'Works with Windows 10 and 11',
    lines: [
      'Udaan runs on both. By default it replaces the Windows taskbar with the dock and adds the top bar and its own Start.',
      'Prefer the Windows taskbar? In Settings, Desktop and Dock, turn off Use the Udaan dock. The Windows taskbar, Start menu and Windows key return exactly as they were.',
      'The top bar has its own switch. You can keep Udaan\'s top bar with the Windows taskbar, or the other way round, or use neither. Every combination works.',
    ],
  },
  {
    id: 'system',
    short: 'Lock & notifications',
    title: 'Lock and notifications',
    lines: [
      'Lock Screen from the Udaan menu gives a quick privacy screen with your PIN. It can also lock automatically after the screensaver.',
      <>Press <Key>Win</Key> <Key>N</Key> or click the bell for notifications. Messages from Phone Link, such as WhatsApp and SMS, arrive here too.</>,
      'Do Not Disturb silences banners when you need to focus.',
    ],
  },
  {
    id: 'finish',
    short: 'All set',
    title: 'You are all set',
    lines: [
      'That is Udaan. Explore Settings: nothing there can break your PC, and every switch can be flipped back.',
      'You can replay this tour any time from Help, Udaan Tutorial.',
    ],
  },
]

const LINE_MS = 5200

/* ── Scenes: a miniature desktop that animates for each chapter ── */

const accent = 'var(--color-accent)'

function Ring({ show, className }: { show: boolean; className: string }) {
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          className={`pointer-events-none absolute rounded-[14px] ${className}`}
          style={{ boxShadow: `0 0 0 2px ${accent}` }}
          initial={{ opacity: 0, scale: 1.08 }}
          animate={{ opacity: [0, 1, 0.55, 1], scale: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 1.1 }}
        />
      )}
    </AnimatePresence>
  )
}

function ClockFaceSample({ style, size = 64 }: { style: string; size?: number }) {
  const hands = (
    <>
      <line x1="50" y1="50" x2="50" y2="28" stroke="white" strokeWidth={style === 'bold' ? 5 : 2.6} strokeLinecap="round" transform="rotate(300 50 50)" />
      <line x1="50" y1="50" x2="50" y2="16" stroke="white" strokeWidth={style === 'bold' ? 3.4 : 1.8} strokeLinecap="round" transform="rotate(60 50 50)" />
      <circle cx="50" cy="50" r="2.4" fill={accent} />
    </>
  )
  return (
    <div className="flex items-center justify-center rounded-[16px] bg-white/10 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.14)]" style={{ width: size, height: size }}>
      {style === 'digital' || style === 'flip' || style === 'words' ? (
        <span className="text-[13px] font-light text-white">{style === 'words' ? 'ten past' : '10:10'}</span>
      ) : style === 'rings' ? (
        <svg viewBox="0 0 100 100" width={size * 0.8} height={size * 0.8}>
          {[42, 31].map((r, i) => (
            <circle key={r} cx="50" cy="50" r={r} fill="none" stroke={i ? 'white' : accent} strokeWidth="7" strokeLinecap="round" strokeDasharray={`${2 * Math.PI * r * (i ? 0.6 : 0.8)} 999`} transform="rotate(-90 50 50)" />
          ))}
        </svg>
      ) : (
        <svg viewBox="0 0 100 100" width={size * 0.8} height={size * 0.8}>
          <circle cx="50" cy="50" r="46" fill="none" stroke="white" strokeOpacity="0.35" strokeWidth="1.5" />
          {style === 'minimal' || style === 'orbit'
            ? Array.from({ length: 12 }, (_, i) => <circle key={i} cx={50 + 40 * Math.sin((i * Math.PI) / 6)} cy={50 - 40 * Math.cos((i * Math.PI) / 6)} r={i % 3 === 0 ? 2.8 : 1.6} fill="white" fillOpacity="0.7" />)
            : null}
          {hands}
        </svg>
      )}
    </div>
  )
}

function SceneView({ scene, line }: { scene: Scene; line: number }) {
  const on = (s: Scene) => scene === s
  const dockIcons = ['#3b82f6', '#22c55e', '#f59e0b', '#ec4899', '#8b5cf6', '#14b8a6']
  const widgetsVisible = ['welcome', 'widgets', 'personal', 'finish'].includes(scene)
  const settingsOpen = on('settings') || on('personal') || (on('windows') && line < 3)
  const faceIndex = on('widgets') ? (line === 1 ? 0 : line === 2 ? 3 : 1) : 0

  return (
    <div className="relative h-full w-full overflow-hidden rounded-[18px]" style={{ background: 'linear-gradient(160deg, #20345c 0%, #3b2a5c 48%, #7a3a4a 100%)', boxShadow: 'inset 0 0 0 1px rgb(255 255 255 / 0.12)' }}>
      {/* Top bar */}
      <motion.div
        className="absolute inset-x-0 top-0 flex h-[7.5%] items-center justify-between bg-black/35 px-[3%]"
        animate={{ opacity: on('windows') && line === 2 ? 0.25 : 1 }}
      >
        <div className="flex items-center gap-[10px]">
          <UdaanMark size={14} />
          <span className="h-[5px] w-10 rounded-full bg-white/55" />
          <span className="h-[5px] w-7 rounded-full bg-white/30" />
          <span className="h-[5px] w-7 rounded-full bg-white/30" />
        </div>
        <div className="flex items-center gap-[8px]">
          {[0, 1, 2].map((i) => (
            <span key={i} className="h-[6px] w-[6px] rounded-full bg-white/55" />
          ))}
          <span className="text-[11px] font-medium tabular-nums text-white/85">10:10</span>
        </div>
      </motion.div>
      <Ring show={on('topbar')} className="inset-x-[1.5%] top-[1%] h-[6.5%]" />

      {/* Widgets */}
      <AnimatePresence>
        {widgetsVisible && (
          <>
            <motion.div key="w1" className="absolute right-[4%] top-[13%]" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ delay: 0.15 }}>
              <ClockFaceSample key={CLOCK_STYLES[faceIndex].id} style={CLOCK_STYLES[faceIndex].id} size={on('widgets') ? 96 : 68} />
              {on('widgets') && <p className="mt-1.5 text-center text-[10.5px] font-semibold uppercase tracking-wider text-white/70">{CLOCK_STYLES[faceIndex].name}</p>}
            </motion.div>
            <motion.div key="w2" className="absolute right-[4%] top-[40%] h-[64px] w-[120px] rounded-[16px] bg-white/10 p-2.5 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.14)]" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ delay: 0.3 }}>
              <span className="block text-[18px] font-light text-white">21°</span>
              <span className="block text-[9.5px] text-white/60">Partly cloudy</span>
            </motion.div>
          </>
        )}
      </AnimatePresence>
      {on('widgets') && line === 2 && (
        <motion.div className="absolute right-[26%] top-[26%] w-[120px] rounded-[10px] bg-black/70 p-1.5 text-[10.5px] text-white shadow-lg" initial={{ opacity: 0, scale: 0.94 }} animate={{ opacity: 1, scale: 1 }}>
          {['Clock style', 'Size', 'Colour', 'Remove'].map((t, i) => (
            <p key={t} className={`rounded-[6px] px-2 py-1 ${i === 0 ? 'bg-white/15' : ''}`}>{t}</p>
          ))}
        </motion.div>
      )}

      {/* Start */}
      <AnimatePresence>
        {on('start') && (
          <motion.div
            className="absolute left-1/2 top-[14%] w-[62%] -translate-x-1/2 rounded-[18px] bg-black/55 p-3 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.14)]"
            initial={{ opacity: 0, y: 14, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8 }}
          >
            <div className="flex h-[28px] items-center rounded-[10px] bg-white/12 px-3 text-[11.5px] text-white/85">
              <motion.span initial={{ width: 0 }} animate={{ width: line >= 1 ? 96 : 0 }} transition={{ duration: 1.4 }} className="overflow-hidden whitespace-nowrap">
                {line >= 1 ? 'calculator' : ''}
              </motion.span>
              <span className="ml-0.5 h-3 w-px bg-white/80" />
            </div>
            <div className="mt-2.5 grid grid-cols-6 gap-2">
              {dockIcons.concat(dockIcons).map((c, i) => (
                <span key={i} className="aspect-square rounded-[9px]" style={{ background: c, opacity: 0.85 }} />
              ))}
            </div>
            {line >= 2 && (
              <motion.div className="mt-2.5 flex gap-2" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                <span className="h-9 flex-1 rounded-[9px] bg-white/10 p-1.5 text-[10px] text-white/70">Weather</span>
                <span className="h-9 flex-1 rounded-[9px] bg-white/10 p-1.5 text-[10px] text-white/70">Calendar</span>
                <span className="h-9 flex-1 rounded-[9px] bg-white/10 p-1.5 text-[10px] text-white/70">News</span>
              </motion.div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Window switcher */}
      <AnimatePresence>
        {on('switch') && line === 0 && (
          <motion.div className="absolute inset-0 flex items-center justify-center bg-black/35" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            {[-2, -1, 0, 1, 2].map((k) => (
              <motion.div
                key={k}
                className="absolute h-[44%] w-[34%] rounded-[12px] bg-white/18 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.25)]"
                initial={{ x: 0, opacity: 0 }}
                animate={{ x: `${k * 34}%`, rotateY: -k * 22, scale: k === 0 ? 1.08 : 0.86, opacity: 1 - Math.abs(k) * 0.22, zIndex: 10 - Math.abs(k) }}
                transition={{ type: 'spring', stiffness: 160, damping: 20 }}
                style={{ background: k === 0 ? 'rgb(255 255 255 / 0.3)' : undefined }}
              />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
      {on('switch') && line === 2 && (
        <>
          {['left-[1.5%] top-[9%]', 'right-[1.5%] top-[9%]', 'left-[1.5%] bottom-[14%]', 'right-[1.5%] bottom-[14%]'].map((p) => (
            <Ring key={p} show className={`${p} h-[12%] w-[8%]`} />
          ))}
        </>
      )}

      {/* Settings window */}
      <AnimatePresence>
        {settingsOpen && (
          <motion.div
            className="absolute left-1/2 top-[16%] flex h-[62%] w-[68%] -translate-x-1/2 overflow-hidden rounded-[14px] bg-black/60 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.16)]"
            initial={{ opacity: 0, scale: 0.95, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97 }}
          >
            <div className="w-[30%] space-y-1.5 border-r border-white/10 p-2.5">
              {['Personalization', 'Desktop & Dock', 'Widgets', 'Keyboard', 'Windows', 'Sound'].map((t, i) => {
                const hot = (on('settings') && i === Math.min(line * 2, 5)) || (on('personal') && i === 0) || (on('windows') && i === 1)
                return (
                  <p key={t} className="rounded-[6px] px-2 py-1 text-[10px] text-white/80" style={{ background: hot ? 'rgb(255 255 255 / 0.18)' : undefined }}>
                    {t}
                  </p>
                )
              })}
            </div>
            <div className="flex-1 space-y-2 p-3">
              {on('windows') ? (
                <>
                  <ToggleRow label="Use the Udaan dock" on={line < 1} />
                  <ToggleRow label="Use the Udaan top bar" on={true} />
                  <ToggleRow label="Windows key opens Udaan Start" on={line < 1} />
                </>
              ) : on('personal') ? (
                <>
                  <div className="flex gap-2">
                    {['#20345c', '#4a2c5c', '#7a3a4a', '#1f5c52'].map((c) => (
                      <span key={c} className="h-9 flex-1 rounded-[8px]" style={{ background: c }} />
                    ))}
                  </div>
                  <ToggleRow label="Dark mode" on={true} />
                  <ToggleRow label="Turn off animations" on={false} />
                </>
              ) : (
                [0, 1, 2, 3].map((i) => <span key={i} className="block h-[10px] rounded-full bg-white/12" style={{ width: `${88 - i * 14}%` }} />)
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Windows taskbar alternative */}
      {on('windows') && line >= 1 && (
        <motion.div className="absolute inset-x-0 bottom-0 flex h-[8%] items-center gap-2 bg-[#1b1b1f] px-3" initial={{ y: 30 }} animate={{ y: 0 }}>
          <span className="h-[10px] w-[10px] rounded-[2px] bg-[#3b9cff]" />
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className="h-[9px] w-[9px] rounded-full bg-white/45" />
          ))}
          <span className="ml-auto text-[10px] text-white/60">Windows taskbar</span>
        </motion.div>
      )}

      {/* Dock */}
      <motion.div
        className="absolute bottom-[3.5%] left-1/2 flex -translate-x-1/2 items-center gap-[7px] rounded-[18px] bg-white/14 px-2.5 py-2 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.2)]"
        animate={{ y: on('windows') && line >= 1 ? 90 : 0, opacity: on('windows') && line >= 1 ? 0 : 1 }}
        transition={{ type: 'spring', stiffness: 200, damping: 24 }}
      >
        {dockIcons.map((c, i) => (
          <motion.span
            key={c}
            className="relative block h-[30px] w-[30px] rounded-[9px]"
            style={{ background: c }}
            animate={{ y: on('dock') && line === 0 && i === 2 ? -9 : 0, scale: on('dock') && line === 0 && i === 2 ? 1.18 : 1 }}
          >
            {on('dock') && line === 1 && i === 1 && (
              <span className="absolute -bottom-[7px] left-1/2 flex -translate-x-1/2 gap-[3px]">
                <span className="h-[3px] w-[3px] rounded-full bg-white" />
                <span className="h-[3px] w-[3px] rounded-full bg-white" />
              </span>
            )}
          </motion.span>
        ))}
      </motion.div>
      <Ring show={on('dock')} className="bottom-[2%] left-1/2 h-[15%] w-[62%] -translate-x-1/2" />

      {/* Welcome mark */}
      <AnimatePresence>
        {on('welcome') && line === 0 && (
          <motion.div className="absolute inset-0 flex items-center justify-center bg-black/40" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 140, damping: 18 }}>
              <UdaanMark size={64} />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Lock and notification card */}
      {on('system') && (
        <motion.div className="absolute right-[4%] top-[11%] w-[46%] space-y-2" initial={{ opacity: 0, x: 18 }} animate={{ opacity: 1, x: 0 }}>
          {['Phone Link: new message', 'Calendar: meeting in 10 minutes', 'Udaan: update available'].slice(0, line + 1).map((t, i) => (
            <motion.p key={t} initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.1 }} className="rounded-[12px] bg-black/55 px-3 py-2 text-[11px] text-white/90 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.14)]">
              {t}
            </motion.p>
          ))}
        </motion.div>
      )}
    </div>
  )
}

function ToggleRow({ label, on }: { label: string; on: boolean }) {
  return (
    <div className="flex items-center justify-between rounded-[8px] bg-white/8 px-2.5 py-1.5">
      <span className="text-[10.5px] text-white/85">{label}</span>
      <span className="relative h-[14px] w-[26px] rounded-full transition-colors duration-500" style={{ background: on ? accent : 'rgb(255 255 255 / 0.25)' }}>
        <span className="absolute top-[2px] h-[10px] w-[10px] rounded-full bg-white transition-all duration-500" style={{ left: on ? 14 : 2 }} />
      </span>
    </div>
  )
}

/* ── The player ─────────────────────────────────────────────── */

export function Tutorial({ onClose }: { onClose: () => void }) {
  const [chapter, setChapter] = useState(0)
  const [line, setLine] = useState(0)
  const [playing, setPlaying] = useState(true)
  const [tick, setTick] = useState(0)
  const ch = CHAPTERS[chapter]
  const last = chapter === CHAPTERS.length - 1
  const lineRef = useRef(line)
  lineRef.current = line

  const goChapter = (i: number) => {
    setChapter(Math.max(0, Math.min(CHAPTERS.length - 1, i)))
    setLine(0)
    setTick(0)
  }

  // Auto-advance: a line every few seconds, then on to the next chapter.
  useEffect(() => {
    if (!playing) return
    const t = setInterval(() => setTick((n) => n + 100), 100)
    return () => clearInterval(t)
  }, [playing])
  useEffect(() => {
    if (tick < LINE_MS) return
    setTick(0)
    if (line < ch.lines.length - 1) setLine(line + 1)
    else if (!last) goChapter(chapter + 1)
    else setPlaying(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === ' ') {
        e.preventDefault()
        setPlaying((p) => !p)
      } else if (e.key === 'ArrowRight') goChapter(chapter + 1)
      else if (e.key === 'ArrowLeft') goChapter(chapter - 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapter, onClose])

  const total = useMemo(() => CHAPTERS.reduce((n, c) => n + c.lines.length, 0), [])
  const before = useMemo(() => CHAPTERS.slice(0, chapter).reduce((n, c) => n + c.lines.length, 0), [chapter])
  const overall = ((before + line + Math.min(1, tick / LINE_MS)) / total) * 100

  return (
    <motion.div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={onClose}>
      <motion.div
        role="dialog"
        aria-label="Udaan tutorial"
        onMouseDown={(e) => e.stopPropagation()}
        initial={{ opacity: 0, scale: 0.97, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.98 }}
        transition={{ type: 'spring', stiffness: 300, damping: 32 }}
        className="flex h-[min(620px,90vh)] w-[min(1080px,94vw)] flex-col overflow-hidden rounded-[22px] u-surface"
      >
        <div className="flex min-h-0 flex-1">
          {/* Chapter list */}
          <nav className="hidden w-[210px] shrink-0 flex-col gap-0.5 border-r border-(--u-edge) p-3 md:flex" aria-label="Chapters">
            <p className="px-2 pb-2 pt-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-(--u-ink-3)">Chapters</p>
            {CHAPTERS.map((c, i) => (
              <button
                key={c.id}
                type="button"
                onClick={() => goChapter(i)}
                className={`flex items-center gap-2.5 rounded-[9px] px-2.5 py-1.5 text-left text-[13px] transition-colors ${i === chapter ? 'bg-(--u-wash-on) font-semibold text-(--u-ink)' : 'text-(--u-ink-2) hover:bg-(--u-wash-hover)'}`}
              >
                <span className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${i < chapter ? 'bg-(--color-accent) text-white' : 'border border-(--u-edge)'}`}>{i < chapter ? <svg viewBox="0 0 12 12" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2.5 6.5l2.2 2.2L9.5 3.5" /></svg> : i + 1}</span>
                {c.short}
              </button>
            ))}
          </nav>

          {/* Stage + narration */}
          <div className="flex min-w-0 flex-1 flex-col gap-4 p-5">
            <div className="min-h-0 flex-1">
              <SceneView scene={ch.id} line={line} />
            </div>
            <div className="min-h-[118px]">
              <p className="text-[11.5px] font-semibold uppercase tracking-[0.14em] text-(--color-accent)">
                Chapter {chapter + 1} of {CHAPTERS.length}
              </p>
              <h2 className="mt-0.5 text-[22px] font-semibold tracking-tight">{ch.title}</h2>
              <div className="mt-2 text-[14.5px] leading-relaxed text-(--u-ink-2)">
                <AnimatePresence mode="wait">
                  <motion.p key={`${chapter}-${line}`} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.25 }}>
                    {ch.lines[line]}
                  </motion.p>
                </AnimatePresence>
              </div>
            </div>
          </div>
        </div>

        {/* Transport */}
        <div className="flex items-center gap-3 border-t border-(--u-edge) px-4 py-3">
          <button type="button" aria-label={playing ? 'Pause' : 'Play'} onClick={() => setPlaying((p) => !p)} className="flex h-9 w-9 items-center justify-center rounded-full bg-(--u-wash-on) hover:bg-(--u-wash-press)">
            {playing ? (
              <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" /></svg>
            ) : (
              <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M8 5.5v13l10.5-6.5z" /></svg>
            )}
          </button>
          <button type="button" onClick={() => goChapter(chapter - 1)} disabled={chapter === 0} className="h-9 rounded-[9px] px-3 text-[13px] font-medium text-(--u-ink-2) hover:bg-(--u-wash-hover) disabled:opacity-30">
            Back
          </button>
          <div className="relative h-[4px] flex-1 overflow-hidden rounded-full bg-(--u-wash-on)">
            <div className="h-full rounded-full bg-(--color-accent)" style={{ width: `${overall}%`, transition: 'width 120ms linear' }} />
          </div>
          <span className="w-[74px] text-right text-[12px] tabular-nums text-(--u-ink-3)">{Math.round(overall)}%</span>
          <button type="button" onClick={onClose} className="h-9 rounded-[9px] px-3 text-[13px] font-medium text-(--u-ink-2) hover:bg-(--u-wash-hover)">
            {last ? 'Close' : 'Skip'}
          </button>
          <button type="button" onClick={() => (last ? goChapter(0) : goChapter(chapter + 1))} className="h-9 rounded-[9px] bg-(--color-accent) px-5 text-[13px] font-semibold text-white hover:brightness-110">
            {last ? 'Replay' : 'Next chapter'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}
