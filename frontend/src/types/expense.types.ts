/**
 * Type definitions for expense tracking application - Frontend
 * Shared types matching backend API contracts
 */

// Available expense categories
export type ExpenseCategory = 'groceries' | 'transport' | 'media' | 'entertainment' | 'utilities' | 'maintenance' | 'other';

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

// Manual FX rates: value of 1 unit of each currency in the USD base (USD = 1)
export type FxRates = Record<Currency, number>;

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

// Fields extracted from a receipt photo by the backend OCR (any may be null).
export interface ReceiptExtraction {
  amount: number | null;
  date: string | null;
  merchant: string | null;
  currency: Currency | null;
  category: ExpenseCategory;
  rawText: string;
  confidence: number; // 0..1
  warnings: string[];
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

// --- Insights -------------------------------------------------------------
// Mirrors the exports of backend/src/models/insights.ts. Types are duplicated
// per package rather than shared across the boundary — keep the two in sync.

export type ComparisonWindow = 'rolling' | 'calendar';
export type ComparisonPeriod = 'week' | 'month' | 'year';
export type Cadence = 'weekly' | 'monthly' | 'quarterly' | 'yearly';
export type AmountStability = 'stable' | 'variable';

export interface DateRange {
  start: string; // inclusive, YYYY-MM-DD
  end: string;   // inclusive, YYYY-MM-DD
}

// One category in one currency, this period against the one before it.
export interface CategoryComparison {
  category: ExpenseCategory;
  currency: Currency;
  current: number;
  previous: number;
  delta: number;
  deltaPct: number | null; // null when there was no previous spend to divide by
  currentCount: number;
  previousCount: number;
  isNew: boolean;
}

export interface ComparisonResult {
  window: ComparisonWindow;
  period: ComparisonPeriod;
  current: DateRange;
  previous: DateRange;
  byCategory: CategoryComparison[];
}

// A charge that repeats on a schedule — the forgotten-subscription report.
export interface RecurringCharge {
  label: string;
  currency: Currency;
  cadence: Cadence;
  medianAmount: number;
  monthlyCost: number;
  totalPaid: number;
  occurrences: number;
  firstSeen: string;
  lastSeen: string;
  amountStability: AmountStability;
  likelyCancelled: boolean;
}

// A monthly spending limit for a category in a given currency
export interface Budget {
  category: ExpenseCategory;
  currency: Currency;
  amount: number; // major units (monthly limit)
}

// Component Props Types

export interface ExpenseFormProps {
  onExpenseAdded: (expense: Expense) => void;
  settings: AppSettings;
}

export interface ExpenseTableProps {
  expenses: Expense[];
  onEdit: (expense: Expense) => void;
  onDelete: (id: number) => void;
  onUpdate: (id: number, updates: Partial<Expense>) => Promise<void>;
}

export interface DashboardProps {
  expenses: Expense[];
  settings: AppSettings;
  rates: FxRates;
}

export interface BudgetsProps {
  expenses: Expense[];
}

export interface FxProps {
  expenses: Expense[];
  rates: FxRates;
  onRatesChanged: (rates: FxRates) => void;
}

// Sort options for table
export type SortField = 'date' | 'amount' | 'category';
export type SortOrder = 'asc' | 'desc';
