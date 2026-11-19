import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwind from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'

// The site borrows Udaan's real icons from the app's source, which sits outside this folder. Without this the
// build ends up with two copies of React (the app's and the site's) and the page crashes. One copy, always.
const here = (p) => fileURLToPath(new URL(p, import.meta.url))
export default defineConfig({
  plugins: [react(), tailwind()],
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: { react: here('./node_modules/react'), 'react-dom': here('./node_modules/react-dom') },
  },
})
