import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { resolve } from 'node:path';

import type { Connect, Logger, Plugin } from 'vite';

import { COLD_START_PROBE } from './coldStartProbe.ts';

/** Gitignored. Measurements from every device that loaded the page land here. */
const REPORT_DIR = '.bench';
const MAX_REPORT_BYTES = 16 * 1024;
const MAX_CAPTURE_BYTES = 8 * 1024 * 1024;

function readBody(request: IncomingMessage, maxBytes: number): Promise<Buffer> {
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error(`body over ${maxBytes} bytes`));
        request.destroy();
      } else chunks.push(chunk);
    });
    request.on('end', () => resolveBody(Buffer.concat(chunks)));
    request.on('error', reject);
  });
}

/**
 *   POST /__bench    JSON object, appended as one line to .bench/results.jsonl
 *   POST /__capture  PNG of the canvas, written to .bench/capture-<time>.png
 */
function reportRoutes(logger: Logger): Connect.NextHandleFunction {
  return (request, response, next) => {
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
          logger.info(`[capture] ${file} (${body.length} bytes)`);
        } else {
          const report: unknown = JSON.parse(body.toString('utf8'));
          if (typeof report !== 'object' || report === null || Array.isArray(report)) {
            throw new Error('report must be a JSON object');
          }
          const line = JSON.stringify({ receivedAt: stamp, ...report });
          appendFileSync(`${REPORT_DIR}/results.jsonl`, `${line}\n`);
          logger.info(`[bench] ${line}`);
        }
        response.statusCode = 204;
        response.end();
      })
      .catch((error: unknown) => {
        response.statusCode = 400;
        response.end(error instanceof Error ? error.message : 'bad request');
      });
  };
}

/**
 *   GET /?coldstart  the built index.html with the cold-start probe injected as
 *                    the first script in <head>, uncacheable
 */
function coldStartPage(indexHtml: string): Connect.NextHandleFunction {
  return (request: IncomingMessage, response: ServerResponse, next) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    if (request.method !== 'GET' || url.pathname !== '/' || !url.searchParams.has('coldstart')) {
      next();
      return;
    }
    const html = readFileSync(indexHtml, 'utf8').replace(
      '<head>',
      `<head><script>${COLD_START_PROBE}</script>`,
    );
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store');
    response.end(html);
  };
}

/**
 * Local measurement routes for `vite` and `vite preview` (`apply: 'serve'`
 * covers both; `vite build` never loads this plugin). A phone on the LAN hands
 * its numbers back to this machine, so they are read from a file rather than
 * copied off a small screen. File names are fixed here, never taken from the
 * request, and bodies are capped.
 *
 * The cold-start page is preview-only: it has to measure the production build.
 */
export function devReports(): Plugin {
  return {
    name: 'agora-dev-reports',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(reportRoutes(server.config.logger));
    },
    configurePreviewServer(server) {
      const { root, build } = server.config;
      server.middlewares.use(reportRoutes(server.config.logger));
      server.middlewares.use(coldStartPage(resolve(root, build.outDir, 'index.html')));
    },
  };
}
