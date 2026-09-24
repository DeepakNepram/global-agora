/**
 * Placeholder for the API Worker (Prompt 2.3: the columnar payload endpoint).
 * The ingest Worker is in workers/ingest/. Service keys live in Workers and
 * never in the client.
 */
export default {
  fetch(_request: Request): Response {
    return new Response('Global Agora API — not implemented yet', {
      status: 501,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  },
};
