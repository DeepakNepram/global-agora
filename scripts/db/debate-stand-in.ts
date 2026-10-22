/**
 * A local stand-in for Claude's Messages API (Prompt 4.6). With no
 * ANTHROPIC_API_KEY, the suggest-debate function sends its call here
 * (DEBATE_STAND_IN_URL, local only), so db:smoke runs the whole path, the
 * SDK inside the edge runtime included, before a key exists.
 *
 * Its one reply is hand-written and says so ("[stand-in]"), never a model's
 * judgement. It records each request, so the smoke can check what the
 * function sent.
 */
import { createServer, type IncomingMessage } from 'node:http';

export const DEBATE_STAND_IN_PORT = 54398;

export const STAND_IN_SUGGESTION = {
  prompt: '[stand-in] Should this go ahead?',
  side_a: 'Go ahead',
  side_b: 'Stop it',
} as const;

export interface SentRequest {
  readonly url: string;
  readonly headers: IncomingMessage['headers'];
  readonly body: Record<string, unknown>;
}

export interface DebateStandIn {
  readonly requests: SentRequest[];
  close(): Promise<void>;
}

async function readBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
}

export async function startDebateStandIn(
  port: number = DEBATE_STAND_IN_PORT,
): Promise<DebateStandIn> {
  const requests: SentRequest[] = [];
  const server = createServer((request, response) => {
    void (async () => {
      if (request.method !== 'POST' || !request.url?.startsWith('/v1/messages')) {
        response.writeHead(404).end();
        return;
      }
      const body = await readBody(request).catch((): Record<string, unknown> => ({}));
      requests.push({ url: request.url, headers: request.headers, body });
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          id: 'msg_stand_in',
          type: 'message',
          role: 'assistant',
          model: typeof body['model'] === 'string' ? body['model'] : 'stand-in',
          content: [{ type: 'text', text: JSON.stringify(STAND_IN_SUGGESTION) }],
          stop_reason: 'end_turn',
          stop_sequence: null,
          usage: { input_tokens: 0, output_tokens: 0 },
        }),
      );
    })();
  });
  // Loopback only: Docker Desktop forwards its host address (192.168.65.254,
  // supabase/functions/.env) here, and nothing else can reach it.
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  return {
    requests,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
