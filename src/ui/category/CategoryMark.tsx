import type { JSX } from 'react';

import { CATEGORY_LABELS, CATEGORY_SHAPES, shapePath, type NewsCategory } from '@/core';

import { categoryColor } from './categoryColor';

/** Every shape fits this box: the triangle reaches 1.56 equal-area units. */
const VIEW_BOX = '-1.6 -1.6 3.2 3.2';

export interface CategoryMarkProps {
  readonly category: NewsCategory;
  readonly className?: string;
}

/**
 * The category's shape in its colour, as the pins draw it (Prompt 5.1).
 * Decorative: it always sits beside the category's name, which says it in
 * words, so the colour and the shape are never the only cue.
 */
export function CategoryMark({ category, className = 'size-3' }: CategoryMarkProps): JSX.Element {
  return (
    <svg aria-hidden="true" viewBox={VIEW_BOX} className={`shrink-0 ${className}`}>
      <path d={shapePath(CATEGORY_SHAPES[category])} fill={categoryColor(category)} />
    </svg>
  );
}

/** The mark and the category's name, for meta lines. */
export function CategoryLabel({ category }: { readonly category: NewsCategory }): JSX.Element {
  return (
    <span className="inline-flex items-center gap-1">
      <CategoryMark category={category} />
      {CATEGORY_LABELS[category]}
    </span>
  );
}
