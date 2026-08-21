import { useCallback, useState } from 'react'

export interface LocalProfile {
  name: string
  /** Freeform notes/preferences — a single text block is enough for a v1, no schema needed yet. */
  preferences: string
}

const STORAGE_KEY = 'udaan.account.profile'

const DEFAULT_PROFILE: LocalProfile = { name: '', preferences: '' }

function readProfile(): LocalProfile {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_PROFILE
    const parsed = JSON.parse(raw)
    return {
      name: typeof parsed.name === 'string' ? parsed.name : '',
      preferences: typeof parsed.preferences === 'string' ? parsed.preferences : '',
    }
  } catch {
    return DEFAULT_PROFILE
  }
}

/**
 * Local-only profile store, backed by localStorage. This is a single-user
 * local app — there is no auth, no account server, no sync. "Profile" here
 * just means a display name and freeform preference notes, saved on this
 * machine only.
 */
export function useLocalProfile() {
  const [profile, setProfile] = useState<LocalProfile>(() => readProfile())
  const [savedAt, setSavedAt] = useState<Date | null>(null)

  const save = useCallback((next: LocalProfile) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    setProfile(next)
    setSavedAt(new Date())
  }, [])

  return { profile, save, savedAt }
}
