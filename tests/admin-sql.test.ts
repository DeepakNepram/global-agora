import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { PROMPT_MAX_CHARS, SIDE_MAX_CHARS } from '../src/core/admin';
import {
  PROMPT_MAX_CHARS as FUNCTION_PROMPT_MAX,
  SIDE_MAX_CHARS as FUNCTION_SIDE_MAX,
} from '../supabase/functions/_shared/debate/suggestion';

/**
 * A debate's words have one set of limits in three places: the database's
 * CHECKs and open_discussion(), the console's form, and the suggestion
 * function. If they drift, the model suggests what the database refuses.
 */
const sql = readFileSync(
  new URL('../supabase/migrations/20261022100000_admin_console.sql', import.meta.url),
  'utf8',
);

function limit(constraint: string, column: string): number {
  const match = new RegExp(`${constraint}\\s+check \\(char_length\\(${column}\\) <= (\\d+)`).exec(
    sql,
  );
  if (match?.[1] === undefined) throw new Error(`no ${constraint}`);
  return Number(match[1]);
}

describe('debate limits, app, function and database', () => {
  it('hold the prompt to the same length', () => {
    expect(limit('discussions_prompt_shape', 'prompt')).toBe(PROMPT_MAX_CHARS);
    expect(FUNCTION_PROMPT_MAX).toBe(PROMPT_MAX_CHARS);
    expect(sql).toContain(`char_length(v_prompt) not between 1 and ${PROMPT_MAX_CHARS}`);
  });

  it('hold each side to the same length', () => {
    expect(limit('discussions_side_a_shape', 'side_a_label')).toBe(SIDE_MAX_CHARS);
    expect(limit('discussions_side_b_shape', 'side_b_label')).toBe(SIDE_MAX_CHARS);
    expect(FUNCTION_SIDE_MAX).toBe(SIDE_MAX_CHARS);
    expect(sql).toContain(`char_length(v_side_a) not between 1 and ${SIDE_MAX_CHARS}`);
  });
});
