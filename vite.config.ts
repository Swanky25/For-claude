import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    target: 'es2022',
    // The n-gram model is a single large module; keep it in its own chunk so the
    // shell can paint before the ~200 KB of language data finishes parsing.
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('model.generated')) return 'language-model';
          if (id.includes('node_modules/crypto-js')) return 'crypto';
          return undefined;
        },
      },
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
