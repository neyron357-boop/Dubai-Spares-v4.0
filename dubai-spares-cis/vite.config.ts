import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      // Это решает проблему, о которой написал DigitalOcean
      external: [], 
    },
  },
  optimizeDeps: {
    // Принудительно включаем zustand в сборку
    include: ['zustand', '@supabase/supabase-js'],
  },
});
