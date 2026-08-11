/**
 * Tests for currencies-as-data.
 *
 * The rule this suite exists for is the one the spec calls a hard rule:
 * `minor_units` is immutable once anything references the code. Everything
 * else here — enable/disable, the catalogue, the migration — is in service of
 * making sure that rule cannot be routed around.
 */

import request from 'supertest';
import app from '../server';
import { db, initializeDatabase } from '../config/database';
import * as CurrencyModel from '../models/currency';
import { toMinorUnits, toMajorUnits } from '../config/money';

/** Enabled out of the box, so upgrading changes nothing. */
const DEFAULT_ENABLED = ['BTC', 'PLN', 'USD'];

const createdExpenseIds: number[] = [];

afterAll(async () => {
  for (const id of createdExpenseIds) {
    await request(app).delete(`/api/expenses/${id}`);
  }
  // Leave the catalogue as we found it for any suite that runs after this one.
  db.prepare(`UPDATE currencies SET enabled = 0 WHERE code NOT IN ('USD','PLN','BTC')`).run();
  db.prepare(`UPDATE currencies SET enabled = 1 WHERE code IN ('USD','PLN','BTC')`).run();
  CurrencyModel.refreshCache();
});

describe('GET /api/currencies', () => {
  it('ships a catalogue with only USD, PLN and BTC enabled', async () => {
    const res = await request(app).get('/api/currencies').expect(200);

    expect(res.body.length).toBeGreaterThan(30);
    expect(res.body.filter((c: { enabled: boolean }) => c.enabled).map((c: { code: string }) => c.code).sort())
      .toEqual(DEFAULT_ENABLED);
  });

  it('carries the exponent, symbol and locale for each entry', async () => {
    const res = await request(app).get('/api/currencies').expect(200);
    const byCode = new Map(res.body.map((c: { code: string }) => [c.code, c]));

    expect(byCode.get('USD')).toMatchObject({ minorUnits: 100, symbol: '$', locale: 'en-US', enabled: true });
    expect(byCode.get('BTC')).toMatchObject({ minorUnits: 100_000_000, symbol: '₿', enabled: true });
    expect(byCode.get('EUR')).toMatchObject({ minorUnits: 100, symbol: '€', enabled: false });
  });

  it('gets the exponent right for the currencies a guess would get wrong', async () => {
    const res = await request(app).get('/api/currencies').expect(200);
    const units = (code: string) => res.body.find((c: { code: string }) => c.code === code)?.minorUnits;

    expect(units('JPY')).toBe(1);        // no minor unit at all
    expect(units('KRW')).toBe(1);
    expect(units('KWD')).toBe(1000);     // three decimals
    expect(units('BHD')).toBe(1000);
    expect(units('CLF')).toBe(10_000);   // four
  });
});

describe('PUT /api/currencies/:code', () => {
  it('enables a currency, which then becomes usable for new expenses', async () => {
    const before = await request(app)
      .post('/api/expenses')
      .send({ amount: 10, date: '2024-08-01', description: 'Too early for EUR', category: 'other', currency: 'EUR' })
      .expect(400);
    expect(before.body.details.join(' ')).toMatch(/Currency must be one of/);

    const res = await request(app).put('/api/currencies/EUR').send({ enabled: true }).expect(200);
    expect(res.body).toMatchObject({ code: 'EUR', enabled: true });

    const after = await request(app)
      .post('/api/expenses')
      .send({ amount: 10.5, date: '2024-08-01', description: 'Now EUR works', category: 'other', currency: 'EUR' })
      .expect(201);
    createdExpenseIds.push(after.body.id);
    expect(after.body).toMatchObject({ currency: 'EUR', amount: 10.5 });
  });

  it('404s for a code the catalogue does not have', async () => {
    await request(app).put('/api/currencies/ZZZ').send({ enabled: true }).expect(404);
  });

  it('rejects anything but a boolean', async () => {
    await request(app).put('/api/currencies/EUR').send({ enabled: 'yes' }).expect(400);
    await request(app).put('/api/currencies/EUR').send({}).expect(400);
  });

  it('refuses to disable the currency the settings still point at', async () => {
    await request(app).put('/api/settings').send({ defaultCurrency: 'EUR' }).expect(200);

    const res = await request(app).put('/api/currencies/EUR').send({ enabled: false }).expect(409);
    expect(res.body.usedBy).toContain('default currency');

    await request(app).put('/api/settings').send({ defaultCurrency: 'USD' }).expect(200);
  });
});

describe('disabling keeps history readable', () => {
  it('does not hide, delete or lock the expenses recorded in it', async () => {
    const created = await request(app)
      .post('/api/expenses')
      .send({ amount: 20, date: '2024-08-02', description: 'Spent while EUR was on', category: 'other', currency: 'EUR' })
      .expect(201);
    createdExpenseIds.push(created.body.id);

    await request(app).put('/api/currencies/EUR').send({ enabled: false }).expect(200);

    // Still listed, still fetchable, still the right amount.
    const list = await request(app).get('/api/expenses?currency=EUR').expect(200);
    expect(list.body.some((e: { id: number }) => e.id === created.body.id)).toBe(true);
    expect((await request(app).get(`/api/expenses/${created.body.id}`).expect(200)).body.amount).toBe(20);

    // And still editable — rejecting the PUT would strand the row.
    const edited = await request(app)
      .put(`/api/expenses/${created.body.id}`)
      .send({ amount: 21 })
      .expect(200);
    expect(edited.body).toMatchObject({ amount: 21, currency: 'EUR' });
  });

  it('still refuses a disabled currency for a brand-new expense', async () => {
    await request(app)
      .post('/api/expenses')
      .send({ amount: 5, date: '2024-08-03', description: 'EUR is off again', category: 'other', currency: 'EUR' })
      .expect(400);
  });

  it('keeps its exchange rate settable, because that is what converts the history', async () => {
    await request(app).put('/api/fx').send({ currency: 'EUR', rate: 1.09 }).expect(200);
    const res = await request(app).get('/api/fx').expect(200);
    expect(res.body.rates.EUR).toBeCloseTo(1.09);
  });

  it('refuses a rate for a currency that is neither enabled nor ever used', async () => {
    await request(app).put('/api/fx').send({ currency: 'JPY', rate: 0.0067 }).expect(400);
  });
});

describe('minor_units immutability (the hard rule)', () => {
  it('can be corrected while nothing references the code', () => {
    // JPY is enabled nowhere and used nowhere at this point.
    expect(CurrencyModel.usage('JPY')).toEqual({ expenses: 0, budgets: 0 });

    expect(() => CurrencyModel.setMinorUnits('JPY', 100)).not.toThrow();
    expect(CurrencyModel.getByCode('JPY')?.minorUnits).toBe(100);

    CurrencyModel.setMinorUnits('JPY', 1);
    expect(CurrencyModel.getByCode('JPY')?.minorUnits).toBe(1);
  });

  it('throws once an expense references the code, naming what would break', async () => {
    await request(app).put('/api/currencies/JPY').send({ enabled: true }).expect(200);
    const created = await request(app)
      .post('/api/expenses')
      .send({ amount: 1500, date: '2024-08-04', description: 'Ramen', category: 'groceries', currency: 'JPY' })
      .expect(201);
    createdExpenseIds.push(created.body.id);

    expect(() => CurrencyModel.setMinorUnits('JPY', 100)).toThrow(/Cannot change minor_units for JPY/);
    expect(CurrencyModel.getByCode('JPY')?.minorUnits).toBe(1);
  });

  it('throws for a budget too, not just an expense', async () => {
    await request(app).put('/api/currencies/SEK').send({ enabled: true }).expect(200);
    await request(app).put('/api/budgets').send({ category: 'other', currency: 'SEK', amount: 500 }).expect(200);

    expect(() => CurrencyModel.setMinorUnits('SEK', 1)).toThrow(/1 budget\(s\)/);

    await request(app).delete('/api/budgets/other?currency=SEK').expect(204);
    await request(app).put('/api/currencies/SEK').send({ enabled: false }).expect(200);
  });

  it('rejects a nonsensical exponent outright', () => {
    expect(() => CurrencyModel.setMinorUnits('SEK', 0)).toThrow(/positive integer/);
    expect(() => CurrencyModel.setMinorUnits('SEK', 2.5)).toThrow(/positive integer/);
  });

  it('leaves a referenced exponent alone when the catalogue is re-seeded', () => {
    // The reconciliation pass in initializeDatabase applies corrected catalogue
    // values — but only where nothing would be reinterpreted. JPY has an
    // expense, so a deliberately wrong stored value must survive a restart
    // rather than be "fixed" underneath it.
    db.prepare(`UPDATE currencies SET minor_units = 7 WHERE code = 'JPY'`).run();

    initializeDatabase();

    expect((db.prepare(`SELECT minor_units FROM currencies WHERE code = 'JPY'`).get() as { minor_units: number }).minor_units).toBe(7);

    // Put it back by hand — the model would refuse, which is the point.
    db.prepare(`UPDATE currencies SET minor_units = 1 WHERE code = 'JPY'`).run();
    CurrencyModel.refreshCache();
  });
});

describe('money conversion follows the table', () => {
  it('uses each currency’s own exponent', () => {
    expect(toMinorUnits(50.99, 'USD')).toBe(5099);
    expect(toMinorUnits(0.0005, 'BTC')).toBe(50_000);
    expect(toMinorUnits(1500, 'JPY')).toBe(1500);   // no minor unit
    expect(toMajorUnits(1500, 'JPY')).toBe(1500);
  });

  it('round-trips a three-decimal currency', () => {
    expect(toMinorUnits(12.345, 'KWD')).toBe(12_345);
    expect(toMajorUnits(12_345, 'KWD')).toBeCloseTo(12.345, 6);
  });

  it('refuses to guess for a currency the catalogue does not have', () => {
    // Defaulting to 100 would write a number nobody can interpret later.
    expect(() => toMinorUnits(10, 'ZZZ')).toThrow(/Unknown currency/);
  });

  it('stores a JPY amount as a whole number of yen, not as cents', async () => {
    const created = await request(app)
      .post('/api/expenses')
      .send({ amount: 980, date: '2024-08-05', description: 'Bento', category: 'groceries', currency: 'JPY' })
      .expect(201);
    createdExpenseIds.push(created.body.id);

    const stored = db.prepare('SELECT amount FROM expenses WHERE id = ?').get(created.body.id) as { amount: number };
    expect(stored.amount).toBe(980);
    expect(created.body.amount).toBe(980);
  });
});

describe('migration', () => {
  it('is idempotent — running initializeDatabase again changes nothing', () => {
    const before = db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name IN ('expenses','budgets','fx_rates','currencies') ORDER BY name`).all();
    const currenciesBefore = db.prepare('SELECT * FROM currencies ORDER BY code').all();

    initializeDatabase();
    initializeDatabase();

    expect(db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name IN ('expenses','budgets','fx_rates','currencies') ORDER BY name`).all()).toEqual(before);
    expect(db.prepare('SELECT * FROM currencies ORDER BY code').all()).toEqual(currenciesBefore);
  });

  it('does not re-enable a currency the user turned off', () => {
    db.prepare(`UPDATE currencies SET enabled = 0 WHERE code = 'PLN'`).run();

    initializeDatabase();

    expect((db.prepare(`SELECT enabled FROM currencies WHERE code = 'PLN'`).get() as { enabled: number }).enabled).toBe(0);
    db.prepare(`UPDATE currencies SET enabled = 1 WHERE code = 'PLN'`).run();
  });

  it('left no currency CHECK constraint behind', () => {
    const ddl = db
      .prepare(`SELECT name, sql FROM sqlite_master WHERE type='table' AND name IN ('expenses','budgets','fx_rates')`)
      .all() as { name: string; sql: string }[];

    expect(ddl).toHaveLength(3);
    ddl.forEach(row => {
      expect(row.sql).not.toContain('CHECK(currency IN');
      expect(row.sql).toContain('REFERENCES currencies(code)');
    });
  });

  it('refuses an expense in a currency that is not a row, at the database level too', () => {
    expect(() =>
      db.prepare(
        `INSERT INTO expenses (amount, date, description, category, currency) VALUES (1, '2024-08-06', 'FK check', 'other', 'ZZZ')`
      ).run()
    ).toThrow(/FOREIGN KEY/i);
  });
});

/**
 * The upgrade path. A fresh database is built in the new shape and skips the
 * migration, so the only way to cover what an existing install actually does is
 * to put the old schema back and run `initializeDatabase()` over it.
 */
describe('migration from the CHECK-constrained schema', () => {
  const LEGACY_CURRENCY_CHECK = `CHECK(currency IN ('USD', 'PLN', 'BTC'))`;

  function restoreLegacySchema(): void {
    db.exec('PRAGMA foreign_keys = OFF');
    db.exec('BEGIN TRANSACTION');
    try {
      rebuildLegacyTables();
      db.exec('COMMIT');
    } catch (error) {
      // Without the rollback a failed rebuild leaves the transaction open, and
      // every later suite in the run dies on "database is locked" rather than
      // showing what actually broke here.
      db.exec('ROLLBACK');
      throw error;
    } finally {
      db.exec('PRAGMA foreign_keys = ON');
    }
  }

  function rebuildLegacyTables(): void {
    db.exec(`
      CREATE TABLE expenses_legacy (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        amount INTEGER NOT NULL CHECK(amount > 0),
        date TEXT NOT NULL,
        description TEXT NOT NULL CHECK(length(description) > 0),
        category TEXT NOT NULL,
        currency TEXT DEFAULT 'USD' ${LEGACY_CURRENCY_CHECK},
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        receipt_image TEXT,
        FOREIGN KEY(category) REFERENCES categories(slug)
      )
    `);
    db.exec(`
      CREATE TABLE budgets_legacy (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        category TEXT NOT NULL,
        currency TEXT NOT NULL ${LEGACY_CURRENCY_CHECK},
        amount INTEGER NOT NULL CHECK(amount > 0),
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(category, currency),
        FOREIGN KEY(category) REFERENCES categories(slug)
      )
    `);
    db.exec(`
      CREATE TABLE fx_rates_legacy (
        currency TEXT PRIMARY KEY ${LEGACY_CURRENCY_CHECK},
        rate REAL NOT NULL CHECK(rate > 0)
      )
    `);
    // Only rows the old CHECK would have allowed — a real legacy DB has no others.
    //
    // Columns are listed rather than `SELECT *`: today's `expenses` carries
    // columns this shape predates (`merchant` is the current one), and a star
    // would supply more values than the legacy table has and abort the rebuild.
    db.exec(`
      INSERT INTO expenses_legacy (id, amount, date, description, category, currency, created_at, receipt_image)
      SELECT id, amount, date, description, category, currency, created_at, receipt_image
      FROM expenses WHERE currency IN ('USD','PLN','BTC')
    `);
    db.exec(`
      INSERT INTO budgets_legacy (id, category, currency, amount, created_at)
      SELECT id, category, currency, amount, created_at FROM budgets WHERE currency IN ('USD','PLN','BTC')
    `);
    db.exec(`
      INSERT INTO fx_rates_legacy (currency, rate)
      SELECT currency, rate FROM fx_rates WHERE currency IN ('USD','PLN','BTC')
    `);
    db.exec('DROP TABLE expenses');
    db.exec('DROP TABLE budgets');
    db.exec('DROP TABLE fx_rates');
    db.exec('ALTER TABLE expenses_legacy RENAME TO expenses');
    db.exec('ALTER TABLE budgets_legacy RENAME TO budgets');
    db.exec('ALTER TABLE fx_rates_legacy RENAME TO fx_rates');
  }

  it('drops the constraint, keeps every row, and adds the foreign key', () => {
    restoreLegacySchema();
    db.prepare(
      `INSERT INTO expenses (amount, date, description, category, currency, receipt_image)
       VALUES (2500, '2024-09-01', 'Legacy currency row', 'groceries', 'PLN', 'receipt-3-c0ffee.png')`
    ).run();
    db.prepare(`INSERT OR REPLACE INTO fx_rates (currency, rate) VALUES ('PLN', 0.25)`).run();

    // The columns the legacy shape had. Read by name rather than with a star so
    // that a column the migration *adds* (today: `merchant`) does not read as a
    // rewritten row — what this asserts is that the existing data is untouched.
    const legacyColumns = 'id, amount, date, description, category, currency, created_at, receipt_image';
    const expensesBefore = db.prepare(`SELECT ${legacyColumns} FROM expenses ORDER BY id`).all();
    const ratesBefore = db.prepare('SELECT * FROM fx_rates ORDER BY currency').all();
    expect((db.prepare(`SELECT sql FROM sqlite_master WHERE name='expenses'`).get() as { sql: string }).sql)
      .toContain('CHECK(currency IN');

    initializeDatabase();

    for (const table of ['expenses', 'budgets', 'fx_rates']) {
      const { sql } = db.prepare(`SELECT sql FROM sqlite_master WHERE name=?`).get(table) as { sql: string };
      expect(sql).not.toContain('CHECK(currency IN');
      expect(sql).toContain('REFERENCES currencies(code)');
    }

    // Not one row rewritten, receipt link included.
    expect(db.prepare(`SELECT ${legacyColumns} FROM expenses ORDER BY id`).all()).toEqual(expensesBefore);
    expect(db.prepare('SELECT * FROM fx_rates ORDER BY currency').all()).toEqual(ratesBefore);

    // ...and the columns the legacy shape predates are back on the rebuilt
    // table, empty. `merchant` is added by an ALTER that deliberately runs
    // after this migration, so a table recreation cannot drop it again.
    const migrated = db.prepare(`SELECT merchant FROM expenses ORDER BY id`).all() as Array<{ merchant: string | null }>;
    expect(migrated.every(row => row.merchant === null)).toBe(true);

    db.prepare(`DELETE FROM expenses WHERE description = 'Legacy currency row'`).run();
  });
});
