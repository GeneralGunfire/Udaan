import { StrictMode, lazy, Suspense, type ComponentType, type ReactNode } from 'react'
import { MotionRoot } from './os/kernel/MotionRoot'
import { installDoubleCtrl } from './os/kernel/doubleCtrl'
import { createRoot } from 'react-dom/client'
import './styles/theme.css'
import { ErrorBoundary } from './app/ErrorBoundary'
import { ThemeProvider } from './app/ThemeProvider'
import { WallpaperProvider } from './app/WallpaperProvider'
import { isAppId } from './os/kernel/registry'

/**
 * One frontend build serves every shell window, picked by `?window=`:
 *   (none)          the desktop (wallpaper, icons, widgets), under all windows
 *   taskbar         the dock
 *   menubar         the menu bar along the top
 *   taskbar-popup   menu-bar/dock popups (network, sound, media, notifications)
 *   launcher        Start, My Day, Exposé, lock screen and the screensaver
 *   toast           notification banners
 *   edgelight       click-through audio-reactive light around the screen border
 *   app&app=<id>    one Udaan app in its own OS window
 *
 * Each window lazy-loads only its own root, so the dock doesn't carry the
 * code (or side effects, like the music player's audio graph) of every
 * other surface.
 */
const params = new URLSearchParams(window.location.search)
const kind = params.get('window')
const appId = params.get('app')

function named<M extends Record<string, unknown>>(load: () => Promise<M>, name: keyof M) {
  return lazy(() => load().then((m) => ({ default: m[name] as ComponentType })))
}

const Roots = {
  taskbar: named(() => import('./os/dock/DockWindow'), 'DockWindow'),
  menubar: named(() => import('./os/menubar/MenuBarWindow'), 'MenuBarWindow'),
  'taskbar-popup': named(() => import('./os/dock/FlyoutWindow'), 'FlyoutWindow'),
  launcher: named(() => import('./os/launcher/LauncherWindow'), 'LauncherWindow'),
  toast: named(() => import('./os/toast/ToastWindow'), 'ToastWindow'),
  edgelight: named(() => import('./os/edgelight/EdgeLightWindow'), 'EdgeLightWindow'),
  desktop: named(() => import('./os/desktop/DesktopRoot'), 'DesktopRoot'),
}
const AppWindow = lazy(() => import('./os/app-window/AppWindow').then((m) => ({ default: m.AppWindow })))

// Transparent OS windows must not paint the page's opaque background.
if (kind && kind !== 'app') document.documentElement.setAttribute('data-taskbar-window', '')
// The switcher's double-tap Ctrl must work while a Udaan window itself has
// focus (the desktop, every app), where the system-wide hook has not been
// reliable. See os/kernel/doubleCtrl.
if (!kind || kind === 'app') installDoubleCtrl()
// Every shell surface (not app content) is unselectable, like a real OS.
if (kind !== 'app') document.documentElement.setAttribute('data-shell', '')

let root: ReactNode
if (kind === 'app' && isAppId(appId)) root = <AppWindow appId={appId} />
else {
  const Root = Roots[(kind ?? 'desktop') as keyof typeof Roots] ?? Roots.desktop
  root = <Root />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <WallpaperProvider>
        <ErrorBoundary>
          <MotionRoot>
            <Suspense fallback={null}>{root}</Suspense>
          </MotionRoot>
        </ErrorBoundary>
      </WallpaperProvider>
    </ThemeProvider>
  </StrictMode>,
)

// The desktop is declared hidden in tauri.conf.json so no blank frame
// shows before React paints; reveal it after the first real frame. Other
// windows control their own visibility. The timer is a second, independent
// path in case rAF is throttled or Tauri's IPC bridge lands late.
if (!kind) {
  let shown = false
  const showOnce = () => {
    if (shown || !('__TAURI_INTERNALS__' in window)) return
    shown = true
    void import('@tauri-apps/api/window').then(({ getCurrentWindow }) => getCurrentWindow().show())
  }
  requestAnimationFrame(() => requestAnimationFrame(showOnce))
  setTimeout(showOnce, 2000)
}
