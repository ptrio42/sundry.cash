/**
 * Type definitions for expense tracking application
 */

// Available expense categories
export type ExpenseCategory = 'groceries' | 'transport' | 'media' | 'entertainment' | 'utilities' | 'maintenance' | 'other';

// Available currencies
export type Currency = 'USD' | 'PLN' | 'BTC';

// Main Expense interface representing a complete expense record
export interface Expense {
  id: number;
  amount: number;
  date: string; // ISO 8601 format (YYYY-MM-DD)
  description: string;
  category: ExpenseCategory;
  currency: Currency;
  createdAt?: string; // ISO 8601 datetime
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

// Statistics by category
export interface CategoryStats {
  category: ExpenseCategory;
  total: number;
  count: number;
}

// Statistics by date
export interface DateStats {
  date: string; // ISO 8601 format
  total: number;
  count: number;
}
