import { useEffect, type ReactNode } from 'react'
import { MotionConfig, MotionGlobalConfig } from 'framer-motion'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { usePref } from './prefs'
import { installUiScale } from './uiScale'

installUiScale()

/** Applies Settings → "Animations off" to every window: no motion, no transitions. */
export function MotionRoot({ children }: { children: ReactNode }) {
  const [off] = usePref('motion.off')
  useEffect(() => {
    document.documentElement.classList.toggle('no-motion', off)
    // Every Framer Motion animation jumps straight to its end state.
    MotionGlobalConfig.skipAnimations = off
  }, [off])
  // The engine's memory tier (tight / normal / roomy) is mirrored on <html data-tier>, so any surface
  // can scale its own effects down when the PC is short of memory, with a plain CSS selector.
  useEffect(() => {
    if (!('__TAURI_INTERNALS__' in window)) return
    const set = (tier: string) => document.documentElement.setAttribute('data-tier', tier)
    void invoke<{ tier: string }>('engine_tier').then((r) => set(r.tier), () => {})
    const un = listen<string>('engine://tier', (e) => set(e.payload))
    return () => void un.then((fn) => fn())
  }, [])
  return <MotionConfig reducedMotion={off ? 'always' : 'never'} transition={off ? { duration: 0 } : undefined}>{children}</MotionConfig>
}
