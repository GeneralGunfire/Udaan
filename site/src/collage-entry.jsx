// Renders the apps collage as one still frame on the warm background, for exporting the PNG.
import { createRoot } from 'react-dom/client'
import './index.css'
import AppsCollage from './AppsCollage.jsx'

createRoot(document.getElementById('root')).render(
  <div style={{ width: 1600, height: 900, background: '#f6f6ef', display: 'grid', placeItems: 'center' }}>
    <div style={{ width: 1200 }}><AppsCollage still /></div>
  </div>,
)
