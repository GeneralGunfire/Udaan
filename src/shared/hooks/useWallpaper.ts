import { createContext, useContext } from 'react'

export interface WallpaperContextValue {
  wallpaperId: string
  setWallpaperId: (id: string) => void
  /** Goes up every time the engine announces a change, even to the same picture (its fit was edited). */
  revision: number
}

export const WallpaperContext = createContext<WallpaperContextValue | null>(
  null,
)

export function useWallpaper(): WallpaperContextValue {
  const ctx = useContext(WallpaperContext)
  if (!ctx) {
    throw new Error('useWallpaper must be used within a WallpaperProvider')
  }
  return ctx
}
