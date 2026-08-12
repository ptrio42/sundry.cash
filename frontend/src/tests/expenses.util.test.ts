/**
 * Tests for `utils/expenses.ts` — what the Expenses screen works out before it
 * renders anything.
 *
 * Every function here takes "today" as an argument rather than reading a clock,
 * which is what makes these cases fixed dates instead of arithmetic performed
 * twice. The window functions are the ones worth pinning: a window measured over
 * the whole of a month that is eleven days old is the defect wave 2 shipped, and
 * a preset labelled "30 days" that covers 31 is F2.
 *
 * Labels are asserted through bucket keys, not through rendered dates: those go
 * through `Intl` with no locale, so the string depends on the host.
 */

import { describe, it, expect } from 'vitest';
import {
  EMPTY_QUERY,
  LedgerQuery,
  categoryTotals,
  describeLedgerWindow,
  filterExpenses,
  grainFor,
  grainForWindow,
  isEmptyQuery,
  measureWindow,
  presetRange,
  queryBounds,
  sortExpenses,
  spendOverTime,
  summarise
} from '../utils/expenses';
import { windowDays } from '../utils/home';
import { TEST_CATEGORIES } from './categories.fixture';
import { Expense, FxRates } from '../types/expense.types';

const TODAY = '2026-08-11';

// 1 PLN = 0.25 USD, i.e. 1 USD = 4 PLN.
const rates: FxRates = { USD: 1, PLN: 0.25, BTC: 65000 };
const inPLN = { display: 'PLN', rates };

const LEDGER: Expense[] = [
  { id: 1, date: '2026-08-11', description: 'Corner shop', category: 'groceries', currency: 'USD', amount: 25 },
  { id: 2, date: '2026-08-06', description: 'Weekly shop', category: 'groceries', currency: 'PLN', amount: 400 },
  { id: 3, date: '2026-05-03', description: 'Train fare', category: 'transport', currency: 'PLN', amount: 60 },
  { id: 4, date: '2025-07-07', description: 'Netflix', category: 'media', currency: 'PLN', amount: 30 },
];

const query = (changes: Partial<LedgerQuery> = {}): LedgerQuery => ({ ...EMPTY_QUERY, ...changes });

describe('presetRange', () => {
  it('covers thirty days, both ends included, under "Last 30 days"', () => {
    const range = presetRange('30d', TODAY);

    expect(range).toEqual({ start: '2026-07-13', end: '2026-08-11' });
    // The old `setMonth(now.getMonth() - 1)` produced 31 days under this label.
    expect(windowDays(range!)).toBe(30);
  });

  it('runs "This month" from the first to today, not to the end of the month', () => {
    expect(presetRange('month', TODAY)).toEqual({ start: '2026-08-01', end: '2026-08-11' });
  });

  it('goes back a whole twelve months, not 365 days', () => {
    expect(presetRange('12m', TODAY)).toEqual({ start: '2025-08-11', end: '2026-08-11' });
  });

  it('has no dates for "All time" or for an unfilled "Custom"', () => {
    expect(presetRange('all', TODAY)).toBeNull();
    expect(presetRange('custom', TODAY)).toBeNull();
    expect(queryBounds(query(), TODAY)).toEqual({ start: '', end: '' });
  });
});

describe('filterExpenses', () => {
  it('shows the whole ledger for the query the screen arrives with', () => {
    expect(filterExpenses(LEDGER, EMPTY_QUERY, TEST_CATEGORIES, TODAY)).toHaveLength(4);
    expect(isEmptyQuery(EMPTY_QUERY)).toBe(true);
  });

  it('reads an empty category selection as every category, never as none', () => {
    // Analytics stored the *exclusions* because all eleven boxes started ticked.
    // Here nothing is ticked and the ledger is whole, which is the same rule
    // stated the way round that costs no setup.
    expect(filterExpenses(LEDGER, query({ categories: [] }), TEST_CATEGORIES, TODAY)).toHaveLength(4);
    expect(filterExpenses(LEDGER, query({ categories: ['transport'] }), TEST_CATEGORIES, TODAY))
      .toEqual([LEDGER[2]]);
    expect(filterExpenses(LEDGER, query({ categories: ['transport', 'media'] }), TEST_CATEGORIES, TODAY))
      .toHaveLength(2);
  });

  it('filters by currency and by either end of a range, independently', () => {
    expect(filterExpenses(LEDGER, query({ currency: 'USD' }), TEST_CATEGORIES, TODAY)).toEqual([LEDGER[0]]);
    expect(filterExpenses(LEDGER, query({ range: '30d' }), TEST_CATEGORIES, TODAY)).toHaveLength(2);
    expect(
      filterExpenses(LEDGER, query({ range: 'custom', customStart: '2026-01-01' }), TEST_CATEGORIES, TODAY)
    ).toHaveLength(3);
    expect(
      filterExpenses(LEDGER, query({ range: 'custom', customEnd: '2026-01-01' }), TEST_CATEGORIES, TODAY)
    ).toHaveLength(1);
  });

  it('searches the description, the slug, the label and the amount', () => {
    const find = (search: string) =>
      filterExpenses(LEDGER, query({ search }), TEST_CATEGORIES, TODAY).map(row => row.description);

    expect(find('netflix')).toEqual(['Netflix']);
    expect(find('transport')).toEqual(['Train fare']);   // the slug
    expect(find('Groceries')).toEqual(['Corner shop', 'Weekly shop']); // the label
    expect(find('400')).toEqual(['Weekly shop']);        // the amount as typed
  });
});

describe('sortExpenses', () => {
  it('orders by the category label the row is showing, not by the slug', () => {
    const sorted = sortExpenses(LEDGER, 'category', 'asc', TEST_CATEGORIES);

    expect(sorted.map(row => row.category)).toEqual(['groceries', 'groceries', 'media', 'transport']);
  });

  it('leaves the input alone', () => {
    const before = LEDGER.map(row => row.id);
    sortExpenses(LEDGER, 'amount', 'desc', TEST_CATEGORIES);

    expect(LEDGER.map(row => row.id)).toEqual(before);
  });
});

describe('measureWindow', () => {
  it('takes the window from the filter when the filter named both ends', () => {
    const window = measureWindow({ start: '2026-07-13', end: '2026-08-11' }, LEDGER, TODAY);

    expect(window).toMatchObject({ range: { start: '2026-07-13', end: '2026-08-11' }, days: 30, derived: false });
  });

  it('measures a calendar month over the part of it that has happened', () => {
    // The whole of August is 31 days; on the 11th, eleven of them have been
    // lived. Dividing by 31 understates the daily rate by two thirds.
    const window = measureWindow({ start: '2026-08-01', end: '2026-08-31' }, LEDGER, TODAY);

    expect(windowDays(window!.range)).toBe(31);
    expect(window!.days).toBe(11);
  });

  it('takes the window from the data when the filter named no dates', () => {
    const window = measureWindow({ start: '', end: '' }, LEDGER, TODAY);

    expect(window).toMatchObject({ range: { start: '2025-07-07', end: '2026-08-11' }, derived: true });
  });

  it('has no window to state when nothing is selected and nothing is filtered', () => {
    expect(measureWindow({ start: '', end: '' }, [], TODAY)).toBeNull();
    // A range typed back to front is not a window either.
    expect(measureWindow({ start: '2026-08-11', end: '2026-08-01' }, LEDGER, TODAY)).toBeNull();
  });
});

describe('describeLedgerWindow', () => {
  it('says "so far" exactly when the range runs past today', () => {
    const future = measureWindow({ start: '2026-08-01', end: '2026-08-31' }, LEDGER, TODAY);
    const past = measureWindow({ start: '2026-07-13', end: '2026-08-11' }, LEDGER, TODAY);

    expect(describeLedgerWindow('This month', future)).toMatch(/11 days so far/);
    expect(describeLedgerWindow('Last 30 days', past)).toMatch(/30 days$/);
    expect(describeLedgerWindow('Last 30 days', past)).not.toMatch(/so far/);
  });

  it('does not report one day as "1 days"', () => {
    const oneDay = measureWindow({ start: TODAY, end: TODAY }, LEDGER, TODAY);

    expect(describeLedgerWindow('Custom', oneDay)).toMatch(/1 day$/);
  });

  it('falls back to the label alone when there is no window', () => {
    expect(describeLedgerWindow('All time', null)).toBe('All time');
  });
});

describe('summarise', () => {
  const window = measureWindow({ start: '', end: '' }, LEDGER, TODAY);

  it('converts each per-currency subtotal once and then adds, and keeps both', () => {
    const summary = summarise(LEDGER, inPLN, window);

    // 490 PLN native + 25 USD at 4 PLN = 590 PLN.
    expect(summary.total).toBeCloseTo(590);
    expect(summary.count).toBe(4);
    expect(summary.natives).toEqual([
      { currency: 'PLN', total: 490, count: 3 },
      { currency: 'USD', total: 25, count: 1 },
    ]);
  });

  it('finds the largest across currencies, by what it is worth', () => {
    const summary = summarise(LEDGER, inPLN, window);

    // 400 PLN beats 25 USD (100 PLN) — comparing the raw numbers would too, so
    // check the case where it does not.
    expect(summary.largest).toMatchObject({ description: 'Weekly shop' });
    expect(summarise(
      [
        { id: 9, date: TODAY, description: 'Flight', category: 'other', currency: 'USD', amount: 200 },
        { id: 10, date: TODAY, description: 'Shopping', category: 'other', currency: 'PLN', amount: 300 },
      ],
      inPLN,
      window
    ).largest).toMatchObject({ description: 'Flight', amount: 800 });
  });

  it('divides by the elapsed days, and by nothing at all when there is no window', () => {
    const month = measureWindow({ start: '2026-08-01', end: '2026-08-31' }, LEDGER, TODAY);
    const august = LEDGER.filter(row => row.date >= '2026-08-01');

    // 400 PLN + 25 USD = 500 PLN over the eleven days that have happened.
    expect(summarise(august, inPLN, month).perDay).toBeCloseTo(500 / 11);
    expect(summarise(august, inPLN, null).perDay).toBe(0);
  });

  it('reports nothing rather than zero for an empty selection', () => {
    const summary = summarise([], inPLN, window);

    expect(summary).toMatchObject({ total: 0, count: 0, largest: null, natives: [] });
  });
});

describe('grainFor', () => {
  it('keeps the bar count readable at both ends', () => {
    expect(grainFor(7)).toBe('day');
    expect(grainFor(45)).toBe('day');
    expect(grainFor(46)).toBe('week');
    expect(grainFor(210)).toBe('week');
    expect(grainFor(211)).toBe('month');
    expect(grainFor(3650)).toBe('month');
  });

  it('slices a window by its calendar length, not by the part that has elapsed', () => {
    // A window running to the end of the year has eleven elapsed days and 153
    // calendar ones. `spendOverTime` seeds a bucket for every slice of the full
    // range, so choosing the grain from the elapsed count would draw 153 daily
    // bars — 142 of them empty — under a caption saying "by day".
    const window = measureWindow({ start: '2026-08-01', end: '2026-12-31' }, LEDGER, TODAY);

    expect(window!.days).toBe(11);
    expect(grainForWindow(window)).toBe('week');
    expect(spendOverTime([], inPLN, window, grainForWindow(window))).toHaveLength(22);
  });

  it('has no grain to choose without a window', () => {
    expect(grainForWindow(null)).toBe('day');
  });
});

describe('spendOverTime', () => {
  const rows: Expense[] = [
    { id: 1, date: '2026-08-01', description: 'a', category: 'other', currency: 'PLN', amount: 10 },
    { id: 2, date: '2026-08-01', description: 'b', category: 'other', currency: 'USD', amount: 5 },
    { id: 3, date: '2026-08-04', description: 'c', category: 'other', currency: 'PLN', amount: 7 },
  ];

  it('keeps the days nothing was spent on', () => {
    const buckets = spendOverTime(rows, inPLN, { range: { start: '2026-08-01', end: '2026-08-05' }, days: 5, derived: false }, 'day');

    expect(buckets.map(b => b.key)).toEqual(['2026-08-01', '2026-08-02', '2026-08-03', '2026-08-04', '2026-08-05']);
    // 10 PLN + 5 USD at 4 PLN.
    expect(buckets[0].total).toBeCloseTo(30);
    expect(buckets[1].total).toBe(0);
    expect(buckets[3].total).toBeCloseTo(7);
  });

  it('anchors weeks on the window it was given, not on a Monday', () => {
    const window = { range: { start: '2026-01-01', end: '2026-01-21' }, days: 21, derived: false };
    const weekly = spendOverTime(
      [{ id: 1, date: '2026-01-09', description: 'a', category: 'other', currency: 'PLN', amount: 12 }],
      inPLN,
      window,
      'week'
    );

    expect(weekly.map(b => b.key)).toEqual(['2026-01-01', '2026-01-08', '2026-01-15']);
    expect(weekly[1].total).toBeCloseTo(12);
  });

  it('walks whole months, including the ones with nothing in them', () => {
    const monthly = spendOverTime(
      [{ id: 1, date: '2026-03-02', description: 'a', category: 'other', currency: 'PLN', amount: 9 }],
      inPLN,
      { range: { start: '2026-01-15', end: '2026-03-02' }, days: 47, derived: false },
      'month'
    );

    expect(monthly.map(b => b.key)).toEqual(['2026-01', '2026-02', '2026-03']);
    expect(monthly.map(b => b.total)).toEqual([0, 0, 9]);
  });

  it('draws nothing when there is no window to draw over', () => {
    expect(spendOverTime(rows, inPLN, null, 'day')).toEqual([]);
  });
});

describe('categoryTotals', () => {
  it('collapses one category held in two currencies into one row', () => {
    const totals = categoryTotals(LEDGER, inPLN);

    expect(totals.map(row => row.category)).toEqual(['groceries', 'transport', 'media']);
    // 400 PLN + 25 USD at 4 PLN, over two expenses.
    expect(totals[0]).toMatchObject({ total: 500, count: 2, average: 250 });
    expect(totals.reduce((sum, row) => sum + row.share, 0)).toBeCloseTo(1);
  });

  it('has no shares to report over an empty selection', () => {
    expect(categoryTotals([], inPLN)).toEqual([]);
  });
});
