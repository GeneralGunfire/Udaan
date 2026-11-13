import { detectApps } from '@/integrations/installed-apps/client'
import type { DetectedApp } from '@/integrations/installed-apps/types'

/** Office extensions this app knows how to fall back to a Launchpad-detected app for. */
const OFFICE_APP_BY_EXTENSION: Record<string, string> = {
  doc: 'word',
  docx: 'word',
  xls: 'excel',
  xlsx: 'excel',
  ppt: 'powerpoint',
  pptx: 'powerpoint',
}

/**
 * Resolves an extension to one of the Microsoft apps already detected for
 * the Launchpad (same `installed_apps_detect` call, same "Microsoft" group)
 * — used only when the OS has no registered default handler for that
 * extension, so Office files still open somewhere useful on a machine
 * where file associations haven't been set.
 */
export async function findOfficeFallback(extension: string): Promise<DetectedApp | null> {
  const appId = OFFICE_APP_BY_EXTENSION[extension.toLowerCase()]
  if (!appId) return null
  const apps = await detectApps('microsoft')
  return apps.find((app) => app.id === appId) ?? null
}
