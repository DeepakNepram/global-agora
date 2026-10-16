/**
 * The little of Deno's API the Edge Functions use, so the repo's tsc and
 * eslint can check them without a Deno install. The real types come from
 * the Supabase edge runtime when the functions run.
 */
declare namespace Deno {
  function serve(handler: (request: Request) => Response | Promise<Response>): unknown;
  const env: {
    get(name: string): string | undefined;
  };
}
