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

// Available currencies
export type Currency = 'USD' | 'PLN' | 'BTC';

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
export type CreateExpenseDTO = Omit<Expense, 'id' | 'createdAt'>;

// DTO for updating an expense (all fields optional)
export type UpdateExpenseDTO = Partial<CreateExpenseDTO>;

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
