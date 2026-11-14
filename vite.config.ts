import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

// https://vite.dev/config/
// Tauri expects a fixed dev server port and a strict host check.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
      // Every `invoke` goes through a shim that retries while Rust is still
      // starting up. Exact match only, so the real `core.js` the shim itself
      // imports is untouched. See src/os/kernel/tauriCore.ts.
      { find: /^@tauri-apps\/api\/core$/, replacement: path.resolve(import.meta.dirname, './src/os/kernel/tauriCore.ts') },
      { find: '@', replacement: path.resolve(import.meta.dirname, './src') },
    ],
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    // Dev only: lets preview.html play a song from the Music folder.
    fs: { allow: [path.resolve(import.meta.dirname), path.join(process.env.USERPROFILE ?? '', 'Music')] },
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },
})
