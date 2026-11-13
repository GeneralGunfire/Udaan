import { invoke } from '@tauri-apps/api/core'

/**
 * Real window materials for Udaan's shell surfaces.
 *
 * Every shell surface (menu bar, dock, flyouts, widgets, toasts) is a
 * transparent OS window floating over the real desktop. A webview cannot
 * blur what is behind its own window — `backdrop-filter` only samples pixels
 * inside the same page — so the blur has to come from the compositor, which
 * owns those pixels. `shell_set_material` asks DWM for it.
 *
 * THE TINT CONTRACT
 * -----------------
 * When the compositor is really blurring, it also composites a tint of its
 * own over the result. The webview must then paint only a whisper of colour
 * on top, or the two tints stack and the surface turns to mud. So each
 * surface has two tints:
 *
 *   glass   what to paint when a real blur landed  (very light)
 *   solid   what to paint when it did not          (carries the surface alone)
 *
 * `applyMaterial` returns which one is in force, and sets a data attribute
 * on <html> so CSS can switch between them without any component knowing.
 */

export type MaterialKind = 'acrylic' | 'mica' | 'mica-alt' | 'none'

export interface MaterialApplied {
  /** The compositor is really blurring the desktop behind this window. */
  blurred: boolean
  /** The modern Windows 11 path was used — better quality than legacy blur. */
  modern: boolean
}

/**
 * Tints, as 0xAARRGGBB. The alpha is what the compositor mixes over the
 * blurred backdrop: higher means a more opaque, less see-through surface.
 *
 * These are deliberately dark-but-weak. A common mistake is a heavy tint,
 * which produces a surface that is technically blurred but looks like
 * frosted plastic; real macOS chrome lets a lot of the backdrop through and
 * recovers legibility with contrast on the text instead.
 */
const TINT = {
  dark: {
    acrylic: 0x40_18_18_1c,
    mica: 0x30_10_10_12,
    'mica-alt': 0x50_0c_0c_0e,
    none: 0,
  },
  light: {
    acrylic: 0x40_f2_f2_f5,
    mica: 0x30_fa_fa_fc,
    'mica-alt': 0x50_ee_ee_f2,
    none: 0,
  },
} as const

let current: MaterialApplied = { blurred: false, modern: false }

/** What the last `applyMaterial` call achieved, for components that need to know. */
export function materialState(): MaterialApplied {
  return current
}

/**
 * Applies a real material to this shell window.
 *
 * Safe to call on every theme change: DWM treats it as idempotent. Returns
 * `{ blurred: false }` on any failure (old Windows, no compositor, a
 * non-Tauri dev page), which is the signal for CSS to paint the opaque
 * fallback — degraded, never broken.
 */
export async function applyMaterial(kind: MaterialKind, dark: boolean, rounded = true): Promise<MaterialApplied> {
  try {
    const applied = await invoke<MaterialApplied>('shell_set_material', {
      material: kind,
      tint: TINT[dark ? 'dark' : 'light'][kind],
      dark,
      rounded,
    })
    current = applied
    // CSS reads this to choose between the glass and solid tints.
    document.documentElement.setAttribute('data-material', applied.blurred ? (applied.modern ? 'modern' : 'legacy') : 'none')
    return applied
  } catch {
    current = { blurred: false, modern: false }
    document.documentElement.setAttribute('data-material', 'none')
    return current
  }
}
