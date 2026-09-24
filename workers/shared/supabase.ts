/**
 * Auth headers for PostgREST, shared by every Worker that calls Supabase.
 *
 * New-style keys (`sb_publishable_…`, `sb_secret_…`) go in `apikey` alone; a
 * legacy JWT key is also sent as the bearer token, which is how PostgREST
 * picks the role.
 */
export function supabaseAuthHeaders(key: string): Record<string, string> {
  return key.startsWith('sb_') ? { apikey: key } : { apikey: key, authorization: `Bearer ${key}` };
}

/** The REST root of a project URL, without a trailing slash. */
export function restBase(url: string): string {
  return `${url.replace(/\/+$/, '')}/rest/v1`;
}
