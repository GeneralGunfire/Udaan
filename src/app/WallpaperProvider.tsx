import { useCallback, useEffect, useState, type PropsWithChildren } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { WallpaperContext } from '@/shared/hooks/useWallpaper'
import { isValidWallpaperId } from './wallpapers'

const STORAGE_KEY = 'udaan-wallpaper'

function readStored(): string {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored && isValidWallpaperId(stored)) return stored
  } catch {
    // localStorage can throw in a locked-down webview context.
  }
  return ''
}

const remember = (id: string) => {
  try {
    localStorage.setItem(STORAGE_KEY, id)
  } catch {
    // Best-effort persistence only.
  }
}

const inTauri = () => '__TAURI_INTERNALS__' in window

/**
 * Every window shows the same wallpaper. The ENGINE owns which one is current (it rotates them,
 * remembers them across restarts) and announces `wallpaper://changed`; this follows it. A solid
 * colour is the one choice the engine does not track, so that stays local.
 */
export function WallpaperProvider({ children }: PropsWithChildren) {
  const [wallpaperId, setWallpaperIdState] = useState<string>(readStored)

  useEffect(() => {
    const onStorage = (e: StorageEvent) => e.key === STORAGE_KEY && setWallpaperIdState(readStored())
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  useEffect(() => {
    if (!inTauri()) return
    // Start from what the engine says is current; if that picture is gone (or nothing was chosen yet),
    // take the first one in the library.
    void (async () => {
      const [id, lib] = await Promise.all([
        invoke<string | null>('wallpaper_current').catch(() => null),
        invoke<{ items: { id: string }[] }>('wallpaper_library').catch(() => null),
      ])
      const exists = !!id && (id.startsWith('color:') || !lib || lib.items.some((i) => i.id === id))
      if (id && exists && isValidWallpaperId(id)) {
        if (!readStored().startsWith('color:')) {
          setWallpaperIdState(id)
          remember(id)
        }
        return
      }
      if (readStored().startsWith('color:')) return
      const first = lib?.items[0]?.id
      if (first) void invoke('wallpaper_set', { id: first })
    })()
    const un = listen<string>('wallpaper://changed', (e) => {
      if (!isValidWallpaperId(e.payload)) return
      setWallpaperIdState(e.payload)
      remember(e.payload)
    })
    return () => void un.then((fn) => fn())
  }, [])

  const setWallpaperId = useCallback((id: string) => {
    if (id.startsWith('file:') && inTauri()) {
      void invoke('wallpaper_set', { id }).catch(() => {})
      return
    }
    setWallpaperIdState(id)
    remember(id)
  }, [])

  return <WallpaperContext.Provider value={{ wallpaperId, setWallpaperId }}>{children}</WallpaperContext.Provider>
}
