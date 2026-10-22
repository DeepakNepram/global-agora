/**
 * The suggest-debate function's settings, read once per request from env.
 *
 * Production: ANTHROPIC_API_KEY via `supabase secrets set`; SUPABASE_URL and
 * SUPABASE_ANON_KEY come from the platform. DEBATE_MODEL and DEBATE_EFFORT
 * are optional tuning.
 *
 * Without a key the function still answers, with no suggestion, and the
 * admin types the words. Local only: DEBATE_STAND_IN_URL sends the call to
 * db:smoke's stand-in instead, so the whole path runs before a key exists;
 * it is refused against a hosted project.
 */
import { isLocalProject } from '../project.ts';

export const DEFAULT_MODEL = 'claude-opus-5-5';
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type Effort = (typeof EFFORTS)[number];
/** Opus 5.5's own default, set explicitly: a short, judgment-led task. */
export const DEFAULT_EFFORT: Effort = 'medium';

export interface ClaudeAccess {
  readonly apiKey: string;
  /** Set only for the local stand-in. */
  readonly baseUrl?: string | undefined;
  readonly standIn: boolean;
  readonly model: string;
  readonly effort: Effort;
}

export interface DebateEnv {
  readonly supabaseUrl: string;
  readonly anonKey: string;
  /** Null when no key is set: the function answers without a suggestion. */
  readonly claude: ClaudeAccess | null;
}

function value(get: (name: string) => string | undefined, name: string): string | null {
  const raw = get(name)?.trim();
  return raw === undefined || raw === '' ? null : raw;
}

function isEffort(value: string): value is Effort {
  return (EFFORTS as readonly string[]).includes(value);
}

/** The settings, or why the function cannot run (a 500). */
export function debateEnv(get: (name: string) => string | undefined): DebateEnv | string {
  const supabaseUrl = value(get, 'SUPABASE_URL');
  const anonKey = value(get, 'SUPABASE_ANON_KEY');
  if (supabaseUrl === null || anonKey === null) {
    const missing = [
      supabaseUrl === null && 'SUPABASE_URL',
      anonKey === null && 'SUPABASE_ANON_KEY',
    ];
    return `not configured: ${missing.filter(Boolean).join(', ')}`;
  }
  const local = isLocalProject(supabaseUrl);
  if (local === null) return 'not configured: SUPABASE_URL is not a URL';

  const standIn = value(get, 'DEBATE_STAND_IN_URL');
  if (!local && standIn !== null) return 'a stand-in model cannot serve a hosted project';
  const effort = value(get, 'DEBATE_EFFORT') ?? DEFAULT_EFFORT;
  if (!isEffort(effort)) return `DEBATE_EFFORT must be one of ${EFFORTS.join(', ')}`;
  const model = value(get, 'DEBATE_MODEL') ?? DEFAULT_MODEL;

  const apiKey = value(get, 'ANTHROPIC_API_KEY');
  let claude: ClaudeAccess | null = null;
  if (apiKey !== null) claude = { apiKey, standIn: false, model, effort };
  else if (standIn !== null) {
    claude = { apiKey: 'stand-in', baseUrl: standIn, standIn: true, model, effort };
  }
  return { supabaseUrl, anonKey, claude };
}
