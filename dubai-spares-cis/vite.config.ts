import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  preview: {
    allowedHosts: [
      'dubai-spares-cis-ay24a.ondigitalocean.app',
      '.ondigitalocean.app'
    ]
  }
})
