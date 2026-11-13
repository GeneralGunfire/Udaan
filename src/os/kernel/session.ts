import { invoke } from '@tauri-apps/api/core'
import { WebviewWindow } from '@tauri-apps/api/webviewWindow'
import { setWindowWatcherEnabled } from '@/integrations/window-watcher/client'
import { CORNER_KEYS, getPref } from './prefs'
import { getTaskbarPref, setTaskbarPref } from '@/integrations/taskbar-prefs/client'
import { inTauri, shell } from './shell'
import { applySoundMode, parseCustomEq, type CustomEq } from '@/os/dock/panels/SoundPanel'

const DOCK_LABEL = 'taskbar'

/**
 * Takes over from Explorer: hides its taskbar(s) and (unless deferred for
 * the splash) shows Udaan's dock. The desktop window's own geometry and
 * z-order are owned by Rust (`shell::install_desktop`).
 */
export async function activateShell(showDock = true): Promise<void> {
  if (!inTauri) return
  await shell.setExplorerChromeHidden(true)
  if (showDock) await showDock_()
}

async function showDock_(): Promise<void> {
  const dock = await WebviewWindow.getByLabel(DOCK_LABEL)
  await dock?.show()
}

export { showDock_ as showDock }

/** Hands the screen back to Explorer's taskbar and hides Udaan's dock. */
export async function deactivateShell(): Promise<void> {
  if (!inTauri) return
  const dock = await WebviewWindow.getByLabel(DOCK_LABEL)
  await dock?.hide()
  await shell.setExplorerChromeHidden(false)
}

/** Re-applies persisted shell behaviour on boot (runs once, in the desktop window). */
export async function applyStartupPrefs(): Promise<void> {
  if (!inTauri) return
  const [winKey, autoMax, dockEnabled] = await Promise.all([
    getPref('shell.winKey'),
    getPref('windows.autoMaximize'),
    getPref('dock.enabled'),
  ])
  await shell.setKeyboardHook(winKey)
  // Keep the speakers awake through quiet passages (see sound_fx.rs).
  const [keepAwake, keepLevel] = await Promise.all([getPref('sound.keepAwake'), getPref('sound.keepAwakeLevel')])
  void invoke('speaker_keepalive_set', { enabled: keepAwake, level: keepLevel }).catch(() => {})
  void restoreSoundMode()
  await syncHotCorners()
  // First run: start with Windows, like a real shell. Only seeded once, so
  // turning it off in Settings sticks.
  if ((await getTaskbarPref('shell.autostartSeeded').catch(() => null)) !== 'true') {
    await shell.setAutostart(true).catch((err) => console.error('[shell] autostart', err))
    await setTaskbarPref('shell.autostartSeeded', 'true')
  }
  if (autoMax) await setWindowWatcherEnabled(true)
  if (!dockEnabled) await deactivateShell()
}

/** Hot-corner polling only runs while at least one corner does something. */
export async function syncHotCorners(): Promise<void> {
  if (!inTauri) return
  const actions = await Promise.all(CORNER_KEYS.map((k) => getPref(k)))
  await shell.setHotCorners(actions.some((a) => a !== 'none'))
}


/** Puts your saved sound mode back (Equalizer APO keeps its own file, but this repairs it if anything changed it). */
async function restoreSoundMode(): Promise<void> {
  try {
    const status = await invoke<{ installed: boolean; preset: string | null }>('sound_fx_status')
    if (!status.installed) return
    const [preset, strength, custom] = await Promise.all([getPref('sound.preset'), getPref('sound.strength'), getPref('sound.custom')])
    if (status.preset === preset) return
    const eq: CustomEq = parseCustomEq(custom)
    await applySoundMode(preset, strength, eq)
  } catch {
    /* Equalizer APO missing or read-only: the panel explains it */
  }
}
