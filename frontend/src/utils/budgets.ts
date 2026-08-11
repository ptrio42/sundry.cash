/**
 * What the Budgets screen works out: which month, how much of it has happened,
 * and what the standing limits say about it.
 *
 * **Budgets have no month dimension.** `/api/budgets` returns a flat set of
 * `{category, currency, amount}` limits with no date on them at all (F2 in
 * `docs/ux-review-findings.md`). Everything about a month here is therefore a
 * frontend construction: the stepper picks a window over the *expenses*, and the
 * limits it is compared against are always today's. That is why the screen
 * prints the caveat whenever the month shown is not the current one — the
 * inaccuracy did not exist while past months were simply unavailable, and
 * stating it is the price of the feature.
 *
 * **The classification is not reimplemented here.** Over / close / on track come
 * from `budgetVerdict` in `utils/home.ts`, the same function Home's budget
 * section calls, and `statusByCategory` merely reads its answer back onto the
 * rows. Two screens making the same claim about the same limits must not be able
 * to disagree about it, which a second copy of `BUDGET_CLOSE` and a second `>`
 * would eventually manage.
 */

import { Budget, Currency, Expense } from '../types/expense.types';
import { BudgetVerdict } from './home';
import { convertAmount } from './fx';
import { Scope } from './insights';

// ---------------------------------------------------------------------------
// 1. Months
// ---------------------------------------------------------------------------

/** The month an ISO date falls in, as `YYYY-MM`. */
export function monthOf(iso: string): string {
  return iso.slice(0, 7);
}

/** `key` moved by whole months. UTC, because a month key carries no time. */
export function stepMonth(key: string, delta: number): string {
  const [year, month] = key.split('-').map(Number);
  const moved = new Date(Date.UTC(year, month - 1 + delta, 1));
  return `${moved.getUTCFullYear()}-${String(moved.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** How many days that month holds — the denominator of the pace line. */
export function daysInMonth(key: string): number {
  const [year, month] = key.split('-').map(Number);
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * How much of the month has actually happened.
 *
 * The whole of a month that has ended, and today's date in the one in progress.
 * Dividing a partial month by its full length is the defect wave 2 shipped and
 * then fixed on Home: on the 11th of a 31-day month it understates the daily
 * rate by two thirds, and here it would report every month in progress as
 * comfortably under pace until about the 25th.
 *
 * A month that has not started yet is zero. The stepper refuses to go there, so
 * this is a guard rather than a state the screen renders.
 */
export function elapsedInMonth(key: string, today: string): number {
  const length = daysInMonth(key);
  const current = monthOf(today);
  if (key < current) return length;
  if (key > current) return 0;
  return Math.min(length, Number(today.slice(8, 10)));
}

/** False for the month we are in, which is as far forward as the stepper goes. */
export function canStepForward(key: string, today: string): boolean {
  return key < monthOf(today);
}

/** True when the month shown is not the current one — the caveat's trigger. */
export function isPastMonth(key: string, today: string): boolean {
  return key < monthOf(today);
}

// ---------------------------------------------------------------------------
// 2. Pace
// ---------------------------------------------------------------------------

/**
 * How far spending may sit from the calendar before the screen says so.
 *
 * Ten points of the allowance. The report's own example is 43% used on day 11 of
 * 31 — about seven points ahead of the calendar — and calls it the thing nothing
 * on the screen states, not a thing worth an alarm. A tighter band would flag
 * every month that started with a weekly shop, which is a verdict nobody can act
 * on; a looser one would stay quiet through half a month's overspend.
 */
export const PACE_BAND = 0.1;

export type Pace = 'ahead' | 'on' | 'under';

/** Where spending sits against the calendar, both as a share of their whole. */
export function paceOf(usedShare: number, elapsedShare: number): Pace {
  const gap = usedShare - elapsedShare;
  if (gap > PACE_BAND) return 'ahead';
  if (gap < -PACE_BAND) return 'under';
  return 'on';
}

/**
 * The word the pace line ends with.
 *
 * "Ahead" means ahead of the calendar, which is the bad direction — the reading
 * a bare "43% used" leaves the user to do, and the one nothing in the product
 * currently does for them (F4).
 */
export const PACE_LABEL: Record<Pace, string> = {
  ahead: 'ahead of pace',
  on: 'on pace',
  under: 'under pace'
};

// ---------------------------------------------------------------------------
// 3. Money, in the scope's currency
// ---------------------------------------------------------------------------

/**
 * `amount` in the scope's display currency, or null when the scope excludes it.
 *
 * The native view compares like with like and ignores everything else, exactly
 * as this screen always has; the combined view converts, the same way Home does.
 * Null rather than 0 so a caller cannot accidentally add an out-of-scope row in
 * as a zero.
 */
function inScope(amount: number, currency: Currency, scope: Scope): number | null {
  if (scope.view === 'primary') return convertAmount(amount, currency, scope.primary, scope.rates);
  return currency === scope.view ? amount : null;
}

/** Spend per category in `month`, in the scope's display currency. */
export function spendByCategory(expenses: Expense[], month: string, scope: Scope): Map<string, number> {
  const spent = new Map<string, number>();
  for (const expense of expenses) {
    if (monthOf(expense.date) !== month) continue;
    const amount = inScope(expense.amount, expense.currency, scope);
    if (amount === null) continue;
    spent.set(expense.category, (spent.get(expense.category) ?? 0) + amount);
  }
  return spent;
}

/**
 * The standing monthly limit per category, in the scope's display currency.
 *
 * A category can hold a limit in more than one currency, so the combined view
 * adds them up — the same arithmetic `budgetVerdict` performs on the same rows,
 * and with the same `<= 0` guard, so the bars and the headline count the same
 * set of limits. Times one month, because this screen shows one month.
 */
export function limitsByCategory(budgets: Budget[], scope: Scope): Map<string, number> {
  const limits = new Map<string, number>();
  for (const budget of budgets) {
    const amount = inScope(budget.amount, budget.currency, scope);
    if (amount === null || amount <= 0) continue;
    limits.set(budget.category, (limits.get(budget.category) ?? 0) + amount);
  }
  return limits;
}

/**
 * Cumulative spend by day of `month`, for the chart, stopping at `throughDay`.
 *
 * The series used to run to the end of the month whatever the date, so on the
 * 11th the line went flat for twenty days — a chart of a month in progress that
 * reads as three weeks of spending nothing. Beside a pace verdict that is not
 * merely untidy: the flat tail is the visual argument against the sentence above
 * it. Pass `elapsedInMonth`, which is the whole month once it has ended.
 */
export function cumulativeByDay(
  expenses: Expense[],
  month: string,
  scope: Scope,
  throughDay: number
): { day: number; cumulative: number }[] {
  const perDay = new Map<number, number>();
  for (const expense of expenses) {
    if (monthOf(expense.date) !== month) continue;
    const amount = inScope(expense.amount, expense.currency, scope);
    if (amount === null) continue;
    const day = Number(expense.date.slice(8, 10));
    perDay.set(day, (perDay.get(day) ?? 0) + amount);
  }

  const days = Math.min(daysInMonth(month), Math.max(1, throughDay));
  const series: { day: number; cumulative: number }[] = [];
  let running = 0;
  for (let day = 1; day <= days; day++) {
    running += perDay.get(day) ?? 0;
    // Trimmed like the old burn-down did: conversion and repeated addition of
    // floats otherwise print a cumulative total ending in 0.000000001.
    series.push({ day, cumulative: Number(running.toFixed(8)) });
  }
  return series;
}

// ---------------------------------------------------------------------------
// 4. The verdict, read back onto the rows
// ---------------------------------------------------------------------------

export type BudgetStatus = 'over' | 'close' | 'on-track';

/**
 * Which categories the verdict called out, so a row can wear the same label the
 * headline counted it under.
 *
 * Anything holding a limit and absent from both lists is on track — which is
 * what `verdict.onTrack` counted, so the rows and the counts are two readings of
 * one classification rather than two classifications.
 */
export function statusByCategory(verdict: BudgetVerdict): Map<string, BudgetStatus> {
  const status = new Map<string, BudgetStatus>();
  for (const row of verdict.over) status.set(row.category, 'over');
  for (const row of verdict.close) status.set(row.category, 'close');
  return status;
}

/**
 * "2 over · 1 close · 5 on track." — the sentence Budgets never says (F4).
 *
 * A clean month is an answer and gets one: "Nothing over" leads, exactly as it
 * does in Home's one-line version of this verdict, rather than the screen going
 * quiet and leaving the reader to conclude it from ten unremarkable cards.
 *
 * Empty only when nothing carries a limit, which is the one state where there is
 * genuinely no verdict to state — and the state that used to put a large red
 * negative on screen the moment a new user saved their first expense.
 */
export function verdictSentence(verdict: BudgetVerdict): string {
  if (verdict.limits === 0) return '';

  const parts = [verdict.over.length > 0 ? `${verdict.over.length} over` : 'Nothing over'];
  if (verdict.close.length > 0) parts.push(`${verdict.close.length} close`);
  if (verdict.onTrack > 0) parts.push(`${verdict.onTrack} on track`);
  return `${parts.join(' · ')}.`;
}
