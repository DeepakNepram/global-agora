import { NEWS_CATEGORIES, type NewsCategory } from './nodeBuffer';

/** What a reader sees for each category: on filter chips, in search and in the feed. */
export const CATEGORY_LABELS: Readonly<Record<NewsCategory, string>> = {
  world: 'World',
  conflict: 'Conflict',
  politics: 'Politics',
  business: 'Business',
  science: 'Science',
  climate: 'Climate',
  tech: 'Tech',
  health: 'Health',
};

/** The category at NEWS_CATEGORIES index `index`, falling back to the first. */
export function categoryAt(index: number): NewsCategory {
  return NEWS_CATEGORIES[index] ?? NEWS_CATEGORIES[0];
}

export function isNewsCategory(value: string): value is NewsCategory {
  return (NEWS_CATEGORIES as readonly string[]).includes(value);
}
