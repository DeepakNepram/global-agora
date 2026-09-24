/**
 * One GKG row -> one IngestArticle, or the reason it was skipped. Skips are
 * counted by reason and logged; nothing is silently dropped.
 */

import type { GkgRecord } from '../gdelt/gkg.ts';

import { primaryPlace, type Place } from './location.ts';
import type { OutletCountry } from './outlets.ts';
import { cleanTitle } from './title.ts';
import { canonicalUrl, urlKey } from './url.ts';

/** GDELT re-crawls old pages; seen more than this long after publishing is not news. */
export const MAX_ARTICLE_AGE_SEC = 48 * 3600;
/** Clock skew allowed on a publish time that claims to be after GDELT saw the page. */
const FUTURE_TOLERANCE_SEC = 15 * 60;
const MAX_OUTLET_LENGTH = 120;
const MAX_KEYS_PER_KIND = 24;

export interface IngestArticle {
  readonly url: string;
  /** Looser identity for de-duplication (see urlKey). */
  readonly urlKey: string;
  readonly outlet: string;
  readonly outletCountry: string | null;
  readonly headline: string;
  /** Lowercase words of the headline; what simhash and title keys use. */
  readonly normalized: string;
  readonly imageUrl: string | null;
  readonly seenAt: number;
  readonly publishedAt: number;
  readonly lang: 'en';
  /** Null when GDELT gave no coordinates: the article can still join a placed story. */
  readonly place: Place | null;
  readonly themes: ReadonlyMap<string, number>;
  readonly persons: readonly string[];
  readonly orgs: readonly string[];
  readonly tone: number | null;
}

export type SkipReason =
  'bad_url' | 'no_title' | 'site_name' | 'short_title' | 'digest' | 'stale' | 'translated';

export type Normalized =
  | { readonly ok: true; readonly article: IngestArticle }
  | { readonly ok: false; readonly reason: SkipReason; readonly url: string };

export interface NormalizeContext {
  readonly outletCountry: OutletCountry;
}

/** The page's own publish time when plausible, else when GDELT saw it. */
function publishTime(record: GkgRecord): number | 'stale' {
  const published = record.publishedAt;
  if (published === null || published > record.seenAt + FUTURE_TOLERANCE_SEC) return record.seenAt;
  if (record.seenAt - published > MAX_ARTICLE_AGE_SEC) return 'stale';
  return published;
}

export function normalizeRecord(record: GkgRecord, context: NormalizeContext): Normalized {
  const skip = (reason: SkipReason): Normalized => ({ ok: false, reason, url: record.url });

  // The English feed only; the translated feed would need a language column.
  if (record.translated) return skip('translated');

  const url = canonicalUrl(record.url);
  if (url === null) return skip('bad_url');

  const title = cleanTitle(record.title, record.domain);
  if (!title.ok) return skip(title.reason);

  const publishedAt = publishTime(record);
  if (publishedAt === 'stale') return skip('stale');

  const image = record.imageUrl === null ? null : canonicalUrl(record.imageUrl);

  return {
    ok: true,
    article: {
      url,
      urlKey: urlKey(url),
      outlet: record.domain.slice(0, MAX_OUTLET_LENGTH),
      outletCountry: context.outletCountry(record.domain),
      headline: title.headline,
      normalized: title.normalized,
      imageUrl: image,
      seenAt: record.seenAt,
      publishedAt,
      lang: 'en',
      place: primaryPlace(record.locations),
      themes: record.themes,
      persons: record.persons.slice(0, MAX_KEYS_PER_KIND),
      orgs: record.orgs.slice(0, MAX_KEYS_PER_KIND),
      tone: record.tone,
    },
  };
}
