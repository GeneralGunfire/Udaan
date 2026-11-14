/**
 * `@tauri-apps/api/core`, with an `invoke` that waits for Rust to be ready.
 *
 * vite.config.ts aliases the package's `core` entry to this file, so every
 * `import { invoke } from '@tauri-apps/api/core'` in the app lands here.
 *
 * THE BUG THIS FIXES
 * ------------------
 * Udaan's windows are declared in tauri.conf.json, so their webviews start
 * running JavaScript while Rust is still inside `setup()` opening a dozen
 * SQLite databases. A command issued in that gap hits a `State<T>` that has
 * not been `.manage()`d yet and Tauri answers "state not managed for field
 * `state` on command `…`". Nothing retried, so those first calls failed for
 * good: the dock never loaded its pins, and because its preferences failed to
 * load it fell back to the default `autoHide: true` and slid off screen.
 *
 * WHY AN ALIAS AND NOT A RUNTIME PATCH
 * ------------------------------------
 * The obvious fix is to wrap `window.__TAURI_INTERNALS__.invoke`. Tauri
 * defines that property read-only, so assigning to it throws — and a throw at
 * startup stops the app rendering at all (this was tried, and blanked every
 * window). A build-time alias cannot be frozen out from under us.
 *
 * WHY RETRYING IS SAFE
 * --------------------
 * That error is raised while Tauri extracts the command's arguments, before
 * the command body runs, so nothing has executed and running it again cannot
 * double an effect. Every other error is rethrown at once, untouched.
 *
 * The real module is imported by relative path on purpose: importing the
 * aliased specifier from here would import this file into itself.
 */
import { invoke as rawInvoke, type InvokeArgs, type InvokeOptions } from '../../../node_modules/@tauri-apps/api/core.js'

export * from '../../../node_modules/@tauri-apps/api/core.js'

const NOT_READY = /state not managed/i
const MAX_ATTEMPTS = 40

export async function invoke<T>(cmd: string, args?: InvokeArgs, options?: InvokeOptions): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await rawInvoke<T>(cmd, args, options)
    } catch (err) {
      // About twenty seconds of patience, then the real error surfaces.
      if (attempt >= MAX_ATTEMPTS || !NOT_READY.test(String(err))) throw err
      await new Promise((resolve) => setTimeout(resolve, Math.min(120 + attempt * 60, 600)))
    }
  }
}
