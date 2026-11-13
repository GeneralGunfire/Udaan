import { useEffect, useState, type ComponentType, type SVGProps } from 'react'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { emit } from '@tauri-apps/api/event'
import { AnimatePresence, motion } from 'framer-motion'
import { contentEnter } from '@/os/motion/systemMotion'
import { prefersReducedMotion } from '@/shared/lib/motion'
import { cn } from '@/shared/lib/cn'
import { useTheme } from '@/shared/hooks/useTheme'
import { useWallpaper } from '@/shared/hooks/useWallpaper'
import { WALLPAPERS, getWallpaper } from '@/app/wallpapers'
import { GENERATED_WALLPAPERS } from '@/os/desktop/generatedWallpapers'
import { GeneratedThumb, SOLID_COLOURS } from '@/os/ui/WallpaperThumb'
import { TrashIcon, CheckIcon } from '@/shared/icons'
import { ShellSafetyPanel } from '@/shared/components/ShellSafetyPanel'
import { setWindowWatcherEnabled } from '@/integrations/window-watcher/client'
import { usePref, type BoolPrefKey, type CornerAction, type CORNER_KEYS } from '@/os/kernel/prefs'
import { activateShell, deactivateShell, syncHotCorners } from '@/os/kernel/session'
import { shell } from '@/os/kernel/shell'
import { toastError } from '@/os/ui/toasts'
import { setSoundsEnabled } from '@/os/sound/sounds'
import { createElement } from 'react'
import { Button } from '@/shared/components/ui/button'
import { WIDGET_CATALOG, WIDGET_VIEWS, addWidget, useWidgets, type WidgetKind } from '@/os/widgets/widgets'
import { QuickstartsSection } from './QuickstartsSection'
import { ActionButton, Group, IconTile, KeyCaps, Row, SearchField, Segmented, Select, Stack, Switch } from './ui'
import { AppearanceGlyph, DockGlyph, GeneralGlyph, KeyboardGlyph, NotificationsGlyph, QuickstartsGlyph, SoundGlyph, WidgetsGlyph, WindowsGlyph } from './glyphs'
import { getVersion } from '@tauri-apps/api/app'
import { listNotifications } from '@/integrations/notifications/client'
import { notificationSource } from '@/os/ui/NotificationIcon'

type Section = 'personalization' | 'dock' | 'widgets' | 'quickstarts' | 'keyboard' | 'windows' | 'notifications' | 'sound' | 'system'

interface NavItem {
  id: Section
  label: string
  icon: ComponentType<SVGProps<SVGSVGElement>>
}

/** System Settings groups its panes; so do we. Section ids stay stable so deep links keep working. */
const NAV: NavItem[][] = [
  [
    { id: 'personalization', label: 'Appearance & Wallpaper', icon: AppearanceGlyph },
    { id: 'dock', label: 'Desktop & Dock', icon: DockGlyph },
    { id: 'widgets', label: 'Widgets', icon: WidgetsGlyph },
    { id: 'quickstarts', label: 'Quickstarts', icon: QuickstartsGlyph },
  ],
  [
    { id: 'notifications', label: 'Notifications & Focus', icon: NotificationsGlyph },
    { id: 'sound', label: 'Sound', icon: SoundGlyph },
    { id: 'keyboard', label: 'Keyboard', icon: KeyboardGlyph },
  ],
  [
    { id: 'windows', label: 'Windows & Hot Corners', icon: WindowsGlyph },
    { id: 'system', label: 'General', icon: GeneralGlyph },
  ],
]
const SECTIONS = NAV.flat()

/** What the search field can find: every real setting, and the pane it lives in. */
const SEARCH_INDEX: { title: string; section: Section; keywords?: string }[] = [
  { title: 'Wallpaper', section: 'personalization', keywords: 'background picture desktop image' },
  { title: 'Light and dark appearance', section: 'personalization', keywords: 'theme dark mode light' },
  { title: 'Dock', section: 'dock', keywords: 'taskbar windows' },
  { title: 'Automatically hide the dock', section: 'dock', keywords: 'auto hide' },
  { title: 'Display size', section: 'dock', keywords: 'scale zoom text size larger smaller tv' },
  { title: 'Turn off animations', section: 'dock', keywords: 'reduce motion accessibility' },
  { title: 'Screensaver delay', section: 'dock', keywords: 'screensaver idle timeout inactive start after seconds minutes 30 seconds 1 minute 5 minutes 10 minutes' },
  { title: 'Lock after the screensaver', section: 'dock', keywords: 'pin password screensaver' },
  { title: 'Interface sounds', section: 'sound', keywords: 'audio effects clicks' },
  { title: 'Widgets', section: 'widgets', keywords: 'desktop clock weather' },
  { title: 'Do not disturb', section: 'notifications', keywords: 'focus banners mute' },
  { title: 'Notification Center', section: 'notifications', keywords: 'alerts missed' },
  { title: 'Banner duration and previews', section: 'notifications', keywords: 'banner message preview seconds' },
  { title: 'Mute an app', section: 'notifications', keywords: 'silence allow notifications from' },
  { title: 'Dock magnification', section: 'dock', keywords: 'zoom hover icons swell' },
  { title: '24-hour clock and seconds', section: 'dock', keywords: 'menu bar time format' },
  { title: 'Motivation video', section: 'dock', keywords: 'focus pill youtube menu bar' },
  { title: 'Windows key', section: 'keyboard', keywords: 'win shortcut launcher start' },
  { title: 'Keyboard shortcuts', section: 'keyboard', keywords: 'keys hotkeys' },
  { title: 'Hot corners', section: 'windows', keywords: 'screen corner mission control' },
  { title: 'Always maximize new windows', section: 'windows', keywords: 'fullscreen zoom' },
  { title: 'Start Udaan when I sign in', section: 'system', keywords: 'login items autostart startup' },
  { title: 'Recycle Bin', section: 'system', keywords: 'trash empty storage' },
  { title: 'Windows shell', section: 'system', keywords: 'explorer replace restore' },
  { title: 'About Udaan', section: 'system', keywords: 'version' },
]

function PrefToggleRow({ title, description, pref, onApply }: { title: string; description: string; pref: BoolPrefKey; onApply?: (v: boolean) => Promise<unknown> }) {
  const [value, setValue] = usePref(pref)
  const [busy, setBusy] = useState(false)
  return (
    <Row title={title} description={description}>
      <Switch
        checked={value}
        disabled={busy}
        onChange={async (v) => {
          setBusy(true)
          try {
            await onApply?.(v)
            await setValue(v)
          } catch (err) {
            toastError(`Couldn’t change "${title}"`, err)
          } finally {
            setBusy(false)
          }
        }}
      />
    </Row>
  )
}

function Personalization() {
  const { theme, toggleTheme } = useTheme()
  const { wallpaperId, setWallpaperId } = useWallpaper()
  const current = getWallpaper(wallpaperId)

  async function browse() {
    const picked = await openDialog({ multiple: false, filters: [{ name: 'Pictures', extensions: ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif'] }] })
    if (typeof picked === 'string') setWallpaperId(`file:${picked}`)
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="relative aspect-[16/9] w-full max-w-[520px] overflow-hidden rounded-[var(--os-radius-overlay)] border border-[var(--border-hairline)]" style={{ background: current.color }}>
        {current.generated ? <GeneratedThumb id={current.id} width={520} height={293} /> : current.src && <img src={current.src} alt="" className="h-full w-full object-cover" />}
      </div>

      <section className="flex flex-col gap-2">
        <h3 className="text-[13px] font-semibold text-[var(--color-text-primary)]">Background</h3>
        <div className="grid grid-cols-3 gap-2">
          {GENERATED_WALLPAPERS.map((w) => (
            <button
              key={w.id}
              type="button"
              onClick={() => setWallpaperId(w.id)}
              className={cn(
                'relative aspect-[16/10] overflow-hidden rounded-[var(--os-radius-control)] border-2 transition-colors',
                wallpaperId === w.id ? 'border-[var(--color-accent)]' : 'border-transparent hover:border-[var(--border-strong)]',
              )}
              title={w.label}
            >
              <GeneratedThumb id={w.id} />
              <span className="absolute bottom-1.5 left-2 text-[11px] font-medium text-[var(--color-text-primary)] drop-shadow">{w.label}</span>
            </button>
          ))}
        </div>
        <div className="grid grid-cols-4 gap-2">
          {WALLPAPERS.map((w) => (
            <button
              key={w.id}
              type="button"
              onClick={() => setWallpaperId(w.id)}
              className={cn(
                'relative aspect-[16/10] overflow-hidden rounded-[var(--os-radius-control)] border-2 transition-colors',
                wallpaperId === w.id ? 'border-[var(--color-accent)]' : 'border-transparent hover:border-[var(--border-strong)]',
              )}
              title={w.label}
            >
              <img src={w.src} alt={w.label} className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
        <Row title="Choose a photo" description="Use any picture on this PC as your desktop background.">
          <button type="button" onClick={() => void browse()} className="rounded-[var(--os-radius-control)] bg-(--os-hover) px-3 py-1.5 text-[12px] font-medium hover:bg-[var(--surface-hover)]">
            Browse photos
          </button>
        </Row>
        <Row title="Solid colour">
          <div className="flex gap-1.5">
            {SOLID_COLOURS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={c}
                onClick={() => setWallpaperId(`color:${c}`)}
                className={cn('flex h-6 w-6 items-center justify-center rounded-full border', wallpaperId === `color:${c}` ? 'border-[var(--color-text-primary)]' : 'border-[var(--border-hairline)]')}
                style={{ background: c }}
              >
                {wallpaperId === `color:${c}` && <CheckIcon className="h-3 w-3 text-[var(--color-text-primary)]" />}
              </button>
            ))}
          </div>
        </Row>
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-[13px] font-semibold text-[var(--color-text-primary)]">Colours</h3>
        <Row title="Mode" description="Applies to the dock, menus, and every Udaan app.">
          <div className="flex rounded-[var(--os-radius-control)] bg-(--os-hover) p-0.5">
            {(['light', 'dark'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => theme !== t && toggleTheme()}
                className={cn('rounded-[5px] px-3 py-1 text-[12px] capitalize', theme === t ? 'bg-[var(--surface-hover)] font-medium' : 'text-[var(--color-text-secondary)]')}
              >
                {t}
              </button>
            ))}
          </div>
        </Row>
      </section>
    </div>
  )
}

function DisplaySizeRow() {
  const [scale, setScale] = usePref('ui.scale')
  const options = [
    { value: 0, label: 'Auto' },
    { value: 0.85, label: 'Smaller' },
    { value: 1, label: 'Default' },
    { value: 1.25, label: 'Larger' },
    { value: 1.5, label: 'TV' },
  ]
  return (
    <Row stack title="Display size" description="How big the menu bar, dock, Start and apps are. Auto picks the right size for each screen you connect.">
      <Segmented value={scale} options={options} onChange={(v) => void setScale(v)} />
    </Row>
  )
}

/** How long Windows must sit untouched (mouse and keys, anywhere) before the clock screensaver starts. */
const SCREENSAVER_DELAYS = [
  { value: 30, label: '30 seconds' },
  { value: 60, label: '1 minute' },
  { value: 300, label: '5 minutes' },
  { value: 600, label: '10 minutes' },
]

function ScreensaverDelayRow() {
  const [seconds, setSeconds] = usePref('screensaver.idleSeconds')
  return (
    <Row stack title="Start screensaver after" description="How long the computer sits untouched before the clock screensaver appears. It never starts over a full-screen app, a show or music.">
      <Segmented value={seconds} options={SCREENSAVER_DELAYS} onChange={(v) => void setSeconds(v)} />
    </Row>
  )
}

function DockSection() {
  return (
    <Stack>
      <Group title="Dock">
        <PrefToggleRow
          title="Use the Udaan dock"
          description="Replaces the Windows taskbar. Turn off to get the Windows taskbar back."
          pref="dock.enabled"
          onApply={(v) => (v ? activateShell(true) : deactivateShell())}
        />
        <PrefToggleRow title="Automatically hide the dock" description="The dock slides away and returns when you move the pointer to the bottom edge." pref="dock.autoHide" />
        <PrefToggleRow title="Magnification" description="Icons swell smoothly as the pointer moves along the dock." pref="dock.magnify" />
      </Group>
      <Group title="Menu Bar">
        <PrefToggleRow title="24-hour clock" description="Show the time as 14:30 instead of 2:30 PM." pref="menubar.clock24" />
        <PrefToggleRow title="Show seconds" description="The clock counts seconds." pref="menubar.seconds" />
        <PrefToggleRow title="Motivation video" description="A thin pill at the top centre of the menu bar. Hover it to open, click to pause." pref="focus.enabled" />
      </Group>
      <Group title="Display">
        <DisplaySizeRow />
      </Group>
      <Group title="Screensaver">
        <ScreensaverDelayRow />
      </Group>
      <Group title="Accessibility & Security">
        <PrefToggleRow title="Turn off animations" description="Everything appears instantly, with no fades, slides or motion anywhere in Udaan." pref="motion.off" />
        <PrefToggleRow title="Lock after the screensaver" description="Ending the screensaver asks for your Udaan PIN." pref="lock.afterScreensaver" />
      </Group>
    </Stack>
  )
}

const SHORTCUTS: [string, string][] = [
  ['Win', 'Open Start and search'],
  ['Ctrl+Space', 'Open Start (works with the Win option off)'],
  ['Alt+Tab', 'Switch windows (Windows)'],
  ['Alt+`', 'Next window of the same app'],
  ['Win+Tab', 'Task View: every window at once'],
  ['Win+D', 'Show the desktop'],
  ['Win+E', 'Open File Explorer'],
  ['Win+A', 'Sound'],
  ['Win+N', 'Notifications'],
  ['Win+Z', 'Snap Layouts for the current Udaan window'],
  ['Win+1…9', 'Open or switch to that dock item'],
  ['Win+Arrows', 'Snap the current window (Windows)'],
  ['Win+Ctrl+D', 'New virtual desktop (Windows)'],
  ['Win+L', 'Lock (Windows)'],
  ['Win+Shift+S', 'Screenshot a region (Windows)'],
]

function WidgetsSection() {
  const [placed, save] = useWidgets()
  const kinds = Object.keys(WIDGET_CATALOG) as WidgetKind[]
  return (
    <div className="flex flex-col gap-6">
      <p className="text-[13px] text-[var(--color-text-secondary)]">Add widgets to your desktop. Drag them to arrange; right-click one to remove it.</p>
      <div className="grid grid-cols-2 gap-4">
        {kinds.map((kind) => {
          const { name, description, w, h } = WIDGET_CATALOG[kind]
          const scale = Math.min(1, 300 / w, 150 / h)
          const count = placed.filter((p) => p.kind === kind).length
          return (
            <div key={kind} className="flex flex-col overflow-hidden rounded-[12px] border border-[var(--border-hairline)] bg-(--os-hover)">
              <div className="flex h-[190px] items-center justify-center bg-[radial-gradient(circle_at_30%_20%,rgb(90_120_200/0.35),rgb(20_22_30/0.6))]">
                <div className="pointer-events-none" style={{ width: w * scale, height: h * scale }}>
                  <div style={{ width: w, height: h, transform: `scale(${scale})`, transformOrigin: 'top left' }}>{createElement(WIDGET_VIEWS[kind])}</div>
                </div>
              </div>
              <div className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-[13.5px] font-medium text-[var(--color-text-primary)]">{name}</p>
                  <p className="truncate text-[12px] text-[var(--color-text-secondary)]">{description}</p>
                </div>
                {count > 0 && <span className="text-[11.5px] text-[var(--color-text-secondary)]">{count} on desktop</span>}
                <Button type="button" variant="brand" size="pill-sm" onClick={() => void addWidget(kind)}>
                  Add
                </Button>
              </div>
            </div>
          )
        })}
      </div>
      {placed.length > 0 && (
        <div className="flex items-center justify-between rounded-[10px] border border-[var(--border-hairline)] px-4 py-3">
          <span className="text-[13px] text-[var(--color-text-primary)]">{placed.length} {placed.length === 1 ? 'widget' : 'widgets'} on your desktop</span>
          <Button type="button" variant="surface" size="pill-sm" onClick={() => void save([])}>
            Remove all
          </Button>
        </div>
      )}
    </div>
  )
}

function KeyboardSection() {
  return (
    <Stack>
      <Group>
        <PrefToggleRow
          title="Use the Windows key for Udaan"
          description="Win opens the Udaan launcher; Win+D, Win+E, Win+A, Win+N, Win+S and Win+1–9 go to Udaan. Win+L, Win+R and Win+Arrows keep working as usual."
          pref="shell.winKey"
          onApply={(v) => shell.setKeyboardHook(v)}
        />
      </Group>
      <Group title="Keyboard shortcuts">
        {SHORTCUTS.map(([keys, what]) => (
          <Row key={keys} title={what}>
            <KeyCaps keys={keys} />
          </Row>
        ))}
      </Group>
    </Stack>
  )
}

const CORNER_OPTIONS: { value: CornerAction; label: string }[] = [
  { value: 'none', label: 'Nothing' },
  { value: 'task-view', label: 'Task View' },
  { value: 'start', label: 'Start' },
  { value: 'show-desktop', label: 'Show desktop' },
  { value: 'notifications', label: 'Notifications' },
  { value: 'screensaver', label: 'Screensaver' },
]

function CornerRow({ pref, label }: { pref: (typeof CORNER_KEYS)[number]; label: string }) {
  const [value, setValue] = usePref(pref)
  return (
    <Row title={label}>
      <Select
        label={label}
        value={value}
        options={CORNER_OPTIONS}
        onChange={async (v) => {
          await setValue(v)
          await syncHotCorners()
        }}
      />
    </Row>
  )
}

function WindowsSection() {
  return (
    <Stack>
      <Group title="Hot corners" footer="Rest the pointer in a screen corner to trigger an action.">
        <CornerRow pref="corners.tl" label="Top left" />
        <CornerRow pref="corners.tr" label="Top right" />
        <CornerRow pref="corners.bl" label="Bottom left" />
        <CornerRow pref="corners.br" label="Bottom right" />
      </Group>
      <Group title="Windows">
        <PrefToggleRow title="Always maximize new windows" description="Every app you open fills the screen, not just Udaan's." pref="windows.autoMaximize" onApply={(v) => setWindowWatcherEnabled(v)} />
      </Group>
    </Stack>
  )
}

function AutostartRow() {
  const [on, setOn] = useState<boolean | null>(null)
  useEffect(() => {
    void shell.autostartEnabled().then(setOn, () => setOn(false))
  }, [])
  return (
    <Row title="Start Udaan when I sign in" description="Udaan opens automatically every time you sign in to Windows.">
      <Switch
        checked={!!on}
        disabled={on === null}
        onChange={async (v) => {
          try {
            await shell.setAutostart(v)
            setOn(v)
          } catch (err) {
            toastError('Couldn’t change start-up behaviour', err)
          }
        }}
      />
    </Row>
  )
}

const DURATION_OPTIONS = [
  { value: '3', label: '3 seconds' },
  { value: '6', label: '6 seconds' },
  { value: '10', label: '10 seconds' },
  { value: '15', label: '15 seconds' },
]

/** One switch per app that has sent a notification: off silences its banners. */
function MutedApps() {
  const [apps, setApps] = useState<string[] | null>(null)
  const [muted, setMuted] = usePref('notifications.muted')
  useEffect(() => {
    void listNotifications(false, 300).then(
      (all) => setApps([...new Set(all.map((n) => notificationSource(n)))].sort((a, b) => a.localeCompare(b))),
      () => setApps([]),
    )
  }, [])
  let off: string[] = []
  try {
    off = JSON.parse(muted) as string[]
  } catch {
    /* nothing muted */
  }
  if (apps === null) return null
  if (!apps.length) {
    return (
      <Group title="Allow notifications from">
        <Row title="No apps yet" description="Apps appear here after they send you a notification." />
      </Group>
    )
  }
  return (
    <Group title="Allow notifications from" footer="Switch an app off to stop its banners. Its notifications still arrive in Notification Center.">
      {apps.map((name) => (
        <Row key={name} title={name}>
          <Switch
            label={`Allow banners from ${name}`}
            checked={!off.includes(name)}
            onChange={(allow) => void setMuted(JSON.stringify(allow ? off.filter((x) => x !== name) : [...off, name]))}
          />
        </Row>
      ))}
    </Group>
  )
}

function NotificationsSection() {
  const [duration, setDuration] = usePref('notifications.duration')
  return (
    <Stack>
      <Group title="Focus">
        <PrefToggleRow title="Do not disturb" description="Notifications still arrive in Notification Center, but no banners pop up." pref="notifications.dnd" />
      </Group>
      <Group title="Banners">
        <PrefToggleRow title="Show previews" description="Banners show the message text. Off: only who it is from." pref="notifications.previews" />
        <Row title="Banner stays for">
          <Select label="Banner duration" value={String(duration)} options={DURATION_OPTIONS} onChange={(v) => void setDuration(Number(v))} />
        </Row>
      </Group>
      <MutedApps />
      <Group title="Notification Center">
        <Row title="Notification Center" description="See everything you've missed, grouped by app.">
          <ActionButton onClick={() => void emit('dock:open-notifications')}>Open</ActionButton>
        </Row>
      </Group>
    </Stack>
  )
}

function SoundSection() {
  return (
    <Stack>
      <Group title="Sound effects">
        <PrefToggleRow title="Interface sounds" description="Short sounds for notifications, launching apps, and other actions." pref="sounds.enabled" onApply={async (v) => setSoundsEnabled(v)} />
      </Group>
    </Stack>
  )
}

function SystemSection() {
  const [safetyOpen, setSafetyOpen] = useState(false)
  const [binCount, setBinCount] = useState<number | null>(null)
  const [version, setVersion] = useState<string | null>(null)
  const refreshBin = () => shell.recycleBinInfo().then((i) => setBinCount(i.itemCount), () => setBinCount(null))
  useEffect(() => {
    void refreshBin()
    void getVersion().then(setVersion, () => setVersion(null))
  }, [])
  return (
    <Stack>
      <Group title="About">
        <Row title="Udaan">
          <span className="text-[13px] text-[var(--color-text-secondary)]">{version ? `Version ${version}` : ''}</span>
        </Row>
      </Group>
      <Group title="Login Items">
        <AutostartRow />
      </Group>
      <Group title="Storage">
        <Row title="Recycle Bin" description={binCount === null ? 'Checking…' : binCount === 0 ? 'Empty' : `${binCount} item${binCount === 1 ? '' : 's'}`}>
          <ActionButton
            disabled={!binCount}
            onClick={async () => {
              if (!window.confirm('Permanently delete everything in the Recycle Bin?')) return
              try {
                await shell.emptyRecycleBin()
              } catch (err) {
                toastError('Couldn’t empty the Recycle Bin', err)
              }
              void refreshBin()
            }}
          >
            <span className="flex items-center gap-1.5">
              <TrashIcon className="h-3.5 w-3.5" /> Empty
            </span>
          </ActionButton>
        </Row>
      </Group>
      <Group title="System">
        <Row title="Windows shell" description="Make Udaan the Windows shell at sign-in, or restore Explorer.">
          <ActionButton onClick={() => setSafetyOpen(true)}>Manage</ActionButton>
        </Row>
      </Group>
      <ShellSafetyPanel open={safetyOpen} onOpenChange={setSafetyOpen} />
    </Stack>
  )
}

function SearchResults({ query, onPick }: { query: string; onPick: (s: Section) => void }) {
  const q = query.trim().toLowerCase()
  const hits = SEARCH_INDEX.filter((e) => `${e.title} ${e.keywords ?? ''}`.toLowerCase().includes(q))
  if (!hits.length) return <p className="text-[13px] text-[var(--color-text-secondary)]">No results for “{query}”.</p>
  return (
    <Group>
      {hits.map((e) => (
        <button key={e.title} type="button" onClick={() => onPick(e.section)} className="flex w-full items-center justify-between px-4 py-3 text-left outline-none hover:bg-(--os-hover) focus-visible:bg-(--os-hover)">
          <span className="text-[13px] font-medium text-[var(--color-text-primary)]">{e.title}</span>
          <span className="text-[12px] text-[var(--color-text-secondary)]">{SECTIONS.find((x) => x.id === e.section)?.label}</span>
        </button>
      ))}
    </Group>
  )
}

export function SettingsApp({ section: initial }: { onClose: () => void; section?: Section }) {
  const [section, setSection] = useState<Section>(initial ?? 'personalization')
  const [query, setQuery] = useState('')
  const reduced = prefersReducedMotion()
  // A new launch request ("open Settings at Dock") switches section.
  const [lastInitial, setLastInitial] = useState(initial)
  if (initial !== lastInitial) {
    setLastInitial(initial)
    if (initial) setSection(initial)
  }
  const current = SECTIONS.find((s) => s.id === section) ?? SECTIONS[0]
  const searching = query.trim().length > 0
  const pick = (id: Section) => {
    setSection(id)
    setQuery('')
  }

  // Up/Down move through the panes like System Settings' sidebar.
  const onNavKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const i = SECTIONS.findIndex((x) => x.id === section)
    const next = SECTIONS[Math.min(SECTIONS.length - 1, Math.max(0, i + (e.key === 'ArrowDown' ? 1 : -1)))]
    pick(next.id)
  }

  return (
    <div className="flex h-full">
      <nav onKeyDown={onNavKey} className="flex w-[240px] shrink-0 flex-col gap-3 overflow-y-auto border-r border-[var(--border-hairline)] bg-[var(--surface-raised)] p-3">
        <SearchField value={query} onChange={setQuery} />
        {NAV.map((group, gi) => (
          <div key={gi} className="flex flex-col gap-0.5">
            {group.map(({ id, label, icon }) => {
              const active = !searching && section === id
              return (
                <button
                  key={id}
                  type="button"
                  aria-current={active ? 'page' : undefined}
                  onClick={() => pick(id)}
                  className={cn(
                    'flex h-9 items-center gap-2.5 rounded-[var(--os-radius-control)] px-2 text-left text-[13px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]/60',
                    active ? 'bg-[var(--color-accent)] font-medium text-[var(--color-accent-contrast)]' : 'text-[var(--color-text-primary)] hover:bg-(--os-hover)',
                  )}
                >
                  <IconTile icon={icon} />
                  <span className="truncate">{label}</span>
                </button>
              )
            })}
          </div>
        ))}
      </nav>
      <div className="min-w-0 flex-1 overflow-y-auto px-8 py-6">
        <div className="mx-auto max-w-[680px]">
          <h1 className="mb-6 text-[26px] font-bold tracking-tight text-[var(--color-text-primary)]">{searching ? 'Search' : current.label}</h1>
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={searching ? 'search' : section} {...(reduced ? { initial: false, animate: {} } : contentEnter)}>
              {searching && <SearchResults query={query} onPick={pick} />}
              {!searching && section === 'personalization' && <Personalization />}
              {!searching && section === 'dock' && <DockSection />}
              {!searching && section === 'widgets' && <WidgetsSection />}
              {!searching && section === 'quickstarts' && <QuickstartsSection />}
              {!searching && section === 'notifications' && <NotificationsSection />}
              {!searching && section === 'sound' && <SoundSection />}
              {!searching && section === 'keyboard' && <KeyboardSection />}
              {!searching && section === 'windows' && <WindowsSection />}
              {!searching && section === 'system' && <SystemSection />}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  )
}
