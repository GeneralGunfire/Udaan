import { useCallback, useState, type PropsWithChildren } from 'react'
import { WallpaperContext } from '@/shared/hooks/useWallpaper'
import { DEFAULT_WALLPAPER_ID, WALLPAPERS } from './wallpapers'

const STORAGE_KEY = 'udaan-wallpaper'

function getInitialWallpaperId(): string {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored && WALLPAPERS.some((w) => w.id === stored)) return stored
  return DEFAULT_WALLPAPER_ID
}

export function WallpaperProvider({ children }: PropsWithChildren) {
  const [wallpaperId, setWallpaperIdState] = useState<string>(
    getInitialWallpaperId,
  )

  const setWallpaperId = useCallback((id: string) => {
    setWallpaperIdState(id)
    localStorage.setItem(STORAGE_KEY, id)
  }, [])

  return (
    <WallpaperContext.Provider value={{ wallpaperId, setWallpaperId }}>
      {children}
    </WallpaperContext.Provider>
  )
}
