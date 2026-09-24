/**
 * Which country an outlet publishes from, for the heat score's source
 * diversity. GDELT's domain list covers ~99% of generic-TLD rows (measured on
 * an hour of the English feed); country-code TLDs answer for themselves.
 */

/**
 * Two-letter TLDs sold worldwide as brands (.tv, .io, .co…), which say nothing
 * about where an outlet is. Domains under these stay in the generated list.
 */
export const VANITY_TLDS: ReadonlySet<string> = new Set([
  'ai',
  'am',
  'as',
  'cc',
  'co',
  'eu',
  'fm',
  'gg',
  'io',
  'la',
  'ly',
  'me',
  'nu',
  'tk',
  'to',
  'tv',
  'ws',
]);

/** ccTLDs that are not their country's ISO code. */
const TLD_TO_ISO: Readonly<Record<string, string>> = { uk: 'GB' };

export type OutletCountry = (domain: string) => string | null;

/**
 * Builds the lookup from the generated `domain<TAB>ISO` list. The Map is built
 * on first use: about 90k entries, done once per isolate.
 */
export function createOutletCountries(listText: string): OutletCountry {
  let table: Map<string, string> | null = null;

  const load = (): Map<string, string> => {
    if (table !== null) return table;
    table = new Map();
    for (const line of listText.split('\n')) {
      const tab = line.indexOf('\t');
      if (tab > 0) table.set(line.slice(0, tab), line.slice(tab + 1));
    }
    return table;
  };

  return (rawDomain: string): string | null => {
    const domain = rawDomain.toLowerCase().replace(/^www\./, '');
    const known = load();
    // english.news.cn -> news.cn -> cn: the most specific listed name wins.
    let name = domain;
    for (;;) {
      const hit = known.get(name);
      if (hit !== undefined) return hit;
      const dot = name.indexOf('.');
      if (dot < 0 || name.indexOf('.', dot + 1) < 0) break;
      name = name.slice(dot + 1);
    }

    const tld = domain.slice(domain.lastIndexOf('.') + 1);
    if (tld.length !== 2 || VANITY_TLDS.has(tld)) return null;
    return TLD_TO_ISO[tld] ?? tld.toUpperCase();
  };
}
