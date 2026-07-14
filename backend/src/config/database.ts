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

/**
 * Initialize database schema
 * Creates the expenses table if it doesn't exist
 */
export function initializeDatabase(): void {
  const createTableSQL = `
    CREATE TABLE IF NOT EXISTS expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      amount INTEGER NOT NULL CHECK(amount > 0),
      date TEXT NOT NULL,
      description TEXT NOT NULL CHECK(length(description) > 0),
      category TEXT NOT NULL CHECK(category IN ('groceries', 'transport', 'media', 'entertainment', 'utilities', 'maintenance', 'other')),
      currency TEXT DEFAULT 'USD' CHECK(currency IN ('USD', 'PLN', 'BTC')),
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      receipt_image TEXT
    )
  `;

  db.exec(createTableSQL);

  // Budgets: one optional monthly limit per (category, currency)
  db.exec(`
    CREATE TABLE IF NOT EXISTS budgets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT NOT NULL CHECK(category IN ('groceries', 'transport', 'media', 'entertainment', 'utilities', 'maintenance', 'other')),
      currency TEXT NOT NULL CHECK(currency IN ('USD', 'PLN', 'BTC')),
      amount INTEGER NOT NULL CHECK(amount > 0),
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(category, currency)
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
      } catch (updateError) {
        // Ignore update errors
      }
    }
  }

  // Migration: Add new categories to CHECK constraint
  // SQLite doesn't support ALTER CONSTRAINT, so we need to recreate the table
  try {
    // Check if the table needs migration
    const checkStmt = db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='expenses'`);
    const tableInfo = checkStmt.get() as any;

    // If the CHECK constraint doesn't include 'maintenance', recreate the table
    if (tableInfo && tableInfo.sql && !tableInfo.sql.includes("'maintenance'")) {
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

    // If the CHECK constraint doesn't include 'BTC', recreate the table
    if (tableInfo && tableInfo.sql && !tableInfo.sql.includes("'BTC'")) {
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

  console.log('Database initialized successfully');
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
