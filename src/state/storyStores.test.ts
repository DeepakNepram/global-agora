import { describe, expect, it } from 'vitest';

import type { KeyValueStorage } from './persist';
import { createReportedStore, REPORTED_MEMORY, REPORTED_STORAGE_KEY } from './reportedStore';
import { createSavedStore, SAVED_STORAGE_KEY } from './savedStore';
import { createStoryStore, ringedStory } from './storyStore';

function memoryStorage(initial: Record<string, string> = {}): KeyValueStorage & {
  data: Record<string, string>;
} {
  const data = { ...initial };
  return {
    data,
    getItem: (key) => data[key] ?? null,
    setItem: (key, value) => {
      data[key] = value;
    },
  };
}

/** Storage that throws on every call, as blocked site data does. */
const brokenStorage: KeyValueStorage = {
  getItem: () => {
    throw new Error('SecurityError');
  },
  setItem: () => {
    throw new Error('QuotaExceededError');
  },
};

describe('story store', () => {
  it('opens a story as a peek card and steps the sheet up and down', () => {
    const store = createStoryStore();
    expect(store.getState()).toMatchObject({ selectedId: null, sheet: 'closed' });
    store.getState().open(7);
    expect(store.getState()).toMatchObject({ selectedId: 7, sheet: 'peek' });
    store.getState().expand();
    expect(store.getState().sheet).toBe('full');
    store.getState().collapse();
    expect(store.getState().sheet).toBe('peek');
    store.getState().collapse();
    expect(store.getState().sheet).toBe('closed');
  });

  it('switches an open sheet to another story without moving it', () => {
    const store = createStoryStore();
    store.getState().open(7);
    store.getState().expand();
    store.getState().open(9);
    expect(store.getState()).toMatchObject({ selectedId: 9, sheet: 'full' });
  });

  it('keeps the story while closing, but stops ringing it at once', () => {
    const store = createStoryStore();
    store.getState().open(7);
    expect(ringedStory(store.getState())).toBe(7);
    store.getState().close();
    expect(store.getState().selectedId).toBe(7);
    expect(ringedStory(store.getState())).toBeNull();
  });

  it('ignores bad ids and a sheet with nothing to show', () => {
    const store = createStoryStore();
    store.getState().open(0);
    store.getState().open(1.5);
    store.getState().setSheet('full');
    expect(store.getState()).toMatchObject({ selectedId: null, sheet: 'closed' });
    store.getState().open(3);
    store.getState().setSheet('full');
    expect(store.getState().sheet).toBe('full');
  });
});

const STORY = { id: 7, headline: 'Vote nears', place: 'London', publishedAtMs: 1_000 };

describe('saved store', () => {
  it('saves a snapshot, newest first, and toggles it off', () => {
    const storage = memoryStorage();
    const store = createSavedStore(storage, () => 5_000);
    expect(store.getState().toggle(STORY, 50)).toBe('saved');
    expect(store.getState().toggle({ ...STORY, id: 8 }, 50)).toBe('saved');
    expect(store.getState().stories.map((s) => s.id)).toEqual([8, 7]);
    expect(store.getState().stories[1]).toEqual({ ...STORY, savedAtMs: 5_000 });
    expect(store.getState().toggle(STORY, 50)).toBe('removed');
    expect(store.getState().stories.map((s) => s.id)).toEqual([8]);
    expect(JSON.parse(storage.data[SAVED_STORAGE_KEY] ?? '[]')).toHaveLength(1);
  });

  it('refuses a save past the configured limit, but still removes', () => {
    const store = createSavedStore(memoryStorage(), () => 0);
    expect(store.getState().toggle(STORY, 1)).toBe('saved');
    expect(store.getState().toggle({ ...STORY, id: 8 }, 1)).toBe('full');
    expect(store.getState().stories).toHaveLength(1);
    expect(store.getState().toggle(STORY, 1)).toBe('removed');
  });

  it('reloads what it stored, dropping anything malformed or repeated', () => {
    const good = { ...STORY, savedAtMs: 9 };
    const storage = memoryStorage({
      [SAVED_STORAGE_KEY]: JSON.stringify([good, { id: 'x' }, good, null, { ...good, id: 8 }]),
    });
    expect(
      createSavedStore(storage)
        .getState()
        .stories.map((s) => s.id),
    ).toEqual([7, 8]);
    expect(
      createSavedStore(memoryStorage({ [SAVED_STORAGE_KEY]: '{not json' })).getState().stories,
    ).toEqual([]);
  });

  it('works for the visit when storage is blocked or absent', () => {
    for (const storage of [brokenStorage, null]) {
      const store = createSavedStore(storage, () => 0);
      expect(store.getState().stories).toEqual([]);
      expect(store.getState().toggle(STORY, 50)).toBe('saved');
      expect(store.getState().stories).toHaveLength(1);
    }
  });
});

describe('reported store', () => {
  it('remembers each reported story once, and only the most recent', () => {
    const storage = memoryStorage();
    const store = createReportedStore(storage);
    store.getState().add(7);
    store.getState().add(7);
    expect(store.getState().ids).toEqual([7]);
    expect(createReportedStore(storage).getState().ids).toEqual([7]);
    for (let id = 1000; id < 1000 + REPORTED_MEMORY; id++) store.getState().add(id);
    expect(store.getState().ids).toHaveLength(REPORTED_MEMORY);
    expect(store.getState().ids).not.toContain(7);
    expect(JSON.parse(storage.data[REPORTED_STORAGE_KEY] ?? '[]')).toHaveLength(REPORTED_MEMORY);
  });

  it('survives blocked storage', () => {
    const store = createReportedStore(brokenStorage);
    store.getState().add(3);
    expect(store.getState().ids).toEqual([3]);
  });
});
