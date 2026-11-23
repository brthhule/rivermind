import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// base './' so the built site works from any static host or subfolder
export default defineConfig({
  base: './',
  plugins: [react()],
  worker: { format: 'es' },
})
