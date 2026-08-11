/**
 * Everything Home works out before it renders anything.
 *
 * Home is one screen carrying two clocks (ruling R2 in
 * `docs/ux-review-findings.md`): the spending sections follow a page-wide window
 * control, the habit sections keep their own much longer one, and **every
 * section states which**. Most of the arithmetic that makes that safe is
 * ordinary and testable, so it lives here rather than inside a component that
 * would then be untestable without a DOM.
 *
 * Three groups, in reading order:
 *   1. windows      — the page control, and how a window is named on screen
 *   2. sections     — ranking categories, the budget verdict, the heatmap ramp
 *   3. prose        — the sentence one finding becomes, and where it belongs
 *
 * Currency scoping is **not** here: `utils/insights.ts` already does it, and
 * every function below takes rows that have already been through it.
 */

import {
  Budget,
  Category,
  CategoryComparison,
  ComparisonPeriod,
  ComparisonWindow,
  Currency,
  DateRange,
  Finding,
  FindingKind
} from '../types/expense.types';
import { categoryLabel } from './categories';
import { formatCurrency, formatDate, monthLabel } from './format';
import { convertAmount } from './fx';
import { Scope } from './insights';

// ---------------------------------------------------------------------------
// 1. Windows
// ---------------------------------------------------------------------------

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

/**
 * Today as a local calendar date, matching `todayISO` in the insights model.
 *
 * Local rather than UTC on purpose: an expense dated "today" is entered against
 * the wall clock the user is looking at, so anything that decides how much of a
 * window has elapsed has to agree with it.
 */
export function todayISO(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

/** How many days the window holds, end included. */
export function windowDays(range: DateRange): number {
  return Math.max(0, diffDays(range.start, range.end) + 1);
}

/**
 * How much of the window has actually happened.
 *
 * The same as `windowDays` for a rolling window, which ends at the anchor. A
 * calendar month runs to the 31st, so on the 11th only eleven days of it have
 * been lived — and dividing its spend by 31 would understate the daily rate by
 * two thirds.
 */
export function elapsedDays(range: DateRange, today: string): number {
  const length = windowDays(range);
  if (length === 0) return 0;
  return Math.min(length, Math.max(1, diffDays(range.start, today) + 1));
}

/** Days still to come in the window, and 0 once it has ended. */
export function daysLeft(range: DateRange, today: string): number {
  return Math.max(0, diffDays(today, range.end));
}

/**
 * The page window control: `Last 30 days · This month · Last 12 months`.
 *
 * Each option is a `period`/`window` pair the insights API already accepts, so
 * the control adds no arithmetic of its own — `/comparison` and `/summary`
 * answer over the same window and report the dates they used, which is what the
 * section header then prints. Nothing here can therefore drift out of step with
 * the numbers underneath it.
 */
export interface PageWindow {
  key: string;
  label: string;
  period: ComparisonPeriod;
  window: ComparisonWindow;
}

export const PAGE_WINDOWS: PageWindow[] = [
  { key: '30d', label: 'Last 30 days', period: 'month', window: 'rolling' },
  { key: 'month', label: 'This month', period: 'month', window: 'calendar' },
  { key: '12m', label: 'Last 12 months', period: 'year', window: 'rolling' }
];

/**
 * 30 days, not the calendar month.
 *
 * A calendar month is a partial window for all but one day of its life, and
 * comparing eleven days of August against the whole of July reports a collapse
 * in spending on the 3rd. The rolling default is the same choice
 * `getComparison` makes for the same reason.
 */
export const DEFAULT_PAGE_WINDOW = PAGE_WINDOWS[0];

/** How a window and the one before it are named in a sentence. */
export interface WindowPhrases {
  /** Reads after "You spent 4 812 zł": "in the last 30 days", "so far in August 2026". */
  window: string;
  /** Reads after "12% more than" and after "nothing in": "the 30 days before", "July 2026". */
  previous: string;
}

export function describeWindow(current: DateRange, previous: DateRange, calendar: boolean): WindowPhrases {
  if (calendar) {
    return {
      // "so far", because the only calendar window the control offers is the
      // month in progress.
      window: `so far in ${monthLabel(current.start.slice(0, 7))}`,
      previous: monthLabel(previous.start.slice(0, 7))
    };
  }
  return {
    window: `in the last ${windowDays(current)} days`,
    previous: `the ${windowDays(previous)} days before`
  };
}

/**
 * Add whole months, clamping the day to the target month's length.
 *
 * Exported for `utils/expenses.ts`, which needs the same "twelve months back"
 * that `habitWindow` does. Two screens working out a window's start with two
 * pieces of date arithmetic is how F1 and F2 happened; there is one here.
 */
export function addMonths(iso: string, months: number): string {
  const [year, month, day] = iso.split('-').map(Number);
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), Math.min(day, lastDay)))
    .toISOString()
    .slice(0, 10);
}

/**
 * The habit sections' clock: the twelve months ending today — the second of
 * Home's two windows, and the reason the page control does not govern the whole
 * screen (R2).
 *
 * Forced to 30 days, the weekday chart has about four samples per weekday and
 * the merchant list goes thin. Computed here rather than left to the endpoints'
 * own defaults so the window a section *prints* is the window it *asked for*;
 * `/insights/recurring` reports no dates back, and a header stating a constant
 * nobody sent would be the F1 defect with extra steps.
 */
export function habitWindow(today: string): DateRange {
  return { start: addMonths(today, -12), end: today };
}

/** The dates a window covers, for the line under a section heading. */
export function windowDates(range: DateRange): string {
  return `${formatDate(range.start)} – ${formatDate(range.end)}`;
}

// ---------------------------------------------------------------------------
// 2. Sections
// ---------------------------------------------------------------------------

/** Round to one decimal place, normalising -0 — as `utils/insights.ts` does. */
function round1(value: number): number {
  const rounded = Math.round(value * 10) / 10;
  return rounded === 0 ? 0 : rounded;
}

/** The headline: what was spent, how fast, and whether that is more than usual. */
export interface HeadlineFacts {
  total: number;
  perDay: number;
  /** Percent change against the previous window, or null when there is nothing to divide by. */
  changePct: number | null;
  /**
   * True when the change is a per-day comparison rather than total against
   * total, which is the case exactly when the two windows are different lengths.
   */
  perDayComparison: boolean;
}

/**
 * The one sentence that answers "is this more than usual, overall?" — which
 * today is only ever answered per category (change 5).
 *
 * Null when the window holds no spending at all: a headline over zero is not a
 * quieter headline, it is a wrong one, and the section renders nothing instead.
 *
 * The change is measured **per day on both sides**. For a rolling window that
 * is identical to comparing the totals, because `getComparison` guarantees two
 * windows of the same length. For a calendar month it is the only comparison
 * that is not a lie: eleven days of August against the whole of July would read
 * as a two-thirds collapse in spending every month, on the 11th.
 */
export function headlineFacts(params: {
  /** Comparison rows, already scoped and converted. */
  rows: CategoryComparison[];
  current: DateRange;
  previous: DateRange;
  today: string;
}): HeadlineFacts | null {
  const total = params.rows.reduce((sum, row) => sum + row.current, 0);
  if (total <= 0) return null;

  const previousTotal = params.rows.reduce((sum, row) => sum + row.previous, 0);
  const elapsed = elapsedDays(params.current, params.today);
  const previousLength = windowDays(params.previous);

  const perDay = elapsed === 0 ? 0 : total / elapsed;
  const previousPerDay = previousLength === 0 ? 0 : previousTotal / previousLength;

  return {
    total,
    perDay,
    changePct: previousPerDay > 0 ? round1(((perDay - previousPerDay) / previousPerDay) * 100) : null,
    perDayComparison: elapsed !== previousLength
  };
}

/** One row of "Where it went". */
export interface RankedCategory {
  /** The slug, or null for the "everything else" row. */
  category: string | null;
  current: number;
  previous: number;
  /** 0..1 of the window's total. */
  share: number;
  /** Percent change against the previous window; null when there was none. */
  deltaPct: number | null;
  /** How many categories the row stands for — 1, except for "everything else". */
  categories: number;
}

/** Ranked rows before the rest collapse into one. */
export const RANKED_CATEGORIES = 6;

/**
 * Categories ranked by what they cost, with the share and the change the donut
 * could not show (changes 27 and 28).
 *
 * Only what was actually spent in the window: this is a decomposition of the
 * headline's total, so a category that fell to zero is not part of it. The drop
 * is not lost — it is what a `category_moved` finding says, if it outranks
 * everything else on the page.
 *
 * Every percentage here is computed from the two totals rather than read off
 * the row, because the "everything else" row has no percentage of its own and
 * two rules for one figure is how a table ends up disagreeing with itself.
 */
export function rankCategories(rows: CategoryComparison[], top: number = RANKED_CATEGORIES): RankedCategory[] {
  const spent = rows.filter(row => row.current > 0);
  const total = spent.reduce((sum, row) => sum + row.current, 0);
  if (total <= 0) return [];

  const change = (current: number, previous: number): number | null =>
    previous > 0 ? round1(((current - previous) / previous) * 100) : null;

  const ranked = [...spent].sort((a, b) => b.current - a.current || a.category.localeCompare(b.category));

  const shown: RankedCategory[] = ranked.slice(0, top).map(row => ({
    category: row.category,
    current: row.current,
    previous: row.previous,
    share: row.current / total,
    deltaPct: change(row.current, row.previous),
    categories: 1
  }));

  const rest = ranked.slice(top);
  if (rest.length === 0) return shown;

  const current = rest.reduce((sum, row) => sum + row.current, 0);
  const previous = rest.reduce((sum, row) => sum + row.previous, 0);
  return [
    ...shown,
    {
      category: null,
      current,
      previous,
      share: current / total,
      deltaPct: change(current, previous),
      categories: rest.length
    }
  ];
}

const DAYS_PER_MONTH = 30.44; // mean Gregorian month, as in models/insights.ts

/**
 * How many monthly limits the window is worth.
 *
 * Budgets have no month dimension at all — `/api/budgets` returns a flat set of
 * standing `{category, currency, amount}` limits (F2). Comparing a year of
 * spending against one of them would report everybody as 1100% over, so the
 * allowance is the limit times the whole months the window covers: 1 for both
 * month-length windows the control offers, 12 for the year. Rounded rather than
 * exact, so a 31-day August is worth one month's limit and not 1.02 of one.
 */
export function monthsInWindow(days: number): number {
  return Math.max(1, Math.round(days / DAYS_PER_MONTH));
}

/** A limit is "close" from this share of its allowance, and "over" above all of it. */
export const BUDGET_CLOSE = 0.9;

export interface BudgetException {
  category: string;
  /** The allowance for this window, not the monthly limit. */
  allowance: number;
  spent: number;
  /** Percent of the allowance used, rounded to a whole number. */
  pct: number;
}

export interface BudgetVerdict {
  over: BudgetException[];
  close: BudgetException[];
  onTrack: number;
  /** How many categories carry a limit at all. Zero means the section says nothing. */
  limits: number;
}

/**
 * "Groceries 12% over · 1 close · 5 on track" — the verdict Budgets never
 * states (F4, change 6).
 *
 * A clean month is an answer, not an absence: with limits set and nothing over,
 * `over` is empty and the caller still says so. What makes the section vanish is
 * `limits === 0`, which is also the state that used to put a large red negative
 * on screen the moment a new user saved their first expense.
 */
export function budgetVerdict(params: {
  budgets: Budget[];
  /** Spend per category in the window, already scoped and converted. */
  spent: Map<string, number>;
  /** What the window is worth in monthly limits — see `monthsInWindow`. */
  months: number;
  scope: Scope;
}): BudgetVerdict {
  const { scope } = params;

  // Limits are held in their own currency. The combined view converts them the
  // same way it converts everything else on the screen; a native view only ever
  // compares like with like and ignores the rest.
  const allowances = new Map<string, number>();
  for (const budget of params.budgets) {
    if (scope.view !== 'primary' && budget.currency !== scope.view) continue;
    const amount = scope.view === 'primary'
      ? convertAmount(budget.amount, budget.currency, scope.primary, scope.rates)
      : budget.amount;
    if (amount <= 0) continue;
    allowances.set(budget.category, (allowances.get(budget.category) ?? 0) + amount * params.months);
  }

  const over: BudgetException[] = [];
  const close: BudgetException[] = [];
  let onTrack = 0;

  for (const [category, allowance] of allowances) {
    const spent = params.spent.get(category) ?? 0;
    const exception = { category, allowance, spent, pct: Math.round((spent / allowance) * 100) };
    if (spent > allowance) over.push(exception);
    else if (spent >= allowance * BUDGET_CLOSE) close.push(exception);
    else onTrack++;
  }

  const worstFirst = (a: BudgetException, b: BudgetException) =>
    b.pct - a.pct || a.category.localeCompare(b.category);

  return { over: over.sort(worstFirst), close: close.sort(worstFirst), onTrack, limits: allowances.size };
}

/** Weeks of daily spend the heatmap draws. */
export const HEATMAP_WEEKS = 13;

export interface HeatmapDay {
  date: string;
  amount: number;
}

/**
 * The last 13 weeks of daily spend, aligned so every column is a Sunday-first
 * week. Days with nothing spent are part of the picture and are kept as zeros.
 */
export function heatmapDays(byDay: Map<string, number>, today: string): HeatmapDay[] {
  const end = toUTC(today);
  let start = end - (HEATMAP_WEEKS * 7 - 1) * MS_PER_DAY;
  start -= new Date(start).getUTCDay() * MS_PER_DAY; // back up to Sunday

  const days: HeatmapDay[] = [];
  for (let cursor = start; cursor <= end; cursor += MS_PER_DAY) {
    const date = new Date(cursor).toISOString().slice(0, 10);
    days.push({ date, amount: byDay.get(date) ?? 0 });
  }
  return days;
}

/**
 * Where the colour ramp tops out: the 90th percentile of the days that had any
 * spending, not the largest one (change 27).
 *
 * Anchored on the maximum, 91 drawn days produced about ten distinguishable
 * ones — a single payday or one flight flattens every ordinary day into three
 * near-identical greens. A p90 anchor spends the ramp on the range someone
 * actually lives in and lets the outliers share the top shade, which is the
 * trade the report asks for: resolution where it can be read.
 *
 * Returns 0 when nothing was spent, which the caller reads as "draw no heatmap".
 */
export function rampAnchor(amounts: number[]): number {
  const spent = amounts.filter(amount => amount > 0).sort((a, b) => a - b);
  if (spent.length === 0) return 0;
  return spent[Math.min(spent.length - 1, Math.ceil(spent.length * 0.9) - 1)];
}

// ---------------------------------------------------------------------------
// 3. Prose
//
// The only place in the app that writes prose about money, and where PL/EN will
// branch. `/insights/summary` deliberately refuses to emit sentences — findings
// carry numbers and identifiers only, because an API that answered in English
// would have to be rebuilt to answer in anything else. These templates used to
// live in `InsightsStrip.tsx`, which was a box at the top of the dashboard; the
// box is gone (ruling R3) and each sentence now heads the section that proves
// it, so they moved here, next to the rest of what Home works out.
// ---------------------------------------------------------------------------

/** The sections of Home a finding can belong to. */
export type HomeSection = 'categories' | 'subscriptions' | 'shop' | 'when';

/**
 * Which section a finding is the headline of.
 *
 * One claim, one place: the weekend claim goes above the weekday chart, the
 * category mover above the category list, the stopped subscription above the
 * subscriptions table. A box at the top repeating three of the page's own
 * sentences would duplicate *itself*, which is what R3 rules against.
 */
export const SECTION_FOR_FINDING: Record<FindingKind, HomeSection> = {
  category_moved: 'categories',
  category_new: 'categories',
  recurring_total: 'subscriptions',
  recurring_stopped: 'subscriptions',
  merchant_drip: 'shop',
  weekend_skew: 'when'
};

/**
 * The findings each section has to head with, in the order the server ranked
 * them.
 *
 * A list rather than one finding per section, because two kinds can prove the
 * same section — a subscription total and a subscription that stopped are both
 * about Subscriptions — and dropping the second would throw away a finding the
 * server thought was worth one of its three slots.
 */
export function findingsBySection(findings: Finding[]): Map<HomeSection, Finding[]> {
  const bySection = new Map<HomeSection, Finding[]>();
  for (const finding of findings) {
    const section = SECTION_FOR_FINDING[finding.kind];
    bySection.set(section, [...(bySection.get(section) ?? []), finding]);
  }
  return bySection;
}

/**
 * How far ahead of the next section's finding the top one has to score before
 * its section is worth moving. A margin rather than a threshold, because
 * severity is a 0..1 geometric mean whose absolute value means nothing on its
 * own — only its distance from the rest does.
 */
export const PROMOTION_MARGIN = 1.5;

/**
 * The one section allowed to move directly under the headline, or null.
 *
 * **At most one**, and this is the only reordering Home permits: the reading
 * order of the rest is the product's argument and is fixed. "Where it went"
 * can never be promoted because it already sits there.
 */
export function promotedSection(findings: Finding[]): HomeSection | null {
  if (findings.length === 0) return null;

  const top = findings[0];
  const section = SECTION_FOR_FINDING[top.kind];
  if (section === 'categories') return null;

  // Against the best finding belonging to a *different* section: a second
  // finding about the same section is not competition for the slot.
  const rival = findings.find(finding => SECTION_FOR_FINDING[finding.kind] !== section);
  if (rival && top.severity < PROMOTION_MARGIN * rival.severity) return null;

  return section;
}

/**
 * A merchant key is a fold of what was typed or scanned ('żabka'), not a name,
 * so it is capitalised for the sentence rather than shown as stored.
 */
function asName(key: string): string {
  return key.charAt(0).toLocaleUpperCase() + key.slice(1);
}

/**
 * One finding, as a sentence.
 *
 * Every template states the window it measured over. That is not decoration:
 * the habit sections below these sentences measure the same behaviour over
 * twelve months, and a per-day figure with no window on it is how the app came
 * to contradict itself about weekends (F10) — `days` was in the payload all
 * along and exactly one template dropped it.
 */
export function findingSentence(finding: Finding, categories: Category[], currency: Currency): string {
  const fmt = (value: number) => formatCurrency(value, currency);
  const label = (slug: string) => categoryLabel(categories, slug);

  switch (finding.kind) {
    case 'category_moved': {
      const { category, current, previous, deltaPct, days } = finding.data;
      // Rounded here, not by the API: the payload keeps a decimal so a future
      // view can be more precise than a sentence wants to be.
      return `${label(category)} is ${deltaPct > 0 ? 'up' : 'down'} ${Math.abs(Math.round(deltaPct))}% ` +
        `over the last ${days} days — ${fmt(current)}, against ${fmt(previous)} before.`;
    }

    case 'category_new': {
      const { category, current, days, previousDays } = finding.data;
      return `${label(category)} is new — ${fmt(current)} in the last ${days} days, ` +
        `nothing in the ${previousDays} before that.`;
    }

    case 'recurring_total': {
      const { count, monthlyCost, totalPaid } = finding.data;
      return count === 1
        ? `1 recurring charge costs about ${fmt(monthlyCost)} a month — ${fmt(totalPaid)} so far.`
        : `${count} recurring charges cost about ${fmt(monthlyCost)} a month — ${fmt(totalPaid)} so far.`;
    }

    case 'recurring_stopped': {
      const { label: charge, monthlyCost, totalPaid, lastSeen } = finding.data;
      return `${asName(charge)} looks like it stopped — nothing since ${formatDate(lastSeen)}, ` +
        `after ${fmt(totalPaid)} at about ${fmt(monthlyCost)} a month.`;
    }

    case 'merchant_drip': {
      const { key, total, count, average, days } = finding.data;
      return `${asName(key)} adds up — ${fmt(total)} across ${count} purchases in the last ${days} days, ` +
        `about ${fmt(average)} each.`;
    }

    case 'weekend_skew': {
      const { weekendPerDay, weekdayPerDay, ratio, days } = finding.data;
      return ratio > 1
        ? `Weekends cost more — about ${fmt(weekendPerDay)} a day over the last ${days} days, ` +
          `against ${fmt(weekdayPerDay)} on weekdays.`
        : `Weekdays cost more — about ${fmt(weekdayPerDay)} a day over the last ${days} days, ` +
          `against ${fmt(weekendPerDay)} at the weekend.`;
    }
  }
}
