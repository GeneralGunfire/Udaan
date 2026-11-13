import { useEffect, useState } from 'react'
import { listDjPresets, saveDjPreset, deleteDjPreset, type DjPreset } from '@/integrations/audio-library/client'
import type { ParamValues } from '../lib/dsp'

export function useDjPresets() {
  const [presets, setPresets] = useState<DjPreset[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    listDjPresets()
      .then(setPresets)
      .catch((err) => console.error('Failed to load DJ presets:', err))
      .finally(() => setLoading(false))
  }, [])

  async function savePreset(name: string, settings: ParamValues) {
    const preset: DjPreset = { id: `dj_${Date.now()}`, name, settings, createdAt: Date.now() }
    await saveDjPreset(preset)
    setPresets((prev) => [...prev, preset])
    return preset
  }

  async function removePreset(id: string) {
    await deleteDjPreset(id)
    setPresets((prev) => prev.filter((p) => p.id !== id))
  }

  return { presets, loading, savePreset, removePreset }
}
