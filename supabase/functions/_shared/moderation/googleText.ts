/**
 * Google Cloud Natural Language text moderation, in Perspective's place
 * (Perspective takes no new users and ends in 2026; the owner's call). Its
 * Toxic confidence is the toxicity the thresholds apply to. The other
 * categories (Insult, Derogatory, Violent, War & Conflict...) are kept for
 * moderators but decide nothing: news debates touch war and death all day.
 */
import { ProviderError, type ProviderCall, readJson } from './provider.ts';

export const GOOGLE_TEXT_BASE_URL = 'https://language.googleapis.com';

export interface GoogleModerationCategory {
  readonly name: string;
  readonly confidence: number;
}

/** The reply as Google sent it, checked for the fields the decision reads. */
export interface GoogleModeration {
  readonly moderationCategories: readonly GoogleModerationCategory[];
}

export function parseGoogleModeration(json: unknown): GoogleModeration {
  const reply = json as Partial<GoogleModeration> | null;
  const categories = reply?.moderationCategories;
  if (
    !Array.isArray(categories) ||
    !categories.every(
      (category: Partial<GoogleModerationCategory> | null) =>
        typeof category?.name === 'string' && typeof category.confidence === 'number',
    )
  ) {
    throw new ProviderError('google', 'unexpected reply');
  }
  return reply as GoogleModeration;
}

/** Toxic's confidence, 0 to 1. A reply without it cannot be decided on. */
export function toxicConfidence(moderation: GoogleModeration): number {
  const toxic = moderation.moderationCategories.find((category) => category.name === 'Toxic');
  if (toxic === undefined || !(toxic.confidence >= 0 && toxic.confidence <= 1)) {
    throw new ProviderError('google', 'no Toxic confidence');
  }
  return toxic.confidence;
}

export async function checkGoogleText(text: string, call: ProviderCall): Promise<GoogleModeration> {
  const response = await call
    .fetch(`${call.baseUrl ?? GOOGLE_TEXT_BASE_URL}/v1/documents:moderateText`, {
      method: 'POST',
      // The key goes in a header, not the URL, so it stays out of request logs.
      headers: { 'x-goog-api-key': call.apiKey, 'content-type': 'application/json' },
      body: JSON.stringify({ document: { type: 'PLAIN_TEXT', content: text } }),
      signal: call.signal ?? null,
    })
    .catch((error: unknown) => {
      throw new ProviderError('google', error instanceof Error ? error.name : 'network');
    });
  const moderation = parseGoogleModeration(await readJson('google', response));
  toxicConfidence(moderation);
  return moderation;
}
