import { describe, expect, it } from 'vitest';

import type { LocalBadgeStatus } from '@/state/localBadge';

import { LOCAL_BADGE_NOTE, localBadgeView } from './localBadgeView';

describe('localBadgeView', () => {
  it('names the exact label and says it is approximate and can be wrong', () => {
    const view = localBadgeView({ kind: 'available', label: 'Bengaluru area, India' });
    expect(view).toEqual({
      disabled: false,
      label: 'Show “Bengaluru area, India” on this post',
      note: LOCAL_BADGE_NOTE,
    });
    expect(LOCAL_BADGE_NOTE).toMatch(/approximate network location/);
    expect(LOCAL_BADGE_NOTE).toMatch(/can be wrong/);
  });

  it('is disabled, with a reason, whenever there is no label to show', () => {
    const statuses: LocalBadgeStatus[] = [
      { kind: 'checking' },
      { kind: 'no-city' },
      { kind: 'unavailable' },
      { kind: 'failed' },
    ];
    for (const status of statuses) {
      const view = localBadgeView(status);
      expect(view.disabled).toBe(true);
      expect(view.note).not.toBe('');
      expect(view.note).not.toBe(LOCAL_BADGE_NOTE);
    }
    expect(localBadgeView({ kind: 'no-city' }).note).toMatch(/doesn't include a city/);
  });
});
