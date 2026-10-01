/**
 * The Following feed (Prompt 3.4): the app's one conventional feed. The
 * payload's stories that match any follow, newest first, and nothing more:
 * finite by construction, because the payload is the window.
 *
 * A story matches a followed city within CITY_RADIUS_KM of it (cities resolve
 * through the gazetteer, so they wait for it), a followed country by its
 * country code, a category by its own, and a followed story by its id.
 */

import type { Gazetteer } from './data/places';
import { followTarget, type Follow } from './follows';
import { EARTH_RADIUS_KM, latLonToVec3 } from './geo';
import { NEWS_CATEGORIES, type NodeBuffer } from './nodeBuffer';
import { CITY_RADIUS_KM } from './places';

export interface FeedItem {
  readonly row: number;
  readonly id: number;
  /** The labels of the follows it matched, places first: "Because you follow Tokyo". */
  readonly reasons: readonly string[];
  /** For a followed story: sources gained since following, else null. */
  readonly sourcesGained: number | null;
}

interface CityFollow {
  readonly label: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface Feed {
  readonly items: readonly FeedItem[];
  /** Some city follows could not be matched yet: the gazetteer is still loading. */
  readonly waitingForPlaces: boolean;
}

/** The chord between two unit vectors that subtend CITY_RADIUS_KM: compared without trigonometry. */
const CITY_CHORD_SQ = (2 * Math.sin(CITY_RADIUS_KM / EARTH_RADIUS_KM / 2)) ** 2;

export function buildFeed(
  nodes: NodeBuffer,
  follows: readonly Follow[],
  places: Gazetteer | null,
): Feed {
  const categories = new Map<number, string>();
  const countries = new Map<string, string>();
  const stories = new Map<number, Follow>();
  const cities: CityFollow[] = [];
  let waitingForPlaces = false;

  for (const follow of follows) {
    const target = followTarget(follow.kind, follow.target);
    if (target === null) continue;
    if (target.type === 'category') {
      categories.set(NEWS_CATEGORIES.indexOf(target.category), follow.label);
    } else if (target.type === 'country') {
      countries.set(target.code, follow.label);
    } else if (target.type === 'story') {
      stories.set(target.id, follow);
    } else if (places === null) {
      waitingForPlaces = true;
    } else {
      const city = places.city(target.id);
      if (city) cities.push({ label: follow.label, ...latLonToVec3(city) });
    }
  }

  const items: FeedItem[] = [];
  // Rows are in time order: walking back gives newest first.
  for (let row = nodes.count - 1; row >= 0; row--) {
    const reasons: string[] = [];
    const x = nodes.positions[row * 3] ?? 0;
    const y = nodes.positions[row * 3 + 1] ?? 0;
    const z = nodes.positions[row * 3 + 2] ?? 0;
    for (const city of cities) {
      if ((x - city.x) ** 2 + (y - city.y) ** 2 + (z - city.z) ** 2 <= CITY_CHORD_SQ) {
        reasons.push(city.label);
      }
    }
    const country = countries.get(nodes.countryCodes[row] ?? '');
    if (country !== undefined) reasons.push(country);
    const category = categories.get(nodes.categories[row] ?? -1);
    if (category !== undefined) reasons.push(category);
    const id = nodes.ids[row] ?? 0;
    const followed = stories.get(id);
    if (followed) reasons.push('this story');
    if (reasons.length === 0) continue;
    items.push({
      row,
      id,
      reasons,
      sourcesGained:
        followed && followed.baseline !== null
          ? Math.max(0, (nodes.sourceCounts[row] ?? 0) - followed.baseline)
          : null,
    });
  }
  return { items, waitingForPlaces };
}

/** "Tokyo, Climate and this story". */
export function reasonText(reasons: readonly string[]): string {
  if (reasons.length <= 1) return reasons[0] ?? '';
  return `${reasons.slice(0, -1).join(', ')} and ${reasons.at(-1) ?? ''}`;
}
