/// <reference types="vitest/config" />
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type ServerOptions } from 'vite';

const DEV_KEY = '.cert/dev-key.pem';
const DEV_CERT = '.cert/dev-cert.pem';

/**
 * `vite --mode lan` serves HTTPS so a phone on the same Wi-Fi can load the dev
 * build: Android Chrome upgrades a bare LAN address to https and refuses plain
 * http. The certificate is self-signed and gitignored; generate it with
 *
 *   openssl req -x509 -newkey rsa:2048 -nodes -sha256 -days 30 \
 *     -keyout .cert/dev-key.pem -out .cert/dev-cert.pem \
 *     -subj "/CN=Global Agora dev server" \
 *     -addext "subjectAltName=IP:<laptop LAN IP>,IP:127.0.0.1,DNS:localhost"
 *
 * Every other mode stays plain http on localhost.
 */
function lanServer(mode: string): ServerOptions {
  if (mode !== 'lan') return {};
  if (!existsSync(DEV_KEY) || !existsSync(DEV_CERT)) {
    throw new Error(`--mode lan needs ${DEV_KEY} and ${DEV_CERT}; see vite.config.ts`);
  }
  return { host: '0.0.0.0', https: { key: readFileSync(DEV_KEY), cert: readFileSync(DEV_CERT) } };
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: lanServer(mode),
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
}));
