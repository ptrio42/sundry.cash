/**
 * Database configuration and initialization
 * Uses better-sqlite3 for synchronous SQLite operations
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { CURRENCY_CATALOGUE, DEFAULT_ENABLED_CURRENCIES } from './currencies';

// Database file path - shared between local development and Docker
// Uses process.cwd() to reference from project root
const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), 'data', 'expenses.db');

// Ensure data directory exists
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// Initialize database connection
export const db: Database.Database = new Database(DB_PATH);

// Enable foreign keys
db.pragma('foreign_keys = ON');

// Write-ahead logging. Two reasons that matter for a self-hosted install:
// readers no longer block on the writer (several phones on the LAN hitting the
// API at once), and `sqlite3 .backup` can run against a live database without
// tearing it. The trade is two sidecar files next to the DB — `-wal` and
// `-shm` — so a backup must copy the whole `data/` directory, or use `.backup`,
// never just `expenses.db`. See docs/DEPLOYMENT.md.
db.pragma('journal_mode = WAL');

// Unicode-aware lowercase, because SQLite's built-in LOWER() only folds ASCII:
// LOWER('ŻABKA') and LOWER('Żabka') both give 'Żabka', but 'żabka' stays
// distinct — enough to split one merchant into two groups. That silently breaks
// `models/insights.ts`, where a subscription grouped under two spellings can
// fall below the occurrence threshold on both and vanish from the report.
// JS toLowerCase() handles the full character set; SQLite gains ICU only when
// compiled with it, which the prebuilt better-sqlite3 binaries are not.
// Marked deterministic so SQLite may use it in GROUP BY without re-evaluating.
db.function('lower_unicode', { deterministic: true }, (value: unknown) =>
  typeof value === 'string' ? value.toLowerCase() : value as null
);

/**
 * The categories we ship. Seeded on every start with INSERT OR IGNORE, so they
 * always exist but the user's edits to label/colour/order are never overwritten.
 *
 * All seven are `is_builtin = 1` and therefore undeletable, because
 * `services/categorize.ts` can emit any of them and the Excel importer falls
 * back to `other`. A missing slug would break both silently — see
 * docs/categories-currencies-spec.md.
 */
const BUILTIN_CATEGORIES: Array<[slug: string, label: string, color: string]> = [
  ['groceries', 'Groceries', '#34d399'],
  ['transport', 'Transport', '#60a5fa'],
  ['media', 'Media', '#a78bfa'],
  ['entertainment', 'Entertainment', '#fbbf24'],
  ['utilities', 'Utilities', '#f87171'],
  ['maintenance', 'Maintenance', '#fb923c'],
  ['other', 'Other', '#94a3b8'],
];

/**
 * Create the schema and bring an existing database up to date.
 *
 * Safe to call repeatedly: every step is either `IF NOT EXISTS`, an
 * `INSERT OR IGNORE`, or a migration gated on a marker in the table's own DDL.
 */
export function initializeDatabase(): void {
  // Categories first: `expenses` and `budgets` both hold a foreign key into it.
  db.exec(`
    CREATE TABLE IF NOT EXISTS categories (
      slug       TEXT PRIMARY KEY,
      label      TEXT NOT NULL CHECK(length(label) > 0),
      color      TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_builtin INTEGER NOT NULL DEFAULT 0
    )
  `);

  // OR IGNORE, never OR REPLACE: a PRIMARY KEY conflict is the normal case here
  // (this runs on every start), and REPLACE would rewrite the row — reverting a
  // renamed or recoloured built-in on the next restart. The spec is explicit
  // that renaming a label is free.
  const seedCategory = db.prepare(
    `INSERT OR IGNORE INTO categories (slug, label, color, sort_order, is_builtin) VALUES (?, ?, ?, ?, 1)`
  );
  BUILTIN_CATEGORIES.forEach(([slug, label, color], index) => seedCategory.run(slug, label, color, index));

  // Currencies, for the same reason as categories: `expenses`, `budgets` and
  // `fx_rates` all reference this table.
  db.exec(`
    CREATE TABLE IF NOT EXISTS currencies (
      code        TEXT PRIMARY KEY,
      minor_units INTEGER NOT NULL CHECK(minor_units > 0),
      symbol      TEXT NOT NULL,
      locale      TEXT,
      is_iso      INTEGER NOT NULL DEFAULT 1,
      enabled     INTEGER NOT NULL DEFAULT 0
    )
  `);
  seedCurrencies();

  const createTableSQL = `
    CREATE TABLE IF NOT EXISTS expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      amount INTEGER NOT NULL CHECK(amount > 0),
      date TEXT NOT NULL,
      description TEXT NOT NULL CHECK(length(description) > 0),
      category TEXT NOT NULL,
      currency TEXT NOT NULL DEFAULT 'USD',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      receipt_image TEXT,
      merchant TEXT,
      FOREIGN KEY(category) REFERENCES categories(slug),
      FOREIGN KEY(currency) REFERENCES currencies(code)
    )
  `;

  db.exec(createTableSQL);

  // Budgets: one optional monthly limit per (category, currency)
  db.exec(`
    CREATE TABLE IF NOT EXISTS budgets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT NOT NULL,
      currency TEXT NOT NULL,
      amount INTEGER NOT NULL CHECK(amount > 0),
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(category, currency),
      FOREIGN KEY(category) REFERENCES categories(slug),
      FOREIGN KEY(currency) REFERENCES currencies(code)
    )
  `);

  // FX rates: value of 1 unit of each currency in the USD base (user-editable)
  db.exec(`
    CREATE TABLE IF NOT EXISTS fx_rates (
      currency TEXT PRIMARY KEY,
      rate REAL NOT NULL CHECK(rate > 0),
      FOREIGN KEY(currency) REFERENCES currencies(code)
    )
  `);
  db.exec(`INSERT OR IGNORE INTO fx_rates (currency, rate) VALUES ('USD', 1), ('PLN', 0.25), ('BTC', 65000)`);

  // App settings: simple key/value store for single-user preferences
  // (default currency/category/BTC unit). Values are read with code-side
  // defaults, so no seeding is required.
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  // Login throttling state, on disk rather than in the process.
  //
  // Not a convenience: a platform that stops idle machines (Fly's autostop —
  // docs/hosted-security.md §2.4) restarts this process constantly, and an
  // in-memory counter is wiped every time, so an attacker who paces their
  // guesses around the idle timeout is never throttled at all.
  //
  // Deliberately NOT inside a try/catch like the enum migrations below. Those
  // may fail and leave a working app; this one may not — a security control
  // whose storage silently failed to appear is the fail-open shape this whole
  // change exists to remove. A throw here stops the process at boot, which is
  // the loud failure we want.
  db.exec(`
    CREATE TABLE IF NOT EXISTS auth_rate_limit (
      key      TEXT PRIMARY KEY,
      hits     INTEGER NOT NULL,
      reset_at INTEGER NOT NULL
    )
  `);

  // The per-instance backstop: one row, because a single-user product has
  // exactly one account to protect and can therefore afford to lock globally in
  // a way a multi-user one never could. `CHECK (id = 1)` is what makes "one
  // row" a property of the schema rather than of every caller.
  db.exec(`
    CREATE TABLE IF NOT EXISTS auth_backstop (
      id                   INTEGER PRIMARY KEY CHECK (id = 1),
      consecutive_failures INTEGER NOT NULL DEFAULT 0,
      blocked_until        INTEGER NOT NULL DEFAULT 0
    )
  `);
  db.exec(`INSERT OR IGNORE INTO auth_backstop (id, consecutive_failures, blocked_until) VALUES (1, 0, 0)`);

  // Migration: Add currency column to existing tables if it doesn't exist
  try {
    // First, try to add the column (without NOT NULL to avoid SQLite limitations)
    db.exec(`ALTER TABLE expenses ADD COLUMN currency TEXT DEFAULT 'USD' CHECK(currency IN ('USD', 'PLN', 'BTC'))`);
    console.log('Added currency column to existing expenses table');

    // Update any existing rows to have USD as default
    db.exec(`UPDATE expenses SET currency = 'USD' WHERE currency IS NULL`);
    console.log('Updated existing expenses with default USD currency');
  } catch (error: any) {
    // Column already exists
    if (error.message.includes('duplicate column name')) {
      // Column exists, make sure all rows have a currency value
      try {
        db.exec(`UPDATE expenses SET currency = 'USD' WHERE currency IS NULL`);
      } catch {
        // Backfill is best-effort: the column exists either way.
      }
    }
  }

  // Migration: Add new categories to CHECK constraint
  // SQLite doesn't support ALTER CONSTRAINT, so we need to recreate the table
  try {
    // Check if the table needs migration
    const checkStmt = db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='expenses'`);
    const tableInfo = checkStmt.get() as any;

    // If the category CHECK constraint doesn't include 'maintenance', recreate
    // the table.
    //
    // Gated on the constraint still being there. Once the categories migration
    // below has removed it there is nothing here to widen, and without the gate
    // "no 'maintenance' in the DDL" would read as "needs migrating" on every
    // single start — re-adding the CHECK, and losing `receipt_image` (which
    // this copy predates and does not carry) along with it.
    if (tableInfo && tableInfo.sql && tableInfo.sql.includes('CHECK(category IN') && !tableInfo.sql.includes("'maintenance'")) {
      console.log('Migrating database to add new categories...');

      // Begin transaction
      db.exec('BEGIN TRANSACTION');

      try {
        // Create new table with updated constraint
        db.exec(`
          CREATE TABLE expenses_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            amount INTEGER NOT NULL CHECK(amount > 0),
            date TEXT NOT NULL,
            description TEXT NOT NULL CHECK(length(description) > 0),
            category TEXT NOT NULL CHECK(category IN ('groceries', 'transport', 'media', 'entertainment', 'utilities', 'maintenance', 'other')),
            currency TEXT DEFAULT 'USD' CHECK(currency IN ('USD', 'PLN', 'BTC')),
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
          )
        `);

        // Copy data from old table to new table
        db.exec(`
          INSERT INTO expenses_new (id, amount, date, description, category, currency, created_at)
          SELECT id, amount, date, description, category, currency, created_at FROM expenses
        `);

        // Drop old table
        db.exec('DROP TABLE expenses');

        // Rename new table to expenses
        db.exec('ALTER TABLE expenses_new RENAME TO expenses');

        // Commit transaction
        db.exec('COMMIT');

        console.log('Successfully migrated database to include new categories');
      } catch (migrationError) {
        // Rollback on error
        db.exec('ROLLBACK');
        throw migrationError;
      }
    }
  } catch (error: any) {
    console.error('Migration check/execution failed:', error.message);
    // Continue even if migration fails - the table might already be correct
  }

  // Migration: Add BTC to currency CHECK constraint
  // SQLite doesn't support ALTER CONSTRAINT, so we need to recreate the table
  try {
    // Check if the table needs migration for BTC currency
    const checkStmt = db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='expenses'`);
    const tableInfo = checkStmt.get() as any;

    // If the currency CHECK constraint doesn't include 'BTC', recreate the
    // table. Gated on the constraint existing for the same reason as the
    // category migration above.
    if (tableInfo && tableInfo.sql && tableInfo.sql.includes('CHECK(currency IN') && !tableInfo.sql.includes("'BTC'")) {
      console.log('Migrating database to add BTC currency...');

      // Begin transaction
      db.exec('BEGIN TRANSACTION');

      try {
        // Create new table with updated constraint
        db.exec(`
          CREATE TABLE expenses_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            amount INTEGER NOT NULL CHECK(amount > 0),
            date TEXT NOT NULL,
            description TEXT NOT NULL CHECK(length(description) > 0),
            category TEXT NOT NULL CHECK(category IN ('groceries', 'transport', 'media', 'entertainment', 'utilities', 'maintenance', 'other')),
            currency TEXT DEFAULT 'USD' CHECK(currency IN ('USD', 'PLN', 'BTC')),
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
          )
        `);

        // Copy data from old table to new table
        db.exec(`
          INSERT INTO expenses_new (id, amount, date, description, category, currency, created_at)
          SELECT id, amount, date, description, category, currency, created_at FROM expenses
        `);

        // Drop old table
        db.exec('DROP TABLE expenses');

        // Rename new table to expenses
        db.exec('ALTER TABLE expenses_new RENAME TO expenses');

        // Commit transaction
        db.exec('COMMIT');

        console.log('Successfully migrated database to include BTC currency');
      } catch (migrationError) {
        // Rollback on error
        db.exec('ROLLBACK');
        throw migrationError;
      }
    }
  } catch (error: any) {
    console.error('BTC currency migration check/execution failed:', error.message);
    // Continue even if migration fails - the table might already be correct
  }

  // Migration: Add receipt_image column for attached receipt photos.
  // Runs last so it re-adds the column even if a table-recreation migration
  // above rebuilt `expenses` without it. Idempotent: a duplicate-column error
  // just means an existing DB already has it.
  try {
    db.exec(`ALTER TABLE expenses ADD COLUMN receipt_image TEXT`);
    console.log('Added receipt_image column to expenses table');
  } catch (error: any) {
    if (!error.message.includes('duplicate column name')) {
      console.error('receipt_image migration failed:', error.message);
    }
  }

  // Migration: categories move from a CHECK-constrained enum to rows in
  // `categories`. Only the constraint changes — the seeds above reuse today's
  // seven slugs, so not a single expense or budget row is rewritten.
  //
  // Runs after the receipt_image ALTER above, so `expenses.receipt_image`
  // exists by now and the copy below can carry its data across. (The two older
  // recreations further up predate that column and do not.)
  migrateCategoryEnumToTable();

  // Migration: the same move for currencies. Kept separate from the categories
  // one — they land in different releases, and a database can arrive needing
  // either, both, or neither.
  migrateCurrencyEnumToTable();

  // Migration: the merchant a receipt scan detected, kept beside the
  // description the user is free to rewrite. Nullable, never backfilled and
  // never an input field — `models/insights.ts` falls back to the description
  // when it is NULL, so every manual and historical row still groups. See
  // docs/insights-spec.md.
  //
  // Placed after both enum migrations rather than beside `receipt_image`:
  // those recreate `expenses` from an explicit column list, so a column added
  // before them would be dropped on the one start that migrates.
  try {
    db.exec(`ALTER TABLE expenses ADD COLUMN merchant TEXT`);
    console.log('Added merchant column to expenses table');
  } catch (error: any) {
    if (!error.message.includes('duplicate column name')) {
      console.error('merchant migration failed:', error.message);
    }
  }

  // Last: needs `expenses` and `budgets` to exist, and needs the migration
  // above to have finished rebuilding them.
  reconcileCurrencyExponents();

  console.log('Database initialized successfully');
}

/**
 * Put the shipped catalogue into `currencies`, without ever overwriting what
 * the user has chosen.
 *
 * Three different rules, because the columns differ in how dangerous they are:
 *   - `enabled` is the user's decision. Set on insert, never touched again —
 *     re-enabling a currency they disabled on every restart would be maddening.
 *   - `symbol` / `locale` are presentation, and no API lets the user change
 *     them, so a corrected catalogue entry is applied.
 *   - `minor_units` decides what stored integers mean. A corrected value is
 *     applied only while nothing references the code; otherwise it is refused
 *     and reported, because changing it would reinterpret existing rows rather
 *     than convert them.
 */
function seedCurrencies(): void {
  const insert = db.prepare(
    `INSERT OR IGNORE INTO currencies (code, minor_units, symbol, locale, is_iso, enabled) VALUES (?, ?, ?, ?, ?, ?)`
  );
  const updatePresentation = db.prepare('UPDATE currencies SET symbol = ?, locale = ?, is_iso = ? WHERE code = ?');

  for (const entry of CURRENCY_CATALOGUE) {
    insert.run(
      entry.code,
      entry.minorUnits,
      entry.symbol,
      entry.locale,
      entry.iso ? 1 : 0,
      DEFAULT_ENABLED_CURRENCIES.includes(entry.code) ? 1 : 0
    );
    updatePresentation.run(entry.symbol, entry.locale, entry.iso ? 1 : 0, entry.code);
  }
}

/**
 * Apply a corrected exponent from the shipped catalogue — but only to codes
 * nothing has been recorded in yet.
 *
 * This is the seeding rule that could not live in `seedCurrencies`: it has to
 * count rows in `expenses` and `budgets`, and better-sqlite3 validates SQL when
 * a statement is prepared, so on a fresh database those tables do not exist
 * yet. It runs at the end of initialization instead, once they do.
 *
 * A refusal is loud rather than silent because the alternative is worse than a
 * wrong symbol: the stored integers were written under the old exponent, so
 * changing it reinterprets them (5099 cents becoming 5.099 of something)
 * instead of converting them.
 */
function reconcileCurrencyExponents(): void {
  const readExponent = db.prepare('SELECT minor_units FROM currencies WHERE code = ?');
  const updateExponent = db.prepare('UPDATE currencies SET minor_units = ? WHERE code = ?');
  const countReferences = db.prepare(
    `SELECT (SELECT COUNT(*) FROM expenses WHERE currency = @code)
          + (SELECT COUNT(*) FROM budgets  WHERE currency = @code) AS n`
  );

  for (const entry of CURRENCY_CATALOGUE) {
    const stored = readExponent.get(entry.code) as { minor_units: number } | undefined;
    if (!stored || stored.minor_units === entry.minorUnits) continue;

    const references = (countReferences.get({ code: entry.code }) as { n: number }).n;
    if (references === 0) {
      updateExponent.run(entry.minorUnits, entry.code);
      console.log(`Corrected minor_units for ${entry.code}: ${stored.minor_units} -> ${entry.minorUnits}`);
    } else {
      console.error(
        `Refusing to change minor_units for ${entry.code} from ${stored.minor_units} to ${entry.minorUnits}: ` +
        `${references} row(s) were stored under the current value and would be reinterpreted, not converted.`
      );
    }
  }
}

/**
 * Drop `CHECK(currency IN (...))` from `expenses`, `budgets` and `fx_rates`,
 * replacing it with a foreign key into `currencies`.
 *
 * Same shape and same marker as the categories migration above: the seeds reuse
 * today's three codes, so no row is rewritten — only the constraint goes.
 */
function migrateCurrencyEnumToTable(): void {
  const tableSQL = (name: string): string => {
    const row = db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name=?`).get(name) as
      | { sql: string | null }
      | undefined;
    return row?.sql ?? '';
  };

  const needs = {
    expenses: tableSQL('expenses').includes('CHECK(currency IN'),
    budgets: tableSQL('budgets').includes('CHECK(currency IN'),
    fx_rates: tableSQL('fx_rates').includes('CHECK(currency IN'),
  };
  if (!needs.expenses && !needs.budgets && !needs.fx_rates) return;

  console.log('Migrating database to make currencies data rather than an enum...');

  db.exec('BEGIN TRANSACTION');
  try {
    if (needs.expenses) {
      db.exec(`
        CREATE TABLE expenses_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          amount INTEGER NOT NULL CHECK(amount > 0),
          date TEXT NOT NULL,
          description TEXT NOT NULL CHECK(length(description) > 0),
          category TEXT NOT NULL,
          currency TEXT NOT NULL DEFAULT 'USD',
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          receipt_image TEXT,
          FOREIGN KEY(category) REFERENCES categories(slug),
          FOREIGN KEY(currency) REFERENCES currencies(code)
        )
      `);
      // COALESCE because the column was nullable before this change: the very
      // old "add currency column" migration above adds it without NOT NULL and
      // backfills best-effort.
      db.exec(`
        INSERT INTO expenses_new (id, amount, date, description, category, currency, created_at, receipt_image)
        SELECT id, amount, date, description, category, COALESCE(currency, 'USD'), created_at, receipt_image FROM expenses
      `);
      db.exec('DROP TABLE expenses');
      db.exec('ALTER TABLE expenses_new RENAME TO expenses');
    }

    if (needs.budgets) {
      db.exec(`
        CREATE TABLE budgets_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          category TEXT NOT NULL,
          currency TEXT NOT NULL,
          amount INTEGER NOT NULL CHECK(amount > 0),
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(category, currency),
          FOREIGN KEY(category) REFERENCES categories(slug),
          FOREIGN KEY(currency) REFERENCES currencies(code)
        )
      `);
      db.exec(`
        INSERT INTO budgets_new (id, category, currency, amount, created_at)
        SELECT id, category, currency, amount, created_at FROM budgets
      `);
      db.exec('DROP TABLE budgets');
      db.exec('ALTER TABLE budgets_new RENAME TO budgets');
    }

    if (needs.fx_rates) {
      db.exec(`
        CREATE TABLE fx_rates_new (
          currency TEXT PRIMARY KEY,
          rate REAL NOT NULL CHECK(rate > 0),
          FOREIGN KEY(currency) REFERENCES currencies(code)
        )
      `);
      db.exec(`INSERT INTO fx_rates_new (currency, rate) SELECT currency, rate FROM fx_rates`);
      db.exec('DROP TABLE fx_rates');
      db.exec('ALTER TABLE fx_rates_new RENAME TO fx_rates');
    }

    db.exec('COMMIT');
    console.log('Successfully migrated currencies to the currencies table');
  } catch (migrationError) {
    db.exec('ROLLBACK');
    throw migrationError;
  }
}

/**
 * Drop `CHECK(category IN (...))` from `expenses` and `budgets`, replacing it
 * with a foreign key into `categories`.
 *
 * Idempotent the same way the migrations above are: the table's own DDL in
 * `sqlite_master` is the marker. Once the CHECK is gone there is nothing to do,
 * which is also why a freshly created database (already built without it, see
 * `initializeDatabase`) skips straight past this.
 */
function migrateCategoryEnumToTable(): void {
  const tableSQL = (name: string): string => {
    const row = db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name=?`).get(name) as
      | { sql: string | null }
      | undefined;
    return row?.sql ?? '';
  };

  const expensesNeedsMigration = tableSQL('expenses').includes('CHECK(category IN');
  const budgetsNeedsMigration = tableSQL('budgets').includes('CHECK(category IN');
  if (!expensesNeedsMigration && !budgetsNeedsMigration) return;

  console.log('Migrating database to make categories data rather than an enum...');

  db.exec('BEGIN TRANSACTION');
  try {
    if (expensesNeedsMigration) {
      db.exec(`
        CREATE TABLE expenses_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          amount INTEGER NOT NULL CHECK(amount > 0),
          date TEXT NOT NULL,
          description TEXT NOT NULL CHECK(length(description) > 0),
          category TEXT NOT NULL,
          currency TEXT DEFAULT 'USD' CHECK(currency IN ('USD', 'PLN', 'BTC')),
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          receipt_image TEXT,
          FOREIGN KEY(category) REFERENCES categories(slug)
        )
      `);
      db.exec(`
        INSERT INTO expenses_new (id, amount, date, description, category, currency, created_at, receipt_image)
        SELECT id, amount, date, description, category, currency, created_at, receipt_image FROM expenses
      `);
      db.exec('DROP TABLE expenses');
      db.exec('ALTER TABLE expenses_new RENAME TO expenses');
    }

    if (budgetsNeedsMigration) {
      db.exec(`
        CREATE TABLE budgets_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          category TEXT NOT NULL,
          currency TEXT NOT NULL CHECK(currency IN ('USD', 'PLN', 'BTC')),
          amount INTEGER NOT NULL CHECK(amount > 0),
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(category, currency),
          FOREIGN KEY(category) REFERENCES categories(slug)
        )
      `);
      db.exec(`
        INSERT INTO budgets_new (id, category, currency, amount, created_at)
        SELECT id, category, currency, amount, created_at FROM budgets
      `);
      db.exec('DROP TABLE budgets');
      db.exec('ALTER TABLE budgets_new RENAME TO budgets');
    }

    db.exec('COMMIT');
    console.log('Successfully migrated categories to the categories table');
  } catch (migrationError) {
    db.exec('ROLLBACK');
    // Rethrown rather than swallowed: half-migrated is not a state the app can
    // run in, and the rollback above means the old tables are still intact.
    throw migrationError;
  }
}

/**
 * Close database connection
 * Should be called when the application shuts down
 */
export function closeDatabase(): void {
  db.close();
  console.log('Database connection closed');
}

// Initialize database on module load
initializeDatabase();
