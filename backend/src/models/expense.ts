/**
 * Expense model - handles all database operations for expenses
 */

import { db } from '../config/database';
import { toMinorUnits, toMajorUnits } from '../config/money';
import { deleteReceiptImage, clearReceiptImages } from '../services/receipt/storage';
import {
  Expense,
  Currency,
  CreateExpenseDTO,
  UpdateExpenseDTO,
  ExpenseFilters,
  CategoryStats,
  DateStats
} from '../types/expense.types';

/**
 * Get all expenses with optional filtering
 */
export function getAll(filters?: ExpenseFilters): Expense[] {
  let query = 'SELECT * FROM expenses WHERE 1=1';
  const params: any[] = [];

  if (filters?.category) {
    query += ' AND category = ?';
    params.push(filters.category);
  }

  if (filters?.startDate) {
    query += ' AND date >= ?';
    params.push(filters.startDate);
  }

  if (filters?.endDate) {
    query += ' AND date <= ?';
    params.push(filters.endDate);
  }

  if (filters?.currency) {
    query += ' AND currency = ?';
    params.push(filters.currency);
  }

  query += ' ORDER BY date DESC, created_at DESC';

  const stmt = db.prepare(query);
  const rows = stmt.all(...params) as any[];

  return rows.map(row => ({
    id: row.id,
    amount: toMajorUnits(row.amount, row.currency),
    date: row.date,
    description: row.description,
    category: row.category,
    currency: row.currency,
    createdAt: row.created_at,
    receiptImage: row.receipt_image ?? null
  }));
}

/**
 * Get a single expense by ID
 */
export function getById(id: number): Expense | undefined {
  const stmt = db.prepare('SELECT * FROM expenses WHERE id = ?');
  const row = stmt.get(id) as any;

  if (!row) return undefined;

  return {
    id: row.id,
    amount: toMajorUnits(row.amount, row.currency),
    date: row.date,
    description: row.description,
    category: row.category,
    currency: row.currency,
    createdAt: row.created_at,
    receiptImage: row.receipt_image ?? null
  };
}

/**
 * Create a new expense
 */
export function create(expense: CreateExpenseDTO): Expense {
  const stmt = db.prepare(`
    INSERT INTO expenses (amount, date, description, category, currency, receipt_image)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const result = stmt.run(
    toMinorUnits(expense.amount, expense.currency),
    expense.date,
    expense.description,
    expense.category,
    expense.currency,
    expense.receiptImage ?? null
  );

  // Fetch and return the created expense
  const created = getById(result.lastInsertRowid as number);
  if (!created) {
    throw new Error('Failed to create expense');
  }

  return created;
}

/**
 * Update an existing expense
 */
export function update(id: number, expense: UpdateExpenseDTO): Expense | undefined {
  // First check if expense exists
  const existing = getById(id);
  if (!existing) return undefined;

  // Build dynamic update query based on provided fields
  const updates: string[] = [];
  const params: any[] = [];

  // Re-encode the stored minor-unit amount whenever the amount OR the currency
  // changes, since the currency determines the minor-unit scale.
  const nextCurrency = expense.currency ?? existing.currency;
  if (expense.amount !== undefined || expense.currency !== undefined) {
    const nextAmountMajor = expense.amount ?? existing.amount;
    updates.push('amount = ?');
    params.push(toMinorUnits(nextAmountMajor, nextCurrency));
  }

  if (expense.date !== undefined) {
    updates.push('date = ?');
    params.push(expense.date);
  }

  if (expense.description !== undefined) {
    updates.push('description = ?');
    params.push(expense.description);
  }

  if (expense.category !== undefined) {
    updates.push('category = ?');
    params.push(expense.category);
  }

  if (expense.currency !== undefined) {
    updates.push('currency = ?');
    params.push(expense.currency);
  }

  // If no fields to update, return existing
  if (updates.length === 0) return existing;

  params.push(id);
  const query = `UPDATE expenses SET ${updates.join(', ')} WHERE id = ?`;

  const stmt = db.prepare(query);
  stmt.run(...params);

  return getById(id);
}

/**
 * Delete an expense
 */
export function deleteExpense(id: number): boolean {
  // Grab the attached receipt (if any) before the row is gone, then clean up
  // the file so deleted expenses don't leave orphaned images on disk.
  const existing = getById(id);
  const stmt = db.prepare('DELETE FROM expenses WHERE id = ?');
  const result = stmt.run(id);
  if (result.changes > 0 && existing?.receiptImage) {
    deleteReceiptImage(existing.receiptImage);
  }
  return result.changes > 0;
}

/**
 * Get expenses by date range
 */
export function getByDateRange(startDate: string, endDate: string): Expense[] {
  return getAll({ startDate, endDate });
}

/**
 * Get expenses by category
 */
export function getByCategory(category: string): Expense[] {
  return getAll({ category: category as any });
}

/**
 * Get statistics grouped by category
 */
export function getStatsByCategory(): CategoryStats[] {
  // Group by currency as well: summing minor units across currencies would be
  // meaningless (cents + satoshis). Each row is a single currency, converted back
  // to major units for the response.
  const stmt = db.prepare(`
    SELECT
      category,
      currency,
      SUM(amount) as total,
      COUNT(*) as count
    FROM expenses
    GROUP BY category, currency
    ORDER BY total DESC
  `);

  const rows = stmt.all() as any[];

  return rows.map(row => ({
    category: row.category,
    currency: row.currency,
    total: toMajorUnits(row.total, row.currency),
    count: row.count
  }));
}

/**
 * Get statistics grouped by date
 */
export function getStatsByDate(): DateStats[] {
  const stmt = db.prepare(`
    SELECT
      date,
      currency,
      SUM(amount) as total,
      COUNT(*) as count
    FROM expenses
    GROUP BY date, currency
    ORDER BY date DESC
  `);

  const rows = stmt.all() as any[];

  return rows.map(row => ({
    date: row.date,
    currency: row.currency,
    total: toMajorUnits(row.total, row.currency),
    count: row.count
  }));
}

/**
 * Delete all expenses and reset auto-increment
 */
export function deleteAll(): number {
  // Delete all rows
  const deleteStmt = db.prepare('DELETE FROM expenses');
  const result = deleteStmt.run();

  // Reset auto-increment counter
  const resetStmt = db.prepare('DELETE FROM sqlite_sequence WHERE name = ?');
  resetStmt.run('expenses');

  // Remove every stored receipt image too — wiping the DB should wipe its files.
  clearReceiptImages();

  return result.changes;
}

/**
 * Get analytics for a time period and category
 */
export function getAnalytics(params: {
  startDate?: string;
  endDate?: string;
  categories?: string[];
  currency?: string;
}): {
  total: number;
  count: number;
  average: number;
  byCategory: Array<{ category: string; currency: string; total: number; count: number; average: number }>;
  byCurrency: Array<{ currency: string; total: number; count: number; average: number }>;
} {
  let query = 'SELECT category, currency, SUM(amount) as total, COUNT(*) as count FROM expenses WHERE 1=1';
  const queryParams: any[] = [];

  if (params.startDate) {
    query += ' AND date >= ?';
    queryParams.push(params.startDate);
  }

  if (params.endDate) {
    query += ' AND date <= ?';
    queryParams.push(params.endDate);
  }

  if (params.categories && params.categories.length > 0) {
    const placeholders = params.categories.map(() => '?').join(',');
    query += ` AND category IN (${placeholders})`;
    queryParams.push(...params.categories);
  }

  if (params.currency) {
    query += ' AND currency = ?';
    queryParams.push(params.currency);
  }

  query += ' GROUP BY category, currency';

  const stmt = db.prepare(query);
  const rows = stmt.all(...queryParams) as any[];

  // Each row is a single (category, currency) group; row.total is exact minor units.
  // byCurrency stays exact (minor units summed per currency, converted once).
  //
  // byCategory keeps the currency dimension rather than collapsing it. Summing
  // across currencies here would be meaningless — 100 USD + 1 BTC is not 101 of
  // anything — and the client cannot undo the collapse. Emitting one row per
  // (category, currency) lets the UI convert at a rate the user controls.
  const categoryMap = new Map<string, { category: string; currency: string; totalMinor: number; count: number }>();
  const currencyMap = new Map<string, { totalMinor: number; count: number }>();   // exact minor units
  let grandTotalMajor = 0;
  let grandCount = 0;

  rows.forEach(row => {
    const rowMajor = toMajorUnits(row.total, row.currency);

    // Key only identifies the group; the fields are carried in the value so
    // nothing has to be parsed back out of the key later.
    const catKey = `${row.category}|${row.currency}`;
    const cat = categoryMap.get(catKey);
    categoryMap.set(catKey, {
      category: row.category,
      currency: row.currency,
      totalMinor: (cat?.totalMinor ?? 0) + row.total,
      count: (cat?.count ?? 0) + row.count
    });

    const cur = currencyMap.get(row.currency) || { totalMinor: 0, count: 0 };
    currencyMap.set(row.currency, {
      totalMinor: cur.totalMinor + row.total,
      count: cur.count + row.count
    });

    grandTotalMajor += rowMajor;
    grandCount += row.count;
  });

  const byCategory = Array.from(categoryMap.values()).map(data => {
    const total = toMajorUnits(data.totalMinor, data.currency as Currency);
    return {
      category: data.category,
      currency: data.currency,
      total,
      count: data.count,
      average: data.count > 0 ? total / data.count : 0
    };
  });

  const byCurrency = Array.from(currencyMap.entries()).map(([currency, data]) => {
    const total = toMajorUnits(data.totalMinor, currency as Currency);
    return {
      currency,
      total,
      count: data.count,
      average: data.count > 0 ? total / data.count : 0
    };
  });

  return {
    // NOTE: `total` and `average` add up major units across whatever currencies
    // the query matched, so they are only meaningful when the caller scoped the
    // request to one currency. Clients spanning currencies must build their
    // totals from `byCurrency` / `byCategory`, which stay currency-scoped.
    total: grandTotalMajor,
    count: grandCount,
    average: grandCount > 0 ? grandTotalMajor / grandCount : 0,
    byCategory,
    byCurrency
  };
}
