import { invoke } from '@tauri-apps/api/core'
import { getPref, setPref } from './prefs'
import { inTauri } from './shell'

/**
 * FIRST-RUN SETUP. On a brand-new install Udaan looks at the PC it landed on and prepares itself once, so it
 * feels right straight away without a settings tour. The person sees a progress screen (FirstRunScreen) and can
 * stop it at any time; stopping keeps the defaults and Udaan finishes the rest quietly later.
 *
 *   - screen size and sharpness -> the interface scale stays on "automatic" (it follows the screen)
 *   - a modest PC (2 or fewer cores, or about 4 GB of memory or less) -> the live liquid-glass bars are turned
 *     off, which keeps it smooth on older hardware
 *   - the wallpapers that come with Udaan are prepared at this screen's size (the slow step)
 *   - the installed programs are found for Start and search
 *   - everything personal (name, PIN, Work profile) is left empty for the person to fill in
 *
 * It runs exactly once, and ONLY on a fresh install. A PC that already has a PIN or a profile name is an
 * existing Udaan and is never changed: the `setup.done` mark is simply set.
 */
export interface Detected {
  width: number
  height: number
  dpr: number
  cores: number
  memoryGb: number
  modest: boolean
}

export function detectPc(): Detected {
  const dpr = window.devicePixelRatio || 1
  const cores = navigator.hardwareConcurrency || 4
  // Chromium reports at most 8 and rounds down, so this is a floor, not an exact figure.
  const memoryGb = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8
  return {
    width: Math.round(window.screen.width * dpr),
    height: Math.round(window.screen.height * dpr),
    dpr,
    cores,
    memoryGb,
    modest: cores <= 2 || memoryGb <= 4,
  }
}

export interface SetupStep {
  id: string
  label: string
  detail: string
}

export const SETUP_STEPS: SetupStep[] = [
  { id: 'screen', label: 'Looking at your screen', detail: 'Size and sharpness' },
  { id: 'tune', label: 'Tuning Udaan for this PC', detail: 'Choosing smooth, light settings' },
  { id: 'apps', label: 'Finding your apps', detail: 'For Start and search' },
  { id: 'wallpapers', label: 'Preparing your wallpapers', detail: 'Sized for your screen, so they open instantly' },
]

export interface SetupHandle {
  /** Called as each step starts and finishes. */
  onProgress: (index: number, status: 'running' | 'done') => void
  /** True once the person has pressed Stop. */
  cancelled: () => boolean
}

/** Resolves to what was detected, or null if this was not a fresh install (nothing to show). */
export async function isFreshInstall(): Promise<boolean> {
  if (!inTauri) return false
  if (await getPref('setup.done')) return false
  const [pin, name] = await Promise.all([getPref('lock.pinHash'), getPref('profile.name')])
  if (pin || name) {
    // Already in use: leave every setting exactly as it is.
    await setPref('setup.done', true)
    return false
  }
  return true
}

export async function runFirstRunSetup(h: SetupHandle): Promise<void> {
  const pc = detectPc()
  const run = async (i: number, work: () => Promise<unknown>) => {
    if (h.cancelled()) return
    h.onProgress(i, 'running')
    try {
      await work()
    } catch (err) {
      console.error('[setup]', SETUP_STEPS[i].id, err)
    }
    h.onProgress(i, 'done')
  }
  await run(0, async () => {
    await setPref('setup.detected', JSON.stringify(pc))
    await new Promise((r) => setTimeout(r, 500))
  })
  await run(1, async () => {
    if (pc.modest) await setPref('bars.liquid', false)
    await new Promise((r) => setTimeout(r, 500))
  })
  await run(2, () => invoke('search_refresh_apps'))
  await run(3, () => invoke('wallpaper_prerender', { width: pc.width, height: pc.height }))
  // Even if stopped part-way, setup is finished: defaults stay and nothing asks again.
  await setPref('setup.done', true)
}
