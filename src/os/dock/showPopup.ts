import { emit, listen } from '@tauri-apps/api/event'

/**
 * Asks the popup window to show something, and makes sure it did.
 *
 * Events are fire-and-forget: a request sent before the popup window has finished loading (the first
 * click after startup, or after the window was recycled) is simply lost, and the user sees a button that
 * does nothing. So the request is repeated until the popup answers `taskbar-popup:shown`, for up to
 * three seconds. `onGiveUp` lets the caller reset its "this one is open" state.
 */
export function showPopup(payload: unknown, onGiveUp?: () => void) {
  let acked = false
  let tries = 0
  const un = listen('taskbar-popup:shown', () => {
    acked = true
  })
  void emit('taskbar-popup:show', payload)
  const again = () => {
    if (acked) return void un.then((fn) => fn())
    if (++tries > 6) {
      void un.then((fn) => fn())
      onGiveUp?.()
      return
    }
    void emit('taskbar-popup:show', payload)
    setTimeout(again, 450)
  }
  setTimeout(again, 400)
}
