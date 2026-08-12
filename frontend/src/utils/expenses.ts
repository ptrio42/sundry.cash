/**
 * Everything the Expenses screen works out before it renders anything.
 *
 * Expenses is the ledger **and** the query tool: change 4 in
 * `docs/ux-review-findings.md` folds Analytics into it, because querying belongs
 * where the rows are and the two screens ran two filter bars over one question
 * (F3, F8). One state drives the table, the summary row and both charts, so the
 * arithmetic that state feeds lives here rather than inside a component that
 * would then need a DOM to be tested.
 *
 * Four groups, in the order the screen uses them:
 *   1. the query   — the range presets, and filtering/sorting the ledger by them
 *   2. the window  — which dates the numbers cover, and how many days that is
 *   3. the summary — total, count, per day, largest, and the native subtotals
 *   4. the charts  — spend over time, and the category breakdown
 *
 * **Nothing here asks the server.** Analytics fetched `/expenses/stats/analytics`
 * for exactly these aggregates while the table filtered the same rows in the
 * browser, which is how two screens came to disagree. The whole ledger is
 * already in `App`, and the search box has no server-side equivalent at all — a
 * chart fetched from the API could never honour it. So the filtered set is
 * computed once, in one place, and everything on the screen is derived from it.
 *
 * The window arithmetic is **imported** from `utils/home.ts` rather than
 * repeated: two screens that disagree about how many days a window holds is the
 * defect class F1 and F2 are both instances of.
 */

import {
  Category,
  Currency,
  DateRange,
  Expense,
  FxRates,
  SortField,
  SortOrder
} from '../types/expense.types';
import { categoryLabel } from './categories';
import { DISPLAY_LOCALE, formatDate } from './format';
import { convertAmount } from './fx';
import { addMonths, elapsedDays, windowDates, windowDays } from './home';

const MS_PER_DAY = 86_400_000;

/** Parse `YYYY-MM-DD` as a calendar date, never an instant — as the backend does. */
function toUTC(iso: string): number {
  const [year, month, day] = iso.split('-').map(Number);
  return Date.UTC(year, month - 1, day);
}

/** Whole days from `from` to `to` (negative when `to` is earlier). */
function diffDays(from: string, to: string): number {
  return Math.round((toUTC(to) - toUTC(from)) / MS_PER_DAY);
}

/** `iso` moved by whole days, as a calendar date. */
function shiftDays(iso: string, days: number): string {
  return new Date(toUTC(iso) + days * MS_PER_DAY).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// 1. The query
// ---------------------------------------------------------------------------

export type RangeKey = 'all' | '30d' | 'month' | '12m' | 'custom';

export interface RangeOption {
  key: RangeKey;
  label: string;
}

/**
 * The date range control.
 *
 * `All time` leads and is the default, because **every filter on this screen
 * arrives neutral**: the ledger shows every row it has and the controls narrow
 * from there. That is the whole of change 4's "arrive answering, not
 * configuring" — Analytics opened with eleven category checkboxes all ticked,
 * the largest control on the screen doing nothing (F8), and a ledger that hid
 * five years of history behind a default window would be the same mistake in
 * the other direction.
 *
 * The three presets are the ones wave 0 fixed and Home already uses, spelled the
 * same way. `Last 30 days` means thirty days ending today — not
 * `setMonth(now.getMonth() - 1)`, which returned 31 days a third of them in the
 * current month while the label said 30 (F2). Any other window, including a
 * whole past calendar month, is reachable through `Custom`.
 */
export const RANGES: RangeOption[] = [
  { key: 'all', label: 'All time' },
  { key: '30d', label: 'Last 30 days' },
  { key: 'month', label: 'This month' },
  { key: '12m', label: 'Last 12 months' },
  { key: 'custom', label: 'Custom' }
];

/** What a preset covers, or null for the two keys that have no fixed dates. */
export function presetRange(key: RangeKey, today: string): DateRange | null {
  switch (key) {
    // Both ends are inclusive, so "the last N days" ends today and starts N−1
    // days back — 30 days, not 31.
    case '30d':
      return { start: shiftDays(today, -29), end: today };
    // The month so far. It ends today rather than on the 31st because only the
    // part of it that has happened can be measured: dividing August's spend by
    // 31 on the 11th understates the daily rate by two thirds.
    case 'month':
      return { start: `${today.slice(0, 7)}-01`, end: today };
    case '12m':
      return { start: addMonths(today, -12), end: today };
    default:
      return null;
  }
}

/** Everything the screen filters by. One object, so one state drives one derivation. */
export interface LedgerQuery {
  search: string;
  /** Selected category slugs. **Empty means every category**, never none. */
  categories: string[];
  currency: Currency | 'all';
  range: RangeKey;
  customStart: string;
  customEnd: string;
}

/**
 * The query the screen opens with: no search, no category, every currency, every
 * date. Also what `Clear` restores.
 */
export const EMPTY_QUERY: LedgerQuery = {
  search: '',
  categories: [],
  currency: 'all',
  range: 'all',
  customStart: '',
  customEnd: ''
};

/** True when the query still shows the whole ledger — what `Clear` undoes. */
export function isEmptyQuery(query: LedgerQuery): boolean {
  return query.search.trim() === ''
    && query.categories.length === 0
    && query.currency === 'all'
    && query.range === 'all';
}

/**
 * The dates the query filters on. An empty string is an open end, which is what
 * `All time` is on both sides and what a half-filled `Custom` is on one.
 */
export function queryBounds(query: LedgerQuery, today: string): { start: string; end: string } {
  if (query.range === 'custom') return { start: query.customStart, end: query.customEnd };
  const preset = presetRange(query.range, today);
  return preset ? { start: preset.start, end: preset.end } : { start: '', end: '' };
}

/**
 * The rows a query selects.
 *
 * The search matches the description, the category slug **and** its label: the
 * label is what the row shows, the slug is what a user who renamed a category
 * may still think in — and what an exported file holds.
 */
export function filterExpenses(
  expenses: Expense[],
  query: LedgerQuery,
  categories: Category[],
  today: string
): Expense[] {
  const bounds = queryBounds(query, today);
  const search = query.search.trim().toLowerCase();
  const wanted = new Set(query.categories);

  return expenses.filter(expense => {
    if (wanted.size > 0 && !wanted.has(expense.category)) return false;
    if (query.currency !== 'all' && expense.currency !== query.currency) return false;
    if (bounds.start && expense.date < bounds.start) return false;
    if (bounds.end && expense.date > bounds.end) return false;
    if (search) {
      const haystack = [
        expense.description,
        expense.category,
        categoryLabel(categories, expense.category),
        String(expense.amount)
      ];
      if (!haystack.some(value => value.toLowerCase().includes(search))) return false;
    }
    return true;
  });
}

/**
 * The rows in the order the table shows them — and therefore the order an
 * export writes them, which is why the screen owns the sort rather than the
 * table: `Export` sits in the toolbar now and "as currently filtered and
 * sorted" has to keep meaning that.
 *
 * Categories sort by the **label**, which is the column the user is reading —
 * not by the slug underneath it, which a rename would leave pointing elsewhere.
 */
export function sortExpenses(
  expenses: Expense[],
  field: SortField,
  order: SortOrder,
  categories: Category[]
): Expense[] {
  const compare = (a: Expense, b: Expense): number => {
    if (field === 'amount') return a.amount - b.amount;
    if (field === 'category') {
      return categoryLabel(categories, a.category).localeCompare(categoryLabel(categories, b.category));
    }
    return a.date.localeCompare(b.date);
  };

  return [...expenses].sort((a, b) => (order === 'asc' ? compare(a, b) : -compare(a, b)));
}

// ---------------------------------------------------------------------------
// 2. The window
// ---------------------------------------------------------------------------

/** The dates the numbers cover, and how much of them has actually happened. */
export interface LedgerWindow {
  range: DateRange;
  /** Days to divide by: the window, capped at the part of it that has elapsed. */
  days: number;
  /** True when the range came from the data rather than from the filter bar. */
  derived: boolean;
}

/**
 * Which window the summary is measuring over.
 *
 * With both ends filtered, that is the filter. With either end open — `All time`
 * is both — it is the span of the rows themselves, which is the only honest
 * answer to "per day of what?" for a query that named no dates.
 *
 * `days` is the **elapsed** length, not the calendar one. That distinction is
 * the defect wave 2 shipped and had to fix: a "This month" window measured 31
 * days when 11 had happened, so a figure divided by 31 sat under a headline
 * divided by 11.
 */
export function measureWindow(
  bounds: { start: string; end: string },
  rows: Expense[],
  today: string
): LedgerWindow | null {
  const dates = rows.map(row => row.date);
  const start = bounds.start || (dates.length > 0 ? dates.reduce((a, b) => (a < b ? a : b)) : '');
  const end = bounds.end || (dates.length > 0 ? dates.reduce((a, b) => (a > b ? a : b)) : '');

  if (!start || !end || end < start) return null;

  const range = { start, end };
  return {
    range,
    days: elapsedDays(range, today),
    derived: !bounds.start || !bounds.end
  };
}

/**
 * The window as one line under the filter bar — change 1, on the screen where
 * the window is the user's own choice: `Last 30 days · 13 Jul – 11 Aug 2026 · 30
 * days`.
 *
 * "so far" appears exactly when the range runs past today, so the day count and
 * the dates beside it can never look like they disagree.
 */
export function describeLedgerWindow(label: string, window: LedgerWindow | null): string {
  if (!window) return label;
  const length = windowDays(window.range);
  const days = `${window.days} ${window.days === 1 ? 'day' : 'days'}${window.days < length ? ' so far' : ''}`;
  return `${label} · ${windowDates(window.range)} · ${days}`;
}

// ---------------------------------------------------------------------------
// 3. The summary
// ---------------------------------------------------------------------------

/** How the screen turns a mixed-currency set into one number. */
export interface DisplayScope {
  /** The currency every combined figure is expressed in. */
  display: Currency;
  rates: FxRates;
}

/** An exact per-currency subtotal, in its own currency. */
export interface NativeTotal {
  currency: Currency;
  total: number;
  count: number;
}

export interface LedgerSummary {
  /** Converted into `display`. */
  total: number;
  /** The subtotals that made it, exact and unconverted. More than one means mixed. */
  natives: NativeTotal[];
  count: number;
  /** Converted, over the window's elapsed days. */
  perDay: number;
  /** The single biggest expense, its amount converted for the comparison. */
  largest: { amount: number; description: string; date: string; currency: Currency } | null;
}

/**
 * The summary row for the filtered set.
 *
 * Everything below a mixed-currency query has to be expressed in **one**
 * currency, and adding raw major units across currencies (100 USD + 1 BTC = 101)
 * was the behaviour Analytics shipped before wave 0, labelled "$" regardless of
 * the data. Per-currency subtotals are exact, so each is converted once and then
 * added — and each is also kept, because a converted total is an estimate at the
 * user's own rates and the exact numbers behind it are worth printing.
 */
export function summarise(rows: Expense[], scope: DisplayScope, window: LedgerWindow | null): LedgerSummary {
  const byCurrency = new Map<Currency, NativeTotal>();
  let largest: LedgerSummary['largest'] = null;

  for (const row of rows) {
    const native = byCurrency.get(row.currency) ?? { currency: row.currency, total: 0, count: 0 };
    native.total += row.amount;
    native.count += 1;
    byCurrency.set(row.currency, native);

    const converted = convertAmount(row.amount, row.currency, scope.display, scope.rates);
    if (!largest || converted > largest.amount) {
      largest = { amount: converted, description: row.description, date: row.date, currency: row.currency };
    }
  }

  const natives = Array.from(byCurrency.values()).map(native => ({
    native,
    converted: convertAmount(native.total, native.currency, scope.display, scope.rates)
  }));

  const total = natives.reduce((sum, entry) => sum + entry.converted, 0);
  const days = window?.days ?? 0;

  return {
    total,
    natives: natives
      .sort((a, b) => b.converted - a.converted || a.native.currency.localeCompare(b.native.currency))
      .map(entry => entry.native),
    count: rows.length,
    perDay: days > 0 ? total / days : 0,
    largest
  };
}

// ---------------------------------------------------------------------------
// 4. The charts
// ---------------------------------------------------------------------------

export type Grain = 'day' | 'week' | 'month';

/** Longest window still drawn one bar per day, and per week. */
const DAILY_UP_TO = 45;
const WEEKLY_UP_TO = 210;

/**
 * How finely to slice the window.
 *
 * A bar per day over a year is 365 bars in about 700 pixels, which is a texture
 * rather than a chart; a bar per month over three weeks is one bar. The
 * thresholds keep the count between roughly 4 and 45, and the chart states the
 * grain it chose so the reader is never left inferring it.
 */
export function grainFor(days: number): Grain {
  if (days <= DAILY_UP_TO) return 'day';
  if (days <= WEEKLY_UP_TO) return 'week';
  return 'month';
}

/**
 * The grain for a window, from the **calendar** length rather than the elapsed
 * one.
 *
 * `LedgerWindow.days` is the elapsed count, which is the right divisor for a
 * per-day figure and the wrong input here: `spendOverTime` seeds a bucket for
 * every slice of the full range, so a window running past today would be sliced
 * by a rule that only looked at the part before it. One future-dated row is
 * enough — the `All time` window then ends next year, three days have elapsed,
 * and the chart draws four hundred daily bars under a caption saying "by day".
 */
export function grainForWindow(window: LedgerWindow | null): Grain {
  return grainFor(window ? windowDays(window.range) : 0);
}

export interface TimeBucket {
  /** The bucket's first date, or `YYYY-MM` for a month. */
  key: string;
  label: string;
  total: number;
}

/** How a bucket is named on the axis. Months are short, so a year of them fits. */
function bucketLabel(key: string, grain: Grain): string {
  if (grain !== 'month') return formatDate(key);
  const date = new Date(`${key}-01T00:00:00Z`);
  if (isNaN(date.getTime())) return key;
  return new Intl.DateTimeFormat(DISPLAY_LOCALE, { month: 'short', year: '2-digit', timeZone: 'UTC' }).format(date);
}

/**
 * Spend over the window, one bucket per slice of it.
 *
 * **Empty buckets are kept.** A month nothing was spent in is a fact about the
 * data, and dropping it would draw a continuous line over a gap — the chart
 * would report a habit the ledger does not have.
 *
 * Weeks are counted from the window's own start rather than from a Monday or a
 * Sunday: the window is what the user chose, and anchoring the buckets to it
 * avoids a first and last column that are silently part-weeks for a reason that
 * has nothing to do with the question.
 */
export function spendOverTime(
  rows: Expense[],
  scope: DisplayScope,
  window: LedgerWindow | null,
  grain: Grain
): TimeBucket[] {
  if (!window) return [];

  const keyFor = (date: string): string => {
    if (grain === 'month') return date.slice(0, 7);
    if (grain === 'day') return date;
    return shiftDays(window.range.start, Math.floor(diffDays(window.range.start, date) / 7) * 7);
  };

  const totals = new Map<string, number>();

  // Every bucket the window covers, including the ones with nothing in them.
  if (grain === 'month') {
    let cursor = window.range.start.slice(0, 7);
    const last = window.range.end.slice(0, 7);
    while (cursor <= last) {
      totals.set(cursor, 0);
      cursor = addMonths(`${cursor}-01`, 1).slice(0, 7);
    }
  } else {
    const step = grain === 'day' ? 1 : 7;
    for (let day = 0; day <= diffDays(window.range.start, window.range.end); day += step) {
      totals.set(shiftDays(window.range.start, day), 0);
    }
  }

  for (const row of rows) {
    const key = keyFor(row.date);
    // A row outside the measured window has no bucket — it can only happen when
    // the user typed a range and the data runs past it, and inventing a bucket
    // for it would put a bar outside the window the chart says it covers.
    if (!totals.has(key)) continue;
    totals.set(key, totals.get(key)! + convertAmount(row.amount, row.currency, scope.display, scope.rates));
  }

  return Array.from(totals.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, total]) => ({ key, label: bucketLabel(key, grain), total }));
}

export interface CategoryTotal {
  category: string;
  total: number;
  count: number;
  average: number;
  /** 0..1 of the filtered set's total. */
  share: number;
}

/**
 * The category breakdown of the filtered set, biggest first.
 *
 * This is not Home's "Where it went" repeated: Home decomposes a window it chose
 * for you and shows the change against the window before it, this decomposes
 * whatever you just asked for. Same shape, different question — which is the
 * distinction ruling R4 draws between a standing answer and a query.
 */
export function categoryTotals(rows: Expense[], scope: DisplayScope): CategoryTotal[] {
  const byCategory = new Map<string, { total: number; count: number }>();

  for (const row of rows) {
    const previous = byCategory.get(row.category) ?? { total: 0, count: 0 };
    byCategory.set(row.category, {
      total: previous.total + convertAmount(row.amount, row.currency, scope.display, scope.rates),
      count: previous.count + 1
    });
  }

  const total = Array.from(byCategory.values()).reduce((sum, entry) => sum + entry.total, 0);

  return Array.from(byCategory.entries())
    .map(([category, entry]) => ({
      category,
      total: entry.total,
      count: entry.count,
      average: entry.count > 0 ? entry.total / entry.count : 0,
      share: total > 0 ? entry.total / total : 0
    }))
    .sort((a, b) => b.total - a.total || a.category.localeCompare(b.category));
}
