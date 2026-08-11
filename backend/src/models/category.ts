/**
 * Category model — categories are rows, not a compile-time enum.
 *
 * `expenses.category` and `budgets.category` are foreign keys into this table,
 * so every write path has to check against it rather than against a literal
 * array. The lookups here are the replacement for that array; better-sqlite3 is
 * synchronous and these are single-row primary-key hits, so they are cheap
 * enough to call per request without a cache to keep in sync.
 */

import { db } from '../config/database';
import { Category } from '../types/expense.types';

interface CategoryRow {
  slug: string;
  label: string;
  color: string;
  sort_order: number;
  is_builtin: number;
}

function toCategory(row: CategoryRow): Category {
  return {
    slug: row.slug,
    label: row.label,
    color: row.color,
    sortOrder: row.sort_order,
    isBuiltin: row.is_builtin === 1,
  };
}

/** Every category, in display order. */
export function getAll(): Category[] {
  const rows = db
    .prepare('SELECT slug, label, color, sort_order, is_builtin FROM categories ORDER BY sort_order, label')
    .all() as CategoryRow[];
  return rows.map(toCategory);
}

export function getBySlug(slug: string): Category | undefined {
  const row = db
    .prepare('SELECT slug, label, color, sort_order, is_builtin FROM categories WHERE slug = ?')
    .get(slug) as CategoryRow | undefined;
  return row ? toCategory(row) : undefined;
}

/** Whether `slug` names a real category. The validation primitive. */
export function exists(slug: unknown): boolean {
  if (typeof slug !== 'string') return false;
  return db.prepare('SELECT 1 FROM categories WHERE slug = ?').get(slug) !== undefined;
}

/** Every slug, in display order — for "must be one of: …" error messages. */
export function allSlugs(): string[] {
  return (db.prepare('SELECT slug FROM categories ORDER BY sort_order, label').all() as { slug: string }[])
    .map(row => row.slug);
}

/** Create a user-defined category. Always `is_builtin = 0`; only we ship built-ins. */
export function create(input: { slug: string; label: string; color: string; sortOrder?: number }): Category {
  // Default new categories to the end of the list rather than the front, so
  // adding one never reshuffles what the user is used to seeing.
  const nextOrder =
    input.sortOrder ??
    ((db.prepare('SELECT MAX(sort_order) AS max FROM categories').get() as { max: number | null }).max ?? -1) + 1;

  db.prepare(
    'INSERT INTO categories (slug, label, color, sort_order, is_builtin) VALUES (?, ?, ?, ?, 0)'
  ).run(input.slug, input.label, input.color, nextOrder);

  return getBySlug(input.slug)!;
}

/**
 * Update presentation only. The slug is the value stored on every expense, so
 * changing it would be a data migration; the API does not offer it.
 */
export function update(
  slug: string,
  changes: { label?: string; color?: string; sortOrder?: number }
): Category | undefined {
  if (!getBySlug(slug)) return undefined;

  const updates: string[] = [];
  const params: unknown[] = [];

  if (changes.label !== undefined) {
    updates.push('label = ?');
    params.push(changes.label);
  }
  if (changes.color !== undefined) {
    updates.push('color = ?');
    params.push(changes.color);
  }
  if (changes.sortOrder !== undefined) {
    updates.push('sort_order = ?');
    params.push(changes.sortOrder);
  }

  if (updates.length > 0) {
    params.push(slug);
    db.prepare(`UPDATE categories SET ${updates.join(', ')} WHERE slug = ?`).run(...params);
  }

  return getBySlug(slug);
}

/** How much would break if this category disappeared. */
export function usage(slug: string): { expenses: number; budgets: number } {
  const expenses = (db.prepare('SELECT COUNT(*) AS n FROM expenses WHERE category = ?').get(slug) as { n: number }).n;
  const budgets = (db.prepare('SELECT COUNT(*) AS n FROM budgets WHERE category = ?').get(slug) as { n: number }).n;
  return { expenses, budgets };
}

/**
 * Delete a category, first moving everything that points at it to `reassignTo`.
 *
 * The caller (routes/categories.ts) is what refuses built-ins and refuses an
 * in-use category with no target; this function assumes both have been checked
 * and only guarantees that the move and the delete happen together, so a
 * failure never leaves rows pointing at a slug that is gone.
 *
 * Budgets need more than a plain UPDATE because of `UNIQUE(category, currency)`:
 * if both categories have a limit in the same currency, moving the row would
 * collide. The two limits are added instead — the target is absorbing the
 * source's spending, so it inherits the allowance that went with it.
 */
const removeTransaction = db.transaction((slug: string, reassignTo?: string): boolean => {
  if (reassignTo) {
    db.prepare(
      `UPDATE budgets SET amount = amount + (
         SELECT source.amount FROM budgets source
         WHERE source.category = @from AND source.currency = budgets.currency
       )
       WHERE category = @to
         AND EXISTS (
           SELECT 1 FROM budgets source
           WHERE source.category = @from AND source.currency = budgets.currency
         )`
    ).run({ from: slug, to: reassignTo });

    db.prepare(
      `DELETE FROM budgets
       WHERE category = @from
         AND currency IN (SELECT currency FROM budgets WHERE category = @to)`
    ).run({ from: slug, to: reassignTo });

    db.prepare('UPDATE budgets SET category = @to WHERE category = @from').run({ from: slug, to: reassignTo });
    db.prepare('UPDATE expenses SET category = @to WHERE category = @from').run({ from: slug, to: reassignTo });
  }

  return db.prepare('DELETE FROM categories WHERE slug = ?').run(slug).changes > 0;
});

export function remove(slug: string, reassignTo?: string): boolean {
  return removeTransaction(slug, reassignTo);
}
