import { useCallback, useEffect, useState, type PropsWithChildren } from 'react'
import { WallpaperContext } from '@/shared/hooks/useWallpaper'
import { DEFAULT_WALLPAPER_ID, isValidWallpaperId } from './wallpapers'

const STORAGE_KEY = 'udaan-wallpaper'

function readStored(): string {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored && isValidWallpaperId(stored)) return stored
  } catch {
    // localStorage can throw in a locked-down webview context.
  }
  return DEFAULT_WALLPAPER_ID
}

/**
 * All Udaan windows share one WebView2 profile, so localStorage is shared
 * and its `storage` event keeps the desktop, launcher and Settings app in
 * sync when any of them changes the wallpaper.
 */
export function WallpaperProvider({ children }: PropsWithChildren) {
  const [wallpaperId, setWallpaperIdState] = useState<string>(readStored)

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setWallpaperIdState(readStored())
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const setWallpaperId = useCallback((id: string) => {
    setWallpaperIdState(id)
    try {
      localStorage.setItem(STORAGE_KEY, id)
    } catch {
      // Best-effort persistence only.
    }
  }, [])

  return <WallpaperContext.Provider value={{ wallpaperId, setWallpaperId }}>{children}</WallpaperContext.Provider>
}
