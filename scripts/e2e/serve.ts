/**
 * The browser checks' server (Prompt 5.2): the e2e build as Cloudflare Pages
 * serves a deploy, and the news API answered from the checks' fixtures, so
 * Playwright and Lighthouse run against production headers and a day's
 * stories without a Worker or a database.
 *
 *   node --experimental-strip-types scripts/e2e/serve.ts [--port 4180]
 *                                   [--dir dist-e2e] [--connect <origin,…>]
 *
 * - public/_headers (copied into the build) is applied as Pages applies it,
 *   with --connect's origins added to the CSP's connect-src: the e2e build's
 *   stand-in Supabase, which only the checks' routes answer.
 * - Paths with no file get index.html, as Pages does for an app without a
 *   404 page; /admin and /privacy route themselves.
 * - Text is Brotli- or gzip-compressed as the client asks, as at the edge.
 * - /api answers from tests/e2e/fixtures/news.ts; textures are a tiny image.
 */

import { readFile, stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { brotliCompressSync, gzipSync } from 'node:zlib';

import {
  nodesPayload,
  outletsIndex,
  storyDetail,
  tinyTexture,
} from '../../tests/e2e/fixtures/news.ts';

function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(name);
  return at >= 0 ? (process.argv[at + 1] ?? fallback) : fallback;
}

const PORT = Number(arg('--port', '4180'));
const ROOT = resolve(arg('--dir', 'dist-e2e'));
const EXTRA_CONNECT = arg('--connect', '').split(',').filter(Boolean);

const TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.map': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
};
const COMPRESSIBLE = /^(text\/|application\/(json|manifest\+json)|image\/svg)/;

interface HeaderRule {
  readonly pattern: RegExp;
  readonly headers: readonly (readonly [string, string])[];
}

/** Cloudflare's _headers: a path pattern on its own line, its headers indented below it. */
function parseHeaders(text: string): HeaderRule[] {
  const rules: { pattern: RegExp; headers: [string, string][] }[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === '' || line.trim().startsWith('#')) continue;
    if (!/^\s/.test(line)) {
      const source = line
        .trim()
        .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*');
      rules.push({ pattern: new RegExp(`^${source}$`), headers: [] });
      continue;
    }
    const colon = line.indexOf(':');
    const rule = rules.at(-1);
    if (colon > 0 && rule)
      rule.headers.push([line.slice(0, colon).trim(), line.slice(colon + 1).trim()]);
  }
  return rules;
}

function withConnect(name: string, value: string): string {
  if (name.toLowerCase() !== 'content-security-policy' || EXTRA_CONNECT.length === 0) return value;
  return value.replace(
    /connect-src ([^;]*)/,
    (_match, sources: string) => `connect-src ${sources} ${EXTRA_CONNECT.join(' ')}`,
  );
}

const rules = parseHeaders(await readFile(join(ROOT, '_headers'), 'utf8').catch(() => ''));
const compressed = new Map<string, { br: Buffer; gzip: Buffer }>();
const texture = await tinyTexture();

function pageHeaders(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rule of rules) {
    if (!rule.pattern.test(path)) continue;
    for (const [name, value] of rule.headers) out[name] = withConnect(name, value);
  }
  return out;
}

function send(
  request: IncomingMessage,
  response: ServerResponse,
  status: number,
  type: string,
  body: Buffer,
  headers: Record<string, string>,
  cacheKey: string | null,
): void {
  const accepts = request.headers['accept-encoding'] ?? '';
  const out: Record<string, string> = { 'content-type': type, vary: 'accept-encoding', ...headers };
  let payload = body;
  if (COMPRESSIBLE.test(type) && body.length > 512 && /\b(br|gzip)\b/.test(String(accepts))) {
    const cached = cacheKey ? compressed.get(cacheKey) : undefined;
    const both = cached ?? { br: brotliCompressSync(body), gzip: gzipSync(body) };
    if (cacheKey && !cached) compressed.set(cacheKey, both);
    const br = /\bbr\b/.test(String(accepts));
    payload = br ? both.br : both.gzip;
    out['content-encoding'] = br ? 'br' : 'gzip';
  }
  out['content-length'] = String(payload.length);
  response.writeHead(status, out);
  response.end(request.method === 'HEAD' ? undefined : payload);
}

function json(
  request: IncomingMessage,
  response: ServerResponse,
  status: number,
  value: unknown,
): void {
  send(
    request,
    response,
    status,
    'application/json',
    Buffer.from(JSON.stringify(value)),
    { 'cache-control': 'no-store' },
    null,
  );
}

function api(request: IncomingMessage, response: ServerResponse, url: URL): void {
  const path = url.pathname;
  if (path === '/api/event') {
    response.writeHead(request.method === 'POST' ? 204 : 405, { 'cache-control': 'no-store' });
    response.end();
    return;
  }
  if (path === '/api/health') return json(request, response, 200, { ok: true });
  if (path === '/api/nodes') return json(request, response, 200, nodesPayload());
  if (path === '/api/outlets') return json(request, response, 200, outletsIndex());
  if (path === '/api/local-badge')
    return json(request, response, 200, { label: null, reason: 'no-city' });
  const outlet = /^\/api\/outlets\/([^/]+)$/.exec(path);
  if (outlet)
    return json(request, response, 200, { outlet: decodeURIComponent(outlet[1] ?? ''), ids: [] });
  const story = /^\/api\/story\/(\d+)$/.exec(path);
  if (story) {
    const detail = storyDetail(Number(story[1]));
    return detail
      ? json(request, response, 200, detail)
      : json(request, response, 404, { error: 'no such story' });
  }
  return json(request, response, 404, { error: 'not found' });
}

/** A file in the build, and a key that changes when it does (a rebuild under a running server). */
async function file(path: string): Promise<{ path: string; key: string; body: Buffer } | null> {
  const full = normalize(join(ROOT, path));
  if (!full.startsWith(ROOT)) return null;
  try {
    const info = await stat(full);
    if (!info.isFile()) return null;
    return { path: full, key: `${full}:${info.mtimeMs}:${info.size}`, body: await readFile(full) };
  } catch {
    return null;
  }
}

createServer((request, response) => {
  const url = new URL(request.url ?? '/', `http://localhost:${PORT}`);
  void (async () => {
    if (url.pathname.startsWith('/api/')) return api(request, response, url);
    const headers = pageHeaders(url.pathname);
    if (url.pathname.startsWith('/textures/')) {
      return send(request, response, 200, 'image/png', texture, headers, null);
    }
    const found =
      (url.pathname === '/' ? null : await file(decodeURIComponent(url.pathname))) ??
      (extname(url.pathname) === '' ? await file('index.html') : null);
    if (!found)
      return send(
        request,
        response,
        404,
        'text/plain; charset=utf-8',
        Buffer.from('not found'),
        headers,
        null,
      );
    const type = TYPES[extname(found.path)] ?? 'application/octet-stream';
    return send(request, response, 200, type, found.body, headers, found.key);
  })().catch((error: unknown) => {
    response.writeHead(500);
    response.end(String(error));
  });
}).listen(PORT, () => console.log(`e2e server: ${ROOT} on http://localhost:${PORT}`));
