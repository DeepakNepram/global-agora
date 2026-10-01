import type { NodeBuffer, PlaceResult } from '@/core';
import { filterStore, wallClockNow } from '@/state';

import { formatAgo } from '../story/format';
import { flyToPlace, openStoryOnGlobe, type GlobeTarget } from './globeNavigation';
import type { SearchModel } from './useSearch';

/** What a search result offers: a line to show and what choosing it does. */
export interface SearchOption {
  readonly id: string;
  readonly label: string;
  readonly detail: string;
  readonly pick: () => void;
}

export interface OptionContext {
  readonly nodes: NodeBuffer | null;
  readonly target: GlobeTarget;
  readonly announce: (text: string) => void;
}

export interface OptionGroup {
  readonly title: string;
  readonly options: readonly SearchOption[];
}

function storyDetail(nodes: NodeBuffer, row: number): string {
  const publishedMs = (nodes.epochSec + (nodes.publishedSec[row] ?? 0)) * 1000;
  return [nodes.places[row], formatAgo(publishedMs, wallClockNow())]
    .filter((part) => part !== undefined && part !== '')
    .join(' · ');
}

/** "1 story", "33 stories". */
export function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** The results as groups of options, each knowing what choosing it does. */
export function groupsFor(
  model: SearchModel,
  context: OptionContext,
  close: (keepText: string | null) => void,
): OptionGroup[] {
  const { nodes, target, announce } = context;
  const story = (row: number, prefix: string): SearchOption | null => {
    if (!nodes) return null;
    const id = nodes.ids[row] ?? 0;
    return {
      id: `${prefix}-story-${id}`,
      label: nodes.headlines[row] ?? '',
      detail: storyDetail(nodes, row),
      pick: () => {
        close(null);
        openStoryOnGlobe(target, nodes, id);
      },
    };
  };

  if (model.outlet !== null) {
    const { outlet } = model;
    const rows = outlet.status === 'ready' ? outlet.rows : [];
    const options = rows.map((row) => story(row, 'outlet')).filter((o) => o !== null);
    return [{ title: `Stories from ${outlet.outlet}`, options }];
  }

  const place = (result: PlaceResult): SearchOption => ({
    id: `place-${result.key}`,
    label: result.label,
    detail: result.detail,
    pick: () => {
      const name = result.city ? `${result.label}, ${result.detail}` : result.label;
      close(result.label);
      flyToPlace(target, result);
      announce(`Showing ${name}.`);
    },
  });
  const { results } = model;
  return [
    { title: 'Places', options: results.places.map(place) },
    {
      title: 'Topics',
      options: results.topics.map((topic) => ({
        id: `topic-${topic.category}`,
        label: topic.label,
        detail: `Show only this topic · ${plural(topic.count, 'story', 'stories')}`,
        pick: () => {
          close(topic.label);
          filterStore.getState().onlyCategory(topic.category);
          announce(`Showing only ${topic.label} stories. Others are dimmed.`);
        },
      })),
    },
    {
      title: 'Stories',
      options: results.stories.map((s) => story(s.row, 'result')).filter((o) => o !== null),
    },
    {
      title: 'Outlets',
      options: results.outlets.map((o) => ({
        id: `outlet-${o.outlet}`,
        label: o.label,
        detail: plural(o.count, 'story', 'stories'),
        pick: () => {
          model.showOutlet(o.outlet);
          announce(`Stories from ${o.outlet}.`);
        },
      })),
    },
  ].filter((group) => group.options.length > 0);
}
