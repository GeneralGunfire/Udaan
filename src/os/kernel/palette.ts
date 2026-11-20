/**
 * App palettes: the surface tones every Udaan app and panel stands on.
 *
 * Udaan has two colour layers that were never tuned to each other (the `--p-*` ladder the app panels use and
 * the `--u-*` materials Settings, menus and cards use), so different apps showed different blacks. A palette
 * sets BOTH layers from one list of tones, so a chosen palette makes every app agree.
 *
 * `default` is deliberately absent from the generated CSS: with it chosen nothing is overridden and Udaan
 * looks exactly as it always has. Palettes only act in the dark theme; the light theme keeps its own tones.
 */

export interface PaletteDef {
  id: string
  name: string
  blurb: string
  /** Surface ladder, darkest to lightest: canvas, app ground, panel, raised, input, hairline. */
  tones: [string, string, string, string, string, string]
}

export const DEFAULT_PALETTE = 'default'

export const PALETTES: PaletteDef[] = [
  { id: 'default', name: 'Udaan', blurb: 'The original: true black grounds with graphite cards.', tones: ['#000000', '#000000', '#0a0a0a', '#161616', '#1e1e1e', '#262626'] },
  { id: 'graphite', name: 'Graphite', blurb: 'One even charcoal everywhere. Settings and apps match.', tones: ['#101012', '#141416', '#1b1b1e', '#232327', '#2b2b30', '#34343a'] },
  { id: 'midnight', name: 'Midnight', blurb: 'Deep blue-black with a cool edge.', tones: ['#080b12', '#0d121c', '#131a27', '#1a2233', '#222c40', '#2c3a56'] },
  { id: 'ocean', name: 'Ocean', blurb: 'Dark teal, calm and slightly green.', tones: ['#061010', '#0b1818', '#112121', '#182c2c', '#213838', '#2b4a4a'] },
  { id: 'forest', name: 'Forest', blurb: 'Deep green-black, easy on the eyes.', tones: ['#070d0a', '#0c1511', '#121e19', '#192922', '#21352c', '#2a4337'] },
  { id: 'plum', name: 'Plum', blurb: 'Dark violet with a soft, warm glow of colour.', tones: ['#0c0810', '#120d18', '#1a1322', '#231b2d', '#2d243a', '#3a3049'] },
  { id: 'ember', name: 'Ember', blurb: 'Warm brown-black, like dark wood.', tones: ['#0d0907', '#150f0c', '#1e1612', '#281e18', '#332822', '#43352c'] },
  { id: 'pitch', name: 'Pitch black', blurb: 'Pure black for OLED screens, with the faintest steps.', tones: ['#000000', '#000000', '#050505', '#101010', '#181818', '#222222'] },
]

const hex = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i
function rgb(c: string): string {
  const m = hex.exec(c)
  return m ? `${parseInt(m[1], 16)} ${parseInt(m[2], 16)} ${parseInt(m[3], 16)}` : '0 0 0'
}

/** The CSS for every palette except the default. Written once into the page as a style element. */
export function paletteCss(): string {
  return PALETTES.filter((p) => p.id !== DEFAULT_PALETTE)
    .map((p) => {
      const [canvas, ground, panel, raised, input, line] = p.tones
      return (
        `html[data-palette='${p.id}']:not([data-theme='light']){` +
        `--p-bg-canvas:${canvas};--p-bg-editor:${ground};--p-bg-panel:${panel};--p-bg-raised:${raised};--p-bg-input:${input};` +
        `--p-border:${line};--p-border-light:${line};` +
        `--u-m-solid:${panel};--u-m-solid-hi:${raised};` +
        `--u-m-glass:rgb(${rgb(panel)} / 72%);--u-m-glass-hi:rgb(${rgb(raised)} / 78%);}`
      )
    })
    .join('\n')
}

/** Puts the palette rules in the page (once) and selects the palette. Safe to call repeatedly. */
export function applyPalette(id: string): void {
  const root = document.documentElement
  if (!document.getElementById('udaan-palettes')) {
    const el = document.createElement('style')
    el.id = 'udaan-palettes'
    el.textContent = paletteCss()
    document.head.appendChild(el)
  }
  const known = PALETTES.some((p) => p.id === id)
  if (!known || id === DEFAULT_PALETTE) root.removeAttribute('data-palette')
  else root.setAttribute('data-palette', id)
}
