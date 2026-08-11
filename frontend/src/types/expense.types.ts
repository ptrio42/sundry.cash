/**
 * Type definitions for expense tracking application - Frontend
 * Shared types matching backend API contracts
 */

// A category slug. Categories are rows the backend owns, not a closed set, so
// this can only be `string`. The alias survives because it still says *which*
// string a field holds. Loaded once in App.tsx and passed down; use
// `utils/categories.ts` to turn a slug into a label or colour.
export type ExpenseCategory = string;

// A category the user can spend against: a slug plus how it is presented.
// Mirrors backend/src/types/expense.types.ts — keep the two in sync.
export interface Category {
  slug: string;
  label: string;
  color: string;      // '#rrggbb'
  sortOrder: number;
  isBuiltin: boolean; // shipped by us; cannot be deleted
}

// A currency code. A row the backend owns, like ExpenseCategory — but the row
// carries the minor-unit exponent that decides how amounts are stored, so the
// user can only enable or disable catalogue entries, never invent one.
export type Currency = string;

// A currency the app knows about. Mirrors backend/src/types/expense.types.ts.
export interface CurrencyInfo {
  code: string;
  minorUnits: number;
  symbol: string;
  locale: string | null;
  isIso: boolean;   // false for BTC: Intl accepts the code but formats it wrongly
  enabled: boolean; // offered for new entries; disabled ones stay readable
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

// What kind of instance the frontend is talking to.
//
// Fetched from the public GET /api/config before login, because it decides what
// the first paint looks like. Booleans only, deliberately: the endpoint is
// unauthenticated, so the backend refuses to put anything else in it (see
// backend/src/routes/config.ts) and this type is the frontend half of that
// promise.
export interface InstanceConfig {
  demoMode: boolean;       // public demo: say so, loudly, above the app
  receiptsEnabled: boolean; // false hides the Scan Receipt tab; the API 403s
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

// --- Insight summary ------------------------------------------------------
// The composed report the dashboard strip renders. Findings carry numbers and
// identifiers, never prose: the sentence is written here, in the component, so
// that PL/EN stays a frontend concern and the API never has to be redone for it.

export type FindingKind =
  | 'category_moved'     // biggest mover present in both windows
  | 'category_new'       // spend where there was none
  | 'recurring_total'    // what the active subscriptions cost per month
  | 'recurring_stopped'  // a repeating charge that stopped
  | 'merchant_drip'      // many small purchases at one place, adding up
  | 'weekend_skew';      // weekend and weekday spend are not the same

interface FindingShape<K extends FindingKind, D> {
  kind: K;
  severity: number;   // 0..1, the server's ranking — never rendered
  currency: Currency; // what every amount in `data` is denominated in
  data: D;
}

export type Finding =
  | FindingShape<'category_moved', {
    category: ExpenseCategory;
    current: number;
    previous: number;
    delta: number;
    deltaPct: number;
    days: number;
    previousDays: number;
  }>
  | FindingShape<'category_new', {
    category: ExpenseCategory;
    current: number;
    days: number;
    previousDays: number;
  }>
  | FindingShape<'recurring_total', {
    count: number;
    monthlyCost: number;
    totalPaid: number;
  }>
  | FindingShape<'recurring_stopped', {
    label: string;
    cadence: Cadence;
    monthlyCost: number;
    totalPaid: number;
    lastSeen: string;
  }>
  | FindingShape<'merchant_drip', {
    key: string;
    total: number;
    count: number;
    average: number;
    days: number;
  }>
  | FindingShape<'weekend_skew', {
    weekendPerDay: number;
    weekdayPerDay: number;
    ratio: number;
    days: number;
  }>;

export interface SummaryResult {
  scope: string;      // 'primary' (everything converted) or a currency code
  currency: Currency; // the currency the findings are expressed in
  windowDays: number;
  findings: Finding[];
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
  categories: Category[];
  currencies: CurrencyInfo[];
}

export interface ExpenseTableProps {
  expenses: Expense[];
  categories: Category[];
  currencies: CurrencyInfo[];
  onEdit: (expense: Expense) => void;
  onDelete: (id: number) => void;
  onUpdate: (id: number, updates: Partial<Expense>) => Promise<void>;
}

export interface DashboardProps {
  expenses: Expense[];
  settings: AppSettings;
  categories: Category[];
  currencies: CurrencyInfo[];
  rates: FxRates;
}

export interface BudgetsProps {
  expenses: Expense[];
  categories: Category[];
  currencies: CurrencyInfo[];
}

export interface FxProps {
  expenses: Expense[];
  currencies: CurrencyInfo[];
  rates: FxRates;
  onRatesChanged: (rates: FxRates) => void;
}

// Sort options for table
export type SortField = 'date' | 'amount' | 'category';
export type SortOrder = 'asc' | 'desc';
