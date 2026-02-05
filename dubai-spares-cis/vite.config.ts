import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  preview: {
    allowedHosts: [
      'dubai-spares-cis-ay24a.ondigitalocean.app'
    ]
  }
})
