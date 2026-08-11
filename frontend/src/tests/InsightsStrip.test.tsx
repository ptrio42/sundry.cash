/**
 * Tests for the dashboard insights strip.
 *
 * The component's whole job is turning two API payloads into at most three
 * sentences — which ones it picks, how it scopes them to the currency on
 * screen, and when it decides to say nothing at all. Both endpoints are mocked
 * so the fixtures are exact and the assertions can be about the prose.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import InsightsStrip from '../components/InsightsStrip';
import { TEST_CATEGORIES } from './categories.fixture';
import { ComparisonResult, Expense, FxRates, RecurringCharge } from '../types/expense.types';

vi.mock('../services/api', () => ({
  getInsightsComparison: vi.fn(),
  getInsightsRecurring: vi.fn()
}));

import { getInsightsComparison, getInsightsRecurring } from '../services/api';

const comparisonMock = vi.mocked(getInsightsComparison);
const recurringMock = vi.mocked(getInsightsRecurring);

// Value of one unit in USD: 1 PLN = 0.25 USD (so 1 USD = 4 PLN), 1 BTC = 65000 USD.
const rates: FxRates = { USD: 1, PLN: 0.25, BTC: 65000 };

// The strip never reads these rows — the insights come from the API. It reads
// the array's length, to know whether asking is worth a request, and its
// identity, to know when the answer it holds has gone stale. One row is enough.
const ledger: Expense[] = [
  { id: 1, amount: 10, date: '2026-08-01', description: 'x', category: 'groceries', currency: 'PLN' }
];

const EMPTY: ComparisonResult = {
  window: 'rolling',
  period: 'month',
  // 2026-07-12..2026-08-10 inclusive is exactly 30 days.
  current: { start: '2026-07-12', end: '2026-08-10' },
  previous: { start: '2026-06-12', end: '2026-07-11' },
  byCategory: []
};

const comparison = (byCategory: ComparisonResult['byCategory']): ComparisonResult => ({ ...EMPTY, byCategory });

const row = (over: Partial<ComparisonResult['byCategory'][number]> & { category: ComparisonResult['byCategory'][number]['category'] }) => ({
  currency: 'PLN' as const,
  current: 0,
  previous: 0,
  delta: 0,
  deltaPct: null,
  currentCount: 0,
  previousCount: 0,
  isNew: false,
  ...over
});

const charge = (over: Partial<RecurringCharge> & Pick<RecurringCharge, 'label'>): RecurringCharge => ({
  currency: 'PLN',
  cadence: 'monthly',
  medianAmount: 43,
  monthlyCost: 43,
  totalPaid: 344,
  occurrences: 8,
  firstSeen: '2026-01-05',
  lastSeen: '2026-08-05',
  amountStability: 'stable',
  likelyCancelled: false,
  ...over
});

beforeEach(() => {
  comparisonMock.mockReset();
  recurringMock.mockReset();
  comparisonMock.mockResolvedValue(EMPTY);
  recurringMock.mockResolvedValue({ recurring: [] });
});

describe('InsightsStrip', () => {
  it('leads with the biggest mover, in percent and in money', async () => {
    comparisonMock.mockResolvedValue(comparison([
      row({ category: 'groceries', current: 1412, previous: 1053.5 }), // +358.50
      row({ category: 'media', current: 90, previous: 100 })           // -10, smaller move
    ]));

    render(<InsightsStrip view="PLN" primary="PLN" categories={TEST_CATEGORIES} rates={rates} expenses={ledger} />);

    // 358.50 / 1053.50 = 34%, over the 30-day window the payload describes.
    const sentence = await screen.findByText(/Groceries is up 34%/);
    expect(sentence).toHaveTextContent('over the last 30 days');
    expect(sentence).toHaveTextContent(/1\s*412,00\s*zł/);
    expect(sentence).toHaveTextContent(/1\s*053,50\s*zł/);
    // The smaller move is not worth one of the three sentences.
    expect(screen.queryByText(/Media/)).not.toBeInTheDocument();
  });

  it('says "down" when spending fell', async () => {
    comparisonMock.mockResolvedValue(comparison([
      row({ category: 'transport', current: 50, previous: 200 })
    ]));

    render(<InsightsStrip view="PLN" primary="PLN" categories={TEST_CATEGORIES} rates={rates} expenses={ledger} />);

    expect(await screen.findByText(/Transport is down 75%/)).toBeInTheDocument();
  });

  it('names a category that had no spending at all last period', async () => {
    comparisonMock.mockResolvedValue(comparison([
      row({ category: 'utilities', current: 40, previous: 0, isNew: true })
    ]));

    render(<InsightsStrip view="PLN" primary="PLN" categories={TEST_CATEGORIES} rates={rates} expenses={ledger} />);

    // No previous spend means no percentage — the sentence must not invent one.
    const sentence = await screen.findByText(/Utilities is new/);
    expect(sentence).toHaveTextContent('nothing in the 30 before that');
    expect(sentence).not.toHaveTextContent('%');
  });

  it('sums what the recurring charges cost per month and what they have cost so far', async () => {
    recurringMock.mockResolvedValue({
      recurring: [
        charge({ label: 'netflix', monthlyCost: 43, totalPaid: 344 }),
        charge({ label: 'gym', monthlyCost: 99.8, totalPaid: 540 })
      ]
    });

    render(<InsightsStrip view="PLN" primary="PLN" categories={TEST_CATEGORIES} rates={rates} expenses={ledger} />);

    const sentence = await screen.findByText(/2 recurring charges/);
    expect(sentence).toHaveTextContent(/142,80\s*zł a month/); // 43 + 99.80
    expect(sentence).toHaveTextContent(/884,00\s*zł so far/);  // 344 + 540
  });

  it('leaves cancelled charges out of what things cost now', async () => {
    recurringMock.mockResolvedValue({
      recurring: [
        charge({ label: 'netflix', monthlyCost: 43, totalPaid: 344 }),
        charge({ label: 'old gazette', monthlyCost: 25, totalPaid: 100, likelyCancelled: true })
      ]
    });

    render(<InsightsStrip view="PLN" primary="PLN" categories={TEST_CATEGORIES} rates={rates} expenses={ledger} />);

    // Singular, and the 25,00 zł that stopped is not counted.
    const sentence = await screen.findByText(/1 recurring charge costs/);
    expect(sentence).toHaveTextContent(/43,00\s*zł a month/);
    expect(sentence).toHaveTextContent(/344,00\s*zł so far/);
  });

  it('says no more than three things', async () => {
    comparisonMock.mockResolvedValue(comparison([
      row({ category: 'groceries', current: 1412, previous: 1053.5 }),
      row({ category: 'media', current: 300, previous: 100 }),
      row({ category: 'utilities', current: 40, previous: 0, isNew: true }),
      row({ category: 'transport', current: 80, previous: 0, isNew: true })
    ]));
    recurringMock.mockResolvedValue({ recurring: [charge({ label: 'netflix' })] });

    const { container } = render(<InsightsStrip view="PLN" primary="PLN" categories={TEST_CATEGORIES} rates={rates} expenses={ledger} />);

    await screen.findByText(/recurring charge/);
    expect(container.querySelectorAll('.insight')).toHaveLength(3);
    // One mover and one newcomer — the largest of each, not every category.
    expect(screen.getByText(/Groceries is up/)).toBeInTheDocument();
    expect(screen.getByText(/Transport is new/)).toBeInTheDocument();
    expect(screen.queryByText(/Utilities/)).not.toBeInTheDocument();
  });

  it('shows only the selected currency in a native view', async () => {
    comparisonMock.mockResolvedValue(comparison([
      row({ category: 'groceries', currency: 'PLN', current: 1412, previous: 1053.5 }),
      row({ category: 'media', currency: 'USD', current: 300, previous: 100 })
    ]));
    recurringMock.mockResolvedValue({
      recurring: [
        charge({ label: 'netflix', currency: 'PLN', monthlyCost: 43, totalPaid: 344 }),
        charge({ label: 'spotify', currency: 'USD', monthlyCost: 12, totalPaid: 96 })
      ]
    });

    render(<InsightsStrip view="PLN" primary="USD" categories={TEST_CATEGORIES} rates={rates} expenses={ledger} />);

    // The USD rows are out of scope entirely — neither converted nor added.
    expect(await screen.findByText(/Groceries is up 34%/)).toBeInTheDocument();
    expect(screen.queryByText(/Media/)).not.toBeInTheDocument();
    expect(screen.getByText(/1 recurring charge costs/)).toHaveTextContent(/43,00\s*zł/);
  });

  it('converts every currency into the primary one in the combined view', async () => {
    comparisonMock.mockResolvedValue(comparison([
      row({ category: 'groceries', currency: 'PLN', current: 400, previous: 200 }),
      row({ category: 'groceries', currency: 'USD', current: 50, previous: 25 })
    ]));
    recurringMock.mockResolvedValue({
      recurring: [
        charge({ label: 'netflix', currency: 'PLN', monthlyCost: 40, totalPaid: 400 }),
        charge({ label: 'spotify', currency: 'USD', monthlyCost: 10, totalPaid: 100 })
      ]
    });

    render(<InsightsStrip view="primary" primary="USD" categories={TEST_CATEGORIES} rates={rates} expenses={ledger} />);

    // 400 PLN -> 100 USD, plus 50 USD = 150 now; 200 PLN -> 50, plus 25 = 75 before.
    const mover = await screen.findByText(/Groceries is up 100%/);
    expect(mover).toHaveTextContent('$150.00');
    expect(mover).toHaveTextContent('$75.00');

    // 40 PLN -> 10 USD, plus 10 USD = $20.00 a month; 400 PLN -> 100, plus 100 = $200.00.
    const subs = screen.getByText(/2 recurring charges/);
    expect(subs).toHaveTextContent('$20.00 a month');
    expect(subs).toHaveTextContent('$200.00 so far');
  });

  it('renders nothing when there is nothing worth saying', async () => {
    const { container } = render(<InsightsStrip view="PLN" primary="PLN" categories={TEST_CATEGORIES} rates={rates} expenses={ledger} />);

    await waitFor(() => expect(comparisonMock).toHaveBeenCalled());
    expect(container.querySelector('.insights-strip')).toBeNull();
  });

  it('ignores a move too small to be a story', async () => {
    comparisonMock.mockResolvedValue(comparison([
      row({ category: 'groceries', current: 1000.4, previous: 1000 }) // +0.04%
    ]));

    const { container } = render(<InsightsStrip view="PLN" primary="PLN" categories={TEST_CATEGORIES} rates={rates} expenses={ledger} />);

    await waitFor(() => expect(comparisonMock).toHaveBeenCalled());
    expect(container.querySelector('.insights-strip')).toBeNull();
  });

  it('stays silent when the insights cannot be loaded', async () => {
    // A broken strip must not take the charts down with it, or shout about it.
    comparisonMock.mockRejectedValue(new Error('HTTP error 500'));
    recurringMock.mockRejectedValue(new Error('HTTP error 500'));

    const { container } = render(<InsightsStrip view="PLN" primary="PLN" categories={TEST_CATEGORIES} rates={rates} expenses={ledger} />);

    await waitFor(() => expect(comparisonMock).toHaveBeenCalled());
    expect(container.querySelector('.insights-strip')).toBeNull();
    expect(screen.queryByText(/error/i)).not.toBeInTheDocument();
  });

  it('counts the previous window separately instead of reusing the current one', async () => {
    // Only `rolling` guarantees two equal windows. March against February is
    // 31 days against 28, and the sentence has to say both.
    comparisonMock.mockResolvedValue({
      window: 'calendar',
      period: 'month',
      current: { start: '2026-03-01', end: '2026-03-31' },
      previous: { start: '2026-02-01', end: '2026-02-28' },
      byCategory: [row({ category: 'utilities', current: 40, previous: 0, isNew: true })]
    });

    render(<InsightsStrip view="PLN" primary="PLN" categories={TEST_CATEGORIES} rates={rates} expenses={ledger} />);

    const sentence = await screen.findByText(/Utilities is new/);
    expect(sentence).toHaveTextContent('in the last 31 days');
    expect(sentence).toHaveTextContent('nothing in the 28 before that');
  });

  it('asks the server again when the ledger changes underneath it', async () => {
    comparisonMock.mockResolvedValue(comparison([
      row({ category: 'groceries', current: 1412, previous: 1053.5 })
    ]));

    const { rerender } = render(
      <InsightsStrip view="PLN" primary="PLN" categories={TEST_CATEGORIES} rates={rates} expenses={ledger} />
    );
    await screen.findByText(/Groceries is up 34%/);
    expect(comparisonMock).toHaveBeenCalledTimes(1);

    // A re-render with the same ledger is not new information.
    rerender(<InsightsStrip view="PLN" primary="PLN" categories={TEST_CATEGORIES} rates={rates} expenses={ledger} />);
    expect(comparisonMock).toHaveBeenCalledTimes(1);

    // App replaces the array on every add, edit and delete; that is the signal.
    comparisonMock.mockResolvedValue(comparison([
      row({ category: 'groceries', current: 2000, previous: 1053.5 })
    ]));
    rerender(<InsightsStrip view="PLN" primary="PLN" categories={TEST_CATEGORIES} rates={rates} expenses={[...ledger]} />);

    expect(await screen.findByText(/Groceries is up 90%/)).toBeInTheDocument();
    expect(comparisonMock).toHaveBeenCalledTimes(2);
  });

  it('does not call the server at all for an empty ledger', async () => {
    const { container } = render(
      <InsightsStrip view="PLN" primary="PLN" categories={TEST_CATEGORIES} rates={rates} expenses={[]} />
    );

    await waitFor(() => expect(container.querySelector('.insights-strip')).toBeNull());
    expect(comparisonMock).not.toHaveBeenCalled();
    expect(recurringMock).not.toHaveBeenCalled();
  });

  it('asks for the backend defaults rather than inventing a window', async () => {
    render(<InsightsStrip view="PLN" primary="PLN" categories={TEST_CATEGORIES} rates={rates} expenses={ledger} />);

    await waitFor(() => expect(comparisonMock).toHaveBeenCalled());
    expect(comparisonMock).toHaveBeenCalledWith();
    expect(recurringMock).toHaveBeenCalledWith();
  });
});
