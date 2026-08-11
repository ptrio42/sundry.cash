/**
 * Tests for the Insights tab.
 *
 * The tab is four independent blocks over four independent endpoints, so these
 * tests are mostly about the seams: a block renders from its own payload,
 * disappears when that payload is empty, and survives its neighbour returning a
 * 500. The rest is the currency scope, which is client-side here (unlike the
 * strip's) and therefore has to be shown not to convert a native view.
 *
 * All four endpoints are mocked so the fixtures and the dates are exact.
 */

import { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import Insights from '../components/Insights';
import { TEST_CATEGORIES } from './categories.fixture';
import { TEST_CURRENCIES } from './currencies.fixture';
import {
  AppSettings,
  ComparisonResult,
  CurrencyPattern,
  Expense,
  FxRates,
  MerchantsResult,
  PatternsResult,
  RecurringCharge,
  WeekdayBucket
} from '../types/expense.types';

vi.mock('../services/api', () => ({
  getInsightsRecurring: vi.fn(),
  getInsightsMerchants: vi.fn(),
  getInsightsPatterns: vi.fn(),
  getInsightsComparison: vi.fn()
}));

/**
 * recharts renders nothing in jsdom — it has no layout, so <ResponsiveContainer>
 * measures zero and draws no bars. Stubbed down to the data it is handed, which
 * is the claim worth testing anyway: the bars have to read `perDay`, because
 * totals would hand weekdays a 5:2 win on a perfectly even spread.
 */
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  BarChart: ({ data }: { data: { short: string; perDay: number }[] }) => (
    <ul data-testid="weekday-bars">
      {data.map(bar => <li key={bar.short}>{`${bar.short}: ${bar.perDay}`}</li>)}
    </ul>
  ),
  Bar: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  XAxis: () => null,
  YAxis: () => null
}));

import {
  getInsightsComparison,
  getInsightsMerchants,
  getInsightsPatterns,
  getInsightsRecurring
} from '../services/api';

const recurringMock = vi.mocked(getInsightsRecurring);
const merchantsMock = vi.mocked(getInsightsMerchants);
const patternsMock = vi.mocked(getInsightsPatterns);
const comparisonMock = vi.mocked(getInsightsComparison);

// Value of one unit in USD: 1 PLN = 0.25 USD, so 1 USD = 4 PLN.
const rates: FxRates = { USD: 1, PLN: 0.25, BTC: 65000 };

const settings: AppSettings = {
  defaultCurrency: 'PLN',
  defaultCategory: 'groceries',
  defaultBtcUnit: 'BTC',
  primaryCurrency: 'PLN'
};

// Only the currencies present here get a button; nothing else is read from the
// ledger, so two rows are enough to put both PLN and USD on screen.
const ledger: Expense[] = [
  { id: 1, amount: 10, date: '2026-08-01', description: 'x', category: 'groceries', currency: 'PLN' },
  { id: 2, amount: 5, date: '2026-08-02', description: 'y', category: 'transport', currency: 'USD' }
];

const charge = (over: Partial<RecurringCharge> & Pick<RecurringCharge, 'label' | 'monthlyCost'>): RecurringCharge => ({
  currency: 'PLN',
  cadence: 'monthly',
  medianAmount: over.monthlyCost,
  totalPaid: over.monthlyCost * 8,
  occurrences: 8,
  firstSeen: '2026-01-10',
  lastSeen: '2026-08-10',
  amountStability: 'stable',
  likelyCancelled: false,
  ...over
});

const subscriptions: RecurringCharge[] = [
  charge({ label: 'netflix', monthlyCost: 43, totalPaid: 344 }),
  charge({ label: 'gym', monthlyCost: 120, totalPaid: 960, amountStability: 'variable' }),
  charge({ label: 'old gazette', monthlyCost: 25, totalPaid: 100, likelyCancelled: true, lastSeen: '2026-04-10' })
];

const merchants: MerchantsResult = {
  since: '2025-08-11',
  until: '2026-08-11',
  limit: 100,
  truncated: false,
  merchants: [
    // 20 visits: over MIN_DRIP_COUNT, so this is the drip case.
    { key: 'żabka', currency: 'PLN', total: 300, count: 20, average: 15, firstSeen: '2025-09-01', lastSeen: '2026-08-09' },
    // A bigger total from four purchases — spend you notice, not a habit.
    { key: 'biedronka', currency: 'PLN', total: 800, count: 4, average: 200, firstSeen: '2025-10-01', lastSeen: '2026-07-30' },
    { key: 'amazon', currency: 'USD', total: 50, count: 2, average: 25, firstSeen: '2026-02-01', lastSeen: '2026-06-01' }
  ]
};

/** Seven buckets from seven per-day figures; every weekday occurs twice. */
const buckets = (perDayByDow: number[]): WeekdayBucket[] =>
  perDayByDow.map((perDay, dow) => ({ dow, days: 2, total: perDay * 2, count: 1, perDay }));

const pattern = (over: Partial<CurrencyPattern> = {}): CurrencyPattern => ({
  currency: 'PLN',
  byWeekday: buckets([100, 20, 30, 40, 50, 60, 110]),
  weekdayPerDay: 40,
  weekendPerDay: 105,
  weekendRatio: 2.63,
  ...over
});

const patterns = (over: Partial<CurrencyPattern> = {}): PatternsResult => ({
  since: '2026-07-29',
  until: '2026-08-11',
  days: 14,
  byCurrency: [pattern(over)]
});

const comparison: ComparisonResult = {
  window: 'rolling',
  period: 'month',
  current: { start: '2026-07-13', end: '2026-08-11' },
  previous: { start: '2026-06-13', end: '2026-07-12' },
  byCategory: [
    {
      category: 'groceries', currency: 'PLN',
      current: 1412, previous: 1053.5, delta: 358.5, deltaPct: 34,
      currentCount: 20, previousCount: 18, isNew: false
    },
    {
      // No previous spend at all: the percentage does not exist.
      category: 'utilities', currency: 'PLN',
      current: 300, previous: 0, delta: 300, deltaPct: null,
      currentCount: 1, previousCount: 0, isNew: true
    }
  ]
};

const emptyMerchants: MerchantsResult = { since: '2025-08-11', until: '2026-08-11', limit: 100, truncated: false, merchants: [] };
const emptyPatterns: PatternsResult = { since: '2026-07-29', until: '2026-08-11', days: 14, byCurrency: [] };
const emptyComparison: ComparisonResult = { ...comparison, byCategory: [] };

const tab = (expenses: Expense[] = ledger) => (
  <Insights
    expenses={expenses}
    settings={settings}
    categories={TEST_CATEGORIES}
    currencies={TEST_CURRENCIES}
    rates={rates}
  />
);

/** Everything populated — the starting point most of these tests vary from. */
function loadEverything(): void {
  recurringMock.mockResolvedValue({ recurring: subscriptions });
  merchantsMock.mockResolvedValue(merchants);
  patternsMock.mockResolvedValue(patterns());
  comparisonMock.mockResolvedValue(comparison);
}

/** The table under a block heading, so a row assertion cannot match a neighbour. */
function blockOf(heading: string): HTMLElement {
  return screen.getByRole('region', { name: heading });
}

beforeEach(() => {
  vi.clearAllMocks();
  recurringMock.mockResolvedValue({ recurring: [] });
  merchantsMock.mockResolvedValue(emptyMerchants);
  patternsMock.mockResolvedValue(emptyPatterns);
  comparisonMock.mockResolvedValue(emptyComparison);
});

describe('Insights', () => {
  it('renders one block per endpoint that had something to say', async () => {
    loadEverything();

    render(tab());

    expect(await screen.findByRole('heading', { name: 'Subscriptions' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Where the money goes' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'When you spend' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'What changed' })).toBeInTheDocument();
  });

  it('renders no block at all for an endpoint that came back empty', async () => {
    render(tab());

    // An empty block is worse than no block — the tab says so once, plainly,
    // instead of showing four headings over four blanks.
    expect(await screen.findByText(/Nothing to report yet/)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Subscriptions' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Where the money goes' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'When you spend' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'What changed' })).not.toBeInTheDocument();
  });

  it('separates the stopped subscriptions from the active ones', async () => {
    loadEverything();

    render(tab());
    const block = within(await screen.findByRole('region', { name: 'Subscriptions' }));

    // The active table names the two that are still being paid...
    expect(block.getByText('Netflix')).toBeInTheDocument();
    expect(block.getByText('Gym')).toBeInTheDocument();

    // ...and the one that stopped sits in its own, quieter list below.
    const stopped = block.getByRole('heading', { name: 'Looks stopped' }).parentElement!;
    expect(within(stopped).getByText('Old gazette')).toBeInTheDocument();
    expect(within(stopped).queryByText('Netflix')).not.toBeInTheDocument();
  });

  it('counts only the active charges in the header total', async () => {
    loadEverything();

    render(tab());
    const block = await screen.findByRole('region', { name: 'Subscriptions' });

    // 43 + 120. The cancelled 25 is money that stopped going out, so adding it
    // would overstate what cancelling something else would save.
    expect(block).toHaveTextContent(/163,00/);
    expect(block).not.toHaveTextContent(/188,00/);
    expect(block).toHaveTextContent('2 active charges');
  });

  it('marks a subscription whose price moves', async () => {
    loadEverything();

    render(tab());
    const block = within(await screen.findByRole('region', { name: 'Subscriptions' }));

    const variable = block.getAllByText('variable');
    expect(variable).toHaveLength(1);
    expect(variable[0].closest('tr')).toHaveTextContent('Gym');
  });

  it('ranks merchants by total and flags the ones that add up', async () => {
    loadEverything();

    render(tab());
    const block = within(await screen.findByRole('region', { name: 'Where the money goes' }));

    // The first child of the name cell is the name itself; the badge, when there
    // is one, is a sibling.
    const names = block.getAllByRole('row').slice(1)
      .map(row => row.querySelector('td')?.firstChild?.textContent);
    // Converted into PLN, 50 USD is 200 zł — behind both PLN merchants.
    expect(names).toEqual(['Biedronka', 'Żabka', 'Amazon']);
    expect(block.getByText('Amazon').closest('tr')).toHaveTextContent(/200,00/);

    // Only the merchant with enough visits to be a habit rather than a purchase.
    expect(block.getAllByText('adds up')).toHaveLength(1);
  });

  it('flags the drip case, not every frequent merchant', async () => {
    // Total 3030 across 58 purchases, so the typical purchase is ~52 and 2% of
    // the window's spend is ~61.
    loadEverything();
    merchantsMock.mockResolvedValue({
      ...merchants,
      merchants: [
        // Frequent and material, but nobody fails to notice a 300 zł fill-up.
        { key: 'orlen', currency: 'PLN', total: 2400, count: 8, average: 300, firstSeen: '2025-09-01', lastSeen: '2026-08-01' },
        // Frequent, small, and it adds up to real money.
        { key: 'żabka', currency: 'PLN', total: 600, count: 40, average: 15, firstSeen: '2025-09-01', lastSeen: '2026-08-09' },
        // Frequent and small, but 30 zł a year is not worth pointing at.
        { key: 'kiosk', currency: 'PLN', total: 30, count: 10, average: 3, firstSeen: '2025-09-01', lastSeen: '2026-08-05' }
      ]
    });

    render(tab());
    const block = within(await screen.findByRole('region', { name: 'Where the money goes' }));

    const flagged = block.getAllByText('adds up')
      .map(flag => flag.closest('td')?.firstChild?.textContent);
    expect(flagged).toEqual(['Żabka']);
  });

  it('says so when the merchant list is not everything', async () => {
    loadEverything();
    merchantsMock.mockResolvedValue({ ...merchants, limit: 100, truncated: true });

    render(tab());
    const block = within(await screen.findByRole('region', { name: 'Where the money goes' }));

    // A silently short list reads as a complete one.
    expect(block.getByText(/at most 100 merchants per currency/)).toBeInTheDocument();
  });

  it('draws the weekday bars from the per-day figures, not the totals', async () => {
    loadEverything();

    render(tab());
    const bars = within(await screen.findByTestId('weekday-bars'));

    // Monday's bucket holds 40 in total across two Mondays. The bar is 20.
    expect(bars.getByText('Mon: 20')).toBeInTheDocument();
    expect(bars.queryByText('Mon: 40')).not.toBeInTheDocument();
    expect(bars.getByText('Sun: 100')).toBeInTheDocument();
  });

  it('names the heavier half of the week when there is one', async () => {
    loadEverything();

    render(tab());
    const block = within(await screen.findByRole('region', { name: 'When you spend' }));

    const claim = block.getByText(/Weekends cost more/);
    expect(claim).toHaveTextContent(/105,00/);
    expect(claim).toHaveTextContent(/40,00/);
    expect(claim).toHaveTextContent('2.63×');
  });

  it('says nothing about the weekend when both halves cost the same', async () => {
    loadEverything();
    patternsMock.mockResolvedValue(patterns({ weekdayPerDay: 50, weekendPerDay: 51, weekendRatio: 1.02 }));

    render(tab());
    // The bars are still worth drawing; the claim about them is not.
    await screen.findByTestId('weekday-bars');
    expect(screen.queryByText(/cost more/)).not.toBeInTheDocument();
  });

  it('says nothing about the weekend when there is no ratio at all', async () => {
    loadEverything();
    patternsMock.mockResolvedValue(patterns({ weekendRatio: null }));

    render(tab());
    await screen.findByTestId('weekday-bars');
    expect(screen.queryByText(/cost more/)).not.toBeInTheDocument();
  });

  it('calls a category with no previous spend new, not zero', async () => {
    loadEverything();

    render(tab());
    const block = within(await screen.findByRole('region', { name: 'What changed' }));

    const row = block.getByText('Utilities').closest('tr')!;
    expect(within(row).getByText('new')).toBeInTheDocument();
    expect(row).not.toHaveTextContent('0.0%');
    expect(row).not.toHaveTextContent('—');

    // The category that does have a previous window still shows its percentage.
    expect(block.getByText('Groceries').closest('tr')).toHaveTextContent('+34.0%');
  });

  it('labels both windows with their dates', async () => {
    loadEverything();

    render(tab());
    const block = within(await screen.findByRole('region', { name: 'What changed' }));

    expect(block.getByText(/Jul 13, 2026 – Aug 11, 2026/)).toBeInTheDocument();
    expect(block.getByText(/Jun 13, 2026 – Jul 12, 2026/)).toBeInTheDocument();
  });

  it('shows a native currency untouched, and nothing from the others', async () => {
    loadEverything();

    render(tab());
    await screen.findByRole('region', { name: 'Where the money goes' });
    fireEvent.click(screen.getByRole('button', { name: 'USD ($)' }));

    const block = within(blockOf('Where the money goes'));
    // The USD merchant at its own amount — not the 200 zł the combined view showed.
    expect(block.getByText('$50.00')).toBeInTheDocument();
    expect(block.queryByText(/200,00/)).not.toBeInTheDocument();
    expect(block.queryByText('Żabka')).not.toBeInTheDocument();
    expect(block.queryByText('Biedronka')).not.toBeInTheDocument();

    // The other three blocks hold PLN rows only, so in a USD view they have
    // nothing to say and say nothing.
    expect(screen.queryByRole('heading', { name: 'Subscriptions' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'When you spend' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'What changed' })).not.toBeInTheDocument();
  });

  it('changes currency without asking the server again', async () => {
    loadEverything();

    render(tab());
    await screen.findByRole('region', { name: 'Where the money goes' });
    expect(merchantsMock).toHaveBeenCalledTimes(1);

    // Unlike the strip, nothing here is ranked across currencies, so the scope
    // is a re-render rather than a new question.
    fireEvent.click(screen.getByRole('button', { name: 'USD ($)' }));
    fireEvent.click(screen.getByRole('button', { name: 'All → PLN' }));

    expect(merchantsMock).toHaveBeenCalledTimes(1);
    expect(patternsMock).toHaveBeenCalledTimes(1);
    expect(comparisonMock).toHaveBeenCalledTimes(1);
    expect(recurringMock).toHaveBeenCalledTimes(1);
  });

  it('asks for enough merchants that the combined ranking is not the server default', async () => {
    loadEverything();

    render(tab());
    await screen.findByRole('region', { name: 'Where the money goes' });

    // A merchant the server dropped cannot come back during the client-side
    // merge, so the request has to be generous before it, not after.
    expect(merchantsMock).toHaveBeenCalledWith({ limit: 100 });
  });

  it('loses only the block whose endpoint failed', async () => {
    loadEverything();
    patternsMock.mockRejectedValue(new Error('HTTP error 500'));

    render(tab());

    expect(await screen.findByText('Could not load spending patterns.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'When you spend' })).not.toBeInTheDocument();

    // The tab is the thing the user navigated to; it does not go blank because
    // one of four calls fell over.
    expect(screen.getByRole('heading', { name: 'Subscriptions' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Where the money goes' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'What changed' })).toBeInTheDocument();
  });
});
