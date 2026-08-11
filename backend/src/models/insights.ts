/**
 * Insights model — the "what changed?" layer.
 *
 * Four analyses, all deterministic SQL + JS (no LLM, no network):
 *   - `getComparison`  period-over-period spend per category
 *   - `getRecurring`   repeating charges — the forgotten-subscription report
 *   - `getMerchants`   where the money actually goes, small purchases included
 *   - `getPatterns`    when you spend, weekend against weekday
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

/** One merchant's spend inside the window, in a single currency. */
export interface MerchantTotal {
  key: string; // detected merchant, or the description when none was captured
  currency: Currency;
  total: number;
  count: number;
  average: number;
  firstSeen: string;
  lastSeen: string;
}

export interface MerchantsResult {
  since: string;
  until: string;
  /** Rows kept per currency, not in total — see `getMerchants`. */
  limit: number;
  /** True when `limit` cut any currency's list — the top N is not everything. */
  truncated: boolean;
  merchants: MerchantTotal[];
}

/** One day of the week inside the window, for a single currency. */
export interface WeekdayBucket {
  dow: number;   // 0 = Sunday .. 6 = Saturday, matching strftime('%w')
  days: number;  // how many days of this kind the window actually contains
  total: number;
  count: number;
  perDay: number;
}

export interface CurrencyPattern {
  currency: Currency;
  byWeekday: WeekdayBucket[]; // always seven entries, Sunday first
  weekdayPerDay: number;
  weekendPerDay: number;
  /** weekendPerDay / weekdayPerDay; null when one side has nothing to divide by. */
  weekendRatio: number | null;
}

export interface PatternsResult {
  since: string;
  until: string;
  days: number;
  byCurrency: CurrencyPattern[];
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

/** Day of the week, 0 = Sunday .. 6 = Saturday — the same numbering strftime('%w') uses. */
function dayOfWeek(iso: string): number {
  return new Date(toUTC(iso)).getUTCDay();
}

/**
 * How many of each weekday the inclusive window contains, Sunday first.
 *
 * The number that matters for `getPatterns`: an arbitrary window is not a whole
 * number of weeks, so dividing weekend spend by 2 and weekday spend by 5 would
 * be wrong for almost every window a user picks. Computed in closed form rather
 * than by walking the days, so a decade-long window costs the same as a week.
 */
function weekdayCounts(start: string, end: string): number[] {
  const total = diffDays(start, end) + 1;
  if (total <= 0) return [0, 0, 0, 0, 0, 0, 0];

  // Every weekday occurs at least floor(total / 7) times; the leftover days are
  // the first `total % 7` weekdays from the start of the window.
  const counts = new Array<number>(7).fill(Math.floor(total / 7));
  const firstDow = dayOfWeek(start);
  for (let i = 0; i < total % 7; i++) {
    counts[(firstDow + i) % 7]++;
  }
  return counts;
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

/** Round to `decimals` places, normalising -0 so the value survives a strict equality check. */
function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  const rounded = Math.round(value * factor) / factor;
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
      deltaPct: row.previous_minor === 0 ? null : round((deltaMinor / row.previous_minor) * 100, 1),
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

// ---------------------------------------------------------------------------
// Merchants and weekday patterns
// ---------------------------------------------------------------------------

/**
 * The window both reports below default to: the twelve months ending at
 * `until`. Derived from `until` rather than from today, so asking about an old
 * `until` without a `since` answers for the year before it instead of
 * inverting the window into nothing.
 */
function defaultWindow(params: { since?: string; until?: string; today?: string }): DateRange {
  const end = params.until ?? params.today ?? todayISO();
  return { start: params.since ?? addMonths(end, -12), end };
}

const DEFAULT_MERCHANT_LIMIT = 20;
export const MAX_MERCHANT_LIMIT = 100;

/**
 * The grouping key for a row: the merchant a scan detected, or the description
 * the user typed when there is none.
 *
 * Folded through `lower_unicode` on *both* branches, not just the description:
 * a receipt-sourced 'Żabka' and a hand-typed 'żabka' are the same shop, and
 * SQLite's built-in LOWER() folds ASCII only (see config/database.ts). NULLIF
 * makes an empty-string merchant behave like a missing one, so a scanner that
 * returns '' does not create a nameless group that swallows every such row.
 */
const MERCHANT_KEY = `lower_unicode(COALESCE(NULLIF(TRIM(merchant), ''), TRIM(description)))`;

interface MerchantRow {
  key: string;
  currency: Currency;
  total_minor: number;
  n: number;
  first_seen: string;
  last_seen: string;
}

/**
 * Where the money actually goes — including the spend that hides in small,
 * frequent, individually unremarkable purchases.
 */
export function getMerchants(params: {
  since?: string;
  until?: string;
  currency?: Currency;
  limit?: number;
  /** Injected so the default window is testable with fixed fixtures. */
  today?: string;
} = {}): MerchantsResult {
  const { start: since, end: until } = defaultWindow(params);
  const limit = Math.min(Math.max(Math.trunc(params.limit ?? DEFAULT_MERCHANT_LIMIT), 1), MAX_MERCHANT_LIMIT);

  // Ordered currency first, exactly like `getComparison` and `getRecurring`:
  // `total_minor` is a count of that currency's own minor units, so ranking
  // across currencies would be comparing satoshis with grosze. That is not a
  // cosmetic complaint once a limit is involved — 0.0002 BTC is 20 000
  // satoshis and outranks 100 zł, so a flat top-20 on the shipped default set
  // (USD, PLN, BTC) can push a whole currency out of the report.
  const rows = db.prepare(`
    SELECT
      ${MERCHANT_KEY} AS key,
      currency,
      SUM(amount) AS total_minor,
      COUNT(*)    AS n,
      MIN(date)   AS first_seen,
      MAX(date)   AS last_seen
    FROM expenses
    WHERE date >= @since AND date <= @until
      ${params.currency ? 'AND currency = @currency' : ''}
    GROUP BY key, currency
    ORDER BY currency ASC, total_minor DESC, key ASC
  `).all({
    since,
    until,
    // better-sqlite3 rejects parameters the statement does not declare, so this
    // key only exists when the filter is part of the SQL above.
    ...(params.currency ? { currency: params.currency } : {})
  }) as MerchantRow[];

  // `limit` therefore means "top N per currency", the only reading under which
  // a limit and the currency dimension can both survive. Applied in JS rather
  // than as a SQL LIMIT for the reason `getRecurring` gives: one row per
  // merchant per currency over a year is a handful of rows for a single-user
  // ledger, and better-sqlite3 is synchronous, so the pass is free.
  const perCurrency = new Map<Currency, MerchantRow[]>();
  for (const row of rows) {
    const group = perCurrency.get(row.currency) ?? [];
    group.push(row);
    perCurrency.set(row.currency, group);
  }

  let truncated = false;
  const kept: MerchantRow[] = [];
  for (const group of perCurrency.values()) {
    if (group.length > limit) truncated = true;
    kept.push(...group.slice(0, limit));
  }

  return {
    since,
    until,
    limit,
    truncated,
    merchants: kept.map(row => ({
      key: row.key,
      currency: row.currency,
      total: toMajorUnits(row.total_minor, row.currency),
      count: row.n,
      // Averaged in minor units and rounded back to a whole one, so the figure
      // never implies more precision than the column can hold.
      average: toMajorUnits(Math.round(row.total_minor / row.n), row.currency),
      firstSeen: row.first_seen,
      lastSeen: row.last_seen
    }))
  };
}

interface PatternRow {
  dow: number;
  currency: Currency;
  total_minor: number;
  n: number;
}

/** Saturday and Sunday, in strftime('%w') numbering. */
const WEEKEND_DOWS = [0, 6];

/**
 * When you spend, rather than what on.
 *
 * The whole finding lives or dies on one detail: totals are compared **per
 * day**, never as totals. A week holds five weekdays and two weekend days, so
 * on a perfectly even spread the weekday total wins 5:2 and the "insight" would
 * be arithmetic, not behaviour. Each side is therefore divided by how many days
 * of that kind the window actually contains — see `weekdayCounts`.
 */
export function getPatterns(params: {
  since?: string;
  until?: string;
  currency?: Currency;
  /** Injected so the default window is testable with fixed fixtures. */
  today?: string;
} = {}): PatternsResult {
  const { start: since, end: until } = defaultWindow(params);

  const rows = db.prepare(`
    SELECT
      CAST(strftime('%w', date) AS INTEGER) AS dow,
      currency,
      SUM(amount) AS total_minor,
      COUNT(*)    AS n
    FROM expenses
    WHERE date >= @since AND date <= @until
      ${params.currency ? 'AND currency = @currency' : ''}
    GROUP BY dow, currency
  `).all({
    since,
    until,
    ...(params.currency ? { currency: params.currency } : {})
  }) as PatternRow[];

  const days = weekdayCounts(since, until);
  const totalDays = days.reduce((sum, count) => sum + count, 0);

  // Seven buckets per currency, zeros included: a day with no spending is part
  // of the pattern, and the caller should not have to guess which index is missing.
  const byCurrency = new Map<Currency, { totalMinor: number[]; counts: number[] }>();
  for (const row of rows) {
    const bucket = byCurrency.get(row.currency)
      ?? { totalMinor: new Array<number>(7).fill(0), counts: new Array<number>(7).fill(0) };
    bucket.totalMinor[row.dow] = row.total_minor;
    bucket.counts[row.dow] = row.n;
    byCurrency.set(row.currency, bucket);
  }

  const patterns = Array.from(byCurrency.entries()).map(([currency, bucket]) => {
    const perDay = (minor: number, dayCount: number) =>
      dayCount === 0 ? 0 : toMajorUnits(Math.round(minor / dayCount), currency);

    const sumOver = (dows: number[]) => dows.reduce(
      (acc, dow) => ({ minor: acc.minor + bucket.totalMinor[dow], days: acc.days + days[dow] }),
      { minor: 0, days: 0 }
    );

    const weekend = sumOver(WEEKEND_DOWS);
    const weekday = sumOver([1, 2, 3, 4, 5]);
    const weekendPerDay = perDay(weekend.minor, weekend.days);
    const weekdayPerDay = perDay(weekday.minor, weekday.days);

    return {
      currency,
      byWeekday: bucket.totalMinor.map((minor, dow) => ({
        dow,
        days: days[dow],
        total: toMajorUnits(minor, currency),
        count: bucket.counts[dow],
        perDay: perDay(minor, days[dow])
      })),
      weekdayPerDay,
      weekendPerDay,
      // Null rather than 0 or Infinity when the comparison cannot be made: a
      // window containing no weekend, or no weekday spend to divide by, has no
      // ratio — the same rule `deltaPct` follows for a missing denominator.
      weekendRatio: weekend.days === 0 || weekday.days === 0 || weekdayPerDay === 0
        ? null
        : round(weekendPerDay / weekdayPerDay, 2)
    };
  });

  patterns.sort((a, b) => a.currency.localeCompare(b.currency));

  return { since, until, days: totalDays, byCurrency: patterns };
}
