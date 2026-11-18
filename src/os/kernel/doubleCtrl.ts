import { emit } from '@tauri-apps/api/event'
import { getPref, onPrefChanged } from './prefs'

/**
 * Double-tap Ctrl, detected inside a Udaan window.
 *
 * The 3D switcher is opened by a double-tap of Ctrl, normally detected by a
 * low-level keyboard hook in Rust (shell/mod.rs) that sees every key in the
 * system. That has proven unreliable exactly when one of Udaan's own windows
 * has focus — the desktop and every Udaan app — while working in VS Code and
 * other programs, which is where you most need a switcher to just work.
 *
 * A Udaan window receives its own key events directly, so this detects the
 * same gesture from them and asks for the switcher itself. It does not
 * replace the hook: when the hook also fires, the launcher ignores the
 * second request (see LauncherWindow), so the two can never cancel out.
 *
 * The rules match the hook's on purpose, so ordinary Ctrl shortcuts and
 * Ctrl+click never trigger it:
 *   - each tap is short (held under 220 ms),
 *   - the two taps are close together (under 350 ms apart),
 *   - nothing else is touched in between: no other key, no mouse button,
 *     no Shift / Alt / Win.
 */

const MAX_HOLD_MS = 220
/** Longest pause between the two taps. Settings → Window Switcher changes it. */
let MAX_GAP_MS = 350
let ENABLED = true

export function installDoubleCtrl(): void {
  void getPref('switcher.ctrlGapMs').then((v) => (MAX_GAP_MS = v))
  void getPref('switcher.ctrl').then((v) => (ENABLED = v))
  void onPrefChanged((key, value) => {
    if (key === 'switcher.ctrlGapMs') MAX_GAP_MS = value as number
    else if (key === 'switcher.ctrl') ENABLED = value as boolean
  })
  let pressedAt = 0
  /** The current press was spoiled by another key, a click or a modifier. */
  let dirty = false
  /** Time the first tap was released, while waiting for its partner. */
  let firstUpAt = 0

  const spoil = () => {
    dirty = true
    firstUpAt = 0
  }

  window.addEventListener(
    'keydown',
    (e) => {
      if (e.key !== 'Control') return spoil()
      // Auto-repeat of a held Ctrl is not a fresh press.
      if (e.repeat) return
      const t = performance.now()
      pressedAt = t
      dirty = e.shiftKey || e.altKey || e.metaKey
      if (firstUpAt && (dirty || t - firstUpAt > MAX_GAP_MS)) firstUpAt = 0
    },
    true,
  )

  window.addEventListener(
    'keyup',
    (e) => {
      if (e.key !== 'Control') return
      const t = performance.now()
      const clean = !dirty && t - pressedAt <= MAX_HOLD_MS
      if (!clean) {
        firstUpAt = 0
        return
      }
      if (firstUpAt && pressedAt - firstUpAt <= MAX_GAP_MS) {
        firstUpAt = 0
        if (ENABLED) void emit('shell://hotkey', { id: 'switcher-ctrl' })
      } else {
        firstUpAt = t
      }
    },
    true,
  )

  // A click is Ctrl+click, a selection or a drag — never a tap. Capture phase
  // so a handler that stops propagation cannot hide it from us.
  window.addEventListener('pointerdown', spoil, true)
  window.addEventListener('wheel', spoil, { capture: true, passive: true })
  // Focus leaving mid-gesture (Alt+Tab, a dialog) cancels it.
  window.addEventListener('blur', () => {
    dirty = true
    firstUpAt = 0
  })
}
