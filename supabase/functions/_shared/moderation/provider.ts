/** What every model call needs, and how one fails. */

export type ProviderName = 'openai' | 'google';

export interface ProviderCall {
  readonly apiKey: string;
  /** Local stand-ins only (db:smoke); production uses each model's own address. */
  readonly baseUrl?: string | undefined;
  readonly fetch: typeof fetch;
  readonly signal?: AbortSignal | undefined;
}

/** A model that did not answer usably. The post stays pending and is retried. */
export class ProviderError extends Error {
  readonly provider: ProviderName;

  constructor(provider: ProviderName, reason: string) {
    super(`${provider}: ${reason}`);
    this.name = 'ProviderError';
    this.provider = provider;
  }
}

export async function readJson(provider: ProviderName, response: Response): Promise<unknown> {
  if (!response.ok) throw new ProviderError(provider, `HTTP ${response.status}`);
  try {
    return await response.json();
  } catch {
    throw new ProviderError(provider, 'reply is not JSON');
  }
}
