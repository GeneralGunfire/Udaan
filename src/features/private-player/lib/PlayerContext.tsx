import { createContext, useContext, type ReactNode } from 'react'
import { usePlayerEngine, type PlayerEngine } from '../hooks/usePlayerEngine'
import { useMusicLibrary, type MusicLibrary } from '../hooks/useMusicLibrary'

interface PlayerContextValue {
  engine: PlayerEngine
  library: MusicLibrary
}

const PlayerContext = createContext<PlayerContextValue | null>(null)

/**
 * Mounted once at App.tsx's top level, alongside the other always-on
 * providers — NOT inside PrivatePlayerView. The single HTMLAudioElement and
 * all playback state now outlive the overlay being open/closed, which is
 * what makes "keep playing after closing Private Player" possible and also
 * what fixes a real duplicate-playback bug: when the engine lived inside
 * the overlay, closing and reopening it mounted a SECOND `usePlayerEngine`
 * (a second `new Audio()`) while the first one's element — now orphaned,
 * with no component left to control it — kept playing untouched, so
 * pressing play on the reopened view started a second, overlapping track.
 *
 * The library scan + resume-last-track logic is bundled in here too (see
 * useMusicLibrary) for the same reason: it must run exactly once for the
 * app's session, not every time the overlay opens.
 */
export function PlayerProvider({ children }: { children: ReactNode }) {
  const engine = usePlayerEngine()
  const library = useMusicLibrary(engine)
  return <PlayerContext.Provider value={{ engine, library }}>{children}</PlayerContext.Provider>
}

export function usePlayer(): PlayerEngine {
  const ctx = useContext(PlayerContext)
  if (!ctx) throw new Error('usePlayer must be used within a PlayerProvider')
  return ctx.engine
}

export function useLibrary(): MusicLibrary {
  const ctx = useContext(PlayerContext)
  if (!ctx) throw new Error('useLibrary must be used within a PlayerProvider')
  return ctx.library
}
