import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      external: [], // Оставляем пустым, чтобы Vite сам упаковал все библиотеки
    },
  },
  optimizeDeps: {
    include: ['zustand', '@supabase/supabase-js'], // Принудительно включаем важные пакеты
  },
});
