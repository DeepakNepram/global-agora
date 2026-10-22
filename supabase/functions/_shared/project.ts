/**
 * Whether the function serves the local stack. Local-only conveniences (the
 * public local secrets, stand-in models) are refused against anything else.
 */

/** How the local stack names itself to its functions. */
const LOCAL_HOSTS = new Set(['kong', 'localhost', '127.0.0.1', 'host.docker.internal']);

/** True for the local stack, false for a hosted project; null when `supabaseUrl` is not a URL. */
export function isLocalProject(supabaseUrl: string): boolean | null {
  try {
    return LOCAL_HOSTS.has(new URL(supabaseUrl).hostname);
  } catch {
    return null;
  }
}
