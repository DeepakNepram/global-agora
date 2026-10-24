import type { NewsCategory } from '@/core';
import { CATEGORY_HUES } from '@/globe';

/** The category's hue as CSS, as the pins draw it. */
export function categoryColor(category: NewsCategory): string {
  return `#${CATEGORY_HUES[category].toString(16).padStart(6, '0')}`;
}
