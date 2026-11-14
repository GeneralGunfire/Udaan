/**
 * Dock geometry, in logical px. Deliberately constant: the dock is always
 * the same size and in the same place, whatever the screen, so it never
 * grows, shrinks or jumps.
 */
export const DOCK = {
  iconSize: 38,
  slot: 50,
  gap: 6,
  pad: 7,
  margin: 5,
} as const

export function dockMetrics() {
  const barHeight = DOCK.slot + DOCK.pad * 2 + 2
  return {
    ...DOCK,
    barHeight,
    // Room for the hover lift and launch bounce above the bar.
    // Room above the bar for the hover lift and the name label.
    windowHeight: barHeight + 56,
    reserve: barHeight + DOCK.margin * 2,
  }
}

export type DockMetrics = ReturnType<typeof dockMetrics>

/** What the desktop keeps clear at the bottom of the screen. */
export function dockZone() {
  return dockMetrics().reserve
}
