/**
 * Tests for the Analytics component. The API layer is mocked.
 *
 * Two behaviours are covered. Currency handling: the API returns one row per
 * (category, currency), and the component must combine them through the user's
 * FX rates rather than adding raw major units together. And the category
 * filter: an empty selection must mean *no* expenses, not all of them.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import Analytics from '../components/Analytics';
import { TEST_CATEGORIES } from './categories.fixture';
import { TEST_CURRENCIES } from './currencies.fixture';
import { getAnalytics } from '../services/api';
import { AppSettings, FxRates } from '../types/expense.types';

vi.mock('../services/api', () => ({ getAnalytics: vi.fn() }));

// 1 PLN = 0.25 USD, i.e. 1 USD = 4 PLN.
const rates: FxRates = { USD: 1, PLN: 0.25, BTC: 65000 };

const settings = (primaryCurrency: AppSettings['primaryCurrency']): AppSettings => ({
  defaultCurrency: 'PLN',
  defaultCategory: 'groceries',
  defaultBtcUnit: 'BTC',
  primaryCurrency,
});

const mixedCurrencyResponse = {
  total: 0,
  count: 3,
  average: 0,
  byCategory: [
    { category: 'groceries', currency: 'PLN', total: 400, count: 2, average: 200 },
    { category: 'groceries', currency: 'USD', total: 25, count: 1, average: 25 },
  ],
  byCurrency: [
    { currency: 'PLN', total: 400, count: 2, average: 200 },
    { currency: 'USD', total: 25, count: 1, average: 25 },
  ],
};

const mockGetAnalytics = getAnalytics as unknown as ReturnType<typeof vi.fn>;

/** The `.summary-card` whose heading is `heading`. */
const card = (heading: string): HTMLElement => {
  const el = screen.getByText(heading).closest('.summary-card');
  if (!el) throw new Error(`no summary card titled "${heading}"`);
  return el as HTMLElement;
};

beforeEach(() => vi.clearAllMocks());

describe('Analytics', () => {
  it('converts mixed currencies into the primary currency instead of adding them', async () => {
    mockGetAnalytics.mockResolvedValue(mixedCurrencyResponse);
    render(<Analytics settings={settings('PLN')} categories={TEST_CATEGORIES} currencies={TEST_CURRENCIES} rates={rates} />);

    // 400 PLN + (25 USD * 4) = 500 PLN. The old code produced a bare 425 and
    // labelled it "$" regardless of the underlying currencies.
    await waitFor(() => expect(card('Total Spent')).toHaveTextContent(/500,00\s*zł/));
    expect(card('Total Spent')).toHaveTextContent(/converted to PLN/i);

    // The naive cross-currency sum must not appear anywhere.
    expect(screen.queryByText(/425/)).not.toBeInTheDocument();
  });

  it('derives the averages from the converted total', async () => {
    mockGetAnalytics.mockResolvedValue(mixedCurrencyResponse);
    render(<Analytics settings={settings('PLN')} categories={TEST_CATEGORIES} currencies={TEST_CURRENCIES} rates={rates} />);

    // 500 PLN over 3 transactions.
    await waitFor(() => expect(card('Average per Expense')).toHaveTextContent(/166,67\s*zł/));
    expect(card('Total Expenses')).toHaveTextContent('3');
  });

  it('keeps the exact native subtotal for each currency alongside the converted total', async () => {
    mockGetAnalytics.mockResolvedValue(mixedCurrencyResponse);
    render(<Analytics settings={settings('PLN')} categories={TEST_CATEGORIES} currencies={TEST_CURRENCIES} rates={rates} />);

    await waitFor(() => expect(card('PLN Total')).toHaveTextContent(/400,00\s*zł/));
    expect(card('USD Total')).toHaveTextContent(/\$25\.00/);
  });

  it('collapses the per-currency category rows into one bar per category', async () => {
    mockGetAnalytics.mockResolvedValue(mixedCurrencyResponse);
    const { container } = render(<Analytics settings={settings('PLN')} categories={TEST_CATEGORIES} currencies={TEST_CURRENCIES} rates={rates} />);

    await waitFor(() =>
      expect(container.querySelector('.category-breakdown')).toBeInTheDocument()
    );
    const breakdown = container.querySelector('.category-breakdown') as HTMLElement;

    // Two API rows for groceries collapse into a single bar holding the
    // converted total, so the percentage is the whole 100%.
    expect(breakdown.querySelectorAll('.category-bar-item')).toHaveLength(1);
    expect(within(breakdown).getByText(/500,00\s*zł\s*\(100\.0%\)/)).toBeInTheDocument();
    expect(within(breakdown).getByText(/3 transactions/)).toBeInTheDocument();
  });

  it('shows nothing — and asks the server nothing — when every category is unchecked', async () => {
    // An empty `categories` filter reads as *unfiltered* to the API, so
    // forwarding it would answer "show me none of it" with the whole ledger.
    mockGetAnalytics.mockResolvedValue(mixedCurrencyResponse);
    render(<Analytics settings={settings('PLN')} categories={TEST_CATEGORIES} currencies={TEST_CURRENCIES} rates={rates} />);

    await waitFor(() => expect(card('Total Spent')).toBeInTheDocument());
    mockGetAnalytics.mockClear();

    fireEvent.click(screen.getByRole('checkbox', { name: /all categories/i }));

    await waitFor(() =>
      expect(screen.getByText(/no expenses found for the selected period/i)).toBeInTheDocument()
    );
    // The stale numbers are gone, and no request was made to learn that.
    expect(screen.queryByText(/Total Spent/)).not.toBeInTheDocument();
    expect(mockGetAnalytics).not.toHaveBeenCalled();
  });

  it('reaches the same empty state by unchecking the categories one at a time', async () => {
    mockGetAnalytics.mockResolvedValue(mixedCurrencyResponse);
    render(<Analytics settings={settings('PLN')} categories={TEST_CATEGORIES} currencies={TEST_CURRENCIES} rates={rates} />);

    await waitFor(() => expect(card('Total Spent')).toBeInTheDocument());

    for (const category of TEST_CATEGORIES) {
      fireEvent.click(screen.getByRole('checkbox', { name: category.label }));
    }

    await waitFor(() =>
      expect(screen.getByText(/no expenses found for the selected period/i)).toBeInTheDocument()
    );
    // Every intermediate selection was fetched; the empty one was not, so the
    // last request still names the single category that was left standing.
    expect(mockGetAnalytics).toHaveBeenLastCalledWith(
      expect.objectContaining({ categories: [TEST_CATEGORIES[TEST_CATEGORIES.length - 1].slug] })
    );
  });

  it('goes back to querying once a category is checked again', async () => {
    mockGetAnalytics.mockResolvedValue(mixedCurrencyResponse);
    render(<Analytics settings={settings('PLN')} categories={TEST_CATEGORIES} currencies={TEST_CURRENCIES} rates={rates} />);

    await waitFor(() => expect(card('Total Spent')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('checkbox', { name: /all categories/i }));
    await waitFor(() => expect(screen.getByText(/no expenses found/i)).toBeInTheDocument());
    mockGetAnalytics.mockClear();

    fireEvent.click(screen.getByRole('checkbox', { name: /groceries/i }));

    await waitFor(() => expect(mockGetAnalytics).toHaveBeenCalledTimes(1));
    expect(mockGetAnalytics.mock.calls[0][0].categories).toEqual(['groceries']);
  });

  it('converts into USD when that is the primary currency', async () => {
    mockGetAnalytics.mockResolvedValue(mixedCurrencyResponse);
    render(<Analytics settings={settings('USD')} categories={TEST_CATEGORIES} currencies={TEST_CURRENCIES} rates={rates} />);

    // 400 PLN * 0.25 = 100 USD, plus 25 USD = 125 USD.
    await waitFor(() => expect(card('Total Spent')).toHaveTextContent(/\$125\.00/));
    expect(card('Total Spent')).toHaveTextContent(/converted to USD/i);
  });
});

/**
 * The presets, checked against the dates they actually send and the day count
 * they actually print. "Last 30 Days" used to subtract a whole month, so on the
 * 11th it asked for the 11th of the month before — 31 days, a third of them in
 * the current month — and printed "31 days" beside a label that said 30 (F2).
 *
 * Both ends of the API filter are inclusive, so a preset of N days spans N-1
 * days back to today and the printed count is the difference plus one.
 */
describe('Analytics — time presets', () => {
  // One currency, so the "Total Spent" subtitle shows the day count rather than
  // the conversion caption it swaps in for mixed results.
  const singleCurrencyResponse = {
    total: 0,
    count: 4,
    average: 0,
    byCategory: [{ category: 'groceries', currency: 'PLN', total: 400, count: 4, average: 100 }],
    byCurrency: [{ currency: 'PLN', total: 400, count: 4, average: 100 }],
  };

  /** The `startDate`/`endDate` of the most recent request. */
  const lastRange = (): { startDate: string; endDate: string } => {
    const calls = mockGetAnalytics.mock.calls;
    const { startDate, endDate } = calls[calls.length - 1][0];
    return { startDate, endDate };
  };

  const daysBetweenInclusive = (startDate: string, endDate: string): number =>
    Math.round((Date.parse(endDate) - Date.parse(startDate)) / 86_400_000) + 1;

  /** `YYYY-MM-DD` in local time, matching what the component builds. */
  const iso = (date: Date): string =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

  const renderAnalytics = () => {
    mockGetAnalytics.mockResolvedValue(singleCurrencyResponse);
    return render(<Analytics settings={settings('PLN')} categories={TEST_CATEGORIES} currencies={TEST_CURRENCIES} rates={rates} />);
  };

  it('asks for exactly 30 days under "Last 30 Days", and says 30', async () => {
    renderAnalytics();
    await waitFor(() => expect(card('Total Spent')).toBeInTheDocument());

    const { startDate, endDate } = lastRange();
    expect(endDate).toBe(iso(new Date()));
    expect(daysBetweenInclusive(startDate, endDate)).toBe(30);
    // The subtitle is the other half of the defect: the label said 30 and the
    // figure beside it said 31, on the same view.
    expect(card('Total Spent')).toHaveTextContent('30 days');
  });

  it('asks for exactly 7 days under "Last 7 Days", and says 7', async () => {
    renderAnalytics();
    await waitFor(() => expect(card('Total Spent')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Last 7 Days' }));

    await waitFor(() => expect(card('Total Spent')).toHaveTextContent('7 days'));
    expect(daysBetweenInclusive(lastRange().startDate, lastRange().endDate)).toBe(7);
  });

  it('offers the previous calendar month, whole, and never runs it into this one', async () => {
    renderAnalytics();
    await waitFor(() => expect(card('Total Spent')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Last Month' }));

    const now = new Date();
    const firstOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0);

    await waitFor(() => expect(lastRange().startDate).toBe(iso(firstOfLastMonth)));
    expect(lastRange().endDate).toBe(iso(lastOfLastMonth));
    // Nothing from the current month leaks in, which is the whole point of it.
    expect(lastRange().endDate < iso(new Date(now.getFullYear(), now.getMonth(), 1))).toBe(true);
    expect(card('Total Spent')).toHaveTextContent(`${lastOfLastMonth.getDate()} days`);
  });

  it('counts a single-day custom range as one day, not none', async () => {
    renderAnalytics();
    await waitFor(() => expect(card('Total Spent')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Custom Range' }));
    fireEvent.change(screen.getByLabelText('Start Date'), { target: { value: '2026-03-04' } });
    fireEvent.change(screen.getByLabelText('End Date'), { target: { value: '2026-03-04' } });

    // Zero days made "Average per Day" divide by nothing and print 0 for a range
    // that plainly held something.
    await waitFor(() => expect(card('Total Spent')).toHaveTextContent(/\b1 days?\b/));
    expect(card('Average per Day')).toHaveTextContent(/400,00\s*zł/);
  });
});
