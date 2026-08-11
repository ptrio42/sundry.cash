/**
 * Tests for the Budgets screen's arithmetic.
 *
 * Three things are worth pinning here and none of them is visible in a render:
 * the month arithmetic the stepper walks, the pace band that turns "43% used"
 * into a verdict, and the guarantee that the rows and the headline are two
 * readings of one classification rather than two classifications that happen to
 * agree today.
 */

import { describe, it, expect } from 'vitest';
import {
  PACE_BAND,
  canStepForward,
  cumulativeByDay,
  daysInMonth,
  elapsedInMonth,
  isPastMonth,
  limitsByCategory,
  monthOf,
  paceOf,
  spendByCategory,
  statusByCategory,
  stepMonth,
  verdictSentence
} from '../utils/budgets';
import { budgetVerdict } from '../utils/home';
import { Scope } from '../utils/insights';
import { Budget, Expense } from '../types/expense.types';

const rates = { USD: 1, PLN: 0.25, BTC: 65000 };
const usd: Scope = { view: 'USD', primary: 'USD', rates };
const combined: Scope = { view: 'primary', primary: 'USD', rates };

const expense = (e: Partial<Expense> & Pick<Expense, 'id' | 'amount' | 'date'>): Expense => ({
  description: 'x',
  category: 'groceries',
  currency: 'USD',
  ...e
});

describe('months', () => {
  it('steps across a year boundary in both directions', () => {
    expect(stepMonth('2026-01', -1)).toBe('2025-12');
    expect(stepMonth('2025-12', 1)).toBe('2026-01');
    expect(stepMonth('2026-08', -1)).toBe('2026-07');
    expect(stepMonth('2026-03', -14)).toBe('2025-01');
  });

  it('knows how long a month is, leap year included', () => {
    expect(daysInMonth('2026-01')).toBe(31);
    expect(daysInMonth('2026-04')).toBe(30);
    expect(daysInMonth('2026-02')).toBe(28);
    expect(daysInMonth('2024-02')).toBe(29);
  });

  it('measures a month in progress over the part of it that has happened', () => {
    // The defect wave 2 shipped and then fixed on Home: dividing eleven lived
    // days of a 31-day month by 31 reports everyone as comfortably under pace.
    expect(elapsedInMonth('2026-01', '2026-01-11')).toBe(11);
    expect(elapsedInMonth('2026-01', '2026-01-31')).toBe(31);
    // A month that has ended is all of it, whatever today is.
    expect(elapsedInMonth('2025-12', '2026-01-11')).toBe(31);
    expect(elapsedInMonth('2026-02', '2026-01-11')).toBe(0);
  });

  it('stops going forward at the month we are in', () => {
    expect(canStepForward('2025-12', '2026-01-11')).toBe(true);
    expect(canStepForward('2026-01', '2026-01-11')).toBe(false);
    expect(isPastMonth('2026-01', '2026-01-11')).toBe(false);
    expect(isPastMonth('2025-12', '2026-01-11')).toBe(true);
    expect(monthOf('2026-01-11')).toBe('2026-01');
  });
});

describe('pace', () => {
  it('calls the report\'s own example on pace, and the same spend on day 3 not', () => {
    // 43% used on day 11 of 31 — about seven points ahead of the calendar, and
    // the reading §F4 says no pixel in the product performs.
    expect(paceOf(0.43, 11 / 31)).toBe('on');
    expect(paceOf(0.43, 3 / 31)).toBe('ahead');
  });

  it('is symmetric, and the band is inclusive at its edge', () => {
    expect(paceOf(0.5, 0.5 - PACE_BAND)).toBe('on');
    expect(paceOf(0.5, 0.5 + PACE_BAND)).toBe('on');
    expect(paceOf(0.5, 0.5 - PACE_BAND - 0.001)).toBe('ahead');
    expect(paceOf(0.5, 0.5 + PACE_BAND + 0.001)).toBe('under');
  });
});

describe('money in scope', () => {
  const expenses: Expense[] = [
    expense({ id: 1, amount: 120, date: '2026-01-05' }),
    expense({ id: 2, amount: 400, date: '2026-01-07', currency: 'PLN' }),
    expense({ id: 3, amount: 30, date: '2026-01-06', category: 'transport' }),
    expense({ id: 4, amount: 999, date: '2025-12-03' })
  ];

  it('counts one currency and one month in a native scope', () => {
    const spent = spendByCategory(expenses, '2026-01', usd);
    expect(spent.get('groceries')).toBe(120);
    expect(spent.get('transport')).toBe(30);
    expect(spendByCategory(expenses, '2025-12', usd).get('groceries')).toBe(999);
  });

  it('converts and merges currencies in the combined scope', () => {
    const spent = spendByCategory(expenses, '2026-01', combined);
    // 120 USD + 400 PLN at 0.25 = 220 USD.
    expect(spent.get('groceries')).toBe(220);
  });

  it('adds a category\'s limits across currencies, and ignores a limit of zero', () => {
    const budgets: Budget[] = [
      { category: 'groceries', currency: 'USD', amount: 200 },
      { category: 'groceries', currency: 'PLN', amount: 1000 },
      { category: 'transport', currency: 'USD', amount: 0 }
    ];

    expect(limitsByCategory(budgets, usd).get('groceries')).toBe(200);
    expect(limitsByCategory(budgets, combined).get('groceries')).toBe(450);
    // The same `<= 0` guard budgetVerdict applies, so the bars and the headline
    // count the same set of limits.
    expect(limitsByCategory(budgets, usd).has('transport')).toBe(false);
  });

  it('runs the cumulative series to the end of a month that has ended', () => {
    const series = cumulativeByDay(expenses, '2026-01', usd, 31);
    expect(series).toHaveLength(31);
    expect(series[3].cumulative).toBe(0);
    expect(series[4].cumulative).toBe(120);  // day 5
    expect(series[5].cumulative).toBe(150);  // day 6
    expect(series[30].cumulative).toBe(150);
  });

  it('stops at today, so a month in progress does not draw twenty flat days', () => {
    const series = cumulativeByDay(expenses, '2026-01', usd, 11);
    expect(series).toHaveLength(11);
    expect(series[10].cumulative).toBe(150);
  });
});

describe('the verdict, and the rows that carry it', () => {
  const budgets: Budget[] = [
    { category: 'groceries', currency: 'USD', amount: 200 },
    { category: 'transport', currency: 'USD', amount: 20 },
    { category: 'entertainment', currency: 'USD', amount: 100 }
  ];
  const spent = new Map([['groceries', 120], ['transport', 30], ['entertainment', 95]]);

  it('labels every row exactly as the headline counted it', () => {
    const verdict = budgetVerdict({ budgets, spent, months: 1, scope: usd });
    const status = statusByCategory(verdict);

    expect(status.get('transport')).toBe('over');
    expect(status.get('entertainment')).toBe('close');
    expect(status.get('groceries')).toBeUndefined(); // on track by absence
    expect(verdict.over.length + verdict.close.length + verdict.onTrack).toBe(verdict.limits);
    expect(verdict.limits).toBe(limitsByCategory(budgets, usd).size);
  });

  it('states a clean month rather than going quiet', () => {
    const clean = budgetVerdict({
      budgets,
      spent: new Map([['groceries', 10]]),
      months: 1,
      scope: usd
    });
    expect(verdictSentence(clean)).toBe('Nothing over · 3 on track.');
  });

  it('names the exceptions it found', () => {
    const verdict = budgetVerdict({ budgets, spent, months: 1, scope: usd });
    expect(verdictSentence(verdict)).toBe('1 over · 1 close · 1 on track.');
  });

  it('says nothing at all when nothing carries a limit', () => {
    const none = budgetVerdict({ budgets: [], spent, months: 1, scope: usd });
    expect(verdictSentence(none)).toBe('');
  });
});
