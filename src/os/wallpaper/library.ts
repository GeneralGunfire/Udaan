import { useCallback, useEffect, useState } from 'react'
import { convertFileSrc, invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

/** The wallpaper library as the engine reports it (`wallpaper_library`). */
export interface Item {
  id: string
  path: string
  name: string
  width: number
  height: number
  bytes: number
  aspect: 'ultrawide' | 'wide' | 'standard' | 'portrait'
  tone: 'dark' | 'light'
}

export interface Pack {
  id: string
  name: string
  keywords: string[]
  manual: string[]
  count: number
  builtin: boolean
}

export type Mode = { mode: 'off' } | { mode: 'interval'; minutes: number } | { mode: 'on-login' } | { mode: 'day-night'; day_from: number; night_from: number }

export interface Rotation {
  mode: Mode
  order: 'shuffle' | 'sequential'
  packId: string | null
  fitScreen: boolean
}

export interface FitSpec {
  mode: 'fill' | 'fit'
  fx: number | null
  fy: number | null
  zoom: number
}

export interface Library {
  items: Item[]
  packs: Pack[]
  unplaced: string[]
  current: string | null
  rotation: Rotation
  folders: string[]
  fits: Record<string, FitSpec>
}

export function useWallpaperLibrary() {
  const [lib, setLib] = useState<Library | null>(null)
  const refresh = useCallback(() => void invoke<Library>('wallpaper_library').then(setLib, () => {}), [])
  useEffect(() => {
    refresh()
    const un = listen('wallpaper://changed', refresh)
    return () => void un.then((fn) => fn())
  }, [refresh])
  return { lib, refresh }
}

const thumbs = new Map<string, string>()

/** A small picture for a grid, made by the engine and cached. */
export async function thumbFor(path: string, width = 360): Promise<string> {
  const key = `${path}|${width}`
  const hit = thumbs.get(key)
  if (hit) return hit
  const out = convertFileSrc(await invoke<string>('wallpaper_thumb', { path, maxWidth: width }))
  thumbs.set(key, out)
  return out
}
