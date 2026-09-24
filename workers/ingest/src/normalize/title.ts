/**
 * Headlines from GKG page titles.
 *
 * Real titles carry HTML entities (`Ping&#x2011;Pong`), site names
 * (`… | NewsRadio 1450/1370 WKIP`, `Xinhua News | …`), and sometimes nothing
 * but the site name (`7 News Belize`, 16 different pages in one slot).
 */

export const MAX_HEADLINE_LENGTH = 300;

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  apos: "'",
  gt: '>',
  hellip: '…',
  laquo: '«',
  ldquo: '“',
  lsquo: '‘',
  lt: '<',
  mdash: '—',
  nbsp: ' ',
  ndash: '–',
  quot: '"',
  raquo: '»',
  rdquo: '”',
  rsquo: '’',
};

/** Decodes numeric and common named entities; unknown names are left as written. */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, body: string) => {
    if (body.startsWith('#')) {
      const code =
        body[1] === 'x' || body[1] === 'X'
          ? parseInt(body.slice(2), 16)
          : parseInt(body.slice(1), 10);
      return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)
        ? String.fromCodePoint(code)
        : match;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? match;
  });
}

/** Lowercase, accent-free words: what similarity and keys are computed on. */
export function normalizeTitle(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/['’‘]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function squash(text: string): string {
  return normalizeTitle(text).replace(/ /g, '');
}

/** "7newsbelize" for 7newsbelize.com; "iheart" for wrak.iheart.com. */
function siteLabel(domain: string): string {
  const parts = domain
    .toLowerCase()
    .replace(/^www\./, '')
    .split('.');
  // Skip second-level labels such as co.uk and com.au.
  const index = parts.length >= 3 && /^(co|com|net|org|gov|ac)$/.test(parts.at(-2) ?? '') ? -3 : -2;
  return squash(parts.at(index) ?? parts[0] ?? '');
}

function wordCount(text: string): number {
  return normalizeTitle(text).split(' ').filter(Boolean).length;
}

/**
 * Removes the outlet's name from a title. Pipes almost always separate a site
 * name, on either side, so the longest pipe segment is the headline. A dash is
 * only cut when what follows is the outlet itself: plenty of headlines contain
 * a dash ("Didcot - Man in his 50s to face trial").
 */
export function stripSiteName(title: string, domain: string): string {
  let text = title;
  const pipes = text.split(/\s+\|\s+/);
  if (pipes.length > 1) {
    text = pipes.reduce((longest, part) => (part.length > longest.length ? part : longest), '');
  }

  const label = siteLabel(domain);
  const dash = /\s+[-–—]\s+([^-–—]{2,60})$/.exec(text);
  if (dash?.[1] !== undefined && label.length >= 3) {
    const tail = squash(dash[1]);
    if (tail !== '' && (tail.includes(label) || label.includes(tail))) {
      text = text.slice(0, dash.index);
    }
  }
  return text.trim();
}

/** A title that is just the site's name ("7 News Belize" on 7newsbelize.com). */
export function isSiteName(title: string, domain: string): boolean {
  const label = siteLabel(domain);
  return label !== '' && squash(title) === label;
}

/** Wire digests list many stories at once and would glue unrelated events together. */
export function isDigest(title: string): boolean {
  return (
    /\b(news|world) (summary|in brief|digest)\b/i.test(title) ||
    /^(morning|evening) briefing\b/i.test(title)
  );
}

export type TitleVerdict =
  | { readonly ok: true; readonly headline: string; readonly normalized: string }
  | { readonly ok: false; readonly reason: 'no_title' | 'site_name' | 'short_title' | 'digest' };

/** A display headline, or why the row has none worth showing. */
export function cleanTitle(raw: string | null, domain: string): TitleVerdict {
  if (raw === null) return { ok: false, reason: 'no_title' };
  const decoded = decodeEntities(raw)
    .replace(/\p{Cc}/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (decoded === '') return { ok: false, reason: 'no_title' };
  if (isSiteName(decoded, domain)) return { ok: false, reason: 'site_name' };

  const stripped = stripSiteName(decoded, domain);
  if (isDigest(stripped)) return { ok: false, reason: 'digest' };
  if (wordCount(stripped) < 3 || stripped.length < 12) return { ok: false, reason: 'short_title' };

  const headline =
    stripped.length <= MAX_HEADLINE_LENGTH
      ? stripped
      : `${stripped.slice(0, MAX_HEADLINE_LENGTH - 1).replace(/\s+\S*$/, '')}…`;
  return { ok: true, headline, normalized: normalizeTitle(headline) };
}
