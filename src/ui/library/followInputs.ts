import {
  categoryAt,
  cityLabel,
  cityTarget,
  countryTarget,
  followLabel,
  nearestCity,
  storyTarget,
  vec3ToLatLon,
  CATEGORY_LABELS,
  type Gazetteer,
  type NewsCategory,
  type NodeBuffer,
  type PlaceResult,
} from '@/core';
import type { FollowInput } from '@/state';

/** The follows a place can be: a country, or a gazetteer city. Story-named places have no id to follow. */
export function placeFollow(place: PlaceResult): FollowInput | null {
  if (place.country) {
    return {
      kind: 'place',
      target: countryTarget(place.country.code),
      label: followLabel(place.country.name, place.country.code),
      baseline: null,
    };
  }
  if (place.city) {
    return {
      kind: 'place',
      target: cityTarget(place.city.id),
      label: followLabel(cityLabel(place.city), place.city.name),
      baseline: null,
    };
  }
  return null;
}

export function categoryFollow(category: NewsCategory): FollowInput {
  return { kind: 'category', target: category, label: CATEGORY_LABELS[category], baseline: null };
}

/**
 * What a story offers to follow: the story itself (with its source count, to
 * show what it gains), its city when the gazetteer has one within 50 km, its
 * country, and its category.
 */
export function storyFollows(
  nodes: NodeBuffer,
  row: number,
  places: Gazetteer | null,
): FollowInput[] {
  const follows: FollowInput[] = [
    {
      kind: 'story',
      target: storyTarget(nodes.ids[row] ?? 0),
      label: followLabel(nodes.headlines[row] ?? '', 'A story'),
      baseline: nodes.sourceCounts[row] ?? 0,
    },
  ];
  if (places) {
    const p = nodes.positions;
    const at = vec3ToLatLon({ x: p[row * 3] ?? 0, y: p[row * 3 + 1] ?? 0, z: p[row * 3 + 2] ?? 0 });
    const city = nearestCity(places, at);
    if (city) {
      follows.push({
        kind: 'place',
        target: cityTarget(city.id),
        label: followLabel(cityLabel(city), city.name),
        baseline: null,
      });
    }
    const code = nodes.countryCodes[row] ?? '';
    const country = code === '' ? null : places.country(code);
    if (country) {
      follows.push({
        kind: 'place',
        target: countryTarget(country.code),
        label: followLabel(country.name, country.code),
        baseline: null,
      });
    }
  }
  follows.push(categoryFollow(categoryAt(nodes.categories[row] ?? 0)));
  return follows;
}
