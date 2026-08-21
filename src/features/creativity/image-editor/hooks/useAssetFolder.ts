import { useCallback, useEffect, useState } from 'react'
import { pickAssetFolder, scanAssetFolder, type AssetEntry } from '@/integrations/asset-library'

const STORAGE_KEY = 'udaan.image-editor.asset-folder'

/** Local image asset library backed by a user-chosen folder — same pattern as the DJ Board's track library. */
export function useAssetFolder() {
  const [folderPath, setFolderPath] = useState<string | null>(() =>
    localStorage.getItem(STORAGE_KEY),
  )
  const [assets, setAssets] = useState<AssetEntry[]>([])
  const [loading, setLoading] = useState(false)

  const rescan = useCallback(async (path: string) => {
    setLoading(true)
    try {
      const found = await scanAssetFolder(path)
      setAssets(found.filter((a) => a.kind === 'image'))
    } catch (err) {
      console.error('Failed to scan asset folder', err)
      setAssets([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (folderPath) rescan(folderPath)
  }, [folderPath, rescan])

  const pickFolder = useCallback(async () => {
    const chosen = await pickAssetFolder()
    if (!chosen) return
    localStorage.setItem(STORAGE_KEY, chosen)
    setFolderPath(chosen)
  }, [])

  return { folderPath, assets, loading, pickFolder }
}
