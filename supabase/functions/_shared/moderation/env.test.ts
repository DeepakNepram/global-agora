import { describe, expect, it } from 'vitest';

import { LOCAL_HOOK_SECRET, moderationEnv } from './env.ts';

const HOSTED: Record<string, string> = {
  MODERATION_HOOK_SECRET: 'hook',
  OPENAI_API_KEY: 'a',
  GOOGLE_API_KEY: 'b',
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'c',
};
const LOCAL: Record<string, string> = {
  ...HOSTED,
  MODERATION_HOOK_SECRET: LOCAL_HOOK_SECRET,
  SUPABASE_URL: 'http://kong:8000',
};

function read(vars: Record<string, string | undefined>): ReturnType<typeof moderationEnv> {
  return moderationEnv((name) => vars[name]);
}

describe('moderationEnv', () => {
  it('reads a hosted project’s settings, every model real', () => {
    expect(read(HOSTED)).toEqual({
      hookSecret: 'hook',
      supabaseUrl: 'https://example.supabase.co',
      serviceRoleKey: 'c',
      openai: { apiKey: 'a', standIn: false },
      google: { apiKey: 'b', standIn: false },
    });
  });

  it('names what is missing, a blank counting as missing', () => {
    expect(read({ ...HOSTED, GOOGLE_API_KEY: ' ', MODERATION_HOOK_SECRET: undefined })).toBe(
      'not configured: MODERATION_HOOK_SECRET, GOOGLE_API_KEY',
    );
  });

  it('locally, sends only the models without a key to the stand-in', () => {
    const env = read({ ...LOCAL, GOOGLE_API_KEY: '', MODERATION_STAND_IN_URL: 'http://host:1' });
    expect(env).toMatchObject({
      openai: { apiKey: 'a', standIn: false },
      google: { apiKey: 'stand-in', baseUrl: 'http://host:1', standIn: true },
    });
  });

  it('refuses a stand-in or the public local secret against a hosted project', () => {
    expect(read({ ...HOSTED, MODERATION_STAND_IN_URL: 'http://host:1' })).toMatch(
      /stand-in model cannot serve a hosted project/,
    );
    expect(read({ ...HOSTED, MODERATION_HOOK_SECRET: LOCAL_HOOK_SECRET })).toMatch(
      /local hook secret cannot serve a hosted project/,
    );
  });

  it('refuses a SUPABASE_URL that is not a URL', () => {
    expect(read({ ...HOSTED, SUPABASE_URL: 'kong' })).toMatch(/not a URL/);
  });
});
