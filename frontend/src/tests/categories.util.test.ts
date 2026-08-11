/**
 * Tests for utils/categories.ts — slug -> label / colour.
 *
 * The interesting case is a slug the list does not contain. That is not a bug
 * to guard against but a state the app really reaches: another device can
 * delete a custom category while this tab still holds expenses that used it.
 */

import { describe, it, expect } from 'vitest';
import { categoryColor, categoryLabel, stackedCategorySeries, FALLBACK_CATEGORY_COLOR } from '../utils/categories';
import { TEST_CATEGORIES } from './categories.fixture';

describe('categoryLabel', () => {
  it('returns the label of a known category', () => {
    expect(categoryLabel(TEST_CATEGORIES, 'groceries')).toBe('Groceries');
  });

  it('prefers a renamed label over the slug', () => {
    const renamed = TEST_CATEGORIES.map(c => (c.slug === 'media' ? { ...c, label: 'Subscriptions' } : c));
    expect(categoryLabel(renamed, 'media')).toBe('Subscriptions');
  });

  it('renders an unknown slug readably rather than blank', () => {
    expect(categoryLabel(TEST_CATEGORIES, 'pet-food')).toBe('Pet food');
    expect(categoryLabel([], 'groceries')).toBe('Groceries');
  });

  it('returns an empty string for an empty slug', () => {
    expect(categoryLabel(TEST_CATEGORIES, '')).toBe('');
  });
});

describe('categoryColor', () => {
  it('returns the stored colour of a known category', () => {
    expect(categoryColor(TEST_CATEGORIES, 'transport')).toBe('#60a5fa');
  });

  it('falls back to neutral grey for an unknown slug', () => {
    expect(categoryColor(TEST_CATEGORIES, 'pet-food')).toBe(FALLBACK_CATEGORY_COLOR);
  });
});

describe('stackedCategorySeries', () => {
  it('emits one series per category, in display order', () => {
    const series = stackedCategorySeries(TEST_CATEGORIES, ['groceries', 'media']);

    expect(series.map(s => s.slug)).toEqual(TEST_CATEGORIES.map(c => c.slug));
    expect(series[0]).toEqual({ slug: 'groceries', color: '#34d399' });
  });

  it('appends a fallback series for a slug the list does not have', () => {
    // Otherwise those amounts count towards the total and the donut but vanish
    // from the stack, which then adds up to less than the figure beside it.
    const series = stackedCategorySeries(TEST_CATEGORIES, ['groceries', 'pet-food']);

    expect(series).toHaveLength(TEST_CATEGORIES.length + 1);
    expect(series[series.length - 1]).toEqual({ slug: 'pet-food', color: FALLBACK_CATEGORY_COLOR });
  });

  it('deduplicates and orders the unknown slugs', () => {
    const series = stackedCategorySeries(TEST_CATEGORIES, ['zebra', 'pet-food', 'zebra']);

    expect(series.slice(TEST_CATEGORIES.length).map(s => s.slug)).toEqual(['pet-food', 'zebra']);
  });

  it('adds nothing when every slug in use is known', () => {
    expect(stackedCategorySeries(TEST_CATEGORIES, ['groceries', 'other'])).toHaveLength(TEST_CATEGORIES.length);
  });
});
