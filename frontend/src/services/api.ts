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
  ReceiptExtraction,
  ExpenseCategory,
  Currency
} from '../types/expense.types';
import { downloadBlob } from '../utils/export';

// Base URL for the API.
// Defaults to the relative "/api" path so the same build works everywhere:
//   - in Docker/Umbrel, nginx reverse-proxies /api -> the backend container
//   - in local dev, Vite proxies /api -> http://localhost:5000 (see vite.config.ts)
// Override with VITE_API_BASE_URL only for non-proxied setups.
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '/api';

// --- Auth token (single-user gate) ---------------------------------------

const TOKEN_KEY = 'expense-tracker-token';

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
  preview: any[][];
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
    errors: Array<{ row: number; error: string; data: any }>;
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
  byCategory: Array<{ category: string; total: number; count: number; average: number }>;
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
