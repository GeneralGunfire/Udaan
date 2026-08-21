import { createContext, useContext } from 'react'

export interface WallpaperContextValue {
  wallpaperId: string
  setWallpaperId: (id: string) => void
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
