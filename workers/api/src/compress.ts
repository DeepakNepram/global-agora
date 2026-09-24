/**
 * Brotli for the payload. Cloudflare's on-the-fly compression runs at a low
 * quality: on a real 24 h window, quality 5 is 150.0 KB (the whole budget) and
 * gzip 158 KB, while quality 11 is 131 KB. So the Worker compresses once per
 * rebuild at high quality and serves the bytes as they are.
 *
 * node:zlib is workerd's Brotli (nodejs_compat); CompressionStream has none.
 */

import { brotliCompressSync, brotliDecompressSync, constants } from 'node:zlib';

// Copied into fresh ArrayBuffers: a Response body must not be a view of
// Node's shared Buffer pool.
export function brotli(bytes: Uint8Array, quality: number): Uint8Array<ArrayBuffer> {
  const compressed = brotliCompressSync(bytes, {
    params: {
      [constants.BROTLI_PARAM_QUALITY]: quality,
      [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_TEXT,
      [constants.BROTLI_PARAM_SIZE_HINT]: bytes.length,
    },
  });
  return new Uint8Array(compressed);
}

export function unbrotli(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  return new Uint8Array(brotliDecompressSync(bytes));
}

/** True when Accept-Encoding lists br with a non-zero quality. */
export function acceptsBrotli(acceptEncoding: string | null): boolean {
  if (acceptEncoding === null) return false;
  return acceptEncoding.split(',').some((part) => {
    const [coding, ...params] = part.trim().toLowerCase().split(';');
    if (coding?.trim() !== 'br') return false;
    const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
    return q === undefined || Number(q.slice(2)) > 0;
  });
}
