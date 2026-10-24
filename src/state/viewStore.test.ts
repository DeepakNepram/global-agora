import { describe, expect, it } from 'vitest';

import type { KeyValueStorage } from './persist';
import { createViewStore, VIEW_STORAGE_KEY } from './viewStore';

function memory(
  initial: Record<string, string> = {},
): KeyValueStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (key) => data[key] ?? null,
    setItem: (key, value) => {
      data[key] = value;
    },
  };
}

describe('viewStore', () => {
  it('starts on the globe, newest first', () => {
    const store = createViewStore(memory());
    expect(store.getState()).toMatchObject({ layout: 'visual', sort: 'newest' });
  });

  it('remembers the list and its sort on this device', () => {
    const storage = memory();
    const store = createViewStore(storage);
    store.getState().setLayout('list');
    store.getState().setSort('covered');
    expect(JSON.parse(storage.data[VIEW_STORAGE_KEY] ?? '')).toEqual({
      layout: 'list',
      sort: 'covered',
    });
    expect(createViewStore(storage).getState()).toMatchObject({ layout: 'list', sort: 'covered' });
  });

  it('ignores a damaged or foreign value', () => {
    const store = createViewStore(memory({ [VIEW_STORAGE_KEY]: '{"layout":"grid","sort":1}' }));
    expect(store.getState()).toMatchObject({ layout: 'visual', sort: 'newest' });
    expect(createViewStore(memory({ [VIEW_STORAGE_KEY]: 'not json' })).getState().layout).toBe(
      'visual',
    );
  });

  it('works without storage', () => {
    const store = createViewStore(null);
    store.getState().setLayout('list');
    expect(store.getState().layout).toBe('list');
  });
});
