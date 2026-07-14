/**
 * ExpenseTable Component
 * Displays expenses in a table with sorting, filtering, and actions
 */

import { useState, useMemo } from 'react';
import { ExpenseTableProps, ExpenseCategory, SortField, SortOrder, Currency } from '../types/expense.types';
import { formatCurrency, formatDate, CURRENCY_SYMBOLS } from '../utils/format';
import { exportExpensesCsv } from '../utils/export';
import { exportExpensesXlsx } from '../services/api';

// Available categories for filtering
const CATEGORIES: ExpenseCategory[] = ['groceries', 'transport', 'media', 'entertainment', 'utilities', 'maintenance', 'other'];

// Available currencies for filtering
const CURRENCIES: Currency[] = ['USD', 'PLN', 'BTC'];

export default function ExpenseTable({ expenses, onEdit, onDelete, onUpdate }: ExpenseTableProps) {
  const [sortField, setSortField] = useState<SortField>('date');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [filterCurrency, setFilterCurrency] = useState<string>('all');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkCategory, setBulkCategory] = useState<ExpenseCategory>('other');

  /**
   * Handle sort by a specific field
   */
  const handleSort = (field: SortField) => {
    if (sortField === field) {
      // Toggle sort order
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      // New field, default to descending
      setSortField(field);
      setSortOrder('desc');
    }
  };

  /**
   * Filter and sort expenses
   */
  const filteredAndSortedExpenses = useMemo(() => {
    let result = [...expenses];

    // Filter by search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter(exp =>
        exp.description.toLowerCase().includes(query) ||
        exp.category.toLowerCase().includes(query) ||
        exp.amount.toString().includes(query)
      );
    }

    // Filter by category
    if (filterCategory !== 'all') {
      result = result.filter(exp => exp.category === filterCategory);
    }

    // Filter by currency
    if (filterCurrency !== 'all') {
      result = result.filter(exp => exp.currency === filterCurrency);
    }

    // Filter by date range
    if (startDate) {
      result = result.filter(exp => exp.date >= startDate);
    }
    if (endDate) {
      result = result.filter(exp => exp.date <= endDate);
    }

    // Sort
    result.sort((a, b) => {
      let compareValue = 0;

      if (sortField === 'date') {
        compareValue = a.date.localeCompare(b.date);
      } else if (sortField === 'amount') {
        compareValue = a.amount - b.amount;
      } else if (sortField === 'category') {
        compareValue = a.category.localeCompare(b.category);
      }

      return sortOrder === 'asc' ? compareValue : -compareValue;
    });

    return result;
  }, [expenses, searchQuery, filterCategory, filterCurrency, startDate, endDate, sortField, sortOrder]);

  /**
   * Handle delete with confirmation
   */
  const handleDelete = (id: number, description: string) => {
    if (window.confirm(`Are you sure you want to delete "${description}"?`)) {
      onDelete(id);
    }
  };

  const handleExportExcel = async () => {
    try {
      await exportExpensesXlsx();
    } catch {
      alert('Export failed. Please try again.');
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
   * Make a header cell keyboard-operable (Enter / Space triggers the sort)
   */
  const handleSortKey = (e: React.KeyboardEvent, field: SortField) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleSort(field);
    }
  };

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
   * Toggle selection of all visible expenses
   */
  const toggleSelectAll = () => {
    if (selectedIds.size === filteredAndSortedExpenses.length) {
      // Deselect all
      setSelectedIds(new Set());
    } else {
      // Select all visible expenses
      const allIds = new Set(filteredAndSortedExpenses.map(exp => exp.id));
      setSelectedIds(allIds);
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

    const confirmMessage = `Assign "${bulkCategory}" category to ${selectedIds.size} selected expense${selectedIds.size > 1 ? 's' : ''}?`;
    if (!window.confirm(confirmMessage)) return;

    try {
      // Update each selected expense
      for (const id of selectedIds) {
        await onUpdate(id, { category: bulkCategory });
      }
      // Clear selection after successful updates
      setSelectedIds(new Set());
    } catch (error) {
      alert('Failed to update some expenses. Please try again.');
    }
  };

  return (
    <div className="expense-table">
      <div className="table-toolbar">
        <h2>All Expenses</h2>
        <div className="export-buttons">
          <button type="button" className="btn-secondary" onClick={() => exportExpensesCsv(filteredAndSortedExpenses)}>
            ⬇ CSV
          </button>
          <button type="button" className="btn-secondary" onClick={handleExportExcel}>
            ⬇ Excel
          </button>
        </div>
      </div>

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
              {CATEGORIES.map(cat => (
                <option key={cat} value={cat}>
                  {cat.charAt(0).toUpperCase() + cat.slice(1)}
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

      {/* Filters */}
      <div className="filters">
        <div className="filter-group search-group">
          <label htmlFor="searchQuery">Search:</label>
          <input
            type="text"
            id="searchQuery"
            placeholder="Search description, category, or amount..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <div className="filter-group">
          <label htmlFor="filterCategory">Category:</label>
          <select
            id="filterCategory"
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
          >
            <option value="all">All Categories</option>
            {CATEGORIES.map((cat) => (
              <option key={cat} value={cat}>
                {cat.charAt(0).toUpperCase() + cat.slice(1)}
              </option>
            ))}
          </select>
        </div>

        <div className="filter-group">
          <label htmlFor="filterCurrency">Currency:</label>
          <select
            id="filterCurrency"
            value={filterCurrency}
            onChange={(e) => setFilterCurrency(e.target.value)}
          >
            <option value="all">All Currencies</option>
            {CURRENCIES.map((curr) => (
              <option key={curr} value={curr}>
                {curr} ({CURRENCY_SYMBOLS[curr]})
              </option>
            ))}
          </select>
        </div>

        <div className="filter-group">
          <label htmlFor="startDate">From:</label>
          <input
            type="date"
            id="startDate"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
        </div>

        <div className="filter-group">
          <label htmlFor="endDate">To:</label>
          <input
            type="date"
            id="endDate"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
          />
        </div>

        <button
          onClick={() => {
            setSearchQuery('');
            setFilterCategory('all');
            setFilterCurrency('all');
            setStartDate('');
            setEndDate('');
          }}
          className="clear-filters"
        >
          Clear Filters
        </button>
      </div>

      {/* Table */}
      <div className="table-container">
        {filteredAndSortedExpenses.length === 0 ? (
          <p className="no-data">No expenses found. Add some to get started!</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th className="checkbox-cell">
                  <input
                    type="checkbox"
                    checked={selectedIds.size > 0 && selectedIds.size === filteredAndSortedExpenses.length}
                    onChange={toggleSelectAll}
                    aria-label="Select all expenses"
                  />
                </th>
                <th
                  className="sortable"
                  role="button"
                  tabIndex={0}
                  aria-sort={ariaSort('date')}
                  onClick={() => handleSort('date')}
                  onKeyDown={(e) => handleSortKey(e, 'date')}
                >
                  Date <span aria-hidden="true">{getSortIcon('date')}</span>
                </th>
                <th>Description</th>
                <th
                  className="sortable"
                  role="button"
                  tabIndex={0}
                  aria-sort={ariaSort('category')}
                  onClick={() => handleSort('category')}
                  onKeyDown={(e) => handleSortKey(e, 'category')}
                >
                  Category <span aria-hidden="true">{getSortIcon('category')}</span>
                </th>
                <th
                  className="sortable"
                  role="button"
                  tabIndex={0}
                  aria-sort={ariaSort('amount')}
                  onClick={() => handleSort('amount')}
                  onKeyDown={(e) => handleSortKey(e, 'amount')}
                >
                  Amount <span aria-hidden="true">{getSortIcon('amount')}</span>
                </th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredAndSortedExpenses.map((expense) => (
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
                  <td>{expense.description}</td>
                  <td className={`category-${expense.category}`}>
                    {expense.category.charAt(0).toUpperCase() + expense.category.slice(1)}
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
            <tfoot>
              <tr>
                <td></td>
                <td colSpan={3} className="total-label">Total:</td>
                <td className="total-amount">
                  {(() => {
                    // Group by currency and calculate totals
                    const totals = filteredAndSortedExpenses.reduce((acc, exp) => {
                      acc[exp.currency] = (acc[exp.currency] || 0) + exp.amount;
                      return acc;
                    }, {} as Record<Currency, number>);

                    // Format and display all currency totals
                    return Object.entries(totals)
                      .map(([currency, total]) => formatCurrency(total, currency as Currency))
                      .join(' + ');
                  })()}
                </td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>
    </div>
  );
}
