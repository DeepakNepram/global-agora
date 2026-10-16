/**
 * The local badge (Prompt 4.4): the coarse text a reader may choose to show on
 * one post, such as "Bengaluru area, India".
 *
 * Its only input is what Cloudflare says about the network a request came
 * from: a city and a country, worked out from the IP address. There is no
 * other source and no fallback (CLAUDE.md #5: no GPS, no coordinates). The
 * API Worker builds the label at post time; the app shows the same text
 * before posting, from the Worker's /api/local-badge.
 *
 * The database checks the same shape (supabase/migrations/…_local_badge.sql).
 */

/** posts.region_label's CHECK, in code points as Postgres counts them. */
export const REGION_LABEL_MAX = 64;

/** Cloudflare's view of a request's network. Nothing else is ever read. */
export interface NetworkPlace {
  readonly city: string | null;
  readonly country: string | null;
}

/**
 * Not a country: Tor (T1), ISO's user-assigned codes (AA, QM-QZ, XA-XZ, ZZ,
 * so Cloudflare's XX "unknown" too), and the groupings ICU also names (EU,
 * EZ, UN, and AP, Asia-Pacific).
 */
const NOT_A_COUNTRY = /^(T1|AA|Q[M-Z]|X[A-Z]|ZZ|EU|EZ|UN|AP)$/;

/** Where the standard English names read awkwardly on a badge. */
const SHORT_NAMES: Readonly<Record<string, string>> = {
  HK: 'Hong Kong',
  MO: 'Macao',
  MM: 'Myanmar',
  CD: 'DR Congo',
  CG: 'Republic of the Congo',
};

let names: Intl.DisplayNames | null | undefined;

function displayNames(): Intl.DisplayNames | null {
  if (names === undefined) {
    try {
      names = new Intl.DisplayNames(['en'], { type: 'region', fallback: 'none' });
    } catch {
      names = null; // a runtime without the data: city only
    }
  }
  return names;
}

/** One line of plain text: no control or direction-override characters. */
function clean(raw: string | null): string {
  return (raw ?? '')
    .normalize('NFC')
    .replace(/[\p{Cc}\u200E\u200F\u202A-\u202E\u2066-\u2069]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** "India" for "IN"; null when Cloudflare does not know, or names no country. */
export function countryName(code: string | null): string | null {
  const upper = (code ?? '').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(upper) || NOT_A_COUNTRY.test(upper)) return null;
  const short = SHORT_NAMES[upper];
  if (short !== undefined) return short;
  const name = displayNames()?.of(upper);
  return name === undefined || name === upper ? null : clean(name) || null;
}

/** The database's CHECK: "<city> area[, <country>]", one line, no decimals. */
function fits(label: string): boolean {
  return [...label].length <= REGION_LABEL_MAX && !/[0-9][.,][0-9]/.test(label);
}

/**
 * "Bengaluru area, India"; "Bengaluru area" without a known country (or when
 * the country would not fit); null without a city. Null means no badge.
 */
export function regionLabel(place: NetworkPlace): string | null {
  const city = clean(place.city);
  if (city === '') return null;
  const area = `${city} area`;
  const country = countryName(place.country);
  const candidates = country === null ? [area] : [`${area}, ${country}`, area];
  return candidates.find(fits) ?? null;
}

/** What /api/local-badge answers: a label, or why there is none. */
export type LocalBadgeReply =
  { readonly label: string } | { readonly label: null; readonly reason: 'no-city' | 'unavailable' };

export function parseLocalBadgeReply(value: unknown): LocalBadgeReply | null {
  if (typeof value !== 'object' || value === null) return null;
  const { label, reason } = value as { label?: unknown; reason?: unknown };
  if (typeof label === 'string' && label !== '') return { label };
  if (label === null && (reason === 'no-city' || reason === 'unavailable')) {
    return { label: null, reason };
  }
  return null;
}
