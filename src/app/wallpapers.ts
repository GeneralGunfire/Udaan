import windowsBlue from '@/assets/wallpapers/windows-blue.jpg'
import cobaltBloom from '@/assets/wallpapers/cobalt-bloom.jpg'
import indigoWave from '@/assets/wallpapers/indigo-wave.jpg'
import navyPetals from '@/assets/wallpapers/navy-petals.jpg'
import dawnLakeCool from '@/assets/wallpapers/dawn-lake-cool.jpg'
import dawnLakeWarm from '@/assets/wallpapers/dawn-lake-warm.jpg'

export interface WallpaperDefinition {
  id: string
  label: string
  src: string
  /** Which theme this wallpaper reads best against; 'any' works in both. */
  mood: 'dark' | 'light' | 'any'
}

// Note: rainbow-ribbon.png, glass-swirl.jpg, and silver-fan.jpg were removed —
// their source resolution (1536x926, 2000x1250, 1440x900) is meaningfully
// lower than the rest of the set and reads visibly blurry full-bleed on a
// large display. Re-add only with a higher-resolution source. The two
// "Smoke"/"Mist" abstract wallpapers and "Midnight" (near-black twisty
// coil) were dropped by request — all photographic/render wallpapers now.
//
// The app's accent color is one fixed electric blue (tokens.css), not
// derived per-wallpaper — a per-wallpaper accent (tried and reverted in
// this same session) produced mismatched colors like orange bubbles on a
// blue wallpaper, which read as broken rather than intentional.
export const WALLPAPERS: WallpaperDefinition[] = [
  { id: 'windows-blue', label: 'Windows Blue', src: windowsBlue, mood: 'dark' },
  { id: 'cobalt-bloom', label: 'Cobalt', src: cobaltBloom, mood: 'dark' },
  { id: 'indigo-wave', label: 'Indigo', src: indigoWave, mood: 'dark' },
  { id: 'navy-petals', label: 'Navy', src: navyPetals, mood: 'dark' },
  {
    id: 'dawn-lake-cool',
    label: 'Dawn (cool)',
    src: dawnLakeCool,
    mood: 'light',
  },
  {
    id: 'dawn-lake-warm',
    label: 'Dawn (warm)',
    src: dawnLakeWarm,
    mood: 'light',
  },
]

export const DEFAULT_WALLPAPER_ID = 'windows-blue'

export function getWallpaper(id: string): WallpaperDefinition {
  return (
    WALLPAPERS.find((w) => w.id === id) ??
    WALLPAPERS.find((w) => w.id === DEFAULT_WALLPAPER_ID)!
  )
}
