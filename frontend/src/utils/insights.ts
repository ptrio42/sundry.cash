/**
 * Currency scope for the Insights tab.
 *
 * The four data endpoints answer per currency, because their numbers are only
 * comparable inside one: a total in satoshis and a total in grosze cannot be
 * ranked against each other. The tab offers the Dashboard's choice — one native
 * currency, or everything converted into the primary one — and that conversion
 * happens here rather than on the server.
 *
 * This is deliberately unlike the summary strip, which *does* send its scope to
 * the backend. The strip ranks findings against one another, and ranking a PLN
 * finding against a USD one requires converting before scoring. The tab only
 * displays per-currency lists and totals, which is exactly what the Dashboard
 * already converts client-side.
 *
 * Every function takes rows in their native currencies and returns rows already
 * denominated in `displayCurrency(scope)`, so a component never has to ask which
 * currency a number in front of it is in.
 */

import {
  CategoryComparison,
  Currency,
  CurrencyPattern,
  FxRates,
  MerchantTotal,
  RecurringCharge,
  WeekdayBucket
} from '../types/expense.types';
import { convertAmount } from './fx';

/** What the tab is showing: one currency's own rows, or all of them combined. */
export interface Scope {
  /** A currency code, or 'primary' for the converted, combined view. */
  view: Currency | 'primary';
  primary: Currency;
  rates: FxRates;
}

/**
 * The two thresholds the summary scorer uses, mirrored here.
 *
 * The same numbers as `SCORING.MIN_DRIP_COUNT` and `SCORING.MIN_MATERIALITY` in
 * backend/src/models/insights.ts, duplicated for the same reason the insight
 * types are: nothing is shared across the package boundary. Two copies of one
 * threshold — keep them in step rather than inventing a second answer to the
 * same question.
 */
export const MIN_DRIP_COUNT = 5;   // fewer visits than this is not a pattern
export const MIN_MATERIALITY = 0.02; // under 2% of the window's spend, it does not matter

/**
 * How far `weekendRatio` has to sit from 1 before the difference is worth
 * mentioning. Inside this band the two halves of the week cost the same, and
 * saying so with two decimal places would be noise dressed as a finding.
 */
export const WEEKEND_FLAT = 0.1;

/** The currency every amount is in once a scope has been applied. */
export function displayCurrency(scope: Scope): Currency {
  return scope.view === 'primary' ? scope.primary : scope.view;
}

/** Round to `decimals` places, normalising -0 — mirrors the backend's `round`. */
function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  const rounded = Math.round(value * factor) / factor;
  return rounded === 0 ? 0 : rounded;
}

/**
 * `amount`, expressed in the scope's display currency.
 *
 * Only called on the combined path; the native path never converts, so a view
 * of one currency shows the server's own arithmetic untouched.
 */
function into(amount: number, from: Currency, scope: Scope): number {
  return convertAmount(amount, from, scope.primary, scope.rates);
}

/**
 * Subscriptions in scope, most expensive per month first.
 *
 * Nothing is merged across currencies: two charges are two charges even when
 * they happen to share a label, and a Netflix billed in USD and one billed in
 * PLN are not one subscription.
 */
export function scopeRecurring(rows: RecurringCharge[], scope: Scope): RecurringCharge[] {
  const scoped = scope.view === 'primary'
    ? rows.map(row => ({
      ...row,
      currency: scope.primary,
      medianAmount: into(row.medianAmount, row.currency, scope),
      monthlyCost: into(row.monthlyCost, row.currency, scope),
      totalPaid: into(row.totalPaid, row.currency, scope)
    }))
    : rows.filter(row => row.currency === scope.view);

  return [...scoped].sort((a, b) => b.monthlyCost - a.monthlyCost || a.label.localeCompare(b.label));
}

/**
 * Merchants in scope, biggest total first.
 *
 * The combined view folds the same key together across currencies — one shop
 * paid for in two currencies is still one shop — and re-ranks what is left.
 * That ranking is only as complete as the rows the server sent: `limit` is a
 * top-N *per currency*, so a merchant cut there cannot reappear here. The
 * caller is expected to say so when `truncated` comes back true.
 */
export function scopeMerchants(rows: MerchantTotal[], scope: Scope): MerchantTotal[] {
  if (scope.view !== 'primary') {
    return rows.filter(row => row.currency === scope.view);
  }

  const merged = new Map<string, MerchantTotal>();
  for (const row of rows) {
    const total = into(row.total, row.currency, scope);
    const seen = merged.get(row.key);
    if (!seen) {
      merged.set(row.key, { ...row, currency: scope.primary, total, average: total / row.count });
      continue;
    }
    seen.total += total;
    seen.count += row.count;
    // Recomputed from the merged figures rather than averaged: the two rows
    // carry different numbers of purchases, so their averages do not add.
    seen.average = seen.total / seen.count;
    if (row.firstSeen < seen.firstSeen) seen.firstSeen = row.firstSeen;
    if (row.lastSeen > seen.lastSeen) seen.lastSeen = row.lastSeen;
  }

  return Array.from(merged.values()).sort((a, b) => b.total - a.total || a.key.localeCompare(b.key));
}

/**
 * Category comparison in scope, biggest mover first.
 *
 * The combined view sums a category's two windows across currencies and then
 * recomputes the derived figures, because a percentage cannot be averaged: a
 * category up 200% on 10 zł and flat on 4000 USD did not move 100%.
 */
export function scopeComparison(rows: CategoryComparison[], scope: Scope): CategoryComparison[] {
  const scoped = scope.view === 'primary'
    ? Array.from(rows.reduce((acc, row) => {
      const seen = acc.get(row.category) ?? {
        category: row.category,
        currency: scope.primary,
        current: 0,
        previous: 0,
        delta: 0,
        deltaPct: null,
        currentCount: 0,
        previousCount: 0,
        isNew: false
      };
      seen.current += into(row.current, row.currency, scope);
      seen.previous += into(row.previous, row.currency, scope);
      seen.currentCount += row.currentCount;
      seen.previousCount += row.previousCount;
      return acc.set(row.category, seen);
    }, new Map<string, CategoryComparison>()).values()).map(row => ({
      ...row,
      delta: row.current - row.previous,
      // Same rule as the server: no previous spend means no denominator, so
      // null rather than Infinity, with `isNew` carrying the actual meaning.
      deltaPct: row.previous === 0 ? null : round(((row.current - row.previous) / row.previous) * 100, 1),
      isNew: row.previous === 0 && row.current > 0
    }))
    : rows.filter(row => row.currency === scope.view);

  return [...scoped].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || a.category.localeCompare(b.category));
}

/**
 * The merchants whose spend is a drip: many purchases, each small, adding up to
 * a total that matters. That last clause is what the flag is for — it is the
 * spend nobody notices, as opposed to the spend that is simply large.
 *
 * All three tests are against the user's own numbers rather than an amount
 * someone picked, which is the rule the server's scorer follows for the same
 * reason: nobody knows what 300 means until they know what the other rows say.
 * "Small" is therefore below the typical purchase in this very list, and
 * "matters" is `MIN_MATERIALITY` of what the list holds.
 *
 * Gating on the visit count alone would light up almost every row on a year of
 * history, and a badge that appears eleven times in thirteen says nothing.
 */
export function dripMerchants(rows: MerchantTotal[]): Set<string> {
  const spend = rows.reduce((sum, row) => sum + row.total, 0);
  const purchases = rows.reduce((sum, row) => sum + row.count, 0);
  if (purchases === 0) return new Set();

  const typical = spend / purchases;
  return new Set(
    rows
      .filter(row => row.count >= MIN_DRIP_COUNT && row.total >= spend * MIN_MATERIALITY && row.average < typical)
      .map(row => row.key)
  );
}

/** Saturday and Sunday, in the strftime('%w') numbering the buckets use. */
const WEEKEND_DOWS = [0, 6];

/**
 * The weekday pattern in scope, or null when the scope has no data.
 *
 * The combined view adds the converted totals day by day and divides again,
 * rather than averaging seven per-day figures: each currency's buckets cover
 * the same window, so the day counts are shared and the sum is exact.
 */
export function scopePattern(patterns: CurrencyPattern[], scope: Scope): CurrencyPattern | null {
  if (scope.view !== 'primary') {
    return patterns.find(pattern => pattern.currency === scope.view) ?? null;
  }
  if (patterns.length === 0) return null;
  if (patterns.length === 1 && patterns[0].currency === scope.primary) return patterns[0];

  const byWeekday: WeekdayBucket[] = patterns[0].byWeekday.map((bucket, dow) => {
    const total = patterns.reduce((sum, p) => sum + into(p.byWeekday[dow].total, p.currency, scope), 0);
    const count = patterns.reduce((sum, p) => sum + p.byWeekday[dow].count, 0);
    return { dow, days: bucket.days, total, count, perDay: bucket.days === 0 ? 0 : total / bucket.days };
  });

  const sumOver = (dows: number[]) => dows.reduce(
    (acc, dow) => ({ total: acc.total + byWeekday[dow].total, days: acc.days + byWeekday[dow].days }),
    { total: 0, days: 0 }
  );

  const weekend = sumOver(WEEKEND_DOWS);
  const weekday = sumOver([1, 2, 3, 4, 5]);
  const weekendPerDay = weekend.days === 0 ? 0 : weekend.total / weekend.days;
  const weekdayPerDay = weekday.days === 0 ? 0 : weekday.total / weekday.days;

  return {
    currency: scope.primary,
    byWeekday,
    weekdayPerDay,
    weekendPerDay,
    weekendRatio: weekend.days === 0 || weekday.days === 0 || weekdayPerDay === 0
      ? null
      : round(weekendPerDay / weekdayPerDay, 2)
  };
}

/** True when the two halves of the week are far enough apart to be worth a claim. */
export function weekendWorthSaying(ratio: number | null): ratio is number {
  return ratio !== null && Math.abs(ratio - 1) > WEEKEND_FLAT;
}
