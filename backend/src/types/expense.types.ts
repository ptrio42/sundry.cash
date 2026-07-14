/**
 * Type definitions for expense tracking application
 */

// Available expense categories
export type ExpenseCategory = 'groceries' | 'transport' | 'media' | 'entertainment' | 'utilities' | 'maintenance' | 'other';

// Available currencies
export type Currency = 'USD' | 'PLN' | 'BTC';

// Display/entry unit for BTC amounts
export type BtcUnit = 'BTC' | 'sats';

// User preferences (single-user, shared across devices via the backend)
export interface AppSettings {
  defaultCurrency: Currency;
  defaultCategory: ExpenseCategory;
  defaultBtcUnit: BtcUnit;
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
