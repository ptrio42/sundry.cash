/**
 * Tests for categories-as-data: the /api/categories endpoints, the migration
 * that replaced the CHECK constraint, and the rules that keep the ledger from
 * pointing at a category that no longer exists.
 *
 * Everything runs against the throwaway test DB (see src/tests/env.ts), so the
 * custom categories created here never reach the developer's real database.
 */

import request from 'supertest';
import app from '../server';
import { db, initializeDatabase } from '../config/database';

/** The seven slugs the app has always shipped, in display order. */
const BUILTIN_SLUGS = ['groceries', 'transport', 'media', 'entertainment', 'utilities', 'maintenance', 'other'];

/** Slugs created by this suite, removed afterwards so other suites see a clean table. */
const createdSlugs = new Set<string>();
const createdExpenseIds: number[] = [];

async function createCategory(body: Record<string, unknown>): Promise<request.Response> {
  const res = await request(app).post('/api/categories').send(body);
  if (res.status === 201) createdSlugs.add(res.body.slug);
  return res;
}

afterAll(async () => {
  for (const id of createdExpenseIds) {
    await request(app).delete(`/api/expenses/${id}`);
  }
  for (const slug of createdSlugs) {
    await request(app).delete(`/api/categories/${slug}?reassignTo=other`);
  }
  await request(app).delete('/api/budgets/other?currency=USD');
});

describe('GET /api/categories', () => {
  it('returns the seven built-ins, in display order', async () => {
    const res = await request(app).get('/api/categories').expect(200);
    const slugs = res.body.map((c: { slug: string }) => c.slug);
    expect(slugs.slice(0, BUILTIN_SLUGS.length)).toEqual(BUILTIN_SLUGS);
  });

  it('carries the label, colour and built-in flag for each row', async () => {
    const res = await request(app).get('/api/categories').expect(200);
    const groceries = res.body.find((c: { slug: string }) => c.slug === 'groceries');
    expect(groceries).toMatchObject({
      slug: 'groceries',
      label: 'Groceries',
      color: '#34d399',
      isBuiltin: true,
    });
  });
});

describe('POST /api/categories', () => {
  it('creates a custom category and appends it to the list', async () => {
    const res = await createCategory({ slug: 'travel', label: 'Travel', color: '#22d3ee' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ slug: 'travel', label: 'Travel', color: '#22d3ee', isBuiltin: false });

    const list = await request(app).get('/api/categories').expect(200);
    expect(list.body[list.body.length - 1].slug).toBe('travel');
  });

  it('rejects a slug that is not lowercase-kebab', async () => {
    const res = await createCategory({ slug: 'Not Valid', label: 'Nope', color: '#ffffff' });
    expect(res.status).toBe(400);
    expect(res.body.details.join(' ')).toMatch(/lowercase letters, digits and hyphens/i);
  });

  it('rejects a duplicate slug', async () => {
    const res = await createCategory({ slug: 'groceries', label: 'Groceries again', color: '#ffffff' });
    expect(res.status).toBe(400);
    expect(res.body.details.join(' ')).toMatch(/already exists/i);
  });

  it('rejects a reserved slug', async () => {
    const res = await createCategory({ slug: 'all', label: 'All', color: '#ffffff' });
    expect(res.status).toBe(400);
    expect(res.body.details.join(' ')).toMatch(/reserved/i);
  });

  it('rejects a colour that is not six-digit hex', async () => {
    const res = await createCategory({ slug: 'badcolor', label: 'Bad', color: 'red' });
    expect(res.status).toBe(400);
    expect(res.body.details.join(' ')).toMatch(/hex value/i);
  });

  it('rejects an empty label', async () => {
    const res = await createCategory({ slug: 'nolabel', label: '   ', color: '#ffffff' });
    expect(res.status).toBe(400);
  });
});

describe('PUT /api/categories/:slug', () => {
  it('renames and recolours a built-in without touching its slug', async () => {
    const res = await request(app)
      .put('/api/categories/media')
      .send({ label: 'Subscriptions', color: '#c4b5fd' })
      .expect(200);
    expect(res.body).toMatchObject({ slug: 'media', label: 'Subscriptions', color: '#c4b5fd', isBuiltin: true });

    // Restore, so the rest of the suite sees the shipped label.
    await request(app).put('/api/categories/media').send({ label: 'Media', color: '#a78bfa' }).expect(200);
  });

  it('reorders via sortOrder', async () => {
    await createCategory({ slug: 'first-please', label: 'First', color: '#ffffff' });
    await request(app).put('/api/categories/first-please').send({ sortOrder: -1 }).expect(200);

    const list = await request(app).get('/api/categories').expect(200);
    expect(list.body[0].slug).toBe('first-please');
  });

  it('404s for a category that does not exist', async () => {
    await request(app).put('/api/categories/nope').send({ label: 'Nope' }).expect(404);
  });

  it('rejects an empty label', async () => {
    await request(app).put('/api/categories/other').send({ label: '' }).expect(400);
  });
});

describe('DELETE /api/categories/:slug', () => {
  it('refuses to delete a built-in', async () => {
    const res = await request(app).delete('/api/categories/other').expect(403);
    expect(res.body.error).toMatch(/built-in/i);

    // Still there — `services/categorize.ts` and the importer both rely on it.
    const list = await request(app).get('/api/categories').expect(200);
    expect(list.body.some((c: { slug: string }) => c.slug === 'other')).toBe(true);
  });

  it('deletes an unused custom category outright', async () => {
    await createCategory({ slug: 'unused', label: 'Unused', color: '#ffffff' });
    await request(app).delete('/api/categories/unused').expect(204);
    createdSlugs.delete('unused');

    const list = await request(app).get('/api/categories').expect(200);
    expect(list.body.some((c: { slug: string }) => c.slug === 'unused')).toBe(false);
  });

  it('returns 409 with the usage count when the category is in use', async () => {
    await createCategory({ slug: 'in-use', label: 'In use', color: '#ffffff' });
    const expense = await request(app)
      .post('/api/expenses')
      .send({ amount: 12.5, date: '2024-06-01', description: 'Uses a custom category', category: 'in-use', currency: 'USD' })
      .expect(201);
    createdExpenseIds.push(expense.body.id);

    const res = await request(app).delete('/api/categories/in-use').expect(409);
    expect(res.body.usage).toEqual({ expenses: 1, budgets: 0 });
    expect(res.body.error).toMatch(/reassignTo/);
  });

  it('returns 409 for a category used only by a budget, not a raw FK error', async () => {
    // A budget is a reference too. Without this the DELETE hits the foreign key
    // and surfaces as a 500 — the exact "never let the FK fail with a raw
    // SQLite error" the spec calls out.
    await createCategory({ slug: 'budget-only', label: 'Budget only', color: '#ffffff' });
    await request(app).put('/api/budgets').send({ category: 'budget-only', currency: 'PLN', amount: 50 }).expect(200);

    const res = await request(app).delete('/api/categories/budget-only').expect(409);
    expect(res.body.usage).toEqual({ expenses: 0, budgets: 1 });

    await request(app).delete('/api/categories/budget-only?reassignTo=other').expect(204);
    createdSlugs.delete('budget-only');
    await request(app).delete('/api/budgets/other?currency=PLN');
  });

  it('rejects a reassignTo that names no category', async () => {
    await request(app).delete('/api/categories/in-use?reassignTo=ghost').expect(400);
  });

  it('moves the rows over when reassignTo is given', async () => {
    await request(app).put('/api/budgets').send({ category: 'in-use', currency: 'USD', amount: 100 }).expect(200);

    await request(app).delete('/api/categories/in-use?reassignTo=other').expect(204);
    createdSlugs.delete('in-use');

    const expenses = await request(app).get('/api/expenses?category=other').expect(200);
    expect(expenses.body.some((e: { description: string }) => e.description === 'Uses a custom category')).toBe(true);

    const budgets = await request(app).get('/api/budgets').expect(200);
    const moved = budgets.body.find((b: { category: string; currency: string }) => b.category === 'other' && b.currency === 'USD');
    expect(moved.amount).toBe(100);

    // Nothing is left pointing at the deleted slug.
    const list = await request(app).get('/api/categories').expect(200);
    expect(list.body.some((c: { slug: string }) => c.slug === 'in-use')).toBe(false);
  });

  it('sums the limits when both categories have a budget in the same currency', async () => {
    await createCategory({ slug: 'merge-me', label: 'Merge me', color: '#ffffff' });
    await request(app).put('/api/budgets').send({ category: 'merge-me', currency: 'USD', amount: 40 }).expect(200);
    // 'other' already carries a 100 USD limit from the test above.

    await request(app).delete('/api/categories/merge-me?reassignTo=other').expect(204);
    createdSlugs.delete('merge-me');

    const budgets = await request(app).get('/api/budgets').expect(200);
    const rows = budgets.body.filter((b: { category: string; currency: string }) => b.category === 'other' && b.currency === 'USD');
    expect(rows).toHaveLength(1);
    expect(rows[0].amount).toBe(140);
  });
});

describe('expenses against a data-driven category list', () => {
  it('accepts a custom category', async () => {
    await createCategory({ slug: 'pets', label: 'Pets', color: '#f472b6' });
    const res = await request(app)
      .post('/api/expenses')
      .send({ amount: 30, date: '2024-06-02', description: 'Dog food', category: 'pets', currency: 'USD' })
      .expect(201);
    createdExpenseIds.push(res.body.id);
    expect(res.body.category).toBe('pets');
  });

  it('still rejects a category that is not a row, listing the live set', async () => {
    const res = await request(app)
      .post('/api/expenses')
      .send({ amount: 1, date: '2024-06-02', description: 'Nope', category: 'not-a-category', currency: 'USD' })
      .expect(400);
    expect(res.body.details.join(' ')).toContain('Category must be one of:');
    expect(res.body.details.join(' ')).toContain('pets');
  });
});

describe('migration', () => {
  it('is idempotent — running initializeDatabase again changes nothing', () => {
    const before = db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name IN ('expenses','budgets','categories') ORDER BY name`).all();
    const categoriesBefore = db.prepare('SELECT * FROM categories ORDER BY slug').all();

    expect(() => initializeDatabase()).not.toThrow();
    expect(() => initializeDatabase()).not.toThrow();

    expect(db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name IN ('expenses','budgets','categories') ORDER BY name`).all()).toEqual(before);
    expect(db.prepare('SELECT * FROM categories ORDER BY slug').all()).toEqual(categoriesBefore);
  });

  it('keeps a renamed built-in renamed across a restart', () => {
    // The seeding statement runs on every start. If it were OR REPLACE rather
    // than OR IGNORE it would quietly restore the shipped label and colour,
    // making the rename in Settings look like it worked until the next restart.
    db.prepare(`UPDATE categories SET label = 'Food shopping', color = '#ff0000', sort_order = 42 WHERE slug = 'groceries'`).run();

    initializeDatabase();

    expect(db.prepare(`SELECT label, color, sort_order FROM categories WHERE slug = 'groceries'`).get()).toEqual({
      label: 'Food shopping',
      color: '#ff0000',
      sort_order: 42,
    });

    db.prepare(`UPDATE categories SET label = 'Groceries', color = '#34d399', sort_order = 0 WHERE slug = 'groceries'`).run();
  });

  it('left no category CHECK constraint behind', () => {
    const ddl = db
      .prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name IN ('expenses','budgets')`)
      .all() as { sql: string }[];
    ddl.forEach(row => expect(row.sql).not.toContain('CHECK(category IN'));
    ddl.forEach(row => expect(row.sql).toContain('REFERENCES categories(slug)'));
  });

  it('keeps a custom category and its receipt links across a restart', () => {
    // A re-init is the closest thing to a process restart the suite can do.
    // It also guards the trap that the legacy "add maintenance" migration used
    // to spring once the CHECK constraint was gone: that one recreates
    // `expenses` without copying `receipt_image`, silently dropping every
    // attached photo on the next start.
    db.prepare(
      `INSERT INTO expenses (amount, date, description, category, currency, receipt_image)
       VALUES (100, '2024-06-03', 'Has a photo', 'pets', 'USD', 'receipt-1-abcd.png')`
    ).run();

    initializeDatabase();

    const row = db.prepare(`SELECT category, receipt_image FROM expenses WHERE description = 'Has a photo'`).get() as
      | { category: string; receipt_image: string | null }
      | undefined;
    expect(row).toEqual({ category: 'pets', receipt_image: 'receipt-1-abcd.png' });
    expect(db.prepare(`SELECT 1 FROM categories WHERE slug = 'pets'`).get()).toBeDefined();

    db.prepare(`DELETE FROM expenses WHERE description = 'Has a photo'`).run();
  });

  it('refuses an expense whose category is not a row, at the database level too', () => {
    expect(() =>
      db.prepare(
        `INSERT INTO expenses (amount, date, description, category, currency) VALUES (1, '2024-06-04', 'FK check', 'ghost', 'USD')`
      ).run()
    ).toThrow(/FOREIGN KEY/i);
  });
});

/**
 * The upgrade itself. A fresh database is created in the new shape and skips
 * the migration entirely, so the only way to cover the path an existing install
 * actually takes is to put the old shape back and run `initializeDatabase()`
 * over it. Runs last in the file: it rebuilds `expenses` and `budgets` in
 * place, and leaves them migrated (i.e. correct) afterwards.
 */
describe('migration from the CHECK-constrained schema', () => {
  const LEGACY_CATEGORY_CHECK =
    `CHECK(category IN ('groceries', 'transport', 'media', 'entertainment', 'utilities', 'maintenance', 'other'))`;

  /** Rebuild `expenses`/`budgets` exactly as they looked before this change. */
  function restoreLegacySchema(): void {
    db.exec('PRAGMA foreign_keys = OFF');
    db.exec('BEGIN TRANSACTION');
    db.exec(`
      CREATE TABLE expenses_legacy (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        amount INTEGER NOT NULL CHECK(amount > 0),
        date TEXT NOT NULL,
        description TEXT NOT NULL CHECK(length(description) > 0),
        category TEXT NOT NULL ${LEGACY_CATEGORY_CHECK},
        currency TEXT DEFAULT 'USD' CHECK(currency IN ('USD', 'PLN', 'BTC')),
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        receipt_image TEXT
      )
    `);
    db.exec(`
      CREATE TABLE budgets_legacy (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        category TEXT NOT NULL ${LEGACY_CATEGORY_CHECK},
        currency TEXT NOT NULL CHECK(currency IN ('USD', 'PLN', 'BTC')),
        amount INTEGER NOT NULL CHECK(amount > 0),
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(category, currency)
      )
    `);
    // Only rows the old CHECK would have allowed — a real legacy DB can hold
    // nothing else.
    db.exec(`INSERT INTO expenses_legacy SELECT * FROM expenses WHERE category IN (${BUILTIN_SLUGS.map(s => `'${s}'`).join(', ')})`);
    db.exec(`INSERT INTO budgets_legacy SELECT * FROM budgets WHERE category IN (${BUILTIN_SLUGS.map(s => `'${s}'`).join(', ')})`);
    db.exec('DROP TABLE expenses');
    db.exec('DROP TABLE budgets');
    db.exec('ALTER TABLE expenses_legacy RENAME TO expenses');
    db.exec('ALTER TABLE budgets_legacy RENAME TO budgets');
    db.exec('COMMIT');
    db.exec('PRAGMA foreign_keys = ON');
  }

  it('drops the constraint, keeps every row, and adds the foreign key', () => {
    restoreLegacySchema();
    db.prepare(
      `INSERT INTO expenses (amount, date, description, category, currency, receipt_image)
       VALUES (2500, '2024-07-01', 'Legacy row', 'groceries', 'USD', 'receipt-9-feed.png')`
    ).run();
    db.prepare(`INSERT INTO budgets (category, currency, amount) VALUES ('transport', 'PLN', 30000)`).run();

    const expensesBefore = db.prepare('SELECT * FROM expenses ORDER BY id').all();
    const budgetsBefore = db.prepare('SELECT * FROM budgets ORDER BY id').all();
    expect(
      (db.prepare(`SELECT sql FROM sqlite_master WHERE name='expenses'`).get() as { sql: string }).sql
    ).toContain('CHECK(category IN');

    initializeDatabase();

    for (const table of ['expenses', 'budgets']) {
      const { sql } = db.prepare(`SELECT sql FROM sqlite_master WHERE name=?`).get(table) as { sql: string };
      expect(sql).not.toContain('CHECK(category IN');
      expect(sql).toContain('REFERENCES categories(slug)');
    }

    // Not one row rewritten — including the receipt link, which the two older
    // table-recreate migrations do not carry across.
    expect(db.prepare('SELECT * FROM expenses ORDER BY id').all()).toEqual(expensesBefore);
    expect(db.prepare('SELECT * FROM budgets ORDER BY id').all()).toEqual(budgetsBefore);

    db.prepare(`DELETE FROM expenses WHERE description = 'Legacy row'`).run();
    db.prepare(`DELETE FROM budgets WHERE category = 'transport' AND currency = 'PLN'`).run();
  });
});
