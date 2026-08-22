import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/theme.css'
import App from './app/App'
import { ThemeProvider } from './app/ThemeProvider'
import { WallpaperProvider } from './app/WallpaperProvider'
import { SplashScreen } from './features/splash/SplashScreen'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <WallpaperProvider>
        <SplashScreen>
          <App />
        </SplashScreen>
      </WallpaperProvider>
    </ThemeProvider>
  </StrictMode>,
)
