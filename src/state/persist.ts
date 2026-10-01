/**
 * Browser storage for per-device conveniences (saved stories while signed
 * out, reports already sent). Every access is guarded: storage can be absent
 * (a native shell, tests), blocked (privacy settings) or full, and none of
 * that may break the page. Stores take a KeyValueStorage, so tests inject one.
 */

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * localStorage when the browser allows it, else null. Outside a browser it is
 * not touched at all: Node 25 defines a global localStorage that warns on
 * first read.
 */
export function browserStorage(): KeyValueStorage | null {
  try {
    const host = globalThis as { window?: { localStorage?: KeyValueStorage } };
    return host.window?.localStorage ?? null;
  } catch {
    // Reading localStorage itself throws where site data is blocked.
    return null;
  }
}

export function readJson(storage: KeyValueStorage | null, key: string): unknown {
  if (!storage) return null;
  try {
    const raw = storage.getItem(key);
    return raw === null ? null : (JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

/** False when the write did not happen (no storage, quota, blocked). */
export function writeJson(storage: KeyValueStorage | null, key: string, value: unknown): boolean {
  if (!storage) return false;
  try {
    storage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}
