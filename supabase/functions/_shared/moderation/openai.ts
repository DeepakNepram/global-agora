/**
 * OpenAI's moderation endpoint (free to call with any API key). The whole
 * reply is kept: Prompt 4.3 stores the full score object in posts.mod_scores.
 *
 * Plain TypeScript with fetch only, so the Edge Function (Deno) and the
 * repo's tests (Node) run the same code.
 */
import { ProviderError, type ProviderCall, readJson } from './provider.ts';

export const OPENAI_MODERATION_MODEL = 'omni-moderation-latest';
export const OPENAI_BASE_URL = 'https://api.openai.com';

export interface OpenAIModerationResult {
  readonly flagged: boolean;
  readonly categories: Readonly<Record<string, boolean>>;
  readonly category_scores: Readonly<Record<string, number>>;
}

/** The reply as OpenAI sent it, checked for the fields the decision reads. */
export interface OpenAIModeration {
  readonly id?: string;
  readonly model: string;
  readonly results: readonly [OpenAIModerationResult, ...OpenAIModerationResult[]];
}

function isRecordOf(value: unknown, type: 'boolean' | 'number'): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((entry) => typeof entry === type)
  );
}

export function parseOpenAIModeration(json: unknown): OpenAIModeration {
  const reply = json as Partial<OpenAIModeration> | null;
  const first = Array.isArray(reply?.results) ? (reply.results[0] as unknown) : undefined;
  const result = first as Partial<OpenAIModerationResult> | undefined;
  if (
    typeof reply?.model !== 'string' ||
    typeof result?.flagged !== 'boolean' ||
    !isRecordOf(result.categories, 'boolean') ||
    !isRecordOf(result.category_scores, 'number')
  ) {
    throw new ProviderError('openai', 'unexpected reply');
  }
  return reply as OpenAIModeration;
}

export async function checkOpenAI(text: string, call: ProviderCall): Promise<OpenAIModeration> {
  const response = await call
    .fetch(`${call.baseUrl ?? OPENAI_BASE_URL}/v1/moderations`, {
      method: 'POST',
      headers: { authorization: `Bearer ${call.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: OPENAI_MODERATION_MODEL, input: text }),
      signal: call.signal ?? null,
    })
    .catch((error: unknown) => {
      throw new ProviderError('openai', error instanceof Error ? error.name : 'network');
    });
  return parseOpenAIModeration(await readJson('openai', response));
}
