/** The screensavers you can pick. `canvas` ones are drawn by CinemaCanvas; the others are made of your wallpaper or plain type. */
export const SAVERS = [
  { id: 'clock', name: 'Clock', blurb: 'Your wallpaper with a clock face.' },
  { id: 'veil', name: 'Veil', blurb: 'Your wallpaper, softly frosted, with the time.' },
  { id: 'reel', name: 'Reel', blurb: 'A slow tour through your wallpapers.' },
  { id: 'aurora', name: 'Aurora', blurb: 'Ribbons of light drifting like northern lights.' },
  { id: 'flow', name: 'Currents', blurb: 'Light carried along an invisible current.' },
  { id: 'daylight', name: 'Daylight', blurb: 'A soft gradient that follows the hour.' },
  { id: 'minimal', name: 'Minimal', blurb: 'Black, with a small drifting clock.' },
  { id: 'shuffle', name: 'Shuffle', blurb: 'A different one each time.' },
] as const

export type SaverId = (typeof SAVERS)[number]['id']
