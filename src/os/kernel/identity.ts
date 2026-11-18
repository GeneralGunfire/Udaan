import { usePref } from './prefs'

/** Who the user is on Start and the lock screen: the name and picture chosen in Settings, else the Windows user. */
export function useIdentity(systemName: string): { name: string; avatar: string } {
  const [name] = usePref('profile.name')
  const [avatar] = usePref('profile.avatar')
  return { name: name.trim() || systemName, avatar }
}

/** A round picture, or the initial letter when there is none. */
export function pictureOf(avatar: string): string | null {
  return avatar.startsWith('data:image/') ? avatar : null
}
