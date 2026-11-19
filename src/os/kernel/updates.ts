import { invoke } from '@tauri-apps/api/core'
import { getVersion } from '@tauri-apps/api/app'
import { inTauri } from './shell'

/**
 * UPDATES. The website publishes one file, `site/public/latest.json`, listing the newest version and where each
 * Windows version's installer is. This checks it, and applying an update is `update_install` in Rust (download,
 * verify checksum, install over the top, restart). The person's data is never touched; see src-tauri/src/updater.rs.
 */
export const RELEASE_URL = 'https://raw.githubusercontent.com/GeneralGunfire/Udaan/master/site/public/latest.json'

export * from './updateLogic'
import { pickUpdate, type Available, type ReleaseFile } from './updateLogic'

/** Which installer this PC needs. The webview reports Windows 11 as platform version 13 and up. */
export async function windowsFlavour(): Promise<'10' | '11'> {
  const u = (navigator as Navigator & { userAgentData?: { getHighEntropyValues?: (k: string[]) => Promise<{ platformVersion?: string }> } }).userAgentData
  try {
    const d = await u?.getHighEntropyValues?.(['platformVersion'])
    return parseInt(d?.platformVersion ?? '0', 10) >= 13 ? '11' : '10'
  } catch {
    return '10'
  }
}

export async function currentVersion(): Promise<string> {
  return inTauri ? getVersion() : '0.0.0'
}

export async function checkForUpdate(): Promise<Available | null> {
  const r = await fetch(RELEASE_URL, { cache: 'no-cache' })
  if (!r.ok) throw new Error(`The update list could not be read (${r.status}).`)
  const file = (await r.json()) as ReleaseFile
  return pickUpdate(file, await currentVersion(), await windowsFlavour())
}

export function installUpdate(a: Available): Promise<void> {
  return invoke('update_install', { url: a.url, sha256: a.sha256 })
}
