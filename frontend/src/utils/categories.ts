/**
 * Turning a category slug into something you can show.
 *
 * Expense rows carry a slug; the label and colour live in the `categories`
 * list App loads once and passes down. Every component that renders a category
 * needs the same two lookups, and the same answer for a slug that is not in the
 * list — which happens legitimately: another device can delete a custom
 * category while this tab still holds expenses that referenced it.
 */

import { Category } from '../types/expense.types';

/** Neutral grey, matching the built-in `other`. Used when a slug is unknown. */
export const FALLBACK_CATEGORY_COLOR = '#94a3b8';

/**
 * The label for `slug`, or a readable rendering of the slug itself when it
 * names no known category ('pet-food' -> 'Pet food'). Never blank, so a stale
 * row still shows something in the table rather than an empty cell.
 */
export function categoryLabel(categories: Category[], slug: string): string {
  const found = categories.find(category => category.slug === slug);
  if (found) return found.label;
  if (!slug) return '';
  const spaced = slug.replace(/-/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** The colour for `slug`, falling back to neutral grey. */
export function categoryColor(categories: Category[], slug: string): string {
  return categories.find(category => category.slug === slug)?.color ?? FALLBACK_CATEGORY_COLOR;
}

/**
 * The series a stacked category chart needs: one per category, in display
 * order, plus one for every slug in `slugsInUse` that the list does not
 * contain.
 *
 * Those extras are the same unknown-slug case as above, and leaving them out is
 * worse here than anywhere else: the amounts still reach the total and the
 * donut, so a stack drawn only from `categories` silently adds up to less than
 * the figure printed beside it.
 */
export function stackedCategorySeries(
  categories: Category[],
  slugsInUse: string[]
): Array<{ slug: string; color: string }> {
  const known = new Set(categories.map(category => category.slug));
  const orphans = Array.from(new Set(slugsInUse)).filter(slug => !known.has(slug)).sort();

  return [
    ...categories.map(category => ({ slug: category.slug, color: category.color })),
    ...orphans.map(slug => ({ slug, color: FALLBACK_CATEGORY_COLOR })),
  ];
}
