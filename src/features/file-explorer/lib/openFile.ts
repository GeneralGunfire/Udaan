import { openWithSystem } from '@/integrations/file-explorer/client'
import { getDefaultHandler, launchApp, openFileWith } from '@/integrations/installed-apps/client'
import { findOfficeFallback } from './officeHandlers'
import type { FileEntry } from '@/integrations/file-explorer/types'

export class NoHandlerError extends Error {}

/**
 * Opens a file with a real installed app: asks the OS for its registered
 * default handler first, then falls back to the Microsoft apps already
 * detected for the Launchpad (Office extensions only), then finally just
 * hands the path to the OS shell (`openWithSystem`) as a last resort —
 * which is itself how the OS would open a file with no explicit
 * association (e.g. prompting the user or using a shell default).
 *
 * Throws `NoHandlerError` only when every path genuinely has nothing to
 * offer, so the caller can show a clear "no app found" message instead of
 * a raw OS error.
 */
export async function openFileWithBestHandler(entry: FileEntry): Promise<void> {
  const extension = entry.extension.toLowerCase()

  const defaultHandler = await getDefaultHandler(extension).catch(() => null)
  if (defaultHandler) {
    await openFileWith(defaultHandler.exePath, entry.path)
    return
  }

  const officeFallback = await findOfficeFallback(extension).catch(() => null)
  if (officeFallback) {
    await launchApp(officeFallback.path)
    // Office apps launched bare (no default handler) don't take a file
    // argument reliably across versions — open the file through the OS
    // shell right after, which now has a running Office instance to hand
    // it to via its own file association plumbing.
    await openWithSystem(entry.path)
    return
  }

  try {
    await openWithSystem(entry.path)
  } catch (err) {
    throw new NoHandlerError(
      `No app is set up to open .${extension || '(no extension)'} files on this system.`,
    )
  }
}
