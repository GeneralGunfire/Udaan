import { useEffect, type ReactNode } from 'react'
import { MotionConfig, MotionGlobalConfig } from 'framer-motion'
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
  return <MotionConfig reducedMotion={off ? 'always' : 'never'} transition={off ? { duration: 0 } : undefined}>{children}</MotionConfig>
}
