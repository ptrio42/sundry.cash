/**
 * Tests for Home.
 *
 * The suites for `Dashboard`, `Insights` and `InsightsStrip` merged into this
 * one, because the three components did. Everything they proved that Home still
 * has to do is here: currency scoping, conversion into the primary currency, the
 * single-currency default, one section per payload, a section that vanishes when
 * its payload is empty, and one failing endpoint costing one section.
 *
 * What is new is the part the merge could get wrong, and which the report is
 * emphatic about (ruling R2): **two clocks, both stated.** The page window
 * control moves the spending sections and must not touch the habit ones, and
 * every section has to print the window it measured over. Skipping that
 * reproduces F1 and F10 on a single screen, where it would be worse.
 *
 * Every endpoint is mocked so the fixtures and the dates are exact, and the
 * clock is pinned to 2026-08-11 — the day the review was written against — so
 * "how much of this window has elapsed" is a fact rather than a moving target.
 */

import { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import Home from '../components/Home';
import { TEST_CATEGORIES } from './categories.fixture';
import { TEST_CURRENCIES } from './currencies.fixture';
import {
  AppSettings,
  Budget,
  CategoryComparison,
  ComparisonResult,
  CurrencyPattern,
  Expense,
  Finding,
  FxRates,
  MerchantsResult,
  PatternsResult,
  RecurringCharge,
  SummaryResult,
  WeekdayBucket
} from '../types/expense.types';

vi.mock('../services/api', () => ({
  getInsightsComparison: vi.fn(),
  getInsightsRecurring: vi.fn(),
  getInsightsMerchants: vi.fn(),
  getInsightsPatterns: vi.fn(),
  getInsightsSummary: vi.fn(),
  getBudgets: vi.fn(),
  // Home's Start card holds the importer inline, so its two calls have to exist
  // on the mocked module even though nothing here uploads a file.
  previewImport: vi.fn(),
  confirmImport: vi.fn()
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
  getBudgets,
  getInsightsComparison,
  getInsightsMerchants,
  getInsightsPatterns,
  getInsightsRecurring,
  getInsightsSummary
} from '../services/api';

const comparisonMock = vi.mocked(getInsightsComparison);
const recurringMock = vi.mocked(getInsightsRecurring);
const merchantsMock = vi.mocked(getInsightsMerchants);
const patternsMock = vi.mocked(getInsightsPatterns);
const summaryMock = vi.mocked(getInsightsSummary);
const budgetsMock = vi.mocked(getBudgets);

/** The day the review was written against. A Tuesday. */
const TODAY = '2026-08-11';

// Value of one unit in USD: 1 PLN = 0.25 USD (so 1 USD = 4 PLN), 1 BTC = 65000 USD.
const rates: FxRates = { USD: 1, PLN: 0.25, BTC: 65000 };

const settings = (primaryCurrency: AppSettings['primaryCurrency'] = 'PLN'): AppSettings => ({
  defaultCurrency: 'PLN',
  defaultCategory: 'groceries',
  defaultBtcUnit: 'BTC',
  primaryCurrency
});

const expense = (e: Partial<Expense> & Pick<Expense, 'id' | 'amount'>): Expense => ({
  date: '2026-08-10',
  description: 'x',
  category: 'groceries',
  currency: 'PLN',
  ...e
});

/** One currency in the ledger: no scope control, and nothing to convert. */
const plnOnly: Expense[] = [
  expense({ id: 1, amount: 100 }),
  expense({ id: 2, amount: 50, date: '2026-08-09' })
];

/** Three currencies, so the scope control has something to offer. */
const mixed: Expense[] = [
  expense({ id: 1, amount: 100, currency: 'PLN' }),
  expense({ id: 2, amount: 25, currency: 'USD', date: '2026-08-09' }),
  expense({ id: 3, amount: 0.002, currency: 'BTC', date: '2026-08-08' })
];

/** Older than the heatmap's 13 weeks, so an empty payload really means an empty screen. */
const oldLedger: Expense[] = [expense({ id: 1, amount: 100, date: '2026-01-15' })];

const cmp = (category: string, current: number, previous: number, currency = 'PLN'): CategoryComparison => ({
  category,
  currency,
  current,
  previous,
  delta: current - previous,
  deltaPct: previous === 0 ? null : Number((((current - previous) / previous) * 100).toFixed(1)),
  currentCount: 1,
  previousCount: previous === 0 ? 0 : 1,
  isNew: previous === 0 && current > 0
});

/** Seven PLN categories: six ranked rows plus one that collapses into the rest. */
const PLN_ROWS: CategoryComparison[] = [
  cmp('groceries', 1000, 800),
  cmp('transport', 600, 500),
  cmp('media', 400, 400),
  cmp('utilities', 300, 0),
  cmp('entertainment', 200, 100),
  cmp('maintenance', 100, 200),
  cmp('other', 50, 25)
];
const PLN_TOTAL = 2650;

/** The same, plus a USD row — 25 USD is 100 zł once converted. */
const MIXED_ROWS: CategoryComparison[] = [...PLN_ROWS, cmp('groceries', 25, 20, 'USD')];

const rolling = (rows: CategoryComparison[] = PLN_ROWS): ComparisonResult => ({
  window: 'rolling',
  period: 'month',
  current: { start: '2026-07-13', end: '2026-08-11' },
  previous: { start: '2026-06-13', end: '2026-07-12' },
  byCategory: rows
});

const calendar = (rows: CategoryComparison[] = PLN_ROWS): ComparisonResult => ({
  window: 'calendar',
  period: 'month',
  current: { start: '2026-08-01', end: '2026-08-31' },
  previous: { start: '2026-07-01', end: '2026-07-31' },
  byCategory: rows
});

const year = (rows: CategoryComparison[] = PLN_ROWS): ComparisonResult => ({
  window: 'rolling',
  period: 'year',
  current: { start: '2025-08-12', end: '2026-08-11' },
  previous: { start: '2024-08-12', end: '2025-08-11' },
  byCategory: rows
});

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
  since: '2025-08-11',
  until: '2026-08-11',
  days: 366,
  byCurrency: [pattern(over)]
});

const budgets: Budget[] = [
  { category: 'groceries', currency: 'PLN', amount: 800 },  // 1000 spent -> 125%, over
  { category: 'transport', currency: 'PLN', amount: 640 },  // 600 spent -> 94%, close
  { category: 'media', currency: 'PLN', amount: 1000 }      // 400 spent -> 40%, on track
];

const summary = (findings: Finding[], currency = 'PLN'): SummaryResult => ({
  scope: currency,
  currency,
  windowDays: 30,
  findings
});

const finding = {
  weekendSkew: (severity = 0.7): Finding => ({
    kind: 'weekend_skew',
    severity,
    currency: 'PLN',
    data: { weekendPerDay: 111.11, weekdayPerDay: 45.86, ratio: 2.42, days: 30 }
  }),
  categoryMoved: (severity = 0.2): Finding => ({
    kind: 'category_moved',
    severity,
    currency: 'PLN',
    data: { category: 'groceries', current: 1000, previous: 800, delta: 200, deltaPct: 25, days: 30, previousDays: 30 }
  }),
  recurringTotal: (severity = 0.3): Finding => ({
    kind: 'recurring_total',
    severity,
    currency: 'PLN',
    data: { count: 2, monthlyCost: 163, totalPaid: 1304 }
  }),
  merchantDrip: (severity = 0.25): Finding => ({
    kind: 'merchant_drip',
    severity,
    currency: 'PLN',
    data: { key: 'żabka', total: 300, count: 20, average: 15, days: 30 }
  })
};

const emptyMerchants: MerchantsResult = { ...merchants, merchants: [] };
const emptyPatterns: PatternsResult = { ...patterns(), byCurrency: [] };

const onAddExpense = vi.fn();
const onExpensesStale = vi.fn();

const home = (expenses: Expense[] = plnOnly, primary: string = 'PLN') => (
  <Home
    expenses={expenses}
    settings={settings(primary)}
    categories={TEST_CATEGORIES}
    currencies={TEST_CURRENCIES}
    rates={rates}
    onAddExpense={onAddExpense}
    onExpensesStale={onExpensesStale}
  />
);

/** Everything populated — the starting point most of these tests vary from. */
function loadEverything(): void {
  comparisonMock.mockImplementation(async (params = {}) =>
    params.window === 'calendar' ? calendar() : params.period === 'year' ? year() : rolling());
  recurringMock.mockResolvedValue({ recurring: subscriptions });
  merchantsMock.mockResolvedValue(merchants);
  patternsMock.mockResolvedValue(patterns());
  budgetsMock.mockResolvedValue(budgets);
  summaryMock.mockResolvedValue(summary([]));
}

const section = (name: string) => screen.getByRole('region', { name });
const sectionNames = () => Array.from(document.querySelectorAll('.home-section-label h2')).map(h => h.textContent);
const windowLine = (name: string) => section(name).querySelector('.home-window')?.textContent ?? '';
const claims = (name: string) => Array.from(section(name).querySelectorAll('.finding')).map(p => p.textContent ?? '');
const headline = () => document.querySelector('.headline');

/** Wait for the first paint to settle — Home shows one loading line until then. */
const settle = () => waitFor(() => expect(screen.queryByText(/loading your overview/i)).not.toBeInTheDocument());

beforeEach(() => {
  vi.clearAllMocks();
  // Only Date, so React Testing Library's own waiting still uses real timers.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(`${TODAY}T10:00:00`));

  comparisonMock.mockResolvedValue(rolling([]));
  recurringMock.mockResolvedValue({ recurring: [] });
  merchantsMock.mockResolvedValue(emptyMerchants);
  patternsMock.mockResolvedValue(emptyPatterns);
  budgetsMock.mockResolvedValue([]);
  summaryMock.mockResolvedValue(summary([]));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Home — the headline', () => {
  it('states the total, the daily rate and the change against the window before', () => {
    loadEverything();
    render(home());

    return settle().then(() => {
      // 2650 over 30 days is 88,33 zł a day; 2650 against 2025 is +31%.
      expect(headline()).toHaveTextContent(/2\s*650,00\s*zł/);
      expect(headline()).toHaveTextContent('in the last 30 days');
      expect(headline()).toHaveTextContent(/88,33\s*zł\/day/);
      expect(headline()).toHaveTextContent('31% more than the 30 days before');
    });
  });

  it('says nothing about a percentage when the previous window was empty', async () => {
    loadEverything();
    comparisonMock.mockResolvedValue(rolling([cmp('groceries', 500, 0)]));

    render(home());
    await settle();

    expect(headline()).toHaveTextContent('nothing in the 30 days before');
    expect(headline()).not.toHaveTextContent('%');
  });

  it('collapses the FX caveat into a clause instead of a paragraph of its own', async () => {
    loadEverything();
    comparisonMock.mockResolvedValue(rolling(MIXED_ROWS));

    render(home(mixed));
    await settle();

    expect(headline()).toHaveTextContent('converted at your rates');
  });

  it('makes no FX claim in a native view', async () => {
    loadEverything();
    render(home());
    await settle();

    expect(headline()).not.toHaveTextContent('converted at your rates');
  });

  it('says so plainly when the window holds no spending', async () => {
    loadEverything();
    comparisonMock.mockResolvedValue(rolling([]));

    render(home());
    await settle();

    // Not a headline over zero, and not a blank space either.
    expect(headline()).toBeNull();
    expect(screen.getByText(/No PLN spending in the last 30 days/)).toBeInTheDocument();
  });
});

describe('Home — the two clocks', () => {
  it('states a window on every section', async () => {
    loadEverything();
    render(home());
    await settle();

    for (const name of ['Where it went', 'Budgets', 'Subscriptions', 'Where you shop', 'When you spend']) {
      expect(windowLine(name)).not.toBe('');
    }
  });

  it('gives the spending sections the page window, with the dates it actually used', async () => {
    loadEverything();
    render(home());
    await settle();

    expect(windowLine('Where it went')).toContain('Last 30 days');
    expect(windowLine('Where it went')).toContain('13 Jul 2026 – 11 Aug 2026');
    expect(windowLine('Budgets')).toContain('Last 30 days');
  });

  it('gives the habit sections a longer window, and a different one from the page', async () => {
    // This is ruling R2. Forced to 30 days the weekday chart has about four
    // samples per weekday and the merchant list goes thin; forced to 12 months
    // the scoring breaks, because materiality divides by spend in the window.
    loadEverything();
    render(home());
    await settle();

    for (const name of ['Subscriptions', 'Where you shop', 'When you spend']) {
      expect(windowLine(name)).toContain('Last 12 months');
      expect(windowLine(name)).not.toContain('Last 30 days');
    }
    expect(windowLine('Subscriptions')).toContain('11 Aug 2025');
    expect(windowLine('Where you shop')).toContain('11 Aug 2025 – 11 Aug 2026');
  });

  it('states the heatmap\'s own window too, which is neither of the other two', async () => {
    loadEverything();
    render(home());
    await settle();

    expect(within(section('When you spend')).getByRole('heading', { name: /Daily spend — last 13 weeks/ }))
      .toBeInTheDocument();
  });

  it('asks the habit endpoints for exactly the window it prints', async () => {
    // `/insights/recurring` reports no dates back, so a header stating a
    // constant nobody sent would be F1 with extra steps.
    loadEverything();
    render(home());
    await settle();

    expect(recurringMock).toHaveBeenCalledWith({ since: '2025-08-11' });
    expect(merchantsMock).toHaveBeenCalledWith({ limit: 100 });
  });
});

describe('Home — the page window control', () => {
  it('offers the three windows and opens on 30 days', async () => {
    loadEverything();
    render(home());
    await settle();

    const period = screen.getByRole('group', { name: 'Period' });
    expect(within(period).getAllByRole('button').map(b => b.textContent))
      .toEqual(['Last 30 days', 'This month', 'Last 12 months']);
    expect(within(period).getByRole('button', { name: 'Last 30 days' })).toHaveClass('active');
    expect(comparisonMock).toHaveBeenCalledWith({ period: 'month', window: 'rolling' });
  });

  it('moves the spending sections, and not the habit ones', async () => {
    loadEverything();
    render(home());
    await settle();

    expect(comparisonMock).toHaveBeenCalledTimes(1);
    expect(recurringMock).toHaveBeenCalledTimes(1);
    expect(patternsMock).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'This month' }));

    // The comparison and the findings that head its sections are a new question…
    await waitFor(() => expect(comparisonMock).toHaveBeenCalledWith({ period: 'month', window: 'calendar' }));
    await waitFor(() => expect(summaryMock).toHaveBeenCalledWith({ scope: 'PLN', period: 'month', window: 'calendar' }));

    // …and the habit sections are not. They measure a different window on
    // purpose, so asking them again would be a request that cannot answer
    // differently.
    expect(recurringMock).toHaveBeenCalledTimes(1);
    expect(merchantsMock).toHaveBeenCalledTimes(1);
    expect(patternsMock).toHaveBeenCalledTimes(1);
    expect(budgetsMock).toHaveBeenCalledTimes(1);
  });

  it('restates the window on the sections it moved, and leaves the others alone', async () => {
    loadEverything();
    render(home());
    await settle();

    fireEvent.click(screen.getByRole('button', { name: 'This month' }));

    await waitFor(() => expect(windowLine('Where it went')).toContain('This month'));
    expect(windowLine('Where it went')).toContain('1 Aug 2026 – 31 Aug 2026');
    expect(windowLine('When you spend')).toContain('Last 12 months');
  });

  it('compares a partial calendar month per day rather than total against total', async () => {
    loadEverything();
    render(home());
    await settle();

    fireEvent.click(screen.getByRole('button', { name: 'This month' }));

    // 2650 in eleven days of August is 240,91 zł a day, against 65,32 in the
    // whole of July. As totals it would read +31%; that comparison reports a
    // collapse in spending on the 3rd of every month.
    await waitFor(() => expect(headline()).toHaveTextContent('so far in August 2026'));
    expect(headline()).toHaveTextContent(/240,91\s*zł\/day/);
    expect(headline()).toHaveTextContent('a day than July 2026');
  });

  it('scales the monthly limits when the window is a year long', async () => {
    loadEverything();
    render(home());
    await settle();

    fireEvent.click(screen.getByRole('button', { name: 'Last 12 months' }));

    // 800 a month is 9600 over the year, so 1000 of groceries is nowhere near it.
    await waitFor(() => expect(windowLine('Budgets')).toContain('against 12× your current monthly limits'));
    expect(claims('Budgets')[0]).toContain('Nothing over');
  });
});

describe('Home — where it went', () => {
  it('ranks the categories by what they cost, six of them plus the rest', async () => {
    loadEverything();
    render(home());
    await settle();

    const rows = Array.from(section('Where it went').querySelectorAll('.rank-name')).map(n => n.textContent);
    expect(rows).toEqual([
      'Groceries', 'Transport', 'Media', 'Utilities', 'Entertainment', 'Maintenance',
      'Everything else (1 category)'
    ]);
  });

  it('keeps the amount, the share and the change the donut could not show', async () => {
    loadEverything();
    render(home());
    await settle();

    const first = section('Where it went').querySelector('.rank-row')!;
    expect(first).toHaveTextContent(/1\s*000,00\s*zł/);
    expect(first).toHaveTextContent(`${Math.round((1000 / PLN_TOTAL) * 100)}%`);
    expect(first.querySelector('.rank-delta')).toHaveTextContent('+25.0%');
  });

  it('calls a category with no previous spend new, not zero', async () => {
    loadEverything();
    render(home());
    await settle();

    const row = within(section('Where it went')).getByText('Utilities').closest('.rank-row')!;
    expect(row.querySelector('.rank-delta')).toHaveTextContent('new');
    expect(row).not.toHaveTextContent('0.0%');
  });

  it('lets the swatch carry the category colour, never the label text', async () => {
    // The rule is written above `.category-dot` in App.css: a category hue is
    // user data and one value has to work on both themes. Painting it onto the
    // text failed all ten donut labels in light mode (F14).
    loadEverything();
    render(home());
    await settle();

    const names = Array.from(section('Where it went').querySelectorAll<HTMLElement>('.rank-name'));
    expect(names).not.toHaveLength(0);
    for (const name of names) {
      expect(name.style.color).toBe('');
      expect(name.querySelector<HTMLElement>('.category-dot')?.style.background).not.toBe('');
    }
  });

  it('counts a category the loaded list does not know, and names it readably', async () => {
    // An expense can legitimately carry a slug the list does not have: the
    // category fetch is non-fatal, and another device can delete a custom
    // category while this tab still holds its rows.
    loadEverything();
    comparisonMock.mockResolvedValue(rolling([cmp('groceries', 120, 100), cmp('pet-food', 80, 0)]));

    render(home());
    await settle();

    const rows = Array.from(section('Where it went').querySelectorAll('.rank-name')).map(n => n.textContent);
    expect(rows).toEqual(['Groceries', 'Pet food']);
    expect(headline()).toHaveTextContent(/200,00\s*zł/);
  });

  it('renders no stat tiles at all', async () => {
    // The four that led the overview were TOTAL SPENT, EXPENSES (a row count),
    // AVERAGE and LARGEST — all-time, saying so nowhere, in the largest type on
    // the screen (F1, F16, change 26). A row count is not a fact about money.
    loadEverything();
    render(home());
    await settle();

    expect(document.querySelectorAll('.summary-card')).toHaveLength(0);
  });
});

describe('Home — the budget verdict', () => {
  it('states the verdict instead of making you scan ten cards', async () => {
    loadEverything();
    render(home());
    await settle();

    // 1000 against a 800 limit is 25% over; transport is at 94%; media is fine.
    expect(claims('Budgets')[0]).toBe('Groceries 25% over · 1 close · 1 on track.');
  });

  it('says nothing is over rather than saying nothing at all', async () => {
    // In the demo nothing is over and no element on the screen says so (F4).
    loadEverything();
    comparisonMock.mockResolvedValue(rolling([cmp('groceries', 10, 5)]));

    render(home());
    await settle();

    expect(claims('Budgets')[0]).toContain('Nothing over');
  });

  it('counts the days left when the window has not ended yet', async () => {
    loadEverything();
    render(home());
    await settle();

    // A rolling window ends today, so there is nothing left of it…
    expect(claims('Budgets')[0]).not.toContain('days left');

    // …whereas the calendar month runs to the 31st.
    fireEvent.click(screen.getByRole('button', { name: 'This month' }));
    await waitFor(() => expect(claims('Budgets')[0]).toContain('with 20 days left'));
  });

  it('renders nothing when no limits are set', async () => {
    // Which is also the state that used to put a large red negative on screen
    // the moment a new user saved their first expense (F4, §9).
    loadEverything();
    budgetsMock.mockResolvedValue([]);

    render(home());
    await settle();

    expect(screen.queryByRole('region', { name: 'Budgets' })).not.toBeInTheDocument();
    expect(screen.queryByText(/on track/)).not.toBeInTheDocument();
  });

  it('says which limits it is comparing against', async () => {
    // Budgets have no month dimension, so the caveat is the price of the feature.
    loadEverything();
    render(home());
    await settle();

    expect(windowLine('Budgets')).toContain('against your current monthly limits');
  });
});

describe('Home — the habit sections', () => {
  it('separates the stopped subscriptions from the active ones', async () => {
    loadEverything();
    render(home());
    await settle();

    const block = within(section('Subscriptions'));
    expect(block.getByText('Netflix')).toBeInTheDocument();
    expect(block.getByText('Gym')).toBeInTheDocument();

    const stopped = block.getByRole('heading', { name: 'Looks stopped' }).parentElement!;
    expect(within(stopped).getByText('Old gazette')).toBeInTheDocument();
    expect(within(stopped).queryByText('Netflix')).not.toBeInTheDocument();
  });

  it('counts only the active charges in the monthly total', async () => {
    loadEverything();
    render(home());
    await settle();

    // 43 + 120. The cancelled 25 is money that stopped going out, so adding it
    // would overstate what cancelling something else would save.
    expect(section('Subscriptions')).toHaveTextContent(/163,00/);
    expect(section('Subscriptions')).not.toHaveTextContent(/188,00/);
    expect(section('Subscriptions')).toHaveTextContent('2 active charges');
  });

  it('marks a subscription whose price moves', async () => {
    loadEverything();
    render(home());
    await settle();

    const variable = within(section('Subscriptions')).getAllByText('variable');
    expect(variable).toHaveLength(1);
    expect(variable[0].closest('tr')).toHaveTextContent('Gym');
  });

  it('ranks merchants by total and flags the ones that add up', async () => {
    loadEverything();
    comparisonMock.mockResolvedValue(rolling(MIXED_ROWS));

    render(home(mixed));
    await settle();

    const block = within(section('Where you shop'));
    const names = block.getAllByRole('row').slice(1)
      .map(row => row.querySelector('td')?.firstChild?.textContent);
    // Converted into PLN, 50 USD is 200 zł — behind both PLN merchants.
    expect(names).toEqual(['Biedronka', 'Żabka', 'Amazon']);
    expect(block.getByText('Amazon').closest('tr')).toHaveTextContent(/200,00/);
    // Only the merchant with enough visits to be a habit rather than a purchase.
    expect(block.getAllByText('adds up')).toHaveLength(1);
  });

  it('says so when the merchant list is not everything', async () => {
    loadEverything();
    merchantsMock.mockResolvedValue({ ...merchants, truncated: true });

    render(home());
    await settle();

    // A silently short list reads as a complete one.
    expect(within(section('Where you shop')).getByText(/at most 100 merchants per currency/)).toBeInTheDocument();
  });

  it('draws the weekday bars from the per-day figures, not the totals', async () => {
    loadEverything();
    render(home());
    await settle();

    // Monday's bucket holds 40 in total across two Mondays. The bar is 20.
    const bars = within(screen.getByTestId('weekday-bars'));
    expect(bars.getByText('Mon: 20')).toBeInTheDocument();
    expect(bars.queryByText('Mon: 40')).not.toBeInTheDocument();
    expect(bars.getByText('Sun: 100')).toBeInTheDocument();
  });

  it('names the heavier half of the week, and states the window it used', async () => {
    loadEverything();
    render(home());
    await settle();

    const claim = within(section('When you spend')).getByText(/Weekends cost more/);
    expect(claim).toHaveTextContent(/105,00/);
    expect(claim).toHaveTextContent(/40,00/);
    expect(claim).toHaveTextContent('2.63× over these 12 months');
  });

  it('says nothing about the weekend when both halves cost the same', async () => {
    loadEverything();
    patternsMock.mockResolvedValue(patterns({ weekdayPerDay: 50, weekendPerDay: 51, weekendRatio: 1.02 }));

    render(home());
    await settle();

    // The bars are still worth drawing; the claim about them is not.
    expect(screen.getByTestId('weekday-bars')).toBeInTheDocument();
    expect(screen.queryByText(/cost more/)).not.toBeInTheDocument();
  });

  it('says nothing about the weekend when there is no ratio at all', async () => {
    loadEverything();
    patternsMock.mockResolvedValue(patterns({ weekendRatio: null }));

    render(home());
    await settle();

    expect(screen.getByTestId('weekday-bars')).toBeInTheDocument();
    expect(screen.queryByText(/cost more/)).not.toBeInTheDocument();
  });

  it('anchors the heatmap ramp above the ordinary days, not on the largest one', async () => {
    // Anchored on the maximum, one 4000 zł day put every ordinary day in the
    // bottom fifth of the ramp and they all rendered alike (change 27).
    loadEverything();
    const ledger = [
      ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map(day =>
        expense({ id: day, amount: 100, date: `2026-08-0${day}` })),
      expense({ id: 10, amount: 4000, date: '2026-08-10' })
    ];

    render(home(ledger));
    await settle();

    const cells = Array.from(section('When you spend').querySelectorAll<HTMLElement>('.heatmap-cell'))
      .filter(cell => cell.title?.startsWith('2026-08-0'));
    // Nine days of 100 against a p90 of 100: every one of them is at the top of
    // the ramp, and the 4000 outlier shares that top shade rather than owning it.
    expect(cells).toHaveLength(9);
    for (const cell of cells) {
      // jsdom normalises a fully opaque rgba() to rgb().
      expect(cell.style.background).toBe('rgb(52, 211, 153)');
    }
    expect(section('When you spend')).toHaveTextContent(/More, from 100,00\s*zł up/);
  });
});

describe('Home — findings as section headings', () => {
  it('renders a finding as the heading of the section that proves it', async () => {
    loadEverything();
    summaryMock.mockResolvedValue(summary([finding.weekendSkew(), finding.categoryMoved()]));

    render(home());
    await settle();

    expect(claims('When you spend')[0]).toMatch(/^Weekends cost more/);
    expect(claims('Where it went')[0]).toMatch(/^Groceries is up 25%/);
    // And not as a box of its own above everything else (ruling R3).
    expect(document.querySelector('.insights-strip')).toBeNull();
  });

  it('asks the server for the currency and the window it is showing', async () => {
    loadEverything();
    render(home());
    await settle();

    expect(summaryMock).toHaveBeenCalledWith({ scope: 'PLN', period: 'month', window: 'rolling' });
  });

  it('does not make the same claim twice inside one section', async () => {
    // The 30-day weekend finding and the section's own 12-month claim are the
    // same sentence with different numbers. Printing both is the contradiction
    // this wave exists to remove (F10), only worse for being 40px apart.
    loadEverything();
    summaryMock.mockResolvedValue(summary([finding.weekendSkew()]));

    render(home());
    await settle();

    expect(screen.getAllByText(/cost more/)).toHaveLength(1);
    expect(claims('When you spend')[0]).toContain('over the last 30 days');
  });

  it('drops the subscriptions total when a finding already states it', async () => {
    loadEverything();
    summaryMock.mockResolvedValue(summary([finding.recurringTotal()]));

    render(home());
    await settle();

    expect(claims('Subscriptions')[0]).toMatch(/^2 recurring charges cost about/);
    expect(section('Subscriptions')).not.toHaveTextContent('2 active charges');
  });

  it('carries both findings when two of them prove one section', async () => {
    loadEverything();
    summaryMock.mockResolvedValue(summary([
      {
        kind: 'recurring_stopped',
        severity: 0.4,
        currency: 'PLN',
        data: { label: 'old gazette', cadence: 'monthly', monthlyCost: 25, totalPaid: 100, lastSeen: '2026-04-10' }
      },
      finding.recurringTotal(0.3)
    ]));

    render(home());
    await settle();

    expect(claims('Subscriptions')).toHaveLength(2);
    expect(claims('Subscriptions')[0]).toMatch(/^Old gazette looks like it stopped/);
  });

  it('says nothing extra when the server found nothing worth saying', async () => {
    loadEverything();
    render(home());
    await settle();

    expect(document.querySelectorAll('.finding')).toHaveLength(1); // the budget verdict
    expect(claims('When you spend')).toEqual([]);
  });

  it('stays silent when the findings cannot be loaded', async () => {
    // Findings are the emphasis on top of sections that work without them.
    loadEverything();
    summaryMock.mockRejectedValue(new Error('HTTP error 500'));

    render(home());
    await settle();

    expect(screen.getByRole('region', { name: 'When you spend' })).toBeInTheDocument();
    expect(screen.queryByText(/could not load/i)).not.toBeInTheDocument();
  });
});

describe('Home — promotion', () => {
  const ORDER = ['Where it went', 'Budgets', 'Subscriptions', 'Where you shop', 'When you spend'];

  it('keeps the fixed reading order when nothing stands out', async () => {
    loadEverything();
    summaryMock.mockResolvedValue(summary([finding.weekendSkew(0.3), finding.categoryMoved(0.25)]));

    render(home());
    await settle();

    expect(sectionNames()).toEqual(ORDER);
  });

  it('moves one section under the headline when its finding scores far above the rest', async () => {
    loadEverything();
    summaryMock.mockResolvedValue(summary([finding.weekendSkew(0.75), finding.categoryMoved(0.2)]));

    render(home());
    await settle();

    expect(sectionNames()).toEqual(['When you spend', 'Where it went', 'Budgets', 'Subscriptions', 'Where you shop']);
  });

  it('promotes at most one, and the rest keep their order', async () => {
    loadEverything();
    summaryMock.mockResolvedValue(summary([finding.merchantDrip(0.8), finding.categoryMoved(0.1)]));

    render(home());
    await settle();

    expect(sectionNames()).toEqual(['Where you shop', 'Where it went', 'Budgets', 'Subscriptions', 'When you spend']);
  });
});

describe('Home — currency scope', () => {
  it('offers no control at all when the ledger holds one currency', async () => {
    // Four screens each grew a control whose only option was already selected
    // (F9, change 14).
    loadEverything();
    render(home());
    await settle();

    expect(screen.queryByRole('button', { name: /^All → / })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^PLN/ })).not.toBeInTheDocument();
    // And the numbers are that currency's own, unconverted: 2650 zł would be
    // 10 600 zł if PLN had been "converted" into PLN.
    expect(headline()).toHaveTextContent(/2\s*650,00\s*zł/);
  });

  it('offers only the currencies it has numbers in, once there is a choice to make', async () => {
    // Every button has to lead somewhere. A currency the catalogue merely has
    // enabled is a guaranteed blank screen behind a button, which is what F9 was
    // about Analytics: it offered USD and the ledger had never seen one.
    loadEverything();
    comparisonMock.mockResolvedValue(rolling(MIXED_ROWS));

    render(home(mixed));
    await settle();

    expect(screen.getByRole('button', { name: 'All → PLN' })).toHaveClass('active');
    for (const code of ['BTC', 'PLN', 'USD']) {
      expect(screen.getByRole('button', { name: new RegExp(`^${code} `) })).toBeInTheDocument();
    }
    // EUR and JPY are in the catalogue and not in the ledger; BTC, PLN and USD
    // are the three the fixture actually holds.
    expect(screen.queryByRole('button', { name: /^EUR/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^JPY/ })).not.toBeInTheDocument();
  });

  it('keeps offering a currency the catalogue has since switched off', async () => {
    // Disabling a currency means "stop offering it for new entries", never "hide
    // the history" — so a ledger holding EUR still gets an EUR button.
    loadEverything();
    const withEur = [...mixed, expense({ id: 4, amount: 20, currency: 'EUR', date: '2026-08-07' })];
    comparisonMock.mockResolvedValue(rolling([...MIXED_ROWS, cmp('media', 20, 10, 'EUR')]));

    render(home(withEur));
    await settle();

    expect(screen.getByRole('button', { name: /^EUR/ })).toBeInTheDocument();
  });

  it('converts everything into the primary currency in the combined view', async () => {
    loadEverything();
    comparisonMock.mockResolvedValue(rolling(MIXED_ROWS));

    render(home(mixed));
    await settle();

    // 2650 zł plus 25 USD converted at 4 zł each = 2750 zł, not the meaningless
    // raw sum of 2675.
    expect(headline()).toHaveTextContent(/2\s*750,00\s*zł/);
  });

  it('converts into USD instead when USD is the primary currency', async () => {
    loadEverything();
    comparisonMock.mockResolvedValue(rolling(MIXED_ROWS));

    render(home(mixed, 'USD'));
    await settle();

    // 2650 zł is 662.50 USD, plus the 25 USD row.
    expect(screen.getByRole('button', { name: 'All → USD' })).toHaveClass('active');
    expect(headline()).toHaveTextContent('$687.50');
  });

  it('narrows to a single native currency and back again', async () => {
    loadEverything();
    comparisonMock.mockResolvedValue(rolling(MIXED_ROWS));

    render(home(mixed));
    await settle();

    fireEvent.click(screen.getByRole('button', { name: /^USD/ }));

    // Only the USD row survives, shown unconverted.
    await waitFor(() => expect(headline()).toHaveTextContent('$25.00'));
    expect(headline()).not.toHaveTextContent('zł');
    expect(headline()).not.toHaveTextContent('converted at your rates');

    fireEvent.click(screen.getByRole('button', { name: 'All → PLN' }));
    await waitFor(() => expect(headline()).toHaveTextContent(/2\s*750,00\s*zł/));
  });

  it('shows a native BTC view in BTC units', async () => {
    loadEverything();
    comparisonMock.mockResolvedValue(rolling([...PLN_ROWS, cmp('media', 0.002, 0.001, 'BTC')]));

    render(home(mixed));
    await settle();

    fireEvent.click(screen.getByRole('button', { name: /^BTC/ }));

    await waitFor(() => expect(headline()).toHaveTextContent('₿0.002'));
  });

  it('re-asks the server for findings, because ranking has to convert first', async () => {
    loadEverything();
    comparisonMock.mockResolvedValue(rolling(MIXED_ROWS));

    render(home(mixed));
    await settle();
    expect(summaryMock).toHaveBeenCalledWith({ scope: 'primary', period: 'month', window: 'rolling' });

    fireEvent.click(screen.getByRole('button', { name: /^USD/ }));

    await waitFor(() => expect(summaryMock).toHaveBeenCalledWith({ scope: 'USD', period: 'month', window: 'rolling' }));
  });

  it('changes currency without asking the four data endpoints again', async () => {
    // Nothing else here is ranked across currencies, so the scope is a re-render.
    loadEverything();
    comparisonMock.mockResolvedValue(rolling(MIXED_ROWS));

    render(home(mixed));
    await settle();

    fireEvent.click(screen.getByRole('button', { name: /^USD/ }));
    fireEvent.click(screen.getByRole('button', { name: 'All → PLN' }));

    expect(comparisonMock).toHaveBeenCalledTimes(1);
    expect(merchantsMock).toHaveBeenCalledTimes(1);
    expect(patternsMock).toHaveBeenCalledTimes(1);
    expect(recurringMock).toHaveBeenCalledTimes(1);
    expect(budgetsMock).toHaveBeenCalledTimes(1);
  });
});

describe('Home — sections that have nothing to say', () => {
  it('renders no section at all for a payload that came back empty', async () => {
    // An empty box costs more than a section that is not there.
    render(home(oldLedger));
    await settle();

    expect(sectionNames()).toEqual([]);
    expect(screen.getByText(/No PLN spending in the last 30 days/)).toBeInTheDocument();
  });

  it('loses only the section whose endpoint failed', async () => {
    loadEverything();
    patternsMock.mockRejectedValue(new Error('HTTP error 500'));

    render(home());
    await settle();

    expect(screen.getByText('Could not load spending patterns.')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'When you spend' })).not.toBeInTheDocument();

    // Home is the boot screen; it does not go blank because one of six calls
    // fell over.
    expect(screen.getByRole('region', { name: 'Subscriptions' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Where you shop' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Where it went' })).toBeInTheDocument();
  });

  it('keeps the habit sections when the comparison is the thing that failed', async () => {
    loadEverything();
    comparisonMock.mockRejectedValue(new Error('HTTP error 500'));

    render(home());
    await settle();

    expect(screen.getByText('Could not load the category breakdown.')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Subscriptions' })).toBeInTheDocument();
  });
});

describe('Home — an empty ledger', () => {
  it('renders one Start card and no sections', async () => {
    render(home([]));
    await settle();

    expect(screen.getByRole('heading', { name: /Nothing recorded yet/ })).toBeInTheDocument();
    expect(sectionNames()).toEqual([]);
    expect(headline()).toBeNull();
  });

  it('asks the server nothing at all', async () => {
    // A fresh install has nothing that repeats, nothing to rank and nothing to
    // compare, so it should not spend six requests learning that.
    render(home([]));
    await settle();

    for (const mock of [comparisonMock, recurringMock, merchantsMock, patternsMock, summaryMock, budgetsMock]) {
      expect(mock).not.toHaveBeenCalled();
    }
  });

  it('offers three ways forward and no tour', async () => {
    render(home([]));
    await settle();

    expect(screen.getByRole('button', { name: 'Import a spreadsheet' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add your first expense' })).toBeInTheDocument();
    const demo = screen.getByRole('link', { name: /18 months of sample data/ });
    expect(demo).toHaveAttribute('href', 'https://demo.sundry.cash');
    expect(demo).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('opens the importer inline rather than sending you somewhere else', async () => {
    render(home([]));
    await settle();

    expect(screen.queryByLabelText(/Select Excel File/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Import a spreadsheet' }));
    expect(screen.getByLabelText(/Select Excel File/)).toBeInTheDocument();
  });

  it('hands the Add action back to the shell', async () => {
    render(home([]));
    await settle();

    fireEvent.click(screen.getByRole('button', { name: 'Add your first expense' }));
    expect(onAddExpense).toHaveBeenCalled();
  });

  it('offers no in-app seeding', async () => {
    // `backend/src/scripts/seed.ts` refuses unless DB_PATH is set explicitly, is
    // not the real ledger, and the ledger is empty. That guard protects a real
    // ledger and a button would have to weaken it (§5).
    render(home([]));
    await settle();

    expect(screen.queryByRole('button', { name: /sample data|seed|demo/i })).not.toBeInTheDocument();
  });
});

describe('Home — type hierarchy', () => {
  it('gives the claim and the headline their own rank, and the section label a quieter one', async () => {
    // The classes, not the pixels: the CSS is not under test, the ranking is. A
    // finding sentence measured 14.72px/400 — the only text on the screen with
    // neither weight nor colour of its own (F6, change 26).
    loadEverything();
    summaryMock.mockResolvedValue(summary([finding.weekendSkew()]));

    render(home());
    await settle();

    expect(headline()).toHaveClass('headline');
    const claim = section('When you spend').querySelector('.finding')!;
    expect(claim).toBeInTheDocument();
    // The section's own name sits under its claim, not above it.
    expect(claim.compareDocumentPosition(section('When you spend').querySelector('h2')!) & Node.DOCUMENT_POSITION_FOLLOWING)
      .toBeTruthy();
  });
});
