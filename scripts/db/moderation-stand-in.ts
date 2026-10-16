/**
 * A local stand-in for the moderation models (Prompt 4.3). The moderate-post
 * function sends any model it has no key for here (MODERATION_STAND_IN_URL,
 * local only), and this replays that model's reply to a known sample from
 * supabase/functions/_shared/moderation/fixtures.json. Text it does not know
 * gets a clean reply, so ordinary local posts are approved.
 *
 * Every reply it serves is a recorded or hand-written one, never a model's
 * judgement: db:smoke says which models were stood in for.
 */
import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage } from 'node:http';

import { MODERATION_SAMPLES } from '../../supabase/functions/_shared/moderation/samples.ts';

export const STAND_IN_PORT = 54399;

type Model = 'openai' | 'google';

interface Fixtures {
  readonly [sample: string]: { readonly [M in Model]: { readonly reply: unknown } };
}

export const FIXTURES_PATH = new URL(
  '../../supabase/functions/_shared/moderation/fixtures.json',
  import.meta.url,
);

function fixtures(): Fixtures {
  return JSON.parse(readFileSync(FIXTURES_PATH, 'utf8')) as Fixtures;
}

const CLEAN: { readonly [M in Model]: unknown } = {
  openai: {
    id: 'modr-stand-in',
    model: 'stand-in',
    results: [{ flagged: false, categories: {}, category_scores: {} }],
  },
  google: { moderationCategories: [{ name: 'Toxic', confidence: 0.01 }] },
};

function replyFor(model: Model, text: string): unknown {
  const sample = MODERATION_SAMPLES.find((candidate) => candidate.text === text);
  return sample === undefined ? CLEAN[model] : fixtures()[sample.id]?.[model].reply;
}

async function readBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}

export interface StandIn {
  /** Requests served, per model. */
  readonly served: { [M in Model]: number };
  close(): Promise<void>;
}

export async function startStandIn(port: number = STAND_IN_PORT): Promise<StandIn> {
  const served = { openai: 0, google: 0 };
  const server = createServer((request, response) => {
    void (async () => {
      const body = (await readBody(request).catch(() => null)) as {
        input?: string;
        document?: { content?: string };
      } | null;
      let model: Model | null = null;
      let text: string | undefined;
      if (request.url === '/v1/moderations') {
        model = 'openai';
        text = body?.input;
      } else if (request.url === '/v1/documents:moderateText') {
        model = 'google';
        text = body?.document?.content;
      }
      if (model === null || typeof text !== 'string') {
        response.writeHead(404).end();
        return;
      }
      served[model] += 1;
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(replyFor(model, text)));
    })();
  });
  // Loopback only: Docker Desktop forwards its host address (192.168.65.254,
  // supabase/functions/.env) here, and nothing else can reach it.
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  return {
    served,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
