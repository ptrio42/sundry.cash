/**
 * Budget model — one optional monthly limit per (category, currency).
 * Amounts are stored as integer minor units, like expenses.
 */

import { db } from '../config/database';
import { toMinorUnits, toMajorUnits } from '../config/money';
import { Budget, Currency, ExpenseCategory } from '../types/expense.types';

export function getAll(): Budget[] {
  const rows = db
    .prepare('SELECT category, currency, amount FROM budgets ORDER BY category, currency')
    .all() as any[];
  return rows.map(row => ({
    category: row.category,
    currency: row.currency,
    amount: toMajorUnits(row.amount, row.currency)
  }));
}

/** Create or update the limit for a (category, currency). */
export function upsert(category: ExpenseCategory, currency: Currency, amountMajor: number): Budget {
  db.prepare(
    `INSERT INTO budgets (category, currency, amount)
     VALUES (?, ?, ?)
     ON CONFLICT(category, currency) DO UPDATE SET amount = excluded.amount`
  ).run(category, currency, toMinorUnits(amountMajor, currency));

  return { category, currency, amount: amountMajor };
}

export function remove(category: ExpenseCategory, currency: Currency): boolean {
  const result = db.prepare('DELETE FROM budgets WHERE category = ? AND currency = ?').run(category, currency);
  return result.changes > 0;
}
