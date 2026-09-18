/// <reference types="vitest/config" />
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { IncomingMessage } from 'node:http';
import { fileURLToPath, URL } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin, type ServerOptions } from 'vite';

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

/** Gitignored. Measurements from every device that loaded the dev build land here. */
const REPORT_DIR = '.bench';
const MAX_REPORT_BYTES = 16 * 1024;
const MAX_CAPTURE_BYTES = 8 * 1024 * 1024;

function readBody(request: IncomingMessage, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error(`body over ${maxBytes} bytes`));
        request.destroy();
      } else chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks)));
    request.on('error', reject);
  });
}

/**
 * Dev server only (`apply: 'serve'`): lets the dev build on a phone hand its
 * measurements back to this machine, so a phone benchmark is read from a file
 * rather than copied off a small screen.
 *
 *   POST /__bench    JSON object, appended as one line to .bench/results.jsonl
 *   POST /__capture  PNG of the canvas, written to .bench/capture-<time>.png
 *
 * File names are fixed here, never taken from the request, and bodies are capped.
 */
function devReports(): Plugin {
  return {
    name: 'agora-dev-reports',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const route = request.url?.split('?')[0];
        if (request.method !== 'POST' || (route !== '/__bench' && route !== '/__capture')) {
          next();
          return;
        }
        const isCapture = route === '/__capture';
        readBody(request, isCapture ? MAX_CAPTURE_BYTES : MAX_REPORT_BYTES)
          .then((body) => {
            mkdirSync(REPORT_DIR, { recursive: true });
            const stamp = new Date().toISOString();
            if (isCapture) {
              const file = `${REPORT_DIR}/capture-${stamp.replace(/[:.]/g, '-')}.png`;
              writeFileSync(file, body);
              server.config.logger.info(`[capture] ${file} (${body.length} bytes)`);
            } else {
              const report: unknown = JSON.parse(body.toString('utf8'));
              if (typeof report !== 'object' || report === null || Array.isArray(report)) {
                throw new Error('report must be a JSON object');
              }
              const line = JSON.stringify({ receivedAt: stamp, ...report });
              appendFileSync(`${REPORT_DIR}/results.jsonl`, `${line}\n`);
              server.config.logger.info(`[bench] ${line}`);
            }
            response.statusCode = 204;
            response.end();
          })
          .catch((error: unknown) => {
            response.statusCode = 400;
            response.end(error instanceof Error ? error.message : 'bad request');
          });
      });
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss(), devReports()],
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
