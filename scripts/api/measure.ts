/**
 * Measures the live payload from a running API Worker: compressed size against
 * the 150 KB budget (CLAUDE.md #1), what each column costs, and latency for
 * cache hits and 304s.
 *
 *   npm run api:measure -- [--url http://127.0.0.1:8788] [--hours 24] [--runs 50]
 *
 * Uses node:http rather than fetch, which would decode the Brotli and hide the
 * bytes actually sent. The first request is a MISS only if the Worker's cache
 * is cold. wrangler dev keeps its Cache API between restarts, so for a cold
 * build stop `npm run api:dev`, delete workers/api/.wrangler/state, restart.
 */

import { request } from 'node:http';
import { brotliCompressSync, brotliDecompressSync, constants, gzipSync } from 'node:zlib';

import { parseNodesPayload } from '../../src/core/data/payload.ts';

const BUDGET_BYTES = 150 * 1024;

function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(name);
  return at >= 0 ? (process.argv[at + 1] ?? fallback) : fallback;
}

interface Reply {
  readonly status: number;
  readonly headers: Record<string, string | string[] | undefined>;
  readonly body: Buffer;
  readonly ms: number;
}

function get(url: string, headers: Record<string, string>): Promise<Reply> {
  const started = process.hrtime.bigint();
  return new Promise((resolve, reject) => {
    request(url, { headers }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () =>
        resolve({
          status: response.statusCode ?? 0,
          headers: response.headers,
          body: Buffer.concat(chunks),
          ms: Number(process.hrtime.bigint() - started) / 1e6,
        }),
      );
    })
      .on('error', reject)
      .end();
  });
}

const kb = (bytes: number): string => `${(bytes / 1024).toFixed(1)} KB`;
const percentile = (sorted: number[], p: number): number =>
  sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? NaN;
const brotli = (json: string): number =>
  brotliCompressSync(Buffer.from(json), {
    params: {
      [constants.BROTLI_PARAM_QUALITY]: 11,
      [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_TEXT,
    },
  }).length;

const base = arg('--url', 'http://127.0.0.1:8788');
const hours = arg('--hours', '24');
const runs = Number(arg('--runs', '50'));
const url = `${base}/api/nodes?hours=${hours}`;

const BR = { 'accept-encoding': 'br' };
const first = await get(url, BR);

/**
 * A STALE first reply is followed by a background rebuild, so the payload can
 * change under the measurement. Wait until two replies in a row are HITs with
 * the same ETag, and measure that one.
 */
let settled = first;
for (let attempt = 0; attempt < 20; attempt++) {
  const next = await get(url, BR);
  const same = next.headers['etag'] === settled.headers['etag'];
  settled = next;
  if (same && next.headers['x-cache'] === 'HIT') break;
  await new Promise((resolve) => setTimeout(resolve, 500));
}
if (settled.status !== 200 || settled.headers['content-encoding'] !== 'br') {
  throw new Error(`expected a 200 with Brotli, got ${settled.status} ${settled.body.toString()}`);
}
const json = brotliDecompressSync(settled.body).toString('utf8');
const payload = parseNodesPayload(JSON.parse(json));
const etag = String(settled.headers['etag']);

const hits: number[] = [];
for (let i = 0; i < runs; i++) hits.push((await get(url, BR)).ms);
hits.sort((a, b) => a - b);
const notModified = await get(url, { ...BR, 'if-none-match': etag });
const identity = await get(url, { 'accept-encoding': 'identity' });
const served = settled.body.length;

console.log(`${url}
`);
console.log(`nodes             ${payload.nodes.id.length}`);
console.log(
  `window            ${payload.window_hours} h ending ${new Date(payload.generated_at * 1000).toISOString()}`,
);
console.log(`brotli (served)   ${served} bytes = ${kb(served)}`);
console.log(`identity          ${identity.body.length} bytes = ${kb(identity.body.length)}`);
console.log(`gzip -6 (for comparison)  ${kb(gzipSync(identity.body).length)}`);
const verdict = served <= BUDGET_BYTES ? 'UNDER' : 'OVER';
console.log(`budget            ${verdict} 150 KB by ${kb(Math.abs(BUDGET_BYTES - served))}
`);

console.log(`first request     ${first.ms.toFixed(1)} ms (${String(first.headers['x-cache'])})`);
console.log(
  `hits x${runs}          p50 ${percentile(hits, 0.5).toFixed(1)} ms, p95 ${percentile(hits, 0.95).toFixed(1)} ms`,
);
console.log(
  `If-None-Match     ${notModified.status}, ${notModified.body.length} bytes, ${notModified.ms.toFixed(1)} ms
`,
);

console.log('column costs (Brotli 11, payload without the column):');
const whole = brotli(json);
for (const column of Object.keys(payload.nodes)) {
  const without = JSON.parse(json) as { nodes: Record<string, unknown> };
  delete without.nodes[column];
  console.log(`  ${column.padEnd(5)} ${kb(whole - brotli(JSON.stringify(without))).padStart(9)}`);
}
