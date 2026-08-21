import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/theme.css'
import App from './app/App'
import { ThemeProvider } from './app/ThemeProvider'
import { WallpaperProvider } from './app/WallpaperProvider'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <WallpaperProvider>
        <App />
      </WallpaperProvider>
    </ThemeProvider>
  </StrictMode>,
)
