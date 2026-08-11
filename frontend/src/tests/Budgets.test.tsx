/**
 * Tests for the Budgets component. The API layer is mocked.
 *
 * Budgets are stored per (category, currency); the current-month spend is
 * computed client-side from the `expenses` prop. The behaviour worth pinning
 * down is therefore the scoping: only expenses in the selected currency and in
 * the current month count towards a limit, and every write (set / clear) has to
 * carry the selected currency, not a hardcoded one.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import Budgets from '../components/Budgets';
import { TEST_CATEGORIES } from './categories.fixture';
import { TEST_CURRENCIES } from './currencies.fixture';
import { getBudgets, setBudget, deleteBudget } from '../services/api';
import { Budget, Expense } from '../types/expense.types';

vi.mock('../services/api', () => ({
  getBudgets: vi.fn(),
  setBudget: vi.fn(),
  deleteBudget: vi.fn(),
}));

const mockGetBudgets = getBudgets as unknown as ReturnType<typeof vi.fn>;
const mockSetBudget = setBudget as unknown as ReturnType<typeof vi.fn>;
const mockDeleteBudget = deleteBudget as unknown as ReturnType<typeof vi.fn>;

// The component only counts the *current* month, so the fixtures have to move
// with the clock rather than being hardcoded dates.
const now = new Date();
const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
const thisMonth = (day: number): string => `${monthKey}-${String(day).padStart(2, '0')}`;
const lastMonth = (day: number): string => {
  const d = new Date(Date.UTC(now.getFullYear(), now.getMonth() - 1, day));
  return d.toISOString().slice(0, 10);
};

const expense = (e: Partial<Expense> & Pick<Expense, 'id'>): Expense => ({
  amount: 0,
  date: thisMonth(5),
  description: 'x',
  category: 'groceries',
  currency: 'USD',
  ...e,
});

const expenses: Expense[] = [
  expense({ id: 1, amount: 120, category: 'groceries', currency: 'USD' }),
  expense({ id: 2, amount: 30, category: 'transport', currency: 'USD', date: thisMonth(6) }),
  expense({ id: 3, amount: 400, category: 'groceries', currency: 'PLN', date: thisMonth(7) }),
  // Same category and currency as #1 but last month — must be ignored.
  expense({ id: 4, amount: 999, category: 'groceries', currency: 'USD', date: lastMonth(3) }),
];

const budgets: Budget[] = [
  { category: 'groceries', currency: 'USD', amount: 200 },
  { category: 'transport', currency: 'USD', amount: 20 },
  { category: 'groceries', currency: 'PLN', amount: 1000 },
];

/** The `.budget-row` for a category, found by its (emoji-prefixed) label. */
const row = (label: RegExp): HTMLElement => {
  const el = screen.getByText(label).closest('.budget-row');
  if (!el) throw new Error(`no budget row for ${label}`);
  return el as HTMLElement;
};

/** The `.summary-card` whose heading is `heading`. */
const card = (heading: string): HTMLElement => {
  const el = screen.getByText(heading).closest('.summary-card');
  if (!el) throw new Error(`no summary card titled "${heading}"`);
  return el as HTMLElement;
};

const renderBudgets = async () => {
  const result = render(<Budgets expenses={expenses} categories={TEST_CATEGORIES} currencies={TEST_CURRENCIES} />);
  await waitFor(() => expect(screen.queryByText(/loading budgets/i)).not.toBeInTheDocument());
  return result;
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGetBudgets.mockResolvedValue(budgets);
  mockSetBudget.mockResolvedValue(undefined);
  mockDeleteBudget.mockResolvedValue(undefined);
});

describe('Budgets', () => {
  it('shows this month\'s spend against each stored limit', async () => {
    await renderBudgets();

    // 120 of a 200 limit — the 999 from last month must not be included.
    expect(within(row(/Groceries/)).getByText(/\$120\.00/)).toBeInTheDocument();
    expect(row(/Groceries/)).toHaveTextContent('/ $200.00');
    expect(row(/Groceries/)).not.toHaveTextContent('999');
    expect(row(/Groceries/)).not.toHaveTextContent(/over/i);

    // Totals cover only the two USD expenses of this month.
    expect(card('Budgeted')).toHaveTextContent('$220.00');
    expect(card('Spent so far')).toHaveTextContent('$150.00');
    expect(card('Remaining')).toHaveTextContent('$70.00');
  });

  it('flags a category whose spend exceeds its limit', async () => {
    await renderBudgets();

    const transport = row(/Transport/);
    expect(transport).toHaveTextContent('$30.00');
    expect(transport).toHaveTextContent('/ $20.00');
    expect(within(transport).getByText(/^over$/i)).toBeInTheDocument();
    expect(transport.className).toMatch(/\bover\b/);
  });

  it('shows a category with no budget as unlimited and offers no Clear action', async () => {
    await renderBudgets();

    const media = row(/Media/);
    expect(media).toHaveTextContent('$0.00');
    expect(media).not.toHaveTextContent('/');
    expect(within(media).queryByRole('button', { name: /clear/i })).not.toBeInTheDocument();
    expect((within(media).getByLabelText(/monthly limit for media/i) as HTMLInputElement).value).toBe('');
    // With no limit anywhere the summary would prompt instead of showing a %.
    expect(card('Remaining')).toHaveTextContent('68% used');
  });

  it('rescopes spend, limits and totals to the selected currency', async () => {
    await renderBudgets();

    fireEvent.click(screen.getByRole('button', { name: /^PLN/ }));

    // The PLN budget and the PLN expense replace the USD ones entirely.
    expect(row(/Groceries/)).toHaveTextContent(/400,00\s*zł/);
    expect(row(/Groceries/)).toHaveTextContent(/1\s*000,00\s*zł/);
    expect(row(/Transport/)).not.toHaveTextContent('30');
    expect(card('Budgeted')).toHaveTextContent(/1\s*000,00\s*zł/);
    expect(card('Spent so far')).toHaveTextContent(/400,00\s*zł/);
  });

  it('saves a typed limit for the selected currency and shows it once reloaded', async () => {
    await renderBudgets();

    fireEvent.click(screen.getByRole('button', { name: /^PLN/ }));
    mockGetBudgets.mockResolvedValue([...budgets, { category: 'media', currency: 'PLN', amount: 250 }]);

    const input = within(row(/Media/)).getByLabelText(/monthly limit for media/i);
    fireEvent.change(input, { target: { value: '250' } });
    fireEvent.blur(input);

    await waitFor(() => expect(mockSetBudget).toHaveBeenCalledWith('media', 'PLN', 250));
    expect(mockDeleteBudget).not.toHaveBeenCalled();
    await waitFor(() => expect(row(/Media/)).toHaveTextContent(/250,00\s*zł/));
  });

  it('clears a limit via the Clear button and drops it from the row', async () => {
    await renderBudgets();

    mockGetBudgets.mockResolvedValue(budgets.filter(b => b.category !== 'transport'));
    fireEvent.click(within(row(/Transport/)).getByRole('button', { name: /clear/i }));

    await waitFor(() => expect(mockDeleteBudget).toHaveBeenCalledWith('transport', 'USD'));
    await waitFor(() => expect(row(/Transport/)).not.toHaveTextContent('$20.00'));
    expect(within(row(/Transport/)).queryByRole('button', { name: /clear/i })).not.toBeInTheDocument();
    expect(mockSetBudget).not.toHaveBeenCalled();
  });

  it('deletes the budget when its input is emptied, but writes nothing for an untouched category', async () => {
    await renderBudgets();

    const grocerySpy = within(row(/Groceries/)).getByLabelText(/monthly limit for groceries/i);
    fireEvent.change(grocerySpy, { target: { value: '' } });
    fireEvent.blur(grocerySpy);
    await waitFor(() => expect(mockDeleteBudget).toHaveBeenCalledWith('groceries', 'USD'));

    // A category that never had a limit and is left blank must not hit the API.
    mockDeleteBudget.mockClear();
    const utilities = within(row(/Utilities/)).getByLabelText(/monthly limit for utilities/i);
    fireEvent.change(utilities, { target: { value: '40' } });
    fireEvent.change(utilities, { target: { value: '' } });
    fireEvent.blur(utilities);

    await waitFor(() => expect(mockSetBudget).not.toHaveBeenCalled());
    expect(mockDeleteBudget).not.toHaveBeenCalled();
  });

  it('surfaces a load failure instead of an empty budget list', async () => {
    mockGetBudgets.mockRejectedValue(new Error('budgets unavailable'));
    render(<Budgets expenses={expenses} categories={TEST_CATEGORIES} currencies={TEST_CURRENCIES} />);

    expect(await screen.findByText('budgets unavailable')).toBeInTheDocument();
    // The rows still render, just without any limits attached.
    expect(row(/Groceries/)).not.toHaveTextContent('/');
  });
});
