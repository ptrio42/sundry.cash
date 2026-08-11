/**
 * The category list components are given in tests.
 *
 * Mirrors the seven the backend seeds (slug, label and colour), so a test that
 * asserts on a rendered category name is asserting on the same string a real
 * install would show.
 */

import { Category } from '../types/expense.types';

export const TEST_CATEGORIES: Category[] = [
  { slug: 'groceries', label: 'Groceries', color: '#34d399', sortOrder: 0, isBuiltin: true },
  { slug: 'transport', label: 'Transport', color: '#60a5fa', sortOrder: 1, isBuiltin: true },
  { slug: 'media', label: 'Media', color: '#a78bfa', sortOrder: 2, isBuiltin: true },
  { slug: 'entertainment', label: 'Entertainment', color: '#fbbf24', sortOrder: 3, isBuiltin: true },
  { slug: 'utilities', label: 'Utilities', color: '#f87171', sortOrder: 4, isBuiltin: true },
  { slug: 'maintenance', label: 'Maintenance', color: '#fb923c', sortOrder: 5, isBuiltin: true },
  { slug: 'other', label: 'Other', color: '#94a3b8', sortOrder: 6, isBuiltin: true },
];
