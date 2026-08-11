/**
 * Currency model.
 *
 * Unlike categories, a currency row carries *behaviour*: `minor_units` is what
 * `config/money.ts` multiplies by, so it defines what every stored integer
 * means. Two consequences shape this file:
 *
 *   - The exponent is immutable once any expense references the code. Changing
 *     it would not migrate those rows, it would silently reinterpret them —
 *     5099 cents becoming 5.099 of something. `setMinorUnits` refuses, and it
 *     refuses in the model rather than in a route so that no caller can skip it.
 *   - Lookups are cached in a module-level map. The app is single-process and
 *     synchronous, and `toMinorUnits` runs on every row of an import, so paying
 *     for a query each time would be silly. The cache is rebuilt on every write
 *     that could change it.
 */

import { db } from '../config/database';
import { CurrencyInfo } from '../types/expense.types';

interface CurrencyRow {
  code: string;
  minor_units: number;
  symbol: string;
  locale: string | null;
  is_iso: number;
  enabled: number;
}

function toCurrency(row: CurrencyRow): CurrencyInfo {
  return {
    code: row.code,
    minorUnits: row.minor_units,
    symbol: row.symbol,
    locale: row.locale,
    isIso: row.is_iso === 1,
    enabled: row.enabled === 1,
  };
}

// --- minor-unit cache ------------------------------------------------------

let minorUnitsCache: Map<string, number> | null = null;

/** Rebuild the exponent cache. Called after any write that could change it. */
export function refreshCache(): void {
  const rows = db.prepare('SELECT code, minor_units FROM currencies').all() as
    { code: string; minor_units: number }[];
  minorUnitsCache = new Map(rows.map(row => [row.code, row.minor_units]));
}

/**
 * Minor units per major unit for `code`, or undefined if the code is unknown.
 * Deliberately not defaulted to 100: a silent guess here is the one mistake
 * this whole design exists to prevent, so callers must decide what to do.
 */
export function minorUnitsFor(code: string): number | undefined {
  if (!minorUnitsCache) refreshCache();
  return minorUnitsCache!.get(code);
}

// --- reads -----------------------------------------------------------------

/** Every catalogue entry, enabled first, then alphabetical. */
export function getAll(): CurrencyInfo[] {
  const rows = db
    .prepare('SELECT code, minor_units, symbol, locale, is_iso, enabled FROM currencies ORDER BY enabled DESC, code')
    .all() as CurrencyRow[];
  return rows.map(toCurrency);
}

/** The currencies offered for new entries. */
export function getEnabled(): CurrencyInfo[] {
  const rows = db
    .prepare('SELECT code, minor_units, symbol, locale, is_iso, enabled FROM currencies WHERE enabled = 1 ORDER BY code')
    .all() as CurrencyRow[];
  return rows.map(toCurrency);
}

export function getByCode(code: string): CurrencyInfo | undefined {
  const row = db
    .prepare('SELECT code, minor_units, symbol, locale, is_iso, enabled FROM currencies WHERE code = ?')
    .get(code) as CurrencyRow | undefined;
  return row ? toCurrency(row) : undefined;
}

/**
 * Whether `code` is a currency the app knows about — enabled or not.
 *
 * This, not `isEnabled`, is what validation on *existing* data should use.
 * Disabling a currency means "stop offering it for new entries", never "hide
 * the history", so editing or filtering an old expense in a disabled currency
 * has to keep working.
 */
export function exists(code: unknown): boolean {
  if (typeof code !== 'string') return false;
  return db.prepare('SELECT 1 FROM currencies WHERE code = ?').get(code) !== undefined;
}

/** Whether `code` may be used for a *new* entry. */
export function isEnabled(code: unknown): boolean {
  if (typeof code !== 'string') return false;
  return db.prepare('SELECT 1 FROM currencies WHERE code = ? AND enabled = 1').get(code) !== undefined;
}

export function enabledCodes(): string[] {
  return (db.prepare('SELECT code FROM currencies WHERE enabled = 1 ORDER BY code').all() as { code: string }[])
    .map(row => row.code);
}

/** How many expenses and budgets are recorded in this currency. */
export function usage(code: string): { expenses: number; budgets: number } {
  const expenses = (db.prepare('SELECT COUNT(*) AS n FROM expenses WHERE currency = ?').get(code) as { n: number }).n;
  const budgets = (db.prepare('SELECT COUNT(*) AS n FROM budgets WHERE currency = ?').get(code) as { n: number }).n;
  return { expenses, budgets };
}

// --- writes ----------------------------------------------------------------

/**
 * Change the exponent for `code`.
 *
 * Throws once anything references the code, because the stored integers were
 * written under the old exponent and this does not — cannot — rewrite them.
 * The guard lives here rather than in the route so a future caller (a corrected
 * catalogue entry, a script) cannot route around it.
 */
export function setMinorUnits(code: string, minorUnits: number): void {
  if (!Number.isInteger(minorUnits) || minorUnits < 1) {
    throw new Error(`minor_units for ${code} must be a positive integer`);
  }

  const referenced = usage(code);
  if (referenced.expenses > 0 || referenced.budgets > 0) {
    throw new Error(
      `Cannot change minor_units for ${code}: ${referenced.expenses} expense(s) and ` +
      `${referenced.budgets} budget(s) were stored under the current value, and changing it ` +
      `would reinterpret them rather than convert them.`
    );
  }

  db.prepare('UPDATE currencies SET minor_units = ? WHERE code = ?').run(minorUnits, code);
  refreshCache();
}

/**
 * Enable or disable a currency.
 *
 * Disabling never touches the expenses recorded in it — it only stops the
 * currency being offered for new ones. That is why this is the only knob the
 * API exposes.
 */
export function setEnabled(code: string, enabled: boolean): CurrencyInfo | undefined {
  db.prepare('UPDATE currencies SET enabled = ? WHERE code = ?').run(enabled ? 1 : 0, code);
  return getByCode(code);
}
