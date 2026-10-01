import react from '@vitejs/plugin-react';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'offline-assets',
      generateBundle(_options, bundle) {
        const files = Object.keys(bundle)
          .filter((path) => /\.(?:js|css|woff2?|png|svg)$/.test(path))
          .sort();
        this.emitFile({
          type: 'asset',
          fileName: 'offline-assets.json',
          source: JSON.stringify(files),
        });
        const version = createHash('sha256').update(files.join(',')).digest('hex').slice(0, 12);
        const worker = readFileSync('public/sw.js', 'utf8').replace(
          'dubai-spares-local-v13',
          `dubai-spares-local-v13-${version}`,
        );
        this.emitFile({ type: 'asset', fileName: 'sw.js', source: worker });
      },
    },
  ],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          if (id.includes('lucide-react')) return 'icons-vendor';
          if (id.includes('react')) return 'react-vendor';
          return 'vendor';
        },
      },
    },
  },
});
