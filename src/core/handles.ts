/**
 * Handles (Prompt 4.1): the public name a reader posts under, chosen on the
 * first sign-in from three suggestions or typed.
 *
 * The rules are the database's (20261016100000_profiles.sql: a CHECK on the
 * table and the same tests in claim_handle); they are repeated here only for
 * instant feedback while typing. tests/handles-sql.test.ts keeps the two in
 * step.
 *
 * Suggestions are random words, never built from the reader's name or email:
 * a handle is public, and an email-shaped one would say who someone is.
 */

/** 3-20 characters: lower-case letters, digits and _, starting with a letter. */
export const HANDLE_PATTERN = /^[a-z][a-z0-9_]{2,19}$/;
export const HANDLE_MIN_LENGTH = 3;
export const HANDLE_MAX_LENGTH = 20;

/** Never a handle, exactly. */
export const RESERVED_HANDLES: readonly string[] = [
  'admin',
  'administrator',
  'anonymous',
  'deleted',
  'everyone',
  'expert',
  'help',
  'mod',
  'mods',
  'moderator',
  'moderators',
  'null',
  'root',
  'security',
  'system',
  'undefined',
  'unverified',
  'verified',
];

/** Never the start of a handle: nobody may look like staff. */
export const RESERVED_HANDLE_PREFIXES: readonly string[] = [
  'admin',
  'agora',
  'global_agora',
  'globalagora',
  'moderator',
  'official',
  'staff',
  'support',
  'team_',
];

/** What the reader typed, as a handle: trimmed, without a leading @, lower case. */
export function normalizeHandle(text: string): string {
  return text.trim().replace(/^@/, '').toLowerCase();
}

export function isHandleReserved(handle: string): boolean {
  return (
    RESERVED_HANDLES.includes(handle) ||
    RESERVED_HANDLE_PREFIXES.some((prefix) => handle.startsWith(prefix))
  );
}

/** Why a normalised handle cannot be claimed, or null if it can (taken aside). */
export function handleProblem(handle: string): string | null {
  if (handle.length < HANDLE_MIN_LENGTH) return `At least ${HANDLE_MIN_LENGTH} characters.`;
  if (handle.length > HANDLE_MAX_LENGTH) return `At most ${HANDLE_MAX_LENGTH} characters.`;
  if (!/^[a-z]/.test(handle)) return 'Start with a letter.';
  if (!HANDLE_PATTERN.test(handle)) return 'Only letters, digits and _.';
  if (isHandleReserved(handle)) return 'That one is reserved.';
  return null;
}

// Short, neutral words that read well in any pairing. At most 7 letters
// each, so word_word_00 stays within 18 characters.
const FIRST: readonly string[] = [
  'amber', 'azure', 'bold', 'brisk', 'calm', 'candid', 'civic', 'clear',
  'coral', 'crisp', 'deft', 'eager', 'fair', 'gentle', 'golden', 'keen',
  'kind', 'lucid', 'lunar', 'mellow', 'misty', 'noble', 'olive', 'polar',
  'quick', 'quiet', 'rapid', 'rosy', 'rustic', 'sage', 'silver', 'solar',
  'steady', 'sunny', 'swift', 'tidal', 'vivid', 'warm', 'wise', 'woven',
]; // prettier-ignore

const SECOND: readonly string[] = [
  'atlas', 'aurora', 'badger', 'beacon', 'birch', 'canyon', 'cedar', 'comet',
  'compass', 'condor', 'delta', 'ember', 'falcon', 'fjord', 'forest', 'harbor',
  'heron', 'island', 'kestrel', 'lagoon', 'lantern', 'maple', 'meadow', 'meteor',
  'orbit', 'osprey', 'otter', 'pebble', 'pine', 'prairie', 'quill', 'raven',
  'reef', 'ridge', 'river', 'sparrow', 'summit', 'tundra', 'valley', 'willow',
]; // prettier-ignore

/** A source of numbers in [0, 1), like Math.random; tests pass a seeded one. */
export type Random = () => number;

function pick<T>(items: readonly T[], random: Random): T {
  const item = items[Math.floor(random() * items.length)];
  if (item === undefined) throw new RangeError('random() must return a number in [0, 1)');
  return item;
}

/**
 * `count` different handles like amber_heron_42. 40 × 40 × 100 = 160,000 of
 * them, so a handful of retries always finds distinct ones; whether they are
 * free is the database's to say (handles_available).
 */
export function suggestHandles(random: Random, count: number): string[] {
  const out = new Set<string>();
  for (let attempt = 0; out.size < count && attempt < count * 20; attempt++) {
    const digits = String(Math.floor(random() * 100)).padStart(2, '0');
    out.add(`${pick(FIRST, random)}_${pick(SECOND, random)}_${digits}`);
  }
  return [...out];
}
