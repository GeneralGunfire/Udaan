import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

// https://vite.dev/config/
// Tauri expects a fixed dev server port and a strict host check.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  // AgriTrack's map is behind a lazy import, so Vite doesn't see
  // maplibre-gl or deck.gl during its startup dependency scan — it only
  // discovers them the moment the map is first opened. Optimizing a
  // ~1.7MB dependency graph at that point forces a full page reload
  // mid-import, which discards the pending dynamic import: the module
  // never finishes loading, its effects never run, and nothing throws.
  // Declaring them here pre-bundles them at server start instead.
  optimizeDeps: {
    include: [
      'maplibre-gl',
      '@deck.gl/core',
      '@deck.gl/mapbox',
      '@deck.gl/layers',
      '@deck.gl/aggregation-layers',
    ],
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },
})
