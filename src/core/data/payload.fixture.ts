import { NEWS_CATEGORIES } from '../nodeBuffer';

import { quantizeLat, quantizeLon, type NodesPayload } from './payload';

/** Three nodes as api_nodes and the Worker produce them. */
export function samplePayload(): NodesPayload {
  return {
    v: 1,
    generated_at: 1_790_000_000,
    window_hours: 24,
    categories: [...NEWS_CATEGORIES],
    nodes: {
      id: [101, 102, 103],
      lonQ: [quantizeLon(-0.1278), quantizeLon(139.69), quantizeLon(180)],
      latQ: [quantizeLat(51.5074), quantizeLat(35.68), quantizeLat(-90)],
      t: [0, 43_200, 86_400],
      cat: [2, 3, 0],
      heat: [255, 120, 10],
      srcN: [48, 5, 1],
      disc: [1, 0, 0],
      hl: ['Vote nears in London', 'Shares slide in Tokyo', 'Ice shelf calves'],
      pl: ['London, United Kingdom', 'Tokyo, Japan', ''],
    },
  };
}
