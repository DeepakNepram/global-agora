/**
 * Cloudflare Worker entry: cron ingest + API edge.
 *
 * Phase 2 fills this in (GDELT pull every 15 minutes, dedupe, heat scoring, and
 * the columnar payload endpoint). Service keys live here and never in the client.
 *
 * This stub typechecks against the app tsconfig; it gets its own tsconfig and
 * @cloudflare/workers-types when the real handler lands.
 */
export default {
  fetch(_request: Request): Response {
    return new Response('Global Agora API — not implemented yet', {
      status: 501,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  },
};
