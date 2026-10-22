/**
 * What a debate suggestion is written from: public.admin_story_brief(),
 * read as the admin who asked, so the database refuses anyone else before
 * any model is called. Headline, snippet, place and outlets' headlines;
 * never post text or anything about a reader.
 */

export interface OutletHeadline {
  readonly outlet: string | null;
  readonly headline: string;
}

export interface StoryBrief {
  readonly title: string;
  readonly summary: string | null;
  readonly placeName: string | null;
  readonly countryCode: string | null;
  readonly publishedAt: string | null;
  readonly headlines: readonly OutletHeadline[];
}

export type BriefResult =
  | { readonly kind: 'ok'; readonly brief: StoryBrief }
  | { readonly kind: 'forbidden' }
  | { readonly kind: 'missing' }
  | { readonly kind: 'failed'; readonly reason: string };

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value : null;

export function parseBrief(json: unknown): StoryBrief | null {
  if (typeof json !== 'object' || json === null) return null;
  const row = json as Record<string, unknown>;
  const title = text(row['title']);
  if (title === null) return null;
  const headlines: OutletHeadline[] = [];
  for (const entry of Array.isArray(row['headlines']) ? (row['headlines'] as unknown[]) : []) {
    const item = (typeof entry === 'object' && entry !== null ? entry : {}) as Record<
      string,
      unknown
    >;
    const headline = text(item['headline']);
    if (headline !== null) headlines.push({ outlet: text(item['outlet']), headline });
  }
  return {
    title,
    summary: text(row['summary']),
    placeName: text(row['place_name']),
    countryCode: text(row['country_code']),
    publishedAt: text(row['published_at']),
    headlines,
  };
}

export interface BriefSource {
  readonly supabaseUrl: string;
  readonly anonKey: string;
  readonly fetch: typeof fetch;
}

/** Calls the database as the caller (their own Authorization header). */
export async function readBrief(
  source: BriefSource,
  authorization: string,
  storyId: string,
): Promise<BriefResult> {
  let response: Response;
  try {
    response = await source.fetch(`${source.supabaseUrl}/rest/v1/rpc/admin_story_brief`, {
      method: 'POST',
      headers: {
        apikey: source.anonKey,
        authorization,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ p_story: storyId }),
    });
  } catch (error) {
    return { kind: 'failed', reason: error instanceof Error ? error.name : 'network' };
  }
  let json: unknown = null;
  try {
    json = await response.json();
  } catch {
    // A body that is not JSON is judged by its status alone.
  }
  const code = (json as { code?: unknown } | null)?.code;
  if (response.status === 401 || response.status === 403 || code === '42501') {
    return { kind: 'forbidden' };
  }
  if (code === 'P0002') return { kind: 'missing' };
  if (!response.ok) return { kind: 'failed', reason: `HTTP ${response.status}` };
  const brief = parseBrief(json);
  return brief === null ? { kind: 'failed', reason: 'unexpected brief' } : { kind: 'ok', brief };
}
