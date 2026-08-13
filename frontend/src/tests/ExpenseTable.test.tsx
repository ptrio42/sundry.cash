/**
 * Tests for the ExpenseTable component.
 *
 * The table stopped deciding *which* rows it shows in wave 3 — the filter bar,
 * the search box and the export buttons moved to `Expenses`, and those
 * behaviours are tested there. What is left here is what a table still owns:
 * paginating a long list, reporting the sort its screen is holding, selecting
 * rows, and rendering a category by its own label and colour.
 *
 * Sorting is driven through a harness that holds the state the screen holds, so
 * these cases exercise the same `sortExpenses` the real screen uses rather than
 * a copy of it.
 *
 * The API layer is mocked because the component imports the authenticated
 * receipt fetch from it at module load.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { useState } from 'react';
import ExpenseTable from '../components/ExpenseTable';
import { sortExpenses } from '../utils/expenses';
import { TEST_CATEGORIES } from './categories.fixture';
import { Category, Expense, SortField, SortOrder } from '../types/expense.types';

vi.mock('../services/api', () => ({
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

/**
 * The state the screen holds around the table: the sort, and the key that says
 * "the question changed" as opposed to "the ledger changed".
 */
function Harness({ expenses, categories = TEST_CATEGORIES, queryKey = 'q', showWho = false }: {
  expenses: Expense[];
  categories?: Category[];
  queryKey?: string;
  /** The screen decides this from the whole ledger; the table only obeys it. */
  showWho?: boolean;
}) {
  const [sortField, setSortField] = useState<SortField>('date');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');

  const onSort = (field: SortField) => {
    if (field === sortField) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
      return;
    }
    setSortField(field);
    setSortOrder('desc');
  };

  return (
    <ExpenseTable
      expenses={sortExpenses(expenses, sortField, sortOrder, categories)}
      categories={categories}
      showWho={showWho}
      onEdit={vi.fn()}
      onDelete={vi.fn()}
      onUpdate={vi.fn().mockResolvedValue(undefined)}
      sortField={sortField}
      sortOrder={sortOrder}
      onSort={onSort}
      queryKey={`${queryKey}|${sortField}|${sortOrder}`}
    />
  );
}

const renderTable = (expenses: Expense[], categories: Category[] = TEST_CATEGORIES) =>
  render(<Harness expenses={expenses} categories={categories} />);

/** Descriptions of the rows currently in the table body, top to bottom. */
const rowDescriptions = (container: HTMLElement): string[] =>
  Array.from(container.querySelectorAll('tbody tr')).map(
    (tr) => tr.children[2].textContent?.trim() ?? ''
  );

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

  it('returns to page 1 when the query changes', () => {
    const rows = manyExpenses(120);
    const { rerender } = render(<Harness expenses={rows} queryKey="everything" />);

    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    expect(paginationStatus()).toHaveTextContent('Page 2 of 3');

    // Still three pages, so landing on page 1 has to come from the reset rather
    // than from clamping to a shorter list.
    rerender(<Harness expenses={rows} queryKey="filtered" />);

    expect(paginationStatus()).toHaveTextContent('Page 1 of 3');
  });

  it('stays on the page you are reading when the ledger changes underneath', () => {
    // Deleting a row on page 3 must not throw the reader back to page 1 — which
    // is why the reset watches the query and not the rows.
    const rows = manyExpenses(120);
    const { rerender } = render(<Harness expenses={rows} queryKey="everything" />);

    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    expect(paginationStatus()).toHaveTextContent('Page 2 of 3');

    rerender(<Harness expenses={rows.filter(row => row.id !== 1)} queryKey="everything" />);

    expect(paginationStatus()).toHaveTextContent('Page 2 of 3');
  });

  it('counts every row it was handed, not just the visible page', () => {
    renderTable(manyExpenses(120));

    expect(paginationStatus()).toHaveTextContent('120 expenses');
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
    // alphabetical order by the label the row is showing.
    expect(header('Category')).toHaveAttribute('aria-sort', 'descending');
    expect(rowDescriptions(container)).toEqual([
      'Bus ticket',      // Transport
      'Netflix',         // Media
      'Hardware store',  // Maintenance
      'Coffee beans',    // Groceries
      'Cinema',          // Entertainment
    ]);
  });
});

/**
 * The icon wave (`docs/icon-wiring-spec.md`).
 *
 * The sort mark used to be ⇅ / ↑ / ↓ — characters, inside an `aria-hidden` span,
 * beside a `<th>` that already carried `aria-sort`. The picture replacing them
 * has to track the same three states, and the header has to go on carrying the
 * attribute, because that attribute is the only part of this a screen reader
 * ever reads.
 */
describe('ExpenseTable — the sort indicator', () => {
  const header = (name: string) => screen.getByRole('columnheader', { name });
  const markIn = (name: string) =>
    header(name).querySelector('svg[data-icon]')?.getAttribute('data-icon');

  it('draws the direction on the sorted column and neutral on the others', () => {
    renderTable(SAMPLE);

    // The harness opens on date descending.
    expect(markIn('Date')).toBe('sort-descending');
    expect(markIn('Amount')).toBe('sort-none');
    expect(markIn('Category')).toBe('sort-none');
  });

  it('follows the column and the direction as they change', () => {
    renderTable(SAMPLE);

    fireEvent.click(within(header('Date')).getByRole('button'));
    expect(markIn('Date')).toBe('sort-ascending');

    fireEvent.click(within(header('Amount')).getByRole('button'));
    expect(markIn('Amount')).toBe('sort-descending');
    // The column that was sorted goes back to neutral rather than keeping a
    // direction it is no longer applying.
    expect(markIn('Date')).toBe('sort-none');
  });

  it('says the same thing in aria-sort, which is the half that is spoken', () => {
    renderTable(SAMPLE);

    // Both halves, together, in all three states — the picture is reinforcement.
    expect(header('Date')).toHaveAttribute('aria-sort', 'descending');
    expect(header('Amount')).toHaveAttribute('aria-sort', 'none');

    fireEvent.click(within(header('Date')).getByRole('button'));

    expect(header('Date')).toHaveAttribute('aria-sort', 'ascending');
    expect(markIn('Date')).toBe('sort-ascending');
  });

  it('keeps the mark out of the accessible name of the column', () => {
    renderTable(SAMPLE);

    // `getByRole('columnheader', { name: 'Date' })` above already proves this —
    // it would not match if the mark contributed. This says so on purpose,
    // because as a font character the state was announced twice, the second
    // time as "up arrow".
    for (const column of ['Date', 'Category', 'Amount']) {
      const svg = header(column).querySelector('svg[data-icon]');
      expect(svg?.getAttribute('aria-hidden'), column).toBe('true');
      expect(header(column).textContent?.trim(), column).toBe(column);
    }
  });
});

describe('ExpenseTable rows', () => {
  it('shows an empty state when it was handed nothing', () => {
    renderTable([]);

    expect(screen.getByText(/no expenses found/i)).toBeInTheDocument();
  });

  it('selects every row it holds, not just the visible page', () => {
    renderTable(manyExpenses(120));

    fireEvent.click(screen.getByRole('checkbox', { name: /select all expenses/i }));

    expect(screen.getByText('120 selected')).toBeInTheDocument();
  });

  it('names the bulk-assign dropdown, which announced as an unnamed combo box', () => {
    renderTable(SAMPLE);
    // The bar only exists once something is selected.
    fireEvent.click(screen.getByRole('checkbox', { name: /select all expenses/i }));

    expect(screen.getByRole('combobox', { name: /category to assign/i })).toBeInTheDocument();
  });

  it('has no footer total — the summary row above the table carries it', () => {
    const { container } = renderTable(SAMPLE);

    expect(container.querySelector('tfoot')).not.toBeInTheDocument();
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

  it('still renders a row whose category has been deleted elsewhere', () => {
    // The list no longer holds 'pet-food', but the expense still points at it.
    const { container } = renderTable([petExpense]);

    expect(categoryCell(container, 'Kibble')).toHaveTextContent('Pet food');
  });
});

/**
 * The "who added it" column (docs/who-label-spec.md).
 *
 * The table only obeys `showWho`; the screen decides it, from the whole ledger
 * rather than from the rows it hands over — which is why a table showing one
 * person's rows can still be told to draw the column.
 */
describe('ExpenseTable — who added it', () => {
  const LABELLED: Expense[] = [
    { id: 1, date: '2024-01-05', description: 'Coffee beans', category: 'groceries', currency: 'USD', amount: 12.5, who: 'Ania' },
    { id: 2, date: '2024-02-10', description: 'Bus ticket', category: 'transport', currency: 'PLN', amount: 4.4, who: null },
  ];

  const whoCell = (container: HTMLElement, description: string): HTMLElement | null => {
    const row = within(container).getByText(description).closest('tr');
    if (!row) throw new Error(`no row for "${description}"`);
    return row.querySelector('.who-cell');
  };

  it('draws no column while the ledger names only one person', () => {
    // A column repeating the same name on every row is noise in a table that is
    // already dense — and one name is what a household of one always has.
    const { container } = render(<Harness expenses={LABELLED} showWho={false} />);

    expect(screen.queryByRole('columnheader', { name: 'Who' })).not.toBeInTheDocument();
    expect(whoCell(container, 'Coffee beans')).toBeNull();
  });

  it('names the person once the ledger holds more than one', () => {
    const { container } = render(<Harness expenses={LABELLED} showWho />);

    expect(screen.getByRole('columnheader', { name: 'Who' })).toBeInTheDocument();
    expect(whoCell(container, 'Coffee beans')).toHaveTextContent('Ania');
  });

  it('prints an em dash where nobody said, because NULL is a value', () => {
    const { container } = render(<Harness expenses={LABELLED} showWho />);

    expect(whoCell(container, 'Bus ticket')).toHaveTextContent('—');
  });

  it('offers no sort on it: the filter above the table is how one person is read', () => {
    render(<Harness expenses={LABELLED} showWho />);

    const header = screen.getByRole('columnheader', { name: 'Who' });
    expect(within(header).queryByRole('button')).not.toBeInTheDocument();
  });
});
