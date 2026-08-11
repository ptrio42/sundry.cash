/**
 * Insights model — the "what changed?" layer.
 *
 * Two analyses, both deterministic SQL + JS (no LLM, no network, no new tables):
 *   - `getComparison`  period-over-period spend per category
 *   - `getRecurring`   repeating charges — the forgotten-subscription report
 *
 * Currency discipline follows the rest of the model layer: aggregates always keep
 * the `currency` dimension, because minor units differ per currency (cents vs
 * satoshis) and summing across them produces a number that means nothing.
 * Amounts leave here in major units; `toMajorUnits` is applied once, at the end.
 */

import { db } from '../config/database';
import { toMajorUnits } from '../config/money';
import { Currency, ExpenseCategory } from '../types/expense.types';

export type ComparisonWindow = 'rolling' | 'calendar';
export type ComparisonPeriod = 'week' | 'month' | 'year';
export type Cadence = 'weekly' | 'monthly' | 'quarterly' | 'yearly';
export type AmountStability = 'stable' | 'variable';

export interface DateRange {
  start: string; // inclusive, YYYY-MM-DD
  end: string;   // inclusive, YYYY-MM-DD
}

export interface CategoryComparison {
  category: ExpenseCategory;
  currency: Currency;
  current: number;
  previous: number;
  delta: number;
  deltaPct: number | null; // null when there is no previous spend to divide by
  currentCount: number;
  previousCount: number;
  isNew: boolean;
}

export interface ComparisonResult {
  window: ComparisonWindow;
  period: ComparisonPeriod;
  current: DateRange;
  previous: DateRange;
  byCategory: CategoryComparison[];
}

export interface RecurringCharge {
  label: string;
  currency: Currency;
  cadence: Cadence;
  medianAmount: number;
  monthlyCost: number;
  totalPaid: number;
  occurrences: number;
  firstSeen: string;
  lastSeen: string;
  amountStability: AmountStability;
  likelyCancelled: boolean;
}

// ---------------------------------------------------------------------------
// Date helpers
//
// Expense dates are calendar dates (YYYY-MM-DD), not instants. Every conversion
// below goes through Date.UTC / getUTC*, so window boundaries do not shift for
// a user west of UTC — the same bug `isValidDate` in middleware/validation.ts
// already had to fix.
// ---------------------------------------------------------------------------

const MS_PER_DAY = 86_400_000;

function toUTC(iso: string): number {
  const [year, month, day] = iso.split('-').map(Number);
  return Date.UTC(year, month - 1, day);
}

function toISO(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function addDays(iso: string, days: number): string {
  return toISO(toUTC(iso) + days * MS_PER_DAY);
}

/** Whole days from `from` to `to` (negative when `to` is earlier). */
function diffDays(from: string, to: string): number {
  return Math.round((toUTC(to) - toUTC(from)) / MS_PER_DAY);
}

/** Add whole months, clamping the day to the target month's length (Mar 31 - 1 => Feb 28/29). */
function addMonths(iso: string, months: number): string {
  const [year, month, day] = iso.split('-').map(Number);
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const targetYear = target.getUTCFullYear();
  const targetMonth = target.getUTCMonth();
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  return toISO(Date.UTC(targetYear, targetMonth, Math.min(day, lastDay)));
}

/**
 * Today as a local calendar date.
 *
 * Deliberately local rather than UTC: an expense dated "today" is entered against
 * the wall clock the user is looking at, so the default anchor has to agree with it.
 */
export function todayISO(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------

/**
 * Length of a rolling window in days. Fixed counts, not calendar arithmetic:
 * the whole point of `rolling` is that both windows are exactly the same length,
 * so a 31-day month never looks like a 3% rise over a 30-day one.
 */
const ROLLING_DAYS: Record<ComparisonPeriod, number> = { week: 7, month: 30, year: 365 };

/** The calendar period containing `anchor`. Weeks are ISO weeks (Monday-Sunday). */
function calendarCurrent(anchor: string, period: ComparisonPeriod): DateRange {
  const [year, month, day] = anchor.split('-').map(Number);

  if (period === 'year') {
    // Padded to four digits like every other branch (which gets it from
    // toISOString): `date` is a TEXT column compared lexicographically, so a
    // bare "999-01-01" would sort *after* 2026 and swallow the whole ledger.
    const padded = String(year).padStart(4, '0');
    return { start: `${padded}-01-01`, end: `${padded}-12-31` };
  }

  if (period === 'month') {
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return { start: toISO(Date.UTC(year, month - 1, 1)), end: toISO(Date.UTC(year, month - 1, lastDay)) };
  }

  // getUTCDay() is 0 for Sunday; shift so Monday is 0.
  const daysSinceMonday = (new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7;
  const start = addDays(anchor, -daysSinceMonday);
  return { start, end: addDays(start, 6) };
}

/**
 * Both windows for a request. `previous` always ends the day before `current`
 * starts, which is what lets one SQL pass split the rows on `date >= curStart`.
 */
function windowsFor(window: ComparisonWindow, period: ComparisonPeriod, anchor: string): { current: DateRange; previous: DateRange } {
  if (window === 'calendar') {
    const current = calendarCurrent(anchor, period);
    const previousEnd = addDays(current.start, -1);
    const previousStart =
      period === 'week' ? addDays(current.start, -7)
        : period === 'month' ? addMonths(current.start, -1)
          : addMonths(current.start, -12);
    return { current, previous: { start: previousStart, end: previousEnd } };
  }

  // Rolling: the N days ending at the anchor, against the N days before those.
  const days = ROLLING_DAYS[period];
  const current = { start: addDays(anchor, -(days - 1)), end: anchor };
  return {
    current,
    previous: { start: addDays(current.start, -days), end: addDays(current.start, -1) }
  };
}

interface ComparisonRow {
  category: ExpenseCategory;
  currency: Currency;
  current_minor: number;
  previous_minor: number;
  current_count: number;
  previous_count: number;
}

/** Round to one decimal, normalising -0 so the value survives a strict equality check. */
function round1(value: number): number {
  const rounded = Math.round(value * 10) / 10;
  return rounded === 0 ? 0 : rounded;
}

export function getComparison(params: {
  window?: ComparisonWindow;
  period?: ComparisonPeriod;
  anchor?: string;
  currency?: Currency;
} = {}): ComparisonResult {
  const window = params.window ?? 'rolling';
  const period = params.period ?? 'month';
  const anchor = params.anchor ?? todayISO();
  const { current, previous } = windowsFor(window, period, anchor);

  // One pass over both windows: the CASE split is cheaper than two queries and
  // guarantees a category that appears in only one window still emits a row,
  // with a zero on the missing side.
  const rows = db.prepare(`
    SELECT
      category,
      currency,
      SUM(CASE WHEN date >= @curStart THEN amount ELSE 0 END) AS current_minor,
      SUM(CASE WHEN date <  @curStart THEN amount ELSE 0 END) AS previous_minor,
      SUM(CASE WHEN date >= @curStart THEN 1 ELSE 0 END)      AS current_count,
      SUM(CASE WHEN date <  @curStart THEN 1 ELSE 0 END)      AS previous_count
    FROM expenses
    WHERE date >= @prevStart AND date <= @curEnd
      ${params.currency ? 'AND currency = @currency' : ''}
    GROUP BY category, currency
  `).all({
    curStart: current.start,
    curEnd: current.end,
    prevStart: previous.start,
    // better-sqlite3 rejects named parameters the statement does not declare,
    // so this key only exists when the filter is part of the SQL above.
    ...(params.currency ? { currency: params.currency } : {})
  }) as ComparisonRow[];

  const byCategory = rows.map(row => {
    const currency = row.currency;
    const deltaMinor = row.current_minor - row.previous_minor;

    return {
      category: row.category,
      currency,
      current: toMajorUnits(row.current_minor, currency),
      previous: toMajorUnits(row.previous_minor, currency),
      delta: toMajorUnits(deltaMinor, currency),
      // The ratio is scale-free, so it is taken in minor units where the
      // operands are exact integers. No previous spend means no denominator:
      // null rather than Infinity, with `isNew` carrying the actual meaning.
      deltaPct: row.previous_minor === 0 ? null : round1((deltaMinor / row.previous_minor) * 100),
      currentCount: row.current_count,
      previousCount: row.previous_count,
      isNew: row.previous_minor === 0 && row.current_minor > 0
    };
  });

  // Currency first, so magnitudes are only ever ranked against comparable ones;
  // biggest mover first within a currency. Ordering only — nothing is summed.
  byCategory.sort((a, b) =>
    a.currency.localeCompare(b.currency) ||
    Math.abs(b.delta) - Math.abs(a.delta) ||
    a.category.localeCompare(b.category)
  );

  return { window, period, current, previous, byCategory };
}

// ---------------------------------------------------------------------------
// Recurring charges
// ---------------------------------------------------------------------------

/**
 * Gap bands that count as a schedule. A median gap outside all of them means the
 * charge is frequent, not recurring — a daily coffee is not a subscription.
 */
const CADENCE_BANDS: Array<{ cadence: Cadence; min: number; max: number }> = [
  { cadence: 'weekly', min: 6, max: 8 },
  { cadence: 'monthly', min: 27, max: 34 },
  { cadence: 'quarterly', min: 88, max: 95 },
  { cadence: 'yearly', min: 360, max: 370 }
];

const DAYS_PER_MONTH = 30.44;      // mean Gregorian month — normalises any cadence to a monthly cost
const AMOUNT_TOLERANCE = 0.15;     // within +/-15% of the median => "stable"
const CANCELLED_AFTER_CYCLES = 1.8; // a whole cycle missed, plus slack for late billing

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function classifyCadence(medianGap: number): Cadence | null {
  const band = CADENCE_BANDS.find(candidate => medianGap >= candidate.min && medianGap <= candidate.max);
  return band ? band.cadence : null;
}

interface RecurringRow {
  key: string;
  currency: Currency;
  n: number;
  dates: string;
  amounts: string;
}

export function getRecurring(params: {
  since?: string;
  minOccurrences?: number;
  /** Injected so the "is it still running?" verdict is testable with fixed fixtures. */
  today?: string;
} = {}): RecurringCharge[] {
  const today = params.today ?? todayISO();
  const since = params.since ?? addMonths(today, -12);
  const minOccurrences = params.minOccurrences ?? 3;

  // Candidates in SQL, the analysis in JS: SQLite has no stddev, and better-sqlite3
  // is synchronous, so a JS pass over a handful of groups costs nothing.
  //
  // `lower_unicode` rather than LOWER(): the built-in folds ASCII only, so
  // 'żabka' and 'Żabka' would be two series, each possibly under the occurrence
  // threshold. Registered in config/database.ts.
  const rows = db.prepare(`
    SELECT
      lower_unicode(TRIM(description)) AS key,
      currency,
      COUNT(*)                 AS n,
      GROUP_CONCAT(date)       AS dates,
      GROUP_CONCAT(amount)     AS amounts
    FROM expenses
    WHERE date >= @since
    GROUP BY key, currency
    HAVING n >= @minOccurrences
  `).all({ since, minOccurrences }) as RecurringRow[];

  const recurring: RecurringCharge[] = [];

  for (const row of rows) {
    // SQLite does not guarantee GROUP_CONCAT ordering, and the two lists are not
    // assumed to be positionally paired: cadence reads only the dates, amount
    // stability and totals read only the amounts. Sorting each independently is
    // therefore safe. ISO dates sort lexicographically = chronologically.
    const dates = row.dates.split(',').sort();
    const amountsMinor = row.amounts.split(',').map(Number);

    const gaps: number[] = [];
    for (let i = 1; i < dates.length; i++) {
      gaps.push(diffDays(dates[i - 1], dates[i]));
    }
    if (gaps.length === 0) continue;

    const medianGap = median(gaps);
    const cadence = classifyCadence(medianGap);
    if (!cadence) continue;

    const currency = row.currency;
    const medianMinor = Math.round(median(amountsMinor));
    const totalMinor = amountsMinor.reduce((sum, amount) => sum + amount, 0);
    const isStable = amountsMinor.every(amount => Math.abs(amount - medianMinor) <= AMOUNT_TOLERANCE * medianMinor);
    const firstSeen = dates[0];
    const lastSeen = dates[dates.length - 1];

    recurring.push({
      label: row.key,
      currency,
      cadence,
      medianAmount: toMajorUnits(medianMinor, currency),
      // Scaled in minor units and rounded back to a whole one, so BTC keeps its
      // eight decimals instead of being flattened to cents.
      monthlyCost: toMajorUnits(Math.round(medianMinor * (DAYS_PER_MONTH / medianGap)), currency),
      totalPaid: toMajorUnits(totalMinor, currency),
      occurrences: row.n,
      firstSeen,
      lastSeen,
      amountStability: isStable ? 'stable' : 'variable',
      likelyCancelled: diffDays(lastSeen, today) > CANCELLED_AFTER_CYCLES * medianGap
    });
  }

  // Same rule as the comparison: group by currency, then most expensive first.
  recurring.sort((a, b) =>
    a.currency.localeCompare(b.currency) ||
    b.monthlyCost - a.monthlyCost ||
    a.label.localeCompare(b.label)
  );

  return recurring;
}
