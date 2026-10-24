/**
 * What error reports may say about where a reader was (Prompt 5.2): a URL's
 * path, never its query or fragment. Queries carry what is nobody else's
 * business: a sign-in's one-time ?code=, Supabase REST filters naming an
 * account, a shared view's camera.
 */

/** The URL up to its query or fragment. Works on absolute and relative URLs alike. */
export function withoutQuery(url: string): string {
  const cut = url.search(/[?#]/);
  return cut < 0 ? url : url.slice(0, cut);
}

/** The same for a value that may or may not be a URL string (a breadcrumb's data). */
export function scrubUrlValue(value: unknown): unknown {
  return typeof value === 'string' ? withoutQuery(value) : value;
}
