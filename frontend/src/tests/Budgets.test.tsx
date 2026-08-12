/**
 * Tests for the Budgets component. The API layer is mocked.
 *
 * The screen states a verdict now (wave 3c), so what is worth pinning down has
 * moved with it: that the counts in the headline describe the rows underneath,
 * that a clean month is an answer rather than an absence, that the month stepper
 * carries its caveat, and that reading a limit can no longer delete it.
 *
 * The old suite's subjects survive underneath: budgets are stored per (category,
 * currency), the spend is computed client-side from the `expenses` prop, and
 * every write has to carry the scope's currency rather than a hardcoded one.
 *
 * The clock is fixed at **11 January 2026** — a 31-day month, so "day 11 of 31"
 * is the report's own pace example and not an accident of when the suite runs.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import Budgets from '../components/Budgets';
import { TEST_CATEGORIES } from './categories.fixture';
import { TEST_CURRENCIES } from './currencies.fixture';
import { getBudgets, setBudget, deleteBudget } from '../services/api';
import { AppSettings, Budget, Expense, FxRates } from '../types/expense.types';

vi.mock('../services/api', () => ({
  getBudgets: vi.fn(),
  setBudget: vi.fn(),
  deleteBudget: vi.fn(),
}));

const mockGetBudgets = getBudgets as unknown as ReturnType<typeof vi.fn>;
const mockSetBudget = setBudget as unknown as ReturnType<typeof vi.fn>;
const mockDeleteBudget = deleteBudget as unknown as ReturnType<typeof vi.fn>;

/** Noon local, so the date the component derives cannot slip a day on a TZ. */
const setToday = (iso: string) => vi.setSystemTime(new Date(`${iso}T12:00:00`));

const rates: FxRates = { USD: 1, PLN: 0.25, BTC: 65000 };

const settings = (primaryCurrency: string): AppSettings => ({
  defaultCurrency: 'USD',
  defaultCategory: 'groceries',
  defaultBtcUnit: 'BTC',
  primaryCurrency,
});

const expense = (e: Partial<Expense> & Pick<Expense, 'id' | 'amount'>): Expense => ({
  date: '2026-01-05',
  description: 'x',
  category: 'groceries',
  currency: 'USD',
  ...e,
});

/**
 * One currency, so the scope control is not rendered and the screen is
 * editable — the single-currency install the old fixtures described.
 */
const expenses: Expense[] = [
  expense({ id: 1, amount: 120, category: 'groceries' }),
  expense({ id: 2, amount: 30, category: 'transport', date: '2026-01-06' }),
  expense({ id: 3, amount: 95, category: 'entertainment', date: '2026-01-07' }),
  // Spend in a category nobody limited: it must not reach the pace figure.
  expense({ id: 4, amount: 45, category: 'media', date: '2026-01-08' }),
  // Same category and currency as #1 but last month — a different window.
  expense({ id: 5, amount: 999, category: 'groceries', date: '2025-12-03' }),
];

const budgets: Budget[] = [
  { category: 'groceries', currency: 'USD', amount: 200 },     // 120 — on track
  { category: 'transport', currency: 'USD', amount: 20 },      // 30  — over
  { category: 'entertainment', currency: 'USD', amount: 100 }, // 95  — close
];

const renderBudgets = async (props: Partial<Parameters<typeof Budgets>[0]> = {}) => {
  const result = render(
    <Budgets
      expenses={expenses}
      settings={settings('USD')}
      categories={TEST_CATEGORIES}
      currencies={TEST_CURRENCIES}
      rates={rates}
      {...props}
    />
  );
  await waitFor(() => expect(screen.queryByText(/loading budgets/i)).not.toBeInTheDocument());
  return result;
};

/**
 * The `.budget-row` for a category, found by its exact label.
 *
 * Scoped to the list, because an exception is named twice on purpose now: once
 * in the verdict at the top, and once by the row that proves it.
 */
const row = (label: string): HTMLElement => {
  const list = document.querySelector('.budget-list') as HTMLElement;
  const el = within(list).getByText(label).closest('.budget-row');
  if (!el) throw new Error(`no budget row for ${label}`);
  return el as HTMLElement;
};

const verdict = (): HTMLElement => document.querySelector('.budget-verdict') as HTMLElement;
const pace = (): HTMLElement => document.querySelector('.budget-pace') as HTMLElement;
const month = (): string => (document.querySelector('.month-current') as HTMLElement).textContent ?? '';
const edit = () => screen.getByRole('button', { name: /edit limits|^done$/i });

beforeEach(() => {
  vi.clearAllMocks();
  // Only Date: testing-library's waitFor needs real timers to poll.
  vi.useFakeTimers({ toFake: ['Date'] });
  setToday('2026-01-11');
  mockGetBudgets.mockResolvedValue(budgets);
  mockSetBudget.mockResolvedValue(undefined);
  mockDeleteBudget.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Budgets — the verdict', () => {
  it('states counts that describe the rows it lists', async () => {
    await renderBudgets();

    expect(within(verdict()).getByText('1 over · 1 close · 1 on track.')).toBeInTheDocument();

    // Every count is spelled out by a row, and the third by a single line.
    const listed = verdict().querySelectorAll('.verdict-row');
    expect(listed).toHaveLength(3);
    expect(listed[0]).toHaveTextContent('Transport');
    expect(listed[0]).toHaveTextContent('50% over');
    expect(listed[1]).toHaveTextContent('Entertainment');
    expect(listed[1]).toHaveTextContent('95% used');
    expect(listed[2]).toHaveTextContent('1 on track');

    // …and by the same category rows underneath.
    expect(row('Transport')).toHaveTextContent('$30.00');
    expect(row('Transport')).toHaveTextContent('/ $20.00');
    expect(within(row('Transport')).getByText('over')).toBeInTheDocument();
    expect(within(row('Entertainment')).getByText('close')).toBeInTheDocument();
    expect(row('Groceries')).toHaveTextContent('$120.00');
    // Last month's 999 belongs to a different window.
    expect(row('Groceries')).not.toHaveTextContent('999');
  });

  it('says "on track" for a clean month instead of saying nothing', async () => {
    mockGetBudgets.mockResolvedValue([{ category: 'groceries', currency: 'USD', amount: 200 }]);
    await renderBudgets();

    expect(within(verdict()).getByText('Nothing over · 1 on track.')).toBeInTheDocument();
    expect(document.querySelectorAll('.budget-row.over')).toHaveLength(0);
  });

  /**
   * With no limits, `remaining` used to be `0 - totalSpent` coloured `--danger`:
   * an empty install turned red the moment the first expense was saved, against
   * a budget nobody had set (F4, and §9 of docs/ux-review-findings.md).
   */
  it('reports no verdict at all when nothing carries a limit, and no negative', async () => {
    mockGetBudgets.mockResolvedValue([]);
    const { container } = await renderBudgets();

    expect(screen.getByText(/No limits set in USD/)).toBeInTheDocument();
    expect(container.querySelector('.budget-verdict')).toBeNull();
    expect(container.querySelector('.budget-pace')).toBeNull();
    expect(container.querySelectorAll('.budget-row.over')).toHaveLength(0);
    expect(container.textContent).not.toMatch(/-\s?\$/);
  });
});

describe('Budgets — pace', () => {
  // 430 spent against 1000 of limits: 43% used, the report's own example.
  const paceBudgets: Budget[] = [{ category: 'groceries', currency: 'USD', amount: 1000 }];
  const paceExpenses: Expense[] = [expense({ id: 1, amount: 430, date: '2026-01-02' })];

  const renderPace = async () => {
    mockGetBudgets.mockResolvedValue(paceBudgets);
    return renderBudgets({ expenses: paceExpenses });
  };

  it('reads 43% on day 11 of 31 as on pace', async () => {
    await renderPace();

    expect(pace()).toHaveTextContent('43% used');
    expect(pace()).toHaveTextContent('day 11 of 31');
    expect(pace()).toHaveTextContent('on pace');
    expect(pace()).toHaveTextContent('$430.00 of $1,000.00 across 1 limit');
  });

  it('does not read the same 43% on day 3 as on pace', async () => {
    setToday('2026-01-03');
    await renderPace();

    expect(pace()).toHaveTextContent('43% used');
    expect(pace()).toHaveTextContent('day 3 of 31');
    expect(pace()).toHaveTextContent('ahead of pace');
    expect(pace()).not.toHaveTextContent('on pace');
  });

  it('measures the percentage against the limits, not against everything spent', async () => {
    await renderBudgets();

    // 245 of 320 across the three limits — the 45 spent on unlimited Media is
    // not part of any budget and cannot push the figure over 100%.
    expect(pace()).toHaveTextContent('77% used');
    expect(pace()).toHaveTextContent('$245.00 of $320.00 across 3 limits');
  });

  it('marks where the calendar is on every bar that has a limit', async () => {
    await renderBudgets();

    const tick = within(row('Groceries')).getByTitle('Day 11 of 31');
    expect(tick).toHaveStyle({ left: `${(11 / 31) * 100}%` });
    // Nothing to pace a limitless category against.
    expect(document.querySelectorAll('.budget-bar-pace')).toHaveLength(3);
  });
});

describe('Budgets — the month stepper', () => {
  it('opens on this month and refuses to go past it', async () => {
    await renderBudgets();

    expect(month()).toBe('January 2026');
    expect(screen.getByRole('button', { name: /next month/i })).toBeDisabled();
    expect(screen.queryByText(/compared with your current limits/)).not.toBeInTheDocument();
  });

  it('moves the spending window back, with the standing-limits caveat', async () => {
    await renderBudgets();

    fireEvent.click(screen.getByRole('button', { name: /previous month/i }));

    expect(month()).toBe('December 2025');
    // Budgets have no month dimension: December is measured against today's
    // limits, and the screen has to say so.
    expect(screen.getByText(/compared with your current limits/)).toBeInTheDocument();
    expect(row('Groceries')).toHaveTextContent('$999.00');
    expect(within(row('Groceries')).getByText('over')).toBeInTheDocument();
    // A finished month has no pace left to keep.
    expect(pace()).toHaveTextContent('the whole of December 2025');
    expect(pace()).not.toHaveTextContent('day');
    expect(document.querySelectorAll('.budget-bar-pace')).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: /next month/i }));
    expect(month()).toBe('January 2026');
    expect(screen.queryByText(/compared with your current limits/)).not.toBeInTheDocument();
  });
});

describe('Budgets — reading and editing are two states', () => {
  it('renders no input until Edit limits is pressed', async () => {
    const { container } = await renderBudgets();

    expect(container.querySelectorAll('input')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: /clear/i })).not.toBeInTheDocument();

    fireEvent.click(edit());

    expect(screen.getByLabelText('Monthly limit for Groceries')).toHaveValue(200);
    expect(container.querySelectorAll('input')).toHaveLength(TEST_CATEGORIES.length);

    fireEvent.click(edit());
    expect(container.querySelectorAll('input')).toHaveLength(0);
  });

  it('collapses the categories with no limit into one line, and expands them to edit', async () => {
    const { container } = await renderBudgets();

    const collapsed = container.querySelector('.budget-nolimit') as HTMLElement;
    expect(collapsed).toHaveTextContent('4 with no limit');
    expect(collapsed).toHaveTextContent('Media · Utilities · Maintenance · Other');
    // Three limits, one collapsed line — not seven cards.
    expect(container.querySelectorAll('.budget-list > li')).toHaveLength(4);

    fireEvent.click(edit());
    expect(container.querySelector('.budget-nolimit')).toBeNull();
    expect(container.querySelectorAll('.budget-list > li')).toHaveLength(TEST_CATEGORIES.length);
  });

  it('saves a typed limit for the scope\'s currency and shows it once reloaded', async () => {
    await renderBudgets();
    fireEvent.click(edit());

    mockGetBudgets.mockResolvedValue([...budgets, { category: 'media', currency: 'USD', amount: 250 }]);
    const input = screen.getByLabelText('Monthly limit for Media');
    fireEvent.change(input, { target: { value: '250' } });
    fireEvent.blur(input);

    await waitFor(() => expect(mockSetBudget).toHaveBeenCalledWith('media', 'USD', 250));
    expect(mockDeleteBudget).not.toHaveBeenCalled();
    await waitFor(() => expect(row('Media')).toHaveTextContent('/ $250.00'));
  });

  it('clears a limit via the Clear button and drops it from the row', async () => {
    await renderBudgets();
    fireEvent.click(edit());

    mockGetBudgets.mockResolvedValue(budgets.filter(b => b.category !== 'transport'));
    fireEvent.click(within(row('Transport')).getByRole('button', { name: /clear/i }));

    await waitFor(() => expect(mockDeleteBudget).toHaveBeenCalledWith('transport', 'USD'));
    await waitFor(() => expect(row('Transport')).not.toHaveTextContent('/ $20.00'));
    expect(within(row('Transport')).queryByRole('button', { name: /clear/i })).not.toBeInTheDocument();
    expect(mockSetBudget).not.toHaveBeenCalled();
  });

  it('deletes on an emptied box, but writes nothing for an untouched category', async () => {
    await renderBudgets();
    fireEvent.click(edit());

    const groceries = screen.getByLabelText('Monthly limit for Groceries');
    fireEvent.change(groceries, { target: { value: '' } });
    fireEvent.blur(groceries);
    await waitFor(() => expect(mockDeleteBudget).toHaveBeenCalledWith('groceries', 'USD'));

    // A category that never had a limit and is left blank must not hit the API.
    mockDeleteBudget.mockClear();
    const utilities = screen.getByLabelText('Monthly limit for Utilities');
    fireEvent.change(utilities, { target: { value: '40' } });
    fireEvent.change(utilities, { target: { value: '' } });
    fireEvent.blur(utilities);

    await waitFor(() => expect(mockSetBudget).not.toHaveBeenCalled());
    expect(mockDeleteBudget).not.toHaveBeenCalled();
  });

  it('surfaces a load failure instead of an empty budget list', async () => {
    mockGetBudgets.mockRejectedValue(new Error('budgets unavailable'));
    await renderBudgets();

    expect(await screen.findByText('budgets unavailable')).toBeInTheDocument();
    // The categories are still listed, just without any limit attached.
    expect(screen.getByText(/7 with no limit/)).toBeInTheDocument();
  });
});

describe('Budgets — currency scope', () => {
  const mixed: Expense[] = [
    ...expenses,
    expense({ id: 6, amount: 400, category: 'groceries', currency: 'PLN', date: '2026-01-07' }),
  ];
  const mixedBudgets: Budget[] = [...budgets, { category: 'groceries', currency: 'PLN', amount: 1000 }];

  const renderMixed = async () => {
    mockGetBudgets.mockResolvedValue(mixedBudgets);
    return renderBudgets({ expenses: mixed });
  };

  it('offers no scope control at all while the ledger holds one currency', async () => {
    await renderBudgets();
    expect(document.querySelector('.currency-buttons')).toBeNull();
  });

  it('lets a fresh install set its first limit', async () => {
    // The empty case: nothing spent and nothing limited. The screen used to
    // fall through to combined, which pinned "Edit limits" disabled — and the
    // scope control that could have unstuck it needs two currencies to appear,
    // so a new install could not set a budget at all. It collapses to
    // `defaultCurrency` instead: nothing to convert, so nothing to choose.
    mockGetBudgets.mockResolvedValue([]);
    await renderBudgets({ expenses: [] });

    expect(document.querySelector('.currency-buttons')).toBeNull();
    expect(screen.queryByText(/A limit is held in its own currency/)).not.toBeInTheDocument();
    expect(edit()).not.toBeDisabled();

    fireEvent.click(edit());
    const input = screen.getByLabelText('Monthly limit for Groceries');
    fireEvent.change(input, { target: { value: '250' } });
    fireEvent.blur(input);

    // Stored in the currency the next expense will be recorded in.
    await waitFor(() => expect(mockSetBudget).toHaveBeenCalledWith('groceries', 'USD', 250));
  });

  it('opens combined, converting both currencies into the primary one', async () => {
    await renderMixed();

    expect(screen.getByRole('button', { name: 'All → USD' }).className).toMatch(/\bactive\b/);
    // 120 USD + 400 PLN at 0.25 = 220, against 200 + 1000 PLN = 450.
    expect(row('Groceries')).toHaveTextContent('$220.00');
    expect(row('Groceries')).toHaveTextContent('/ $450.00');
  });

  it('is read-only while combined, and says which currency to pick', async () => {
    const { container } = await renderMixed();

    expect(edit()).toBeDisabled();
    expect(screen.getByText(/A limit is held in its own currency/)).toHaveTextContent(/USD, PLN/);
    expect(container.querySelectorAll('input')).toHaveLength(0);
  });

  it('rescopes to a native currency, which is then editable', async () => {
    await renderMixed();

    fireEvent.click(screen.getByRole('button', { name: /^PLN/ }));

    expect(row('Groceries')).toHaveTextContent(/400,00\s*zł/);
    expect(row('Groceries')).toHaveTextContent(/1\s*000,00\s*zł/);
    // No PLN limit, so Transport is inside the collapsed line rather than a row.
    expect(document.querySelector('.budget-nolimit')).toHaveTextContent('Transport');
    expect(edit()).not.toBeDisabled();

    fireEvent.click(edit());
    const input = screen.getByLabelText('Monthly limit for Groceries');
    expect(input).toHaveValue(1000); // the stored PLN figure, not a converted one

    fireEvent.change(input, { target: { value: '1200' } });
    fireEvent.blur(input);
    await waitFor(() => expect(mockSetBudget).toHaveBeenCalledWith('groceries', 'PLN', 1200));
  });

  it('closes the editor when the scope goes back to combined', async () => {
    const { container } = await renderMixed();

    fireEvent.click(screen.getByRole('button', { name: /^PLN/ }));
    fireEvent.click(edit());
    expect(container.querySelectorAll('input').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: 'All → USD' }));
    expect(container.querySelectorAll('input')).toHaveLength(0);
    expect(edit()).toBeDisabled();
  });
});
