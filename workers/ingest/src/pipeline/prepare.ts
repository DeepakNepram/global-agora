/**
 * GKG rows -> the new articles of a slot: normalized, redirects followed, one
 * per URL, and none the database already has.
 */

import type { IngestDb } from '../db/service.ts';
import type { Fetch } from '../gdelt/feed.ts';
import type { GkgRecord } from '../gdelt/gkg.ts';
import { normalizeRecord, type IngestArticle, type SkipReason } from '../normalize/article.ts';
import type { OutletCountry } from '../normalize/outlets.ts';
import { isRedirector, resolveRedirect, urlKey } from '../normalize/url.ts';

const SAMPLE_URLS = 5;

export interface Prepared {
  readonly articles: IngestArticle[];
  readonly skipped: Partial<Record<SkipReason, number>>;
  /** A few skipped URLs, so a spike in one reason can be looked at. */
  readonly sampleUrls: string[];
  readonly redirectsResolved: number;
  readonly urlDuplicates: number;
  readonly knownUrls: number;
}

export interface PrepareDeps {
  readonly db: IngestDb;
  readonly fetch: Fetch;
  readonly outletCountry: OutletCountry;
  readonly redirectBudget: number;
  readonly maxAgeSec: number;
}

export async function prepareArticles(
  records: readonly GkgRecord[],
  deps: PrepareDeps,
): Promise<Prepared> {
  const skipped: Partial<Record<SkipReason, number>> = {};
  const sampleUrls: string[] = [];
  const normalized: IngestArticle[] = [];
  for (const record of records) {
    const result = normalizeRecord(record, {
      outletCountry: deps.outletCountry,
      maxAgeSec: deps.maxAgeSec,
    });
    if (result.ok) normalized.push(result.article);
    else {
      skipped[result.reason] = (skipped[result.reason] ?? 0) + 1;
      if (sampleUrls.length < SAMPLE_URLS) sampleUrls.push(result.url);
    }
  }

  // Shorteners resolve to the article, within the run's subrequest budget.
  const budget = { remaining: deps.redirectBudget };
  let redirectsResolved = 0;
  const resolved: IngestArticle[] = [];
  for (const article of normalized) {
    if (!isRedirector(article.url)) {
      resolved.push(article);
      continue;
    }
    const url = await resolveRedirect(article.url, deps.fetch, budget);
    if (url !== article.url) redirectsResolved++;
    resolved.push({ ...article, url, urlKey: urlKey(url) });
  }

  const byKey = new Map<string, IngestArticle>();
  for (const article of resolved)
    if (!byKey.has(article.urlKey)) byKey.set(article.urlKey, article);
  const unique = [...byKey.values()];
  const known = await deps.db.knownUrls(unique.map((a) => a.url));

  return {
    articles: unique.filter((a) => !known.has(a.url)),
    skipped,
    sampleUrls,
    redirectsResolved,
    urlDuplicates: resolved.length - unique.length,
    knownUrls: known.size,
  };
}
