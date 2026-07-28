/**
 * Tests for the Analytics component. The API layer is mocked.
 *
 * The behaviour under test is currency handling: the API returns one row per
 * (category, currency), and the component must combine them through the user's
 * FX rates rather than adding raw major units together.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import Analytics from '../components/Analytics';
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
    render(<Analytics settings={settings('PLN')} rates={rates} />);

    // 400 PLN + (25 USD * 4) = 500 PLN. The old code produced a bare 425 and
    // labelled it "$" regardless of the underlying currencies.
    await waitFor(() => expect(card('Total Spent')).toHaveTextContent(/500,00\s*zł/));
    expect(card('Total Spent')).toHaveTextContent(/converted to PLN/i);

    // The naive cross-currency sum must not appear anywhere.
    expect(screen.queryByText(/425/)).not.toBeInTheDocument();
  });

  it('derives the averages from the converted total', async () => {
    mockGetAnalytics.mockResolvedValue(mixedCurrencyResponse);
    render(<Analytics settings={settings('PLN')} rates={rates} />);

    // 500 PLN over 3 transactions.
    await waitFor(() => expect(card('Average per Expense')).toHaveTextContent(/166,67\s*zł/));
    expect(card('Total Expenses')).toHaveTextContent('3');
  });

  it('keeps the exact native subtotal for each currency alongside the converted total', async () => {
    mockGetAnalytics.mockResolvedValue(mixedCurrencyResponse);
    render(<Analytics settings={settings('PLN')} rates={rates} />);

    await waitFor(() => expect(card('PLN Total')).toHaveTextContent(/400,00\s*zł/));
    expect(card('USD Total')).toHaveTextContent(/\$25\.00/);
  });

  it('collapses the per-currency category rows into one bar per category', async () => {
    mockGetAnalytics.mockResolvedValue(mixedCurrencyResponse);
    const { container } = render(<Analytics settings={settings('PLN')} rates={rates} />);

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

  it('converts into USD when that is the primary currency', async () => {
    mockGetAnalytics.mockResolvedValue(mixedCurrencyResponse);
    render(<Analytics settings={settings('USD')} rates={rates} />);

    // 400 PLN * 0.25 = 100 USD, plus 25 USD = 125 USD.
    await waitFor(() => expect(card('Total Spent')).toHaveTextContent(/\$125\.00/));
    expect(card('Total Spent')).toHaveTextContent(/converted to USD/i);
  });
});
