import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('@supabase')) return 'supabase-vendor';
          if (id.includes('lucide-react')) return 'icons-vendor';
          if (id.includes('react')) return 'react-vendor';
          return 'vendor';
        }
      }
    }
  },
  preview: {
    allowedHosts: [
      'dubai-spares-cis-ay24a.ondigitalocean.app'
    ]
  }
})
