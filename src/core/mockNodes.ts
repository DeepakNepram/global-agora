import { NEWS_CATEGORIES, nodeBufferCapacity, type NodeBuffer } from './nodeBuffer';
import { mulberry32 } from './random';

/**
 * Placeholder stories until Prompt 2.3 serves real ones.
 *
 * Seeded, so a benchmark run draws exactly the same pins every time and two
 * measurements differ only in what was changed.
 */

export interface MockNodeOptions {
  readonly count: number;
  /** The window ends here (epoch ms), normally the time store's instant. */
  readonly windowEndMs: number;
  /** From AppConfig.historyWindowHours: the window is a tier limit, not a constant. */
  readonly windowHours: number;
  readonly seed: number;
}

/**
 * Fills `buffer` with random stories and returns it.
 *
 * Positions are uniform over the sphere's area:
 *   y = 2u - 1,  azimuth = 2πv,  x = √(1 - y²)·cos(azimuth),  z = √(1 - y²)·sin(azimuth)
 * (uniform y is Archimedes' hat-box theorem; uniform latitude would crowd the poles).
 * Times are uniform over the window. Heat is 255·u³, so most stories are
 * minor and a few are hot, roughly as real coverage is.
 */
export function fillMockNodes(buffer: NodeBuffer, options: MockNodeOptions): NodeBuffer {
  const { count, windowEndMs, windowHours, seed } = options;
  if (!Number.isInteger(count) || count < 0 || count > nodeBufferCapacity(buffer)) {
    throw new RangeError(`count ${count} does not fit capacity ${nodeBufferCapacity(buffer)}`);
  }
  if (!(windowHours > 0) || !Number.isFinite(windowEndMs)) {
    throw new RangeError(`invalid window: ${windowHours} h ending ${windowEndMs}`);
  }

  const random = mulberry32(seed);
  const windowSec = Math.round(windowHours * 3600);
  const { positions, publishedSec, categories, heat } = buffer;

  buffer.count = count;
  buffer.epochSec = Math.floor(windowEndMs / 1000) - windowSec;

  for (let i = 0; i < count; i++) {
    const y = 2 * random() - 1;
    const azimuth = 2 * Math.PI * random();
    const ring = Math.sqrt(Math.max(0, 1 - y * y));
    positions[i * 3] = ring * Math.cos(azimuth);
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = ring * Math.sin(azimuth);

    publishedSec[i] = Math.floor(random() * windowSec);
    categories[i] = Math.min(
      Math.floor(random() * NEWS_CATEGORIES.length),
      NEWS_CATEGORIES.length - 1,
    );
    const u = random();
    heat[i] = Math.floor(255 * u * u * u);
  }
  return buffer;
}
