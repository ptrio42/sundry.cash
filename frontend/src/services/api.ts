/**
 * API service for communicating with the backend
 * Handles all HTTP requests to the expense tracker API
 */

import {
  Expense,
  CreateExpenseDTO,
  UpdateExpenseDTO,
  ExpenseFilters,
  CategoryStats,
  DateStats,
  Budget,
  Category,
  CurrencyInfo,
  InstanceConfig,
  ReceiptExtraction,
  ExpenseCategory,
  Currency,
  AppSettings,
  ComparisonWindow,
  ComparisonPeriod,
  ComparisonResult,
  RecurringCharge,
  MerchantsResult,
  PatternsResult,
  SummaryResult
} from '../types/expense.types';
import { downloadBlob } from '../utils/export';

// Base URL for the API.
// Defaults to the relative "/api" path so the same build works everywhere:
//   - in Docker, nginx reverse-proxies /api -> the backend container
//   - in local dev, Vite proxies /api -> http://localhost:5000 (see vite.config.ts)
// Override with VITE_API_BASE_URL only for non-proxied setups.
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '/api';

// --- Auth token (single-user gate) ---------------------------------------

const TOKEN_KEY = 'sundry-token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

/**
 * fetch wrapper that prefixes the API base URL, attaches the bearer token when
 * present, and signals session expiry on a 401 so the app can show the login screen.
 */
async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const token = getToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const response = await fetch(`${API_BASE_URL}${path}`, { ...init, headers });

  if (response.status === 401) {
    clearToken();
    window.dispatchEvent(new Event('auth-expired'));
  }

  return response;
}

/**
 * Handle API errors and throw with meaningful messages
 */
async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `HTTP error ${response.status}`);
  }

  // Handle 204 No Content
  if (response.status === 204) {
    return undefined as T;
  }

  return response.json();
}

// --- Auth ----------------------------------------------------------------

/** Whether the backend requires a password. */
export async function getAuthStatus(): Promise<{ authRequired: boolean }> {
  const response = await apiFetch('/auth/status');
  return handleResponse(response);
}

/** Exchange the password for a token and store it. */
export async function login(password: string): Promise<void> {
  const response = await apiFetch('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password })
  });
  const data = await handleResponse<{ token: string }>(response);
  setToken(data.token);
}

/** Clear the stored token. */
export function logout(): void {
  clearToken();
}

// --- Instance ------------------------------------------------------------

/**
 * What kind of instance this is: a public demo, and whether it offers receipts.
 *
 * Public like `/auth/status`, and for the same reason — the answer decides what
 * the app renders before a token can exist. Two booleans is the whole contract;
 * the backend will not put anything else in it.
 */
export async function getInstanceConfig(): Promise<InstanceConfig> {
  const response = await apiFetch('/config');
  return handleResponse<InstanceConfig>(response);
}

// --- Expenses ------------------------------------------------------------

/**
 * Get all expenses with optional filtering
 */
export async function getExpenses(filters?: ExpenseFilters): Promise<Expense[]> {
  const params = new URLSearchParams();

  if (filters?.category) {
    params.append('category', filters.category);
  }
  if (filters?.startDate) {
    params.append('startDate', filters.startDate);
  }
  if (filters?.endDate) {
    params.append('endDate', filters.endDate);
  }
  if (filters?.currency) {
    params.append('currency', filters.currency);
  }

  const response = await apiFetch(`/expenses${params.toString() ? '?' + params.toString() : ''}`);
  return handleResponse<Expense[]>(response);
}

/**
 * Get a single expense by ID
 */
export async function getExpense(id: number): Promise<Expense> {
  const response = await apiFetch(`/expenses/${id}`);
  return handleResponse<Expense>(response);
}

/**
 * Create a new expense
 */
export async function createExpense(expense: CreateExpenseDTO): Promise<Expense> {
  const response = await apiFetch('/expenses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(expense)
  });
  return handleResponse<Expense>(response);
}

/**
 * Update an existing expense
 */
export async function updateExpense(id: number, expense: UpdateExpenseDTO): Promise<Expense> {
  const response = await apiFetch(`/expenses/${id}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(expense)
  });
  return handleResponse<Expense>(response);
}

/**
 * Delete an expense
 */
export async function deleteExpense(id: number): Promise<void> {
  const response = await apiFetch(`/expenses/${id}`, {
    method: 'DELETE'
  });
  return handleResponse<void>(response);
}

/**
 * Get statistics grouped by category
 */
export async function getStatsByCategory(): Promise<CategoryStats[]> {
  const response = await apiFetch('/expenses/stats/by-category');
  return handleResponse<CategoryStats[]>(response);
}

/**
 * Get statistics grouped by date
 */
export async function getStatsByDate(): Promise<DateStats[]> {
  const response = await apiFetch('/expenses/stats/by-date');
  return handleResponse<DateStats[]>(response);
}

// --- Budgets -------------------------------------------------------------

export async function getBudgets(): Promise<Budget[]> {
  const response = await apiFetch('/budgets');
  return handleResponse<Budget[]>(response);
}

export async function setBudget(category: string, currency: string, amount: number): Promise<Budget> {
  const response = await apiFetch('/budgets', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ category, currency, amount })
  });
  return handleResponse<Budget>(response);
}

export async function deleteBudget(category: string, currency: string): Promise<void> {
  const response = await apiFetch(`/budgets/${category}?currency=${encodeURIComponent(currency)}`, {
    method: 'DELETE'
  });
  return handleResponse<void>(response);
}

// --- Categories ----------------------------------------------------------

/** Every category, already in display order. */
export async function getCategories(): Promise<Category[]> {
  const response = await apiFetch('/categories');
  return handleResponse<Category[]>(response);
}

export async function createCategory(input: { slug: string; label: string; color: string }): Promise<Category> {
  const response = await apiFetch('/categories', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input)
  });
  return handleResponse<Category>(response);
}

/** Presentation only — the slug is fixed once the category exists. */
export async function updateCategory(
  slug: string,
  changes: { label?: string; color?: string; sortOrder?: number }
): Promise<Category> {
  const response = await apiFetch(`/categories/${encodeURIComponent(slug)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(changes)
  });
  return handleResponse<Category>(response);
}

/**
 * Delete a category. Without `reassignTo` the backend answers 409 when
 * anything still uses it, so the caller can ask where those rows should go
 * instead of orphaning them.
 */
export async function deleteCategory(slug: string, reassignTo?: string): Promise<void> {
  const query = reassignTo ? `?reassignTo=${encodeURIComponent(reassignTo)}` : '';
  const response = await apiFetch(`/categories/${encodeURIComponent(slug)}${query}`, {
    method: 'DELETE'
  });
  return handleResponse<void>(response);
}

// --- Currencies ----------------------------------------------------------

/** The whole catalogue, enabled entries first. */
export async function getCurrencies(): Promise<CurrencyInfo[]> {
  const response = await apiFetch('/currencies');
  return handleResponse<CurrencyInfo[]>(response);
}

/**
 * Turn a currency on or off. The only thing about a currency that can change:
 * its minor-unit exponent decides how stored amounts are interpreted, so it is
 * fixed by the shipped catalogue rather than editable.
 */
export async function setCurrencyEnabled(code: string, enabled: boolean): Promise<CurrencyInfo> {
  const response = await apiFetch(`/currencies/${encodeURIComponent(code)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled })
  });
  return handleResponse<CurrencyInfo>(response);
}

// --- FX rates ------------------------------------------------------------

export interface FxData {
  base: string;
  rates: Record<string, number>;
}

export async function getFxRates(): Promise<FxData> {
  const response = await apiFetch('/fx');
  return handleResponse<FxData>(response);
}

export async function setFxRate(currency: string, rate: number): Promise<FxData> {
  const response = await apiFetch('/fx', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ currency, rate })
  });
  return handleResponse<FxData>(response);
}

// --- Export --------------------------------------------------------------

/** Download all expenses as an .xlsx file (generated by the backend). */
export async function exportExpensesXlsx(filename = 'expenses.xlsx'): Promise<void> {
  const response = await apiFetch('/expenses/export');
  if (!response.ok) {
    throw new Error('Export failed');
  }
  const blob = await response.blob();
  downloadBlob(blob, filename);
}

// --- Import --------------------------------------------------------------

/**
 * Preview Excel import - get first rows and column names
 */
export async function previewImport(file: File): Promise<{
  columns: string[];
  preview: unknown[][];
  totalRows: number;
}> {
  const formData = new FormData();
  formData.append('file', file);

  const response = await apiFetch('/import/preview', {
    method: 'POST',
    body: formData
  });

  return handleResponse(response);
}

/**
 * Confirm Excel import with column mapping
 */
export async function confirmImport(
  file: File,
  mapping: {
    dateColumn: string;
    amountColumn: string;
    descriptionColumn: string;
    categoryColumn?: string;
    currency: string;
  }
): Promise<{
  message: string;
  results: {
    total: number;
    success: number;
    failed: number;
    skipped: number;
    errors: Array<{ row: number; error: string; data: unknown }>;
  };
}> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('dateColumn', mapping.dateColumn);
  formData.append('amountColumn', mapping.amountColumn);
  formData.append('descriptionColumn', mapping.descriptionColumn);
  if (mapping.categoryColumn) {
    formData.append('categoryColumn', mapping.categoryColumn);
  }
  formData.append('currency', mapping.currency);

  const response = await apiFetch('/import/confirm', {
    method: 'POST',
    body: formData
  });

  return handleResponse(response);
}

// --- Settings ------------------------------------------------------------

/** Fetch user preferences (defaults applied server-side). */
export async function getSettings(): Promise<AppSettings> {
  const response = await apiFetch('/settings');
  return handleResponse<AppSettings>(response);
}

/** Update one or more preferences; returns the full, current settings. */
export async function updateSettings(partial: Partial<AppSettings>): Promise<AppSettings> {
  const response = await apiFetch('/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(partial)
  });
  return handleResponse<AppSettings>(response);
}

// --- Receipt scanning ----------------------------------------------------

/**
 * Upload a receipt photo for OCR and get back the extracted fields to review.
 * No expense is created by this call.
 */
export async function scanReceipt(file: File): Promise<ReceiptExtraction> {
  const formData = new FormData();
  formData.append('receipt', file);

  const response = await apiFetch('/receipts/scan', {
    method: 'POST',
    body: formData
  });

  return handleResponse<ReceiptExtraction>(response);
}

/**
 * Create an expense from reviewed receipt fields, attaching the photo.
 */
export async function createReceiptExpense(
  fields: {
    amount: number;
    date: string;
    description: string;
    category: ExpenseCategory;
    currency: Currency;
    /**
     * The merchant the scan detected, passed through untouched. Never an input:
     * the user edits the description, and this records what was on the receipt
     * so insights can still group the row by shop.
     */
    merchant?: string | null;
  },
  file?: File | null
): Promise<Expense> {
  const formData = new FormData();
  if (file) formData.append('receipt', file);
  formData.append('amount', String(fields.amount));
  formData.append('date', fields.date);
  formData.append('description', fields.description);
  formData.append('category', fields.category);
  formData.append('currency', fields.currency);
  // Omitted rather than sent empty when OCR found no merchant: the column is
  // nullable and the backend falls back to the description.
  if (fields.merchant) formData.append('merchant', fields.merchant);

  const response = await apiFetch('/receipts', {
    method: 'POST',
    body: formData
  });

  return handleResponse<Expense>(response);
}

/**
 * Fetch a stored receipt image (with auth) and return an object URL for display.
 * The caller is responsible for URL.revokeObjectURL when the image is unmounted.
 */
export async function fetchReceiptObjectUrl(filename: string): Promise<string> {
  const response = await apiFetch(`/receipts/${encodeURIComponent(filename)}`);
  if (!response.ok) {
    throw new Error('Failed to load receipt image');
  }
  const blob = await response.blob();
  return URL.createObjectURL(blob);
}

/**
 * Delete all expenses (wipe database)
 */
export async function deleteAllExpenses(): Promise<{
  message: string;
  deletedCount: number;
}> {
  const response = await apiFetch('/expenses/all', {
    method: 'DELETE'
  });

  return handleResponse(response);
}

/**
 * Get analytics for time period and categories
 */
export async function getAnalytics(params: {
  startDate?: string;
  endDate?: string;
  categories?: string[];
  currency?: string;
}): Promise<{
  total: number;
  count: number;
  average: number;
  byCategory: Array<{ category: string; currency: string; total: number; count: number; average: number }>;
  byCurrency: Array<{ currency: string; total: number; count: number; average: number }>;
}> {
  const queryParams = new URLSearchParams();

  if (params.startDate) {
    queryParams.append('startDate', params.startDate);
  }
  if (params.endDate) {
    queryParams.append('endDate', params.endDate);
  }
  if (params.categories && params.categories.length > 0) {
    queryParams.append('categories', params.categories.join(','));
  }
  if (params.currency) {
    queryParams.append('currency', params.currency);
  }

  const response = await apiFetch(
    `/expenses/stats/analytics${queryParams.toString() ? '?' + queryParams.toString() : ''}`
  );
  return handleResponse(response);
}

// --- Insights ------------------------------------------------------------

/**
 * Spend per category for a period against the one before it.
 *
 * Every parameter is optional: with none, the backend answers for a rolling
 * month anchored on today, which is what the dashboard strip wants. Rows keep
 * the currency dimension unless `currency` narrows the request.
 */
export async function getInsightsComparison(params: {
  window?: ComparisonWindow;
  period?: ComparisonPeriod;
  anchor?: string;
  currency?: Currency;
} = {}): Promise<ComparisonResult> {
  const queryParams = new URLSearchParams();

  if (params.window) {
    queryParams.append('window', params.window);
  }
  if (params.period) {
    queryParams.append('period', params.period);
  }
  if (params.anchor) {
    queryParams.append('anchor', params.anchor);
  }
  if (params.currency) {
    queryParams.append('currency', params.currency);
  }

  const response = await apiFetch(
    `/insights/comparison${queryParams.toString() ? '?' + queryParams.toString() : ''}`
  );
  return handleResponse(response);
}

/**
 * Repeating charges and what each one costs per month.
 * Defaults to the last 12 months and at least 3 occurrences.
 */
export async function getInsightsRecurring(params: {
  since?: string;
  minOccurrences?: number;
} = {}): Promise<{ recurring: RecurringCharge[] }> {
  const queryParams = new URLSearchParams();

  if (params.since) {
    queryParams.append('since', params.since);
  }
  if (params.minOccurrences !== undefined) {
    queryParams.append('minOccurrences', String(params.minOccurrences));
  }

  const response = await apiFetch(
    `/insights/recurring${queryParams.toString() ? '?' + queryParams.toString() : ''}`
  );
  return handleResponse(response);
}

/**
 * Where the money goes, ranked by total — the spend that hides in small,
 * frequent purchases no category total makes visible.
 *
 * `limit` is rows kept **per currency**, not in total: totals are counted in
 * each currency's own minor units, so one flat top-N would rank satoshis
 * against grosze and could drop a whole currency. The response says whether
 * that cap cut anything (`truncated`), which is the caller's cue that the list
 * it is holding is not everything.
 */
export async function getInsightsMerchants(params: {
  since?: string;
  until?: string;
  currency?: Currency;
  limit?: number;
} = {}): Promise<MerchantsResult> {
  const queryParams = new URLSearchParams();

  if (params.since) {
    queryParams.append('since', params.since);
  }
  if (params.until) {
    queryParams.append('until', params.until);
  }
  if (params.currency) {
    queryParams.append('currency', params.currency);
  }
  if (params.limit !== undefined) {
    queryParams.append('limit', String(params.limit));
  }

  const response = await apiFetch(
    `/insights/merchants${queryParams.toString() ? '?' + queryParams.toString() : ''}`
  );
  return handleResponse(response);
}

/**
 * When the money goes out: seven weekday buckets per currency, plus the
 * weekend/weekday split. Every figure is per day — a week holds five weekdays
 * and two weekend days, so raw totals would make weekdays win on an even spread.
 * Defaults to the twelve months ending today.
 */
export async function getInsightsPatterns(params: {
  since?: string;
  until?: string;
  currency?: Currency;
} = {}): Promise<PatternsResult> {
  const queryParams = new URLSearchParams();

  if (params.since) {
    queryParams.append('since', params.since);
  }
  if (params.until) {
    queryParams.append('until', params.until);
  }
  if (params.currency) {
    queryParams.append('currency', params.currency);
  }

  const response = await apiFetch(
    `/insights/patterns${queryParams.toString() ? '?' + queryParams.toString() : ''}`
  );
  return handleResponse(response);
}

/**
 * The findings worth a sentence, already ranked and already in one currency.
 *
 * `scope` is what the dashboard's currency buttons select: a currency code for
 * the native view, or 'primary' to have the backend convert everything into the
 * primary currency before it ranks anything. Ranking a PLN finding against a
 * USD one requires the conversion, so the scope has to go to the server —
 * switching currencies costs a round trip rather than a re-render, and buys one
 * implementation of the merge instead of two.
 */
export async function getInsightsSummary(params: {
  scope?: string;
  limit?: number;
  anchor?: string;
} = {}): Promise<SummaryResult> {
  const queryParams = new URLSearchParams();

  if (params.scope) {
    queryParams.append('scope', params.scope);
  }
  if (params.limit !== undefined) {
    queryParams.append('limit', String(params.limit));
  }
  if (params.anchor) {
    queryParams.append('anchor', params.anchor);
  }

  const response = await apiFetch(
    `/insights/summary${queryParams.toString() ? '?' + queryParams.toString() : ''}`
  );
  return handleResponse(response);
}
