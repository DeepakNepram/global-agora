/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    // Source maps ship so Sentry can symbolicate the first Android white-screen.
    sourcemap: true,
    target: 'es2022',
  },
  test: {
    // No jsdom yet: nothing in the skeleton renders. Add it (and
    // @testing-library/react) in Phase 1 when there are components to mount.
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'tests/**/*.test.ts'],
    globals: false,
  },
});
