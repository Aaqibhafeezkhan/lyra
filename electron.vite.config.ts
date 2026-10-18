import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

const shared = resolve(__dirname, 'src/shared')
const core = resolve(__dirname, 'src/core')

export default defineConfig({
  main: {
    resolve: { alias: { '@shared': shared, '@core': core } },
    build: { externalizeDeps: true }
  },
  preload: {
    resolve: { alias: { '@shared': shared, '@core': core } },
    build: { externalizeDeps: true }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    resolve: { alias: { '@shared': shared, '@core': core, '@': resolve(__dirname, 'src/renderer/src') } },
    plugins: [react()],
    build: { rollupOptions: { input: resolve(__dirname, 'src/renderer/index.html') } }
  }
})
