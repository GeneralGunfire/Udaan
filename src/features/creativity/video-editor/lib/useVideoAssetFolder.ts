import { useCallback, useEffect, useState } from 'react'
import {
  pickAssetFolder,
  pickAssetFiles,
  scanAssetFolder,
  type AssetEntry,
} from '@/integrations/asset-library'

const FOLDER_STORAGE_KEY = 'udaan.video-editor.asset-folder'
const ASSETS_STORAGE_KEY = 'udaan.video-editor.assets'

function loadStoredAssets(): AssetEntry[] {
  try {
    const raw = localStorage.getItem(ASSETS_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function dedupeByPath(assets: AssetEntry[]): AssetEntry[] {
  const seen = new Map<string, AssetEntry>()
  for (const a of assets) seen.set(a.path, a)
  return Array.from(seen.values())
}

/** Local video asset library — a persistent, growing list, added to by folder scan or individual/multi-file pick. */
export function useVideoAssetFolder() {
  const [folderPath, setFolderPath] = useState<string | null>(() =>
    localStorage.getItem(FOLDER_STORAGE_KEY),
  )
  const [assets, setAssets] = useState<AssetEntry[]>(() => loadStoredAssets())
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    localStorage.setItem(ASSETS_STORAGE_KEY, JSON.stringify(assets))
  }, [assets])

  const addAssets = useCallback((found: AssetEntry[]) => {
    setAssets((prev) => dedupeByPath([...prev, ...found.filter((a) => a.kind === 'video')]))
  }, [])

  const pickFolder = useCallback(async () => {
    const chosen = await pickAssetFolder()
    if (!chosen) return
    localStorage.setItem(FOLDER_STORAGE_KEY, chosen)
    setFolderPath(chosen)
    setLoading(true)
    try {
      const found = await scanAssetFolder(chosen)
      addAssets(found)
    } catch (err) {
      console.error('Failed to scan video asset folder', err)
    } finally {
      setLoading(false)
    }
  }, [addAssets])

  const pickFiles = useCallback(
    async (multiple: boolean) => {
      setLoading(true)
      try {
        const found = await pickAssetFiles(multiple)
        addAssets(found)
      } catch (err) {
        console.error('Failed to pick video file(s)', err)
      } finally {
        setLoading(false)
      }
    },
    [addAssets],
  )

  return { folderPath, assets, loading, pickFolder, pickFiles }
}
