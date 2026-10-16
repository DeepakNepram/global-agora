/**
 * What the database decides on: the OpenAI categories flagged, and Google's
 * Toxic confidence. The decision itself, with its tunable thresholds, is
 * private.moderation_verdict() in supabase/migrations/20261017100000.
 */
import { toxicConfidence, type GoogleModeration } from './googleText.ts';
import { type OpenAIModeration } from './openai.ts';

export interface ModerationSignals {
  /** OpenAI categories flagged, sorted. Any one removes the post. */
  readonly flagged: readonly string[];
  /** Google's Toxic confidence, 0 to 1. */
  readonly toxicity: number;
}

export function moderationSignals(
  openai: OpenAIModeration,
  google: GoogleModeration,
): ModerationSignals {
  const result = openai.results[0];
  const flagged = Object.entries(result.categories)
    .filter(([, isFlagged]) => isFlagged)
    .map(([category]) => category)
    .sort();
  // Flagged overall with no category named: still removed (fail closed),
  // under a name no setting spares from a strike.
  if (result.flagged && flagged.length === 0) flagged.push('unspecified');
  return { flagged, toxicity: toxicConfidence(google) };
}
