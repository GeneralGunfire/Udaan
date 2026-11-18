import { createContext, useContext } from 'react'
import type { Service } from './services'
import type { Title, View } from './types'

/** What every TV page can do, provided by the shell so pages never reach into the hosted-app machinery. */
export interface TvCtx {
  openTitle: (t: Title) => void
  /** Open a streaming app on a search for this title, and mark it as being watched. */
  watch: (s: Service, t: Title) => void
  openApp: (s: Service, url?: string) => void
  go: (v: View) => void
  say: (text: string) => void
  running: string[]
  loadingId: string | null
  /** Installed apps that can search for a title; the chosen one is `chosen`. */
  searchable: Service[]
  chosen: Service
}

export const Ctx = createContext<TvCtx | null>(null)
export const useTv = () => {
  const c = useContext(Ctx)
  if (!c) throw new Error('TV context missing')
  return c
}
