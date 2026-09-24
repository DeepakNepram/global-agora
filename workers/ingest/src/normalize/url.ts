/**
 * Canonical article URLs: one spelling per article, so the same page seen
 * twice (or listed with and without `:443`, as asiaone.com was on 2026-09-24)
 * becomes one row.
 */

import type { Fetch } from '../gdelt/feed.ts';

/** Query parameters that track the click and never change the page. */
const TRACKING_EXACT: ReadonlySet<string> = new Set([
  '_ga',
  '_gl',
  'cexp_id',
  'cexp_var',
  'cmp',
  'cmpid',
  'dclid',
  'fbclid',
  'gbraid',
  'gclid',
  'guccounter',
  'guce_referrer',
  'guce_referrer_sig',
  'igshid',
  'ito',
  'mc_cid',
  'mc_eid',
  'mkt_tok',
  'msclkid',
  'ncid',
  'ocid',
  'ref_src',
  's_cid',
  'smid',
  'sr_share',
  'taid',
  'wbraid',
  'xtor',
  'yclid',
]);

const TRACKING_PREFIXES = ['utm_', 'at_', 'hsa_', 'itm_', 'pk_'];

export const MAX_URL_LENGTH = 2048;

export function isTrackingParam(name: string): boolean {
  const key = name.toLowerCase();
  return TRACKING_EXACT.has(key) || TRACKING_PREFIXES.some((prefix) => key.startsWith(prefix));
}

/**
 * The URL to store and link to: http(s) only, no fragment, no default port, no
 * tracking parameters. Null for anything that is not a usable web link, since
 * these become clickable (a `javascript:` URL would be a script).
 */
export function canonicalUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username !== '' || url.password !== '') return null;

  // URL already lowercases the host and drops :443 on https and :80 on http.
  url.hash = '';
  const params = [...url.searchParams.keys()];
  // Only rewrite the query when something goes: URLSearchParams re-encodes
  // (a space becomes +), which could change what some servers return.
  if (params.some(isTrackingParam)) {
    for (const name of params) if (isTrackingParam(name)) url.searchParams.delete(name);
  }

  const result = url.toString().replace(/\?$/, '');
  return result.length <= MAX_URL_LENGTH ? result : null;
}

/**
 * The identity used for de-duplication, looser than the stored URL: http and
 * https, `www.` and a trailing slash all name the same page.
 */
export function urlKey(canonical: string): string {
  const url = new URL(canonical);
  const host = url.hostname.replace(/^www\./, '');
  const path = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, '') : '';
  return `${host}${path}${url.search}`;
}

/**
 * Hosts that only redirect. GKG URLs are the page GDELT crawled, so these are
 * rare (none in the 2026-09-24 sample), but a shortener would otherwise count
 * as a separate outlet and defeat URL de-duplication.
 */
export const REDIRECTOR_HOSTS: ReadonlySet<string> = new Set([
  'apple.news',
  'bit.ly',
  'buff.ly',
  'dlvr.it',
  'feeds.feedburner.com',
  'feedproxy.google.com',
  'flip.it',
  'ift.tt',
  'lnkd.in',
  'news.google.com',
  'ow.ly',
  't.co',
  'tinyurl.com',
  'trib.al',
]);

const MAX_HOPS = 3;

export function isRedirector(url: string): boolean {
  try {
    return REDIRECTOR_HOSTS.has(new URL(url).hostname.replace(/^www\./, ''));
  } catch {
    return false;
  }
}

/** Shared across a run so a flood of shortened links cannot spend every subrequest. */
export interface RedirectBudget {
  remaining: number;
}

/**
 * Follows a redirector to where it points, with HEAD requests and at most
 * three hops. Returns the URL unchanged when it is not a redirector, when the
 * budget is spent, or when the redirector does not answer with a redirect.
 */
export async function resolveRedirect(
  url: string,
  fetchFn: Fetch,
  budget: RedirectBudget,
): Promise<string> {
  let current = url;
  for (let hop = 0; hop < MAX_HOPS && isRedirector(current) && budget.remaining > 0; hop++) {
    budget.remaining--;
    try {
      const response = await fetchFn(current, { method: 'HEAD', redirect: 'manual' });
      const location = response.headers.get('location');
      if (response.status < 300 || response.status >= 400 || location === null) break;
      const next = canonicalUrl(new URL(location, current).toString());
      if (next === null) break;
      current = next;
    } catch {
      break;
    }
  }
  return current;
}
