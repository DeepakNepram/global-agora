import { describe, expect, it } from 'vitest';

import { scrubUrlValue, withoutQuery } from './scrub';

describe('error report scrubbing', () => {
  it('keeps the path and drops the query and fragment', () => {
    expect(withoutQuery('https://agora.example/?code=abc123&story=4')).toBe(
      'https://agora.example/',
    );
    expect(withoutQuery('https://ref.supabase.co/rest/v1/saved?user_id=eq.1234')).toBe(
      'https://ref.supabase.co/rest/v1/saved',
    );
    expect(withoutQuery('/privacy#local-badge')).toBe('/privacy');
    expect(withoutQuery('/api/story/12')).toBe('/api/story/12');
  });

  it('leaves values that are not strings alone', () => {
    expect(scrubUrlValue(404)).toBe(404);
    expect(scrubUrlValue(undefined)).toBeUndefined();
    expect(scrubUrlValue('/a?b=c')).toBe('/a');
  });
});
