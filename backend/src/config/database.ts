/**
 * Database configuration and initialization
 * Uses better-sqlite3 for synchronous SQLite operations
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

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
 * Initialize database schema
 * Creates the expenses table if it doesn't exist
 */
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

  const createTableSQL = `
    CREATE TABLE IF NOT EXISTS expenses (
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
  `;

  db.exec(createTableSQL);

  // Budgets: one optional monthly limit per (category, currency)
  db.exec(`
    CREATE TABLE IF NOT EXISTS budgets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT NOT NULL,
      currency TEXT NOT NULL CHECK(currency IN ('USD', 'PLN', 'BTC')),
      amount INTEGER NOT NULL CHECK(amount > 0),
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(category, currency),
      FOREIGN KEY(category) REFERENCES categories(slug)
    )
  `);

  // FX rates: value of 1 unit of each currency in the USD base (user-editable)
  db.exec(`
    CREATE TABLE IF NOT EXISTS fx_rates (
      currency TEXT PRIMARY KEY CHECK(currency IN ('USD', 'PLN', 'BTC')),
      rate REAL NOT NULL CHECK(rate > 0)
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

  console.log('Database initialized successfully');
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
