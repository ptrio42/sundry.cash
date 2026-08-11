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
    render(<Analytics settings={settings('PLN')} categories={TEST_CATEGORIES} rates={rates} />);

    // 400 PLN + (25 USD * 4) = 500 PLN. The old code produced a bare 425 and
    // labelled it "$" regardless of the underlying currencies.
    await waitFor(() => expect(card('Total Spent')).toHaveTextContent(/500,00\s*zł/));
    expect(card('Total Spent')).toHaveTextContent(/converted to PLN/i);

    // The naive cross-currency sum must not appear anywhere.
    expect(screen.queryByText(/425/)).not.toBeInTheDocument();
  });

  it('derives the averages from the converted total', async () => {
    mockGetAnalytics.mockResolvedValue(mixedCurrencyResponse);
    render(<Analytics settings={settings('PLN')} categories={TEST_CATEGORIES} rates={rates} />);

    // 500 PLN over 3 transactions.
    await waitFor(() => expect(card('Average per Expense')).toHaveTextContent(/166,67\s*zł/));
    expect(card('Total Expenses')).toHaveTextContent('3');
  });

  it('keeps the exact native subtotal for each currency alongside the converted total', async () => {
    mockGetAnalytics.mockResolvedValue(mixedCurrencyResponse);
    render(<Analytics settings={settings('PLN')} categories={TEST_CATEGORIES} rates={rates} />);

    await waitFor(() => expect(card('PLN Total')).toHaveTextContent(/400,00\s*zł/));
    expect(card('USD Total')).toHaveTextContent(/\$25\.00/);
  });

  it('collapses the per-currency category rows into one bar per category', async () => {
    mockGetAnalytics.mockResolvedValue(mixedCurrencyResponse);
    const { container } = render(<Analytics settings={settings('PLN')} categories={TEST_CATEGORIES} rates={rates} />);

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
    render(<Analytics settings={settings('PLN')} categories={TEST_CATEGORIES} rates={rates} />);

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
    render(<Analytics settings={settings('PLN')} categories={TEST_CATEGORIES} rates={rates} />);

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
    render(<Analytics settings={settings('PLN')} categories={TEST_CATEGORIES} rates={rates} />);

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
    render(<Analytics settings={settings('USD')} categories={TEST_CATEGORIES} rates={rates} />);

    // 400 PLN * 0.25 = 100 USD, plus 25 USD = 125 USD.
    await waitFor(() => expect(card('Total Spent')).toHaveTextContent(/\$125\.00/));
    expect(card('Total Spent')).toHaveTextContent(/converted to USD/i);
  });
});
