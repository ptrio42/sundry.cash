/**
 * Type definitions for expense tracking application
 */

// A category slug. Categories are rows in the `categories` table, not a closed
// set, so this can only be `string` — the valid values are whatever the table
// holds right now. Validation therefore has to query it (models/category.ts);
// the compiler can no longer do it for us. The alias is kept because it still
// says *which* string a field expects.
export type ExpenseCategory = string;

// A category the user can spend against: a slug plus how it is presented.
export interface Category {
  slug: string;      // stable identifier stored on every expense; never renamed
  label: string;     // what the UI shows — free to change
  color: string;     // '#rrggbb', used for charts and swatches
  sortOrder: number; // display order; ties broken by label
  isBuiltin: boolean; // shipped by us: `services/categorize.ts` can emit it, so it cannot be deleted
}

// A currency code. Like ExpenseCategory this is now a row, not a closed set —
// but for a different and sharper reason: the row carries the minor-unit
// exponent that decides how every amount under this code is stored. Users can
// only enable or disable catalogue entries, never invent one; see
// `config/currencies.ts` and docs/categories-currencies-spec.md.
export type Currency = string;

// A currency the app knows about. Enabled ones are offered for new entries;
// disabled ones stay readable in history.
export interface CurrencyInfo {
  code: string;
  minorUnits: number; // 100 for cents, 100_000_000 for satoshis
  symbol: string;
  locale: string | null; // formatting locale; see frontend utils/format.ts
  isIso: boolean;        // false for BTC: Intl accepts the code but formats it wrongly
  enabled: boolean;
}

// Display/entry unit for BTC amounts
export type BtcUnit = 'BTC' | 'sats';

// User preferences (single-user, shared across devices via the backend)
export interface AppSettings {
  defaultCurrency: Currency;   // pre-selected when entering a new expense
  defaultCategory: ExpenseCategory;
  defaultBtcUnit: BtcUnit;
  primaryCurrency: Currency;   // currency that combined totals are converted to
}

// Main Expense interface representing a complete expense record
export interface Expense {
  id: number;
  amount: number;
  date: string; // ISO 8601 format (YYYY-MM-DD)
  description: string;
  category: ExpenseCategory;
  currency: Currency;
  createdAt?: string; // ISO 8601 datetime
  receiptImage?: string | null; // filename of an attached receipt photo, if any
}

// DTO for creating a new expense (excludes id and createdAt)
export type CreateExpenseDTO = Omit<Expense, 'id' | 'createdAt'> & {
  /**
   * The merchant a receipt scan detected, captured silently at scan time.
   *
   * Write-only on purpose, and deliberately not part of `Expense`: it is never
   * shown, never entered by hand and never returned, so the product gains no
   * second "Merchant" box for the sake of a report. It exists only so
   * `models/insights.ts` can group rows whose description the user has since
   * rewritten; NULL (every manual and historical row) falls back to the
   * description. See docs/insights-spec.md.
   */
  merchant?: string | null;
};

// DTO for updating an expense (all fields optional).
// Built from `Expense`, not from `CreateExpenseDTO`: `merchant` is what the
// scan saw, so an edit to the description must not be able to rewrite it.
export type UpdateExpenseDTO = Partial<Omit<Expense, 'id' | 'createdAt'>>;

// Filters for querying expenses
export interface ExpenseFilters {
  category?: ExpenseCategory;
  startDate?: string; // ISO 8601 format
  endDate?: string; // ISO 8601 format
  currency?: Currency;
}

// A monthly spending limit for a category in a given currency
export interface Budget {
  category: ExpenseCategory;
  currency: Currency;
  amount: number; // major units (monthly limit)
}

// Statistics by category (per currency)
export interface CategoryStats {
  category: ExpenseCategory;
  currency: Currency;
  total: number;
  count: number;
}

// Statistics by date (per currency)
export interface DateStats {
  date: string; // ISO 8601 format
  currency: Currency;
  total: number;
  count: number;
}
