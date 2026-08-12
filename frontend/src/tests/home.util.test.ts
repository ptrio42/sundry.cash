/**
 * Tests for `utils/home.ts` — the arithmetic and the prose behind Home.
 *
 * These are the claims that would be expensive to pin down through a DOM and
 * cheap to get wrong: how much of a window has elapsed, what a monthly limit is
 * worth over a year, where a colour ramp should top out, when one section has
 * earned the slot under the headline, and the exact wording of every sentence a
 * finding turns into.
 *
 * The sentence templates used to live in `InsightsStrip.tsx` and were tested
 * through it. The strip is gone (ruling R3) and each sentence now heads the
 * section that proves it, so the templates are tested here, directly — the
 * assertions about the words are the same ones, and one of them (the weekend
 * window, F10) is the whole reason this suite exists.
 */

import { describe, it, expect } from 'vitest';
import {
  BUDGET_CLOSE,
  DEFAULT_PAGE_WINDOW,
  PAGE_WINDOWS,
  PROMOTION_MARGIN,
  RANKED_CATEGORIES,
  SECTION_FOR_FINDING,
  budgetVerdict,
  daysLeft,
  describeWindow,
  elapsedDays,
  findingSentence,
  findingsBySection,
  habitWindow,
  headlineFacts,
  heatmapDays,
  monthsInWindow,
  promotedSection,
  rampAnchor,
  rankCategories,
  windowDates,
  windowDays
} from '../utils/home';
import { Scope } from '../utils/insights';
import { TEST_CATEGORIES } from './categories.fixture';
import { Budget, CategoryComparison, Finding } from '../types/expense.types';

const ROLLING = { start: '2026-07-13', end: '2026-08-11' }; // 30 days ending today
const PREVIOUS = { start: '2026-06-13', end: '2026-07-12' };
const CALENDAR = { start: '2026-08-01', end: '2026-08-31' };
const CALENDAR_PREVIOUS = { start: '2026-07-01', end: '2026-07-31' };
const TODAY = '2026-08-11';

const row = (category: string, current: number, previous: number, currency = 'PLN'): CategoryComparison => ({
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

const scope: Scope = { view: 'PLN', primary: 'PLN', rates: { USD: 1, PLN: 0.25, BTC: 65000 } };
const combined: Scope = { ...scope, view: 'primary' };

describe('windows', () => {
  it('counts a window inclusively, both ends', () => {
    expect(windowDays(ROLLING)).toBe(30);
    expect(windowDays(CALENDAR)).toBe(31);
    expect(windowDays({ start: '2026-08-11', end: '2026-08-11' })).toBe(1);
  });

  it('treats a rolling window as fully elapsed, because it ends at the anchor', () => {
    expect(elapsedDays(ROLLING, TODAY)).toBe(30);
  });

  it('counts only the part of a calendar month that has happened', () => {
    // The whole point: a month runs to the 31st, and dividing its spend by 31 on
    // the 11th understates the daily rate by two thirds.
    expect(elapsedDays(CALENDAR, TODAY)).toBe(11);
    expect(elapsedDays(CALENDAR, '2026-08-31')).toBe(31);
    // Never more than the window holds, whatever the clock says.
    expect(elapsedDays(CALENDAR, '2026-09-04')).toBe(31);
  });

  it('reports what is left of a window, and nothing once it has ended', () => {
    expect(daysLeft(CALENDAR, TODAY)).toBe(20);
    expect(daysLeft(ROLLING, TODAY)).toBe(0);
    expect(daysLeft(PREVIOUS, TODAY)).toBe(0);
  });

  it('offers exactly the three page windows, defaulting to the rolling 30 days', () => {
    expect(PAGE_WINDOWS.map(w => w.label)).toEqual(['Last 30 days', 'This month', 'Last 12 months']);
    // Each one is a period/window pair the insights API already accepts, so the
    // control invents no arithmetic of its own.
    expect(PAGE_WINDOWS.map(w => `${w.period}/${w.window}`))
      .toEqual(['month/rolling', 'month/calendar', 'year/rolling']);
    expect(DEFAULT_PAGE_WINDOW.label).toBe('Last 30 days');
  });

  it('names a rolling window by its length and a calendar one by its month', () => {
    expect(describeWindow(ROLLING, PREVIOUS, false)).toEqual({
      window: 'in the last 30 days',
      previous: 'the 30 days before'
    });

    const calendar = describeWindow(CALENDAR, CALENDAR_PREVIOUS, true);
    expect(calendar.window).toMatch(/^so far in August 2026$/);
    expect(calendar.previous).toBe('July 2026');
  });

  it('prints a window as the dates it actually covers', () => {
    expect(windowDates(ROLLING)).toBe('13 Jul 2026 – 11 Aug 2026');
  });

  it('gives the habit sections the twelve months ending today', () => {
    // The second clock. Forced to 30 days the weekday chart has about four
    // samples per weekday, which is ruling R2's whole argument.
    expect(habitWindow(TODAY)).toEqual({ start: '2025-08-11', end: '2026-08-11' });
    // Day clamped to the target month's length, so the last of March does not
    // become the 31st of February.
    expect(habitWindow('2026-03-31').start).toBe('2025-03-31');
    expect(habitWindow('2024-02-29').start).toBe('2023-02-28');
  });
});

describe('the headline', () => {
  const rows = [row('groceries', 1000, 800), row('transport', 600, 500)];

  it('states the total and the daily rate over the window', () => {
    const facts = headlineFacts({ rows, current: ROLLING, previous: PREVIOUS, today: TODAY })!;
    expect(facts.total).toBe(1600);
    expect(facts.perDay).toBeCloseTo(1600 / 30, 6);
  });

  it('compares equal-length windows, which is the same as comparing the totals', () => {
    const facts = headlineFacts({ rows, current: ROLLING, previous: PREVIOUS, today: TODAY })!;
    // 1600 against 1300 is +23.1%, and per day it is 53.33 against 43.33 — the
    // same figure, because `rolling` guarantees two windows of one length.
    expect(facts.changePct).toBe(23.1);
    expect(facts.perDayComparison).toBe(false);
  });

  it('compares a partial calendar month per day, not total against total', () => {
    // 1600 in eleven days of August against 1300 in the whole of July. Compared
    // as totals that is +23%; compared per day, which is the only fair reading,
    // it is 145.45 against 41.94 — nearly 250% more. The naive version reports a
    // collapse in spending on the 3rd of every month.
    const facts = headlineFacts({ rows, current: CALENDAR, previous: CALENDAR_PREVIOUS, today: TODAY })!;
    expect(facts.perDay).toBeCloseTo(1600 / 11, 6);
    expect(facts.changePct).toBe(246.9);
    expect(facts.perDayComparison).toBe(true);
  });

  it('has no percentage when there was nothing before to divide by', () => {
    const facts = headlineFacts({
      rows: [row('groceries', 1000, 0)],
      current: ROLLING,
      previous: PREVIOUS,
      today: TODAY
    })!;
    expect(facts.changePct).toBeNull();
  });

  it('says nothing at all when the window holds no spending', () => {
    // A headline over zero is not a quieter headline, it is a wrong one.
    expect(headlineFacts({ rows: [], current: ROLLING, previous: PREVIOUS, today: TODAY })).toBeNull();
    expect(headlineFacts({
      rows: [row('groceries', 0, 900)],
      current: ROLLING,
      previous: PREVIOUS,
      today: TODAY
    })).toBeNull();
  });
});

describe('where it went', () => {
  const seven = [
    row('groceries', 1000, 800),
    row('transport', 600, 500),
    row('media', 400, 400),
    row('utilities', 300, 0),
    row('entertainment', 200, 100),
    row('maintenance', 100, 200),
    row('other', 50, 25)
  ];

  it('ranks by what was spent, biggest first', () => {
    const ranked = rankCategories(seven);
    expect(ranked.slice(0, 3).map(r => r.category)).toEqual(['groceries', 'transport', 'media']);
  });

  it('collapses everything past the sixth row into one', () => {
    const ranked = rankCategories(seven);
    expect(ranked).toHaveLength(RANKED_CATEGORIES + 1);
    expect(ranked[RANKED_CATEGORIES]).toMatchObject({ category: null, current: 50, previous: 25, categories: 1 });
  });

  it('adds up several leftovers into one row and recomputes its change', () => {
    const ranked = rankCategories([...seven, row('pet-food', 40, 10), row('gifts', 10, 0)]);
    const rest = ranked[RANKED_CATEGORIES];
    // A percentage cannot be averaged: 100 against 35 is +185.7%, not the mean
    // of three category percentages.
    expect(rest).toMatchObject({ category: null, current: 100, previous: 35, categories: 3, deltaPct: 185.7 });
  });

  it('gives every row its share of the window', () => {
    const ranked = rankCategories(seven);
    expect(ranked[0].share).toBeCloseTo(1000 / 2650, 6);
    expect(ranked.reduce((sum, r) => sum + r.share, 0)).toBeCloseTo(1, 6);
  });

  it('has no percentage for a category with no previous spend', () => {
    const ranked = rankCategories(seven);
    expect(ranked.find(r => r.category === 'utilities')?.deltaPct).toBeNull();
  });

  it('leaves out a category that was not spent on in this window', () => {
    // This is a decomposition of the headline's total, and a category that fell
    // to zero is not part of it. The drop is what a `category_moved` finding
    // says, if it outranks everything else on the page.
    const ranked = rankCategories([row('groceries', 1000, 800), row('media', 0, 500)]);
    expect(ranked.map(r => r.category)).toEqual(['groceries']);
  });

  it('returns nothing at all for a window with no spending', () => {
    expect(rankCategories([])).toEqual([]);
    expect(rankCategories([row('media', 0, 500)])).toEqual([]);
  });
});

describe('the budget verdict', () => {
  const budgets: Budget[] = [
    { category: 'groceries', currency: 'PLN', amount: 800 },
    { category: 'transport', currency: 'PLN', amount: 640 },
    { category: 'media', currency: 'PLN', amount: 1000 }
  ];
  const spent = new Map([['groceries', 1000], ['transport', 600], ['media', 400]]);

  it('scales a monthly limit to the window it is being compared against', () => {
    // Budgets have no month dimension at all, so a year of spending against one
    // monthly limit would report everybody as 1100% over.
    expect(monthsInWindow(30)).toBe(1);
    expect(monthsInWindow(31)).toBe(1);
    expect(monthsInWindow(365)).toBe(12);
  });

  it('separates over, close and on track', () => {
    const verdict = budgetVerdict({ budgets, spent, months: 1, scope });
    expect(verdict.over.map(row => row.category)).toEqual(['groceries']);
    expect(verdict.over[0].pct).toBe(125);
    // 600 of 640 is 93.75%, past the threshold but not over it.
    expect(verdict.close.map(row => row.category)).toEqual(['transport']);
    expect(600 / 640).toBeGreaterThanOrEqual(BUDGET_CLOSE);
    expect(verdict.onTrack).toBe(1);
    expect(verdict.limits).toBe(3);
  });

  it('says nothing is over rather than saying nothing', () => {
    // A clean month is an answer. Scanning ten cards and receiving an absence
    // is what F4 was.
    const verdict = budgetVerdict({ budgets, spent: new Map([['groceries', 10]]), months: 1, scope });
    expect(verdict.over).toEqual([]);
    expect(verdict.limits).toBe(3);
    expect(verdict.onTrack).toBe(3);
  });

  it('has no limits to report when none are set', () => {
    expect(budgetVerdict({ budgets: [], spent, months: 1, scope }).limits).toBe(0);
  });

  it('lists the worst breach first', () => {
    const verdict = budgetVerdict({
      budgets: [
        { category: 'groceries', currency: 'PLN', amount: 800 },
        { category: 'transport', currency: 'PLN', amount: 100 }
      ],
      spent: new Map([['groceries', 1000], ['transport', 400]]),
      months: 1,
      scope
    });
    expect(verdict.over.map(row => row.category)).toEqual(['transport', 'groceries']); // 400% then 125%
  });

  it('multiplies the allowance across a twelve-month window', () => {
    // 800 a month is 9600 over a year, so 9000 of spending is 94% of the
    // allowance — close to it, and not the 1025% over that comparing a year
    // against one monthly limit would report.
    const verdict = budgetVerdict({
      budgets: [{ category: 'groceries', currency: 'PLN', amount: 800 }],
      spent: new Map([['groceries', 9000]]),
      months: 12,
      scope
    });
    expect(verdict.over).toEqual([]);
    expect(verdict.close.map(row => row.category)).toEqual(['groceries']);
    expect(verdict.close[0]).toMatchObject({ allowance: 9600, pct: 94 });
  });

  it('only compares limits in the currency being shown', () => {
    const verdict = budgetVerdict({
      budgets: [
        { category: 'groceries', currency: 'PLN', amount: 800 },
        { category: 'transport', currency: 'USD', amount: 50 }
      ],
      spent,
      months: 1,
      scope
    });
    expect(verdict.limits).toBe(1);
    expect(verdict.over.map(row => row.category)).toEqual(['groceries']);
  });

  it('converts limits into the primary currency for the combined view', () => {
    // 50 USD is 200 zł at these rates, so 600 zł of transport is 300% of it.
    const verdict = budgetVerdict({
      budgets: [{ category: 'transport', currency: 'USD', amount: 50 }],
      spent,
      months: 1,
      scope: combined
    });
    expect(verdict.over).toHaveLength(1);
    expect(verdict.over[0]).toMatchObject({ category: 'transport', allowance: 200, pct: 300 });
  });
});

describe('the heatmap', () => {
  it('draws thirteen whole weeks ending today, aligned to Sundays', () => {
    const days = heatmapDays(new Map(), TODAY);
    // 2026-08-11 is a Tuesday, so the grid runs from the Sunday on or before the
    // 91st day back and ends today: whole columns, no ragged first week.
    expect(days[0].date).toBe('2026-05-10');
    expect(new Date(`${days[0].date}T00:00:00Z`).getUTCDay()).toBe(0);
    expect(days[days.length - 1].date).toBe(TODAY);
    // 91 days plus the three that alignment added at the front, so the last
    // column holds Sunday, Monday and the Tuesday that is today.
    expect(days).toHaveLength(94);
    expect(days.length % 7).toBe(3);
  });

  it('keeps a day with nothing spent, because it is part of the picture', () => {
    const days = heatmapDays(new Map([['2026-08-10', 42]]), TODAY);
    expect(days.find(day => day.date === '2026-08-10')?.amount).toBe(42);
    expect(days.find(day => day.date === '2026-08-09')?.amount).toBe(0);
  });

  it('tops the ramp out at the ninetieth percentile, not the largest day', () => {
    // Nine ordinary days and one outlier. Anchored on 10 000 every ordinary day
    // lands in the bottom fifth of the ramp and they all render alike (change 27).
    const amounts = [10, 20, 30, 40, 50, 60, 70, 80, 90, 10_000];
    expect(rampAnchor(amounts)).toBe(90);
  });

  it('ignores the days with nothing spent when picking the anchor', () => {
    expect(rampAnchor([0, 0, 0, 100])).toBe(100);
    // Nothing spent anywhere: no anchor, which the caller reads as "no heatmap".
    expect(rampAnchor([0, 0])).toBe(0);
    expect(rampAnchor([])).toBe(0);
  });
});

describe('findings and the sections they head', () => {
  const finding = (kind: Finding['kind'], severity: number): Finding => {
    switch (kind) {
      case 'category_moved':
        return { kind, severity, currency: 'PLN', data: { category: 'groceries', current: 1412, previous: 1053.5, delta: 358.5, deltaPct: 34, days: 30, previousDays: 30 } };
      case 'category_new':
        return { kind, severity, currency: 'PLN', data: { category: 'utilities', current: 40, days: 31, previousDays: 28 } };
      case 'recurring_total':
        return { kind, severity, currency: 'PLN', data: { count: 2, monthlyCost: 142.8, totalPaid: 884 } };
      case 'recurring_stopped':
        return { kind, severity, currency: 'PLN', data: { label: 'old gazette', cadence: 'monthly', monthlyCost: 25, totalPaid: 100, lastSeen: '2026-04-10' } };
      case 'merchant_drip':
        return { kind, severity, currency: 'PLN', data: { key: 'żabka', total: 300, count: 20, average: 15, days: 30 } };
      case 'weekend_skew':
        return { kind, severity, currency: 'PLN', data: { weekendPerDay: 111.11, weekdayPerDay: 45.86, ratio: 2.42, days: 30 } };
    }
  };

  it('sends every kind of finding to the section that proves it', () => {
    expect(SECTION_FOR_FINDING).toEqual({
      category_moved: 'categories',
      category_new: 'categories',
      recurring_total: 'subscriptions',
      recurring_stopped: 'subscriptions',
      merchant_drip: 'shop',
      weekend_skew: 'when'
    });
  });

  it('keeps both findings when two of them prove the same section', () => {
    // Dropping the second would throw away something the server thought worth
    // one of its three slots.
    const bySection = findingsBySection([finding('recurring_stopped', 0.5), finding('recurring_total', 0.3)]);
    expect(bySection.get('subscriptions')?.map(f => f.kind)).toEqual(['recurring_stopped', 'recurring_total']);
    expect(bySection.has('when')).toBe(false);
  });

  it('promotes the section whose finding scores far above the rest', () => {
    expect(promotedSection([finding('weekend_skew', 0.75), finding('category_moved', 0.2)])).toBe('when');
  });

  it('promotes nothing when the top two are close together', () => {
    const top = finding('weekend_skew', 0.3);
    const rival = finding('category_moved', 0.25);
    expect(top.severity).toBeLessThan(PROMOTION_MARGIN * rival.severity);
    expect(promotedSection([top, rival])).toBeNull();
  });

  it('never promotes "Where it went", which already sits under the headline', () => {
    expect(promotedSection([finding('category_moved', 0.9), finding('weekend_skew', 0.1)])).toBeNull();
  });

  it('compares against a rival from a different section, not a second finding about the same one', () => {
    // Both of these are Subscriptions. The runner-up is not competition for the
    // slot its own section would take.
    expect(promotedSection([
      finding('recurring_stopped', 0.5),
      finding('recurring_total', 0.45),
      finding('category_moved', 0.05)
    ])).toBe('subscriptions');
  });

  it('promotes an unopposed finding', () => {
    expect(promotedSection([finding('merchant_drip', 0.2)])).toBe('shop');
  });

  it('promotes nothing when there is nothing to say', () => {
    expect(promotedSection([])).toBeNull();
  });
});

/**
 * The six sentence templates, moved here from `InsightsStrip.test.tsx`.
 *
 * Every one of them states the window it measured over. That is not decoration:
 * the habit sections these sentences head measure the same behaviour over twelve
 * months, and a per-day figure with no window on it is how the app came to
 * contradict itself about weekends (F10).
 */
describe('a finding as a sentence', () => {
  const say = (finding: Finding, currency = 'PLN') => findingSentence(finding, TEST_CATEGORIES, currency);

  it('says which way a category moved, in percent and in money', () => {
    const sentence = say({
      kind: 'category_moved',
      severity: 0.4,
      currency: 'PLN',
      data: { category: 'groceries', current: 1412, previous: 1053.5, delta: 358.5, deltaPct: 34, days: 30, previousDays: 30 }
    });
    expect(sentence).toMatch(/^Groceries is up 34%/);
    expect(sentence).toContain('over the last 30 days');
    expect(sentence).toMatch(/1\s*412,00\s*zł/);
    expect(sentence).toMatch(/1\s*053,50\s*zł/);
  });

  it('says "down" when spending fell', () => {
    expect(say({
      kind: 'category_moved',
      severity: 0.4,
      currency: 'PLN',
      data: { category: 'transport', current: 50, previous: 200, delta: -150, deltaPct: -75, days: 30, previousDays: 30 }
    })).toMatch(/^Transport is down 75%/);
  });

  it('names a category that had no spending at all last period', () => {
    // No previous spend means no percentage — the sentence must not invent one.
    // The two windows are not assumed to be the same length either: a calendar
    // March against February is 31 days against 28.
    const sentence = say({
      kind: 'category_new',
      severity: 0.4,
      currency: 'PLN',
      data: { category: 'utilities', current: 40, days: 31, previousDays: 28 }
    });
    expect(sentence).toMatch(/^Utilities is new/);
    expect(sentence).toContain('in the last 31 days');
    expect(sentence).toContain('nothing in the 28 before that');
    expect(sentence).not.toContain('%');
  });

  it('counts the recurring charges and what they have cost', () => {
    const sentence = say({ kind: 'recurring_total', severity: 0.3, currency: 'PLN', data: { count: 2, monthlyCost: 142.8, totalPaid: 884 } });
    expect(sentence).toMatch(/^2 recurring charges/);
    expect(sentence).toMatch(/142,80\s*zł a month/);
    expect(sentence).toMatch(/884,00\s*zł so far/);
  });

  it('uses the singular for a single charge', () => {
    expect(say({ kind: 'recurring_total', severity: 0.3, currency: 'PLN', data: { count: 1, monthlyCost: 43, totalPaid: 344 } }))
      .toMatch(/^1 recurring charge costs about 43,00\s*zł a month/);
  });

  it('names a charge that stopped, and what it had cost by then', () => {
    const sentence = say({
      kind: 'recurring_stopped',
      severity: 0.3,
      currency: 'PLN',
      data: { label: 'old gazette', cadence: 'monthly', monthlyCost: 25, totalPaid: 100, lastSeen: '2026-04-10' }
    });
    expect(sentence).toMatch(/^Old gazette looks like it stopped/);
    expect(sentence).toContain('10 Apr 2026');
    expect(sentence).toMatch(/100,00\s*zł/);
  });

  it('adds up the small purchases at one place', () => {
    // Merchant keys are a case-folded grouping key, not a name.
    const sentence = say({ kind: 'merchant_drip', severity: 0.2, currency: 'PLN', data: { key: 'żabka', total: 300, count: 20, average: 15, days: 30 } });
    expect(sentence).toMatch(/^Żabka adds up/);
    expect(sentence).toContain('across 20 purchases in the last 30 days');
    expect(sentence).toMatch(/300,00\s*zł/);
    expect(sentence).toMatch(/15,00\s*zł each/);
  });

  it('says which side of the week costs more, whichever side it is', () => {
    expect(say({ kind: 'weekend_skew', severity: 0.5, currency: 'PLN', data: { weekendPerDay: 111.11, weekdayPerDay: 45.86, ratio: 2.42, days: 30 } }))
      .toMatch(/^Weekends cost more — about 111,11\s*zł a day/);
    // A ratio below 1 is the same finding pointing the other way.
    expect(say({ kind: 'weekend_skew', severity: 0.5, currency: 'PLN', data: { weekendPerDay: 20, weekdayPerDay: 80, ratio: 0.25, days: 30 } }))
      .toMatch(/^Weekdays cost more — about 80,00\s*zł a day/);
  });

  it('states the window it measured the week over, whichever side won', () => {
    expect(say({ kind: 'weekend_skew', severity: 0.5, currency: 'PLN', data: { weekendPerDay: 111.11, weekdayPerDay: 45.86, ratio: 2.42, days: 30 } }))
      .toContain('over the last 30 days');
    expect(say({ kind: 'weekend_skew', severity: 0.5, currency: 'PLN', data: { weekendPerDay: 20, weekdayPerDay: 80, ratio: 0.25, days: 14 } }))
      .toContain('over the last 14 days');
  });

  it('formats every amount in the currency the payload came back in', () => {
    // Nothing here converts: the server has already decided what currency the
    // findings are in, and says so.
    const sentence = say({
      kind: 'category_moved',
      severity: 0.4,
      currency: 'USD',
      data: { category: 'groceries', current: 150, previous: 75, delta: 75, deltaPct: 100, days: 30, previousDays: 30 }
    }, 'USD');
    expect(sentence).toContain('$150.00');
    expect(sentence).toContain('$75.00');
  });
});
