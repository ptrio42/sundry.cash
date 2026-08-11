/**
 * Tests for the ExpenseTable component.
 *
 * The table is the most stateful piece of the UI: it filters, searches, sorts
 * and — since the ledger can run to thousands of rows — paginates. These tests
 * drive it through props only and assert on what a user would see: which rows
 * are in the DOM, what the pagination control says, the aria-sort on the
 * headers, and the per-currency footer total.
 *
 * The API layer is mocked because the component imports the Excel export and
 * the authenticated receipt fetch from it at module load.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import ExpenseTable from '../components/ExpenseTable';
import { TEST_CATEGORIES } from './categories.fixture';
import { TEST_CURRENCIES } from './currencies.fixture';
import { Category, Expense } from '../types/expense.types';

vi.mock('../services/api', () => ({
  exportExpensesXlsx: vi.fn(),
  fetchReceiptObjectUrl: vi.fn(),
}));

const PAGE_SIZE = 50;

/** A handful of rows spanning categories, currencies and amounts. */
const SAMPLE: Expense[] = [
  { id: 1, date: '2024-01-05', description: 'Coffee beans', category: 'groceries', currency: 'USD', amount: 12.5 },
  { id: 2, date: '2024-02-10', description: 'Bus ticket', category: 'transport', currency: 'PLN', amount: 4.4 },
  { id: 3, date: '2024-03-15', description: 'Netflix', category: 'media', currency: 'USD', amount: 15.99 },
  { id: 4, date: '2024-04-20', description: 'Hardware store', category: 'maintenance', currency: 'PLN', amount: 100 },
  { id: 5, date: '2024-05-25', description: 'Cinema', category: 'entertainment', currency: 'USD', amount: 30 },
];

/**
 * `n` expenses, one per consecutive day from 2024-01-01, with amount === id.
 * Descriptions are zero-padded so "Item 0…" selects exactly ids 1–99.
 */
const manyExpenses = (n: number): Expense[] =>
  Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    amount: i + 1,
    date: new Date(Date.UTC(2024, 0, 1 + i)).toISOString().slice(0, 10),
    description: `Item ${String(i + 1).padStart(3, '0')}`,
    category: 'other' as const,
    currency: 'USD' as const,
  }));

const renderTable = (expenses: Expense[], categories: Category[] = TEST_CATEGORIES) =>
  render(
    <ExpenseTable
      expenses={expenses}
      categories={categories}
      currencies={TEST_CURRENCIES}
      onEdit={vi.fn()}
      onDelete={vi.fn()}
      onUpdate={vi.fn().mockResolvedValue(undefined)}
    />
  );

/** Descriptions of the rows currently in the table body, top to bottom. */
const rowDescriptions = (container: HTMLElement): string[] =>
  Array.from(container.querySelectorAll('tbody tr')).map(
    (tr) => tr.children[2].textContent?.trim() ?? ''
  );

const footerTotal = (container: HTMLElement): string =>
  container.querySelector('.total-amount')?.textContent?.trim() ?? '';

const paginationStatus = () => screen.getByText(/Page \d+ of \d+/);

describe('ExpenseTable pagination', () => {
  it('renders only one page worth of rows and reports the page count', () => {
    const { container } = renderTable(manyExpenses(120));

    expect(rowDescriptions(container)).toHaveLength(PAGE_SIZE);
    expect(paginationStatus()).toHaveTextContent('Page 1 of 3');
    // Default sort is date descending, so the newest row leads.
    expect(screen.getByText('Item 120')).toBeInTheDocument();
    expect(screen.queryByText('Item 070')).not.toBeInTheDocument();
  });

  it('swaps the rows when advancing to the next page', () => {
    const { container } = renderTable(manyExpenses(120));

    fireEvent.click(screen.getByRole('button', { name: /next/i }));

    expect(paginationStatus()).toHaveTextContent('Page 2 of 3');
    const rows = rowDescriptions(container);
    expect(rows).toHaveLength(PAGE_SIZE);
    expect(rows[0]).toBe('Item 070');
    expect(screen.queryByText('Item 120')).not.toBeInTheDocument();
  });

  it('disables Previous on the first page and Next on the last', () => {
    const { container } = renderTable(manyExpenses(120));

    expect(screen.getByRole('button', { name: /previous/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /next/i })).not.toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    fireEvent.click(screen.getByRole('button', { name: /next/i }));

    expect(paginationStatus()).toHaveTextContent('Page 3 of 3');
    expect(screen.getByRole('button', { name: /next/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /previous/i })).not.toBeDisabled();
    // The tail of the ledger: 120 rows over 3 pages leaves 20 on the last one.
    expect(rowDescriptions(container)).toHaveLength(20);
    expect(screen.getByText('Item 001')).toBeInTheDocument();
  });

  it('walks back to the previous page', () => {
    const { container } = renderTable(manyExpenses(120));

    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    fireEvent.click(screen.getByRole('button', { name: /previous/i }));

    expect(paginationStatus()).toHaveTextContent('Page 1 of 3');
    expect(rowDescriptions(container)[0]).toBe('Item 120');
  });

  it('hides the pagination control entirely when everything fits on one page', () => {
    const { container } = renderTable(manyExpenses(PAGE_SIZE));

    expect(rowDescriptions(container)).toHaveLength(PAGE_SIZE);
    expect(screen.queryByRole('navigation', { name: /expense pages/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/Page \d+ of \d+/)).not.toBeInTheDocument();
  });

  it('returns to page 1 when the filter changes', () => {
    const { container } = renderTable(manyExpenses(120));

    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    expect(paginationStatus()).toHaveTextContent('Page 2 of 3');

    // Matches Item 001–Item 099, i.e. still two pages — so landing on page 1
    // has to come from the reset, not from clamping to a shorter list.
    fireEvent.change(screen.getByLabelText('Search:'), { target: { value: 'Item 0' } });

    expect(paginationStatus()).toHaveTextContent('Page 1 of 2');
    expect(rowDescriptions(container)[0]).toBe('Item 099');
  });

  it('totals every filtered row, not just the visible page', () => {
    const { container } = renderTable(manyExpenses(120));

    // Amount === id, so the whole ledger sums to 120 * 121 / 2 = 7260.
    expect(rowDescriptions(container)).toHaveLength(PAGE_SIZE);
    expect(footerTotal(container)).toBe('$7,260.00');
  });
});

describe('ExpenseTable filtering', () => {
  it('filters by category', () => {
    const { container } = renderTable(SAMPLE);

    fireEvent.change(screen.getByLabelText('Category:'), { target: { value: 'transport' } });

    expect(rowDescriptions(container)).toEqual(['Bus ticket']);
  });

  it('filters by currency', () => {
    const { container } = renderTable(SAMPLE);

    fireEvent.change(screen.getByLabelText('Currency:'), { target: { value: 'PLN' } });

    expect(rowDescriptions(container)).toEqual(['Hardware store', 'Bus ticket']);
  });

  it('searches across description, category and amount', () => {
    const { container } = renderTable(SAMPLE);
    const search = screen.getByLabelText('Search:');

    fireEvent.change(search, { target: { value: 'netflix' } });
    expect(rowDescriptions(container)).toEqual(['Netflix']);

    // The category name is searchable even though it is not in the description.
    fireEvent.change(search, { target: { value: 'entertainment' } });
    expect(rowDescriptions(container)).toEqual(['Cinema']);

    // …and so is the raw amount.
    fireEvent.change(search, { target: { value: '15.99' } });
    expect(rowDescriptions(container)).toEqual(['Netflix']);
  });

  it('shows an empty state when nothing matches', () => {
    renderTable(SAMPLE);

    fireEvent.change(screen.getByLabelText('Search:'), { target: { value: 'nothing here' } });

    expect(screen.getByText(/no expenses found/i)).toBeInTheDocument();
  });

  it('restores every row via Clear Filters', () => {
    const { container } = renderTable(SAMPLE);

    fireEvent.change(screen.getByLabelText('Category:'), { target: { value: 'transport' } });
    expect(rowDescriptions(container)).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: /clear filters/i }));

    expect(rowDescriptions(container)).toHaveLength(SAMPLE.length);
  });
});

describe('ExpenseTable sorting', () => {
  const header = (name: string) => screen.getByRole('columnheader', { name });

  it('starts on date descending and flips to ascending when Date is clicked', () => {
    const { container } = renderTable(SAMPLE);

    expect(header('Date')).toHaveAttribute('aria-sort', 'descending');
    expect(rowDescriptions(container)[0]).toBe('Cinema');

    fireEvent.click(within(header('Date')).getByRole('button'));

    expect(header('Date')).toHaveAttribute('aria-sort', 'ascending');
    expect(rowDescriptions(container)[0]).toBe('Coffee beans');
  });

  it('sorts by amount and toggles the direction on a second click', () => {
    const { container } = renderTable(SAMPLE);

    fireEvent.click(within(header('Amount')).getByRole('button'));

    // A new column starts descending, and the old column drops its aria-sort.
    expect(header('Amount')).toHaveAttribute('aria-sort', 'descending');
    expect(header('Date')).toHaveAttribute('aria-sort', 'none');
    expect(rowDescriptions(container)).toEqual([
      'Hardware store', 'Cinema', 'Netflix', 'Coffee beans', 'Bus ticket',
    ]);

    fireEvent.click(within(header('Amount')).getByRole('button'));

    expect(header('Amount')).toHaveAttribute('aria-sort', 'ascending');
    expect(rowDescriptions(container)[0]).toBe('Bus ticket');
  });

  it('sorts by category name', () => {
    const { container } = renderTable(SAMPLE);

    fireEvent.click(within(header('Category')).getByRole('button'));

    // A newly-chosen sort field starts descending, so this is reverse
    // alphabetical order by the stored category name.
    expect(header('Category')).toHaveAttribute('aria-sort', 'descending');
    expect(rowDescriptions(container)).toEqual([
      'Bus ticket',      // transport
      'Netflix',         // media
      'Hardware store',  // maintenance
      'Coffee beans',    // groceries
      'Cinema',          // entertainment
    ]);
  });
});

describe('ExpenseTable totals', () => {
  it('groups the footer total per currency', () => {
    const { container } = renderTable(SAMPLE);

    // 12.50 + 15.99 + 30 USD and 4.40 + 100 PLN, kept apart rather than added.
    expect(footerTotal(container)).toMatch(/\$58\.49/);
    expect(footerTotal(container)).toMatch(/104,40\s*zł/);
  });

  it('recomputes the total from the filtered rows only', () => {
    const { container } = renderTable(SAMPLE);

    fireEvent.change(screen.getByLabelText('Currency:'), { target: { value: 'PLN' } });

    expect(footerTotal(container)).toMatch(/104,40\s*zł/);
    expect(footerTotal(container)).not.toMatch(/\$/);
  });
});

describe('ExpenseTable categories', () => {
  const CUSTOM: Category = { slug: 'pet-food', label: 'Pet food', color: '#f472b6', sortOrder: 7, isBuiltin: false };
  const petExpense: Expense = { id: 9, date: '2024-06-01', description: 'Kibble', category: 'pet-food', currency: 'USD', amount: 20 };

  /** The category cell of the row whose description is `description`. */
  const categoryCell = (container: HTMLElement, description: string): HTMLElement => {
    const row = within(container).getByText(description).closest('tr');
    if (!row) throw new Error(`no row for "${description}"`);
    return row.querySelector('.category-cell') as HTMLElement;
  };

  it('shows a custom category by its label and its own colour', () => {
    const { container } = renderTable([petExpense], [...TEST_CATEGORIES, CUSTOM]);

    const cell = categoryCell(container, 'Kibble');
    expect(cell).toHaveTextContent('Pet food');
    expect(cell.querySelector('.category-dot')).toHaveStyle({ background: '#f472b6' });
  });

  it('offers custom categories in the filter, and filters by them', () => {
    const { container } = renderTable([...SAMPLE, petExpense], [...TEST_CATEGORIES, CUSTOM]);

    fireEvent.change(screen.getByLabelText('Category:'), { target: { value: 'pet-food' } });

    expect(rowDescriptions(container)).toEqual(['Kibble']);
  });

  it('finds a row by its category label as well as its slug', () => {
    const { container } = renderTable([...SAMPLE, petExpense], [...TEST_CATEGORIES, CUSTOM]);

    fireEvent.change(screen.getByLabelText('Search:'), { target: { value: 'Pet food' } });
    expect(rowDescriptions(container)).toEqual(['Kibble']);

    fireEvent.change(screen.getByLabelText('Search:'), { target: { value: 'pet-food' } });
    expect(rowDescriptions(container)).toEqual(['Kibble']);
  });

  it('still renders a row whose category has been deleted elsewhere', () => {
    // The list no longer holds 'pet-food', but the expense still points at it.
    const { container } = renderTable([petExpense]);

    expect(categoryCell(container, 'Kibble')).toHaveTextContent('Pet food');
  });
});
