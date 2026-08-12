/**
 * ExpenseTable — the rows, and nothing that decides which rows.
 *
 * The filter bar, the search box, the currency picker and the export buttons
 * left this file in wave 3: `Expenses.tsx` owns them now, because the table was
 * the second of two filter bars asking the same question of the same ledger
 * (change 4, F3). What is left is what a table is for — selecting, sorting,
 * paginating and editing rows — driven by props.
 *
 * **The sort is a prop, not state.** The screen holds it so that "export as
 * currently filtered and sorted" still means that once `Export` sits in the
 * toolbar rather than in this file's own header.
 *
 * **There is no footer total.** The summary row above the table carries it,
 * converted, with the exact per-currency subtotals beneath — printing the same
 * figures again 200px lower is the duplication this wave exists to remove.
 */

import { useState, useMemo, useEffect, useRef } from 'react';
import { ExpenseTableProps, ExpenseCategory, SortField } from '../types/expense.types';
import { formatCurrency, formatDate } from '../utils/format';
import { categoryColor, categoryLabel } from '../utils/categories';
import { fetchReceiptObjectUrl } from '../services/api';

// Rows rendered at once. The whole ledger is still fetched — the charts need
// it — but an unwindowed <tbody> of several thousand <tr>s is what actually
// makes the page crawl, so only a slice reaches the DOM.
const PAGE_SIZE = 50;

export default function ExpenseTable({
  expenses,
  categories,
  onEdit,
  onDelete,
  onUpdate,
  sortField,
  sortOrder,
  onSort,
  queryKey
}: ExpenseTableProps) {
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  // 'other' is a built-in, so it is always a valid target for a bulk reassign.
  const [bulkCategory, setBulkCategory] = useState<ExpenseCategory>('other');
  const [page, setPage] = useState<number>(1);

  // Receipt image viewer (loaded with auth, held as an object URL)
  const [receiptUrl, setReceiptUrl] = useState<string | null>(null);
  const [receiptLoading, setReceiptLoading] = useState<boolean>(false);
  const [receiptError, setReceiptError] = useState<string>('');
  const mountedRef = useRef(true);
  const lastFocusedRef = useRef<HTMLElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  // Track mount status so an in-flight image fetch that resolves after unmount
  // can revoke its object URL instead of leaking it.
  useEffect(() => {
    return () => { mountedRef.current = false; };
  }, []);

  // Revoke the object URL whenever it changes or the component unmounts.
  useEffect(() => {
    return () => {
      if (receiptUrl) URL.revokeObjectURL(receiptUrl);
    };
  }, [receiptUrl]);

  const closeReceipt = () => {
    if (receiptUrl) URL.revokeObjectURL(receiptUrl);
    setReceiptUrl(null);
    setReceiptError('');
    // Restore focus to whatever opened the modal.
    lastFocusedRef.current?.focus();
    lastFocusedRef.current = null;
  };

  // While the modal is open: close on Escape and move focus into the dialog.
  useEffect(() => {
    if (!receiptUrl) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeReceipt();
    };
    document.addEventListener('keydown', onKey);
    closeButtonRef.current?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [receiptUrl]);

  const viewReceipt = async (filename: string) => {
    setReceiptError('');
    setReceiptLoading(true);
    lastFocusedRef.current = (document.activeElement as HTMLElement) ?? null;
    try {
      const url = await fetchReceiptObjectUrl(filename);
      // If we unmounted while the request was in flight, don't leak the URL.
      if (!mountedRef.current) {
        URL.revokeObjectURL(url);
        return;
      }
      setReceiptUrl(url);
    } catch {
      if (mountedRef.current) setReceiptError('Could not load the receipt image.');
    } finally {
      if (mountedRef.current) setReceiptLoading(false);
    }
  };

  const pageCount = Math.max(1, Math.ceil(expenses.length / PAGE_SIZE));

  // Filtering can shrink the list under the current page (or a delete can empty
  // the last page); snap back rather than showing a blank table.
  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  // Any change to *what is being asked* starts from the top again — and a change
  // to the ledger itself deliberately does not, so deleting a row on page 3
  // leaves you on page 3.
  useEffect(() => {
    setPage(1);
  }, [queryKey]);

  const visibleExpenses = useMemo(
    () => expenses.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [expenses, page]
  );

  /**
   * Handle delete with confirmation
   */
  const handleDelete = (id: number, description: string) => {
    if (window.confirm(`Are you sure you want to delete "${description}"?`)) {
      onDelete(id);
    }
  };

  /**
   * Get sort indicator icon
   */
  const getSortIcon = (field: SortField) => {
    if (sortField !== field) return '⇅';
    return sortOrder === 'asc' ? '↑' : '↓';
  };

  /**
   * aria-sort value for a column header
   */
  const ariaSort = (field: SortField): 'ascending' | 'descending' | 'none' =>
    sortField === field ? (sortOrder === 'asc' ? 'ascending' : 'descending') : 'none';

  /**
   * Toggle selection of a single expense
   */
  const toggleSelection = (id: number) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedIds(newSelected);
  };

  /**
   * Toggle selection of all rows the filter left standing — not just the page.
   */
  const toggleSelectAll = () => {
    if (selectedIds.size === expenses.length) {
      // Deselect all
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(expenses.map(exp => exp.id)));
    }
  };

  /**
   * Handle bulk delete
   */
  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;

    const confirmMessage = `Are you sure you want to delete ${selectedIds.size} selected expense${selectedIds.size > 1 ? 's' : ''}?`;
    if (!window.confirm(confirmMessage)) return;

    // Delete each selected expense
    for (const id of selectedIds) {
      onDelete(id);
    }

    // Clear selection
    setSelectedIds(new Set());
  };

  /**
   * Handle bulk category assignment
   */
  const handleBulkAssignCategory = async () => {
    if (selectedIds.size === 0) return;

    const confirmMessage = `Assign "${categoryLabel(categories, bulkCategory)}" category to ${selectedIds.size} selected expense${selectedIds.size > 1 ? 's' : ''}?`;
    if (!window.confirm(confirmMessage)) return;

    try {
      // Update each selected expense
      for (const id of selectedIds) {
        await onUpdate(id, { category: bulkCategory });
      }
      // Clear selection after successful updates
      setSelectedIds(new Set());
    } catch {
      alert('Failed to update some expenses. Please try again.');
    }
  };

  return (
    <div className="expense-table">
      {/* No heading: the page title one line above already says "Expenses", and
          saying it twice at two ranks is change 28's second half. */}

      {/* Bulk Actions Bar */}
      {selectedIds.size > 0 && (
        <div className="bulk-actions-bar">
          <span className="selected-count">{selectedIds.size} selected</span>

          <div className="bulk-actions-controls">
            <select
              value={bulkCategory}
              onChange={(e) => setBulkCategory(e.target.value as ExpenseCategory)}
              className="bulk-category-select"
            >
              {categories.map(cat => (
                <option key={cat.slug} value={cat.slug}>
                  {cat.label}
                </option>
              ))}
            </select>

            <button
              onClick={handleBulkAssignCategory}
              className="btn-bulk-assign"
            >
              Assign Category
            </button>

            <button
              onClick={handleBulkDelete}
              className="btn-bulk-delete"
            >
              Delete Selected
            </button>

            <button
              onClick={() => setSelectedIds(new Set())}
              className="btn-bulk-cancel"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="table-container">
        {expenses.length === 0 ? (
          <p className="no-data">No expenses found. Add some to get started!</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th className="checkbox-cell">
                  <input
                    type="checkbox"
                    checked={selectedIds.size > 0 && selectedIds.size === expenses.length}
                    onChange={toggleSelectAll}
                    aria-label="Select all expenses"
                  />
                </th>
                <th className="sortable" scope="col" aria-sort={ariaSort('date')}>
                  <button type="button" onClick={() => onSort('date')}>
                    Date <span aria-hidden="true">{getSortIcon('date')}</span>
                  </button>
                </th>
                <th>Description</th>
                <th className="sortable" scope="col" aria-sort={ariaSort('category')}>
                  <button type="button" onClick={() => onSort('category')}>
                    Category <span aria-hidden="true">{getSortIcon('category')}</span>
                  </button>
                </th>
                <th className="sortable" scope="col" aria-sort={ariaSort('amount')}>
                  <button type="button" onClick={() => onSort('amount')}>
                    Amount <span aria-hidden="true">{getSortIcon('amount')}</span>
                  </button>
                </th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {visibleExpenses.map((expense) => (
                <tr key={expense.id} className={selectedIds.has(expense.id) ? 'selected-row' : ''}>
                  <td className="checkbox-cell">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(expense.id)}
                      onChange={() => toggleSelection(expense.id)}
                      aria-label={`Select ${expense.description}`}
                    />
                  </td>
                  <td>{formatDate(expense.date)}</td>
                  <td>
                    {expense.description}
                    {expense.receiptImage && (
                      <button
                        type="button"
                        className="receipt-badge"
                        title="View receipt"
                        aria-label={`View receipt for ${expense.description}`}
                        onClick={() => viewReceipt(expense.receiptImage as string)}
                        disabled={receiptLoading}
                      >
                        🧾
                      </button>
                    )}
                  </td>
                  {/* The colour is data now, so it arrives as a swatch rather
                      than as text colour: one hex per category has to work on
                      both the dark and the light theme, and a mid-tone that
                      reads on dark is unreadable on white. */}
                  <td className="category-cell">
                    <span className="category-dot" style={{ background: categoryColor(categories, expense.category) }} />
                    {categoryLabel(categories, expense.category)}
                  </td>
                  <td className="amount">{formatCurrency(expense.amount, expense.currency)}</td>
                  <td className="actions">
                    <button
                      onClick={() => onEdit(expense)}
                      className="btn-edit"
                      title="Edit expense"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(expense.id, expense.description)}
                      className="btn-delete"
                      title="Delete expense"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {pageCount > 1 && (
          <nav className="pagination" aria-label="Expense pages">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
            >
              ← Previous
            </button>
            {/* aria-live so the position is announced after the rows swap out. */}
            <span className="pagination-status" aria-live="polite">
              Page {page} of {pageCount}
              <span className="pagination-count">
                {' '}· {expenses.length} expense
                {expenses.length === 1 ? '' : 's'}
              </span>
            </span>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setPage(p => Math.min(pageCount, p + 1))}
              disabled={page === pageCount}
            >
              Next →
            </button>
          </nav>
        )}
      </div>

      {receiptError && <div className="error-message">{receiptError}</div>}

      {receiptUrl && (
        <div
          className="receipt-modal-overlay"
          role="presentation"
          onClick={(e) => { if (e.target === e.currentTarget) closeReceipt(); }}
        >
          {/* role="dialog" belongs on the panel that holds the content and the
              close button, not on the backdrop. Escape also closes (see above). */}
          <div className="receipt-modal" role="dialog" aria-modal="true" aria-label="Receipt image">
            <button ref={closeButtonRef} type="button" className="receipt-modal-close" onClick={closeReceipt} aria-label="Close">
              ✕
            </button>
            <img src={receiptUrl} alt="Receipt" />
          </div>
        </div>
      )}
    </div>
  );
}
