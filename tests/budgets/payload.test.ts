import { readFileSync } from 'node:fs';
import { brotliDecompressSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import { DEFAULT_API_CONFIG } from '../../workers/api/src/config.ts';
import type { ApiDb } from '../../workers/api/src/db.ts';
import { buildNodes } from '../../workers/api/src/entries.ts';

/**
 * The initial data payload budget (CLAUDE.md #1: under 150 KB compressed),
 * measured on one real day: 3,000 stories from a 24-hour GDELT load, as
 * api_nodes answered for them (scripts/api/capture-day.ts). The Worker's own
 * build turns it into the bytes it serves.
 */

const BUDGET_BYTES = 150 * 1024;

/** api_nodes' columns when the fixture was captured; pgTAP 05_api pins the function to them. */
const NODE_COLUMNS = ['id', 'lonQ', 'latQ', 't', 'cat', 'heat', 'srcN', 'disc', 'hl', 'pl', 'cc'];

const day = JSON.parse(
  brotliDecompressSync(readFileSync('tests/budgets/nodes-day.json.br')).toString('utf8'),
) as { window_hours: number; nodes: Record<string, unknown[]> };

function fixtureDb(): ApiDb {
  const unused = (): never => {
    throw new Error('not part of the payload');
  };
  return {
    nodes: () => Promise.resolve({ hash: 'day', payload: day }),
    story: unused,
    reportLocation: unused,
    outlets: unused,
    outletStories: unused,
  };
}

describe('the nodes payload budget', () => {
  it('is the columns api_nodes returns today', () => {
    expect(Object.keys(day.nodes)).toEqual(NODE_COLUMNS);
  });

  it('holds as many stories as the Worker sends', () => {
    // Raising nodeLimit past the fixture means measuring a bigger day first.
    expect(day.nodes['id']?.length).toBeGreaterThanOrEqual(DEFAULT_API_CONFIG.nodeLimit);
  });

  it('is under 150 KB as the Worker compresses it', async () => {
    const entry = await buildNodes(
      {
        db: fixtureDb(),
        hours: day.window_hours,
        limit: DEFAULT_API_CONFIG.nodeLimit,
        brotliQuality: DEFAULT_API_CONFIG.brotliQuality,
        now: () => 0,
      },
      null,
    );
    expect(entry.encoding).toBe('br');
    const bytes = entry.body.byteLength;
    console.log(`nodes payload: ${(bytes / 1024).toFixed(1)} KB of ${BUDGET_BYTES / 1024} KB`);
    expect(bytes).toBeLessThanOrEqual(BUDGET_BYTES);
  });
});
