import { useCallback, useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { getTaskbarPref, setTaskbarPref } from '@/integrations/taskbar-prefs/client'
import { launchApp, launchAppByExeName } from '@/integrations/installed-apps/client'
import { isAppId, type AppId } from './registry'
import { openApp, useShell } from './shell'

const PREF_KEY = 'quickstarts'

/** A rectangle in monitor work-area fractions, matching the Rust `Zone`. */
export interface Zone {
  x: number
  y: number
  w: number
  h: number
}

export interface QuickstartEntry {
  /** A Udaan app id, or an external launch target. */
  kind: 'udaan' | 'external'
  /** AppId for 'udaan'; an exe name, path or URL for 'external'. */
  ref: string
  /** Shown in the editor and the grid picker. */
  label: string
  /** Where to place it once open. Omitted means "leave where it opens".
   * Only honoured for Udaan windows — external programs are launched but
   * not positioned, since they create their window on their own schedule. */
  zone?: Zone
}

export interface Quickstart {
  id: string
  name: string
  entries: QuickstartEntry[]
}

function parse(raw: string | null): Quickstart[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as Quickstart[]) : []
  } catch {
    return []
  }
}

export async function loadQuickstarts(): Promise<Quickstart[]> {
  return parse(await getTaskbarPref(PREF_KEY).catch(() => null))
}

export async function saveQuickstarts(list: Quickstart[]): Promise<void> {
  await setTaskbarPref(PREF_KEY, JSON.stringify(list))
  // Desktop icons and any open editor live in other windows, so the change
  // has to be announced rather than relying on shared React state.
  window.dispatchEvent(new CustomEvent('udaan:quickstarts-changed'))
}

/** Reactive view of the saved quickstarts, kept in step across windows. */
export function useQuickstarts(): { quickstarts: Quickstart[]; reload: () => void } {
  const [quickstarts, setQuickstarts] = useState<Quickstart[]>([])

  const reload = useCallback(() => {
    void loadQuickstarts().then(setQuickstarts)
  }, [])

  useEffect(() => {
    reload()
    const onChange = () => reload()
    window.addEventListener('udaan:quickstarts-changed', onChange)
    return () => window.removeEventListener('udaan:quickstarts-changed', onChange)
  }, [reload])

  return { quickstarts, reload }
}

/** How long to wait for a just-opened Udaan window to exist before giving up
 * on positioning it. Opening is fast, but not instantaneous. */
const WINDOW_WAIT_MS = 4000
const POLL_MS = 100

/** Resolves with the handle of a window for `appId` that was not already open. */
async function waitForWindow(appId: AppId, knownBefore: Set<number>): Promise<number | null> {
  const deadline = Date.now() + WINDOW_WAIT_MS
  while (Date.now() < deadline) {
    const fresh = useShell
      .getState()
      .windows.find((w) => w.appId === appId && !knownBefore.has(w.handle))
    if (fresh) return fresh.handle
    await new Promise((r) => setTimeout(r, POLL_MS))
  }
  return null
}

/**
 * Opens every app in a quickstart, then snaps the Udaan ones into their zones.
 *
 * Windows are opened one at a time rather than all at once: each needs to be
 * identified in the snapshot before the next opens, otherwise two windows of
 * the same app can't be told apart and the wrong one gets positioned.
 */
export async function runQuickstart(qs: Quickstart): Promise<void> {
  for (const entry of qs.entries) {
    if (entry.kind === 'external') {
      // A bare exe name resolves via the Windows App Paths registry key;
      // anything with a scheme or a path separator is handed over as-is.
      const target = entry.ref
      const promise = /^[a-z][a-z0-9+.-]+:|[\\/]/i.test(target)
        ? launchApp(target)
        : launchAppByExeName(target)
      await promise.catch((err) => console.error(`[quickstart] ${entry.label} failed to launch:`, err))
      continue
    }

    if (!isAppId(entry.ref)) continue
    const before = new Set(useShell.getState().windows.map((w) => w.handle))
    await openApp(entry.ref).catch((err) => console.error(`[quickstart] ${entry.label} failed to open:`, err))

    if (!entry.zone) continue
    const handle = await waitForWindow(entry.ref, before)
    if (handle === null) continue
    await invoke('shell_snap_window', { handle, zone: entry.zone }).catch((err) =>
      console.error(`[quickstart] couldn't place ${entry.label}:`, err),
    )
  }
}
