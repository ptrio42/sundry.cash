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
  DateStats
} from '../types/expense.types';

// Base URL for the API.
// Defaults to the relative "/api" path so the same build works everywhere:
//   - in Docker/Umbrel, nginx reverse-proxies /api -> the backend container
//   - in local dev, Vite proxies /api -> http://localhost:5000 (see vite.config.ts)
// Override with VITE_API_BASE_URL only for non-proxied setups.
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '/api';

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

  const url = `${API_BASE_URL}/expenses${params.toString() ? '?' + params.toString() : ''}`;
  const response = await fetch(url);
  return handleResponse<Expense[]>(response);
}

/**
 * Get a single expense by ID
 */
export async function getExpense(id: number): Promise<Expense> {
  const response = await fetch(`${API_BASE_URL}/expenses/${id}`);
  return handleResponse<Expense>(response);
}

/**
 * Create a new expense
 */
export async function createExpense(expense: CreateExpenseDTO): Promise<Expense> {
  const response = await fetch(`${API_BASE_URL}/expenses`, {
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
  const response = await fetch(`${API_BASE_URL}/expenses/${id}`, {
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
  const response = await fetch(`${API_BASE_URL}/expenses/${id}`, {
    method: 'DELETE'
  });
  return handleResponse<void>(response);
}

/**
 * Get statistics grouped by category
 */
export async function getStatsByCategory(): Promise<CategoryStats[]> {
  const response = await fetch(`${API_BASE_URL}/expenses/stats/by-category`);
  return handleResponse<CategoryStats[]>(response);
}

/**
 * Get statistics grouped by date
 */
export async function getStatsByDate(): Promise<DateStats[]> {
  const response = await fetch(`${API_BASE_URL}/expenses/stats/by-date`);
  return handleResponse<DateStats[]>(response);
}

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

  const response = await fetch(`${API_BASE_URL}/import/preview`, {
    method: 'POST',
    body: formData,
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

  const response = await fetch(`${API_BASE_URL}/import/confirm`, {
    method: 'POST',
    body: formData,
  });

  return handleResponse(response);
}

/**
 * Delete all expenses (wipe database)
 */
export async function deleteAllExpenses(): Promise<{
  message: string;
  deletedCount: number;
}> {
  const response = await fetch(`${API_BASE_URL}/expenses/all`, {
    method: 'DELETE',
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

  const url = `${API_BASE_URL}/expenses/stats/analytics${queryParams.toString() ? '?' + queryParams.toString() : ''}`;
  const response = await fetch(url);
  return handleResponse(response);
}
