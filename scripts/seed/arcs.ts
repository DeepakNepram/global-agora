/**
 * The shape of the seeded news: category mix, sentiment by category, and a few
 * developing stories that move across the map over the day.
 *
 * The arcs exist for Phase 3's time scrubber, whose pitch is watching a story
 * spread; random points alone would never show that.
 */
import type { NewsCategory } from '../../src/core/nodeBuffer.ts';

/** Relative share of each category among the random stories. */
export const CATEGORY_WEIGHTS: Readonly<Record<NewsCategory, number>> = {
  world: 18,
  politics: 17,
  business: 15,
  health: 12,
  conflict: 10,
  climate: 10,
  tech: 10,
  science: 8,
};

/** Centre of each category's sentiment (-100..100); stories scatter ±25 around it. */
export const SENTIMENT_BASE: Readonly<Record<NewsCategory, number>> = {
  world: 0,
  conflict: -45,
  politics: -10,
  business: -5,
  science: 20,
  climate: -25,
  tech: 5,
  health: -15,
};

export interface Arc {
  readonly category: NewsCategory;
  /** Index into HEADLINES[category]. */
  readonly template: number;
  /** Heat at the first and last stop; coverage builds as the story travels. */
  readonly heat: readonly [number, number];
  /** [city, hours ago], oldest first. */
  readonly stops: readonly (readonly [string, number])[];
}

export const ARCS: readonly Arc[] = [
  {
    // A sell-off following the trading day west, market by market.
    category: 'business',
    template: 0,
    heat: [120, 240],
    stops: [
      ['Tokyo', 23],
      ['Hong Kong', 22],
      ['Mumbai', 19.5],
      ['Frankfurt', 16.5],
      ['London', 16],
      ['New York', 11],
    ],
  },
  {
    // A typhoon tracking north-west up the coast.
    category: 'climate',
    template: 1,
    heat: [150, 230],
    stops: [
      ['Manila', 20],
      ['Kaohsiung', 14],
      ['Xiamen', 9],
      ['Shanghai', 3],
    ],
  },
  {
    // One solar storm, seen wherever it is dark at high latitude, ending with a
    // pin in Antarctica so the far south of the globe is exercised too.
    category: 'science',
    template: 0,
    heat: [90, 160],
    stops: [
      ['Tromsø', 22],
      ['Reykjavík', 20],
      ['Anchorage', 14],
      ['Hobart', 6],
      ['McMurdo Station', 4],
    ],
  },
  {
    // A payments outage following the business day around the world.
    category: 'tech',
    template: 0,
    heat: [110, 220],
    stops: [
      ['Sydney', 10],
      ['Singapore', 8],
      ['Bengaluru', 7],
      ['London', 5],
      ['New York', 2],
    ],
  },
  {
    // An infection cluster reported in neighbouring cities.
    category: 'health',
    template: 3,
    heat: [80, 180],
    stops: [
      ['Dhaka', 21],
      ['Kolkata', 15],
      ['Kathmandu', 8],
    ],
  },
];
