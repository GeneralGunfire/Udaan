import { getPref, setPref } from './prefs'

/**
 * FIRST-RUN SETUP. On a brand-new install Udaan looks at the PC it landed on and picks sensible settings
 * once, so it feels right straight away without a settings tour:
 *
 *   - screen size and sharpness -> the interface scale stays on "automatic" (it follows the screen), and the
 *     result is recorded so Settings can say what was detected
 *   - a modest PC (few cores or little memory) -> the live liquid-glass bars are turned off and animation is
 *     kept lighter, which keeps it smooth on older hardware
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

export async function runFirstRunSetup(): Promise<Detected | null> {
  if (await getPref('setup.done')) return null
  const [pin, name] = await Promise.all([getPref('lock.pinHash'), getPref('profile.name')])
  if (pin || name) {
    // Already in use: leave every setting exactly as it is.
    await setPref('setup.done', true)
    return null
  }
  const pc = detectPc()
  if (pc.modest) await setPref('bars.liquid', false)
  await setPref('setup.detected', JSON.stringify(pc))
  await setPref('setup.done', true)
  return pc
}
