import { SplashScreen } from '@/features/splash/SplashScreen'
import { Desktop } from './Desktop'

/** The desktop window: the boot splash, then the desktop itself. */
export function DesktopRoot() {
  return (
    <SplashScreen>
      <Desktop />
    </SplashScreen>
  )
}
