import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

/** Builds the web UI for the Android app into its assets folder (npm run build:android-ui). */
export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@core': resolve(__dirname, 'src/core'),
      '@': resolve(__dirname, 'src/renderer/src')
    }
  },
  build: {
    outDir: resolve(__dirname, 'android/app/src/main/assets/ui'),
    emptyOutDir: true,
    target: 'es2022',
    rollupOptions: { input: resolve(__dirname, 'src/renderer/android.html') }
  }
})
