/**
 * Client-side export helpers.
 */

import { Expense } from '../types/expense.types';

/** Trigger a browser download for a Blob. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function csvEscape(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Export a list of expenses to a CSV file (as currently filtered/sorted). */
export function exportExpensesCsv(expenses: Expense[], filename = 'expenses.csv'): void {
  const header = ['Date', 'Description', 'Category', 'Amount', 'Currency'];
  const lines = expenses.map(e =>
    [e.date, e.description, e.category, String(e.amount), e.currency].map(csvEscape).join(',')
  );
  const csv = [header.join(','), ...lines].join('\r\n');
  downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8;' }), filename);
}
