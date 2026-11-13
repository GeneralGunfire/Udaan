import { getCurrentWebview } from '@tauri-apps/api/webview'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { getPref, onPrefChanged } from './prefs'
import { onHotkey, shell } from './shell'

/**
 * How big Udaan draws itself on the current screen. Windows' own scaling
 * already handles DPI; this adds a size class on top so the shell is
 * comfortable on a laptop, a 4K monitor at 100%, or a TV across the room.
 */
export async function autoScale(): Promise<number> {
  try {
    const [m] = await shell.monitorOf()
    const dpi = await getCurrentWindow().scaleFactor()
    const w = (m.right - m.left) / dpi // logical width
    const physical = m.right - m.left
    if (physical >= 3800 && dpi <= 1.25) return 1.5 // 4K TV / monitor at low Windows scaling
    if (w >= 2500) return 1.25
    if (w < 1300) return 0.85 // small laptops
    if (w < 1500) return 0.92
    return 1
  } catch {
    return 1
  }
}

export async function currentScale(): Promise<number> {
  const pref = await getPref('ui.scale')
  return pref > 0 ? pref : autoScale()
}

let applied = 1

/** Applies the scale to this window's web content; fires `ui-scale-changed` when it changes. */
async function apply() {
  const z = Math.round((await currentScale()) * 100) / 100
  if (z === applied) return
  applied = z
  await getCurrentWebview().setZoom(z).catch(() => {})
  window.dispatchEvent(new Event('ui-scale-changed'))
}

/** Call once per window. */
export function installUiScale() {
  void apply()
  void onPrefChanged((key) => key === 'ui.scale' && void apply())
  void onHotkey((id) => (id as string) === 'display-changed' && void apply())
}

/** Physical pixels per CSS pixel in this window (Windows scaling × Udaan scale). */
export const pxScale = () => window.devicePixelRatio || 1

/** Runs `fn` now and again whenever the screen or Udaan's scale changes. */
export function onLayoutChange(fn: () => void): () => void {
  const onScale = () => fn()
  window.addEventListener('ui-scale-changed', onScale)
  const un = onHotkey((id) => (id as string) === 'display-changed' && setTimeout(fn, 300))
  return () => {
    window.removeEventListener('ui-scale-changed', onScale)
    void un.then((f) => f())
  }
}
