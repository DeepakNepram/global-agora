/**
 * A suggested debate: the prompt and the two side labels, held to the same
 * limits as public.discussions (20261022100000) and the console's form
 * (src/core/admin.ts; tests/admin-sql.test.ts keeps all three in step).
 */

export const PROMPT_MAX_CHARS = 200;
export const SIDE_MAX_CHARS = 40;

export interface Suggestion {
  readonly prompt: string;
  readonly sideA: string;
  readonly sideB: string;
}

/** Structured output: the model's reply must be exactly this object. */
export const SUGGESTION_SCHEMA = {
  type: 'object',
  properties: {
    prompt: { type: 'string', description: 'The debate question, one line.' },
    side_a: { type: 'string', description: 'The label for the side that answers yes.' },
    side_b: { type: 'string', description: 'The label for the side that answers no.' },
  },
  required: ['prompt', 'side_a', 'side_b'],
  additionalProperties: false,
} as const;

/** One line, single-spaced, trimmed: what the database stores. */
function oneLine(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const line = value.replace(/\s+/g, ' ').trim();
  return line === '' ? null : line;
}

/** Characters as Postgres counts them (code points), not UTF-16 units. */
const length = (value: string): number => Array.from(value).length;

/** The suggestion, or null when it would not fit the panel (the admin types instead). */
export function parseSuggestion(value: unknown): Suggestion | null {
  if (typeof value !== 'object' || value === null) return null;
  const row = value as Record<string, unknown>;
  const prompt = oneLine(row['prompt']);
  const sideA = oneLine(row['side_a']);
  const sideB = oneLine(row['side_b']);
  if (prompt === null || sideA === null || sideB === null) return null;
  if (length(prompt) > PROMPT_MAX_CHARS) return null;
  if (length(sideA) > SIDE_MAX_CHARS || length(sideB) > SIDE_MAX_CHARS) return null;
  if (sideA.toLowerCase() === sideB.toLowerCase()) return null;
  return { prompt, sideA, sideB };
}
