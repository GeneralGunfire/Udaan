import { useEffect } from 'react'

const SHORTCUT = 'CommandOrControl+Shift+V'

/**
 * Registers a global OS-level hotkey (works even when the window isn't focused) that calls
 * `onTrigger`. Only active inside the Tauri shell — no-ops in a plain browser (`pnpm dev`).
 * Unregisters on unmount so re-mounting (e.g. HMR) doesn't throw "already registered".
 */
export function useClipboardShortcut(onTrigger: () => void) {
  useEffect(() => {
    if (!('__TAURI_INTERNALS__' in window)) return

    let unregistered = false
    let registeredShortcut: string | null = null

    import('@tauri-apps/plugin-global-shortcut')
      .then(async ({ register }) => {
        if (unregistered) return
        try {
          await register(SHORTCUT, (event) => {
            if (event.state === 'Pressed') onTrigger()
          })
          registeredShortcut = SHORTCUT
        } catch (err) {
          console.error('Failed to register clipboard history shortcut:', err)
        }
      })
      .catch((err) => console.error('Global shortcut plugin unavailable:', err))

    return () => {
      unregistered = true
      if (!registeredShortcut) return
      import('@tauri-apps/plugin-global-shortcut')
        .then(({ unregister }) => unregister(registeredShortcut!))
        .catch(() => {})
    }
  }, [onTrigger])
}

export { SHORTCUT as CLIPBOARD_SHORTCUT_LABEL }
