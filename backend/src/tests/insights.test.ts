/**
 * Tests for the insights API (comparison + recurring).
 *
 * Every fixture date is hardcoded and every assertion is anchored explicitly —
 * a suite that seeded relative to `new Date()` would start failing on its own
 * next month. `likelyCancelled` is the one verdict that needs "now", so those
 * cases call the model with an injected `today` instead of going over HTTP.
 *
 * The suite shares one temp database with the other test files (see
 * src/tests/env.ts), so each block starts by clearing the expenses table.
 */

import request from 'supertest';
import app from '../server';
import { db } from '../config/database';
import * as expenseModel from '../models/expense';
import * as insightsModel from '../models/insights';
import { CreateExpenseDTO } from '../types/expense.types';

function reset(rows: CreateExpenseDTO[] = []): void {
  db.exec('DELETE FROM expenses');
  rows.forEach(row => expenseModel.create(row));
}

/** Find one comparison row; category+currency is the only unique key. */
function row(body: any, category: string, currency: string) {
  return body.byCategory.find((r: any) => r.category === category && r.currency === currency);
}

describe('GET /api/insights/comparison', () => {
  // Anchor for every case below is 2026-08-10 (a Monday), which makes:
  //   rolling  month -> current 2026-07-12..2026-08-10, previous 2026-06-12..2026-07-11
  //   calendar month -> current 2026-08-01..2026-08-31, previous 2026-07-01..2026-07-31
  beforeAll(() => {
    reset([
      // groceries: spend in both windows
      { amount: 100, date: '2026-06-20', description: 'old groceries', category: 'groceries', currency: 'PLN' },
      { amount: 100, date: '2026-07-15', description: 'mid groceries', category: 'groceries', currency: 'PLN' },
      { amount: 50, date: '2026-08-01', description: 'new groceries', category: 'groceries', currency: 'PLN' },
      // transport: current window only, plus a charge dated after the anchor
      { amount: 40, date: '2026-08-05', description: 'first taxi', category: 'transport', currency: 'PLN' },
      { amount: 500, date: '2026-08-20', description: 'prepaid rail pass', category: 'transport', currency: 'PLN' },
      // media: previous window only
      { amount: 60, date: '2026-06-15', description: 'last magazine', category: 'media', currency: 'PLN' },
      // entertainment in two currencies, so the rows must not merge
      { amount: 0.005, date: '2026-06-20', description: 'btc fun', category: 'entertainment', currency: 'BTC' },
      { amount: 0.01, date: '2026-07-20', description: 'btc fun', category: 'entertainment', currency: 'BTC' },
      { amount: 100, date: '2026-06-20', description: 'pln fun', category: 'entertainment', currency: 'PLN' },
      { amount: 200, date: '2026-07-20', description: 'pln fun', category: 'entertainment', currency: 'PLN' },
      // utilities: exact window boundaries, plus one row just outside
      { amount: 999, date: '2026-06-11', description: 'before window', category: 'utilities', currency: 'PLN' },
      { amount: 10, date: '2026-07-11', description: 'last day of previous', category: 'utilities', currency: 'PLN' },
      { amount: 20, date: '2026-07-12', description: 'first day of current', category: 'utilities', currency: 'PLN' }
    ]);
  });

  it('reports the rolling windows it used', async () => {
    const res = await request(app).get('/api/insights/comparison?anchor=2026-08-10').expect(200);
    expect(res.body.window).toBe('rolling');
    expect(res.body.period).toBe('month');
    expect(res.body.current).toEqual({ start: '2026-07-12', end: '2026-08-10' });
    expect(res.body.previous).toEqual({ start: '2026-06-12', end: '2026-07-11' });
  });

  it('compares equal-length rolling windows', async () => {
    const res = await request(app).get('/api/insights/comparison?anchor=2026-08-10').expect(200);
    expect(row(res.body, 'groceries', 'PLN')).toMatchObject({
      current: 150,
      previous: 100,
      delta: 50,
      deltaPct: 50,
      currentCount: 2,
      previousCount: 1,
      isNew: false
    });
  });

  it('respects both window boundaries to the day', async () => {
    const res = await request(app).get('/api/insights/comparison?anchor=2026-08-10').expect(200);
    // 2026-07-12 is the first day of current, 2026-07-11 the last of previous,
    // and the 999 on 2026-06-11 falls one day before the window opens.
    expect(row(res.body, 'utilities', 'PLN')).toMatchObject({ current: 20, previous: 10 });
  });

  it('stops the current window at the anchor', async () => {
    // A rolling window ends at the anchor, so the 2026-08-20 rail pass is not
    // spending that has happened yet...
    const rolling = await request(app).get('/api/insights/comparison?anchor=2026-08-10').expect(200);
    expect(row(rolling.body, 'transport', 'PLN')).toMatchObject({ current: 40, currentCount: 1 });

    // ...whereas a calendar month runs to the 31st and does include it.
    const calendar = await request(app)
      .get('/api/insights/comparison?window=calendar&period=month&anchor=2026-08-10')
      .expect(200);
    expect(row(calendar.body, 'transport', 'PLN')).toMatchObject({ current: 540, currentCount: 2 });
  });

  it('marks a category with no previous spend as new, without dividing by zero', async () => {
    const res = await request(app).get('/api/insights/comparison?anchor=2026-08-10').expect(200);
    expect(row(res.body, 'transport', 'PLN')).toMatchObject({
      current: 40,
      previous: 0,
      delta: 40,
      deltaPct: null,
      isNew: true
    });
  });

  it('still emits a row for a category that only existed in the previous window', async () => {
    const res = await request(app).get('/api/insights/comparison?anchor=2026-08-10').expect(200);
    expect(row(res.body, 'media', 'PLN')).toMatchObject({
      current: 0,
      previous: 60,
      delta: -60,
      deltaPct: -100,
      currentCount: 0,
      previousCount: 1,
      isNew: false
    });
  });

  it('never merges currencies within a category', async () => {
    const res = await request(app).get('/api/insights/comparison?anchor=2026-08-10').expect(200);
    const entertainment = res.body.byCategory.filter((r: any) => r.category === 'entertainment');
    expect(entertainment).toHaveLength(2);
    expect(row(res.body, 'entertainment', 'BTC')).toMatchObject({ current: 0.01, previous: 0.005, delta: 0.005, deltaPct: 100 });
    expect(row(res.body, 'entertainment', 'PLN')).toMatchObject({ current: 200, previous: 100, delta: 100, deltaPct: 100 });
  });

  it('filters to a single currency on request', async () => {
    const res = await request(app).get('/api/insights/comparison?anchor=2026-08-10&currency=PLN').expect(200);
    expect(res.body.byCategory.length).toBeGreaterThan(0);
    expect(res.body.byCategory.every((r: any) => r.currency === 'PLN')).toBe(true);
  });

  it('orders rows by currency, then by biggest mover', async () => {
    const res = await request(app).get('/api/insights/comparison?anchor=2026-08-10').expect(200);
    expect(res.body.byCategory[0]).toMatchObject({ category: 'entertainment', currency: 'BTC' });
    const pln = res.body.byCategory.filter((r: any) => r.currency === 'PLN').map((r: any) => r.category);
    expect(pln).toEqual(['entertainment', 'media', 'groceries', 'transport', 'utilities']);
  });

  it('uses whole calendar periods when asked, including the incomplete current one', async () => {
    const res = await request(app)
      .get('/api/insights/comparison?window=calendar&period=month&anchor=2026-08-10')
      .expect(200);
    expect(res.body.current).toEqual({ start: '2026-08-01', end: '2026-08-31' });
    expect(res.body.previous).toEqual({ start: '2026-07-01', end: '2026-07-31' });
    // Both boundary rows now sit in the previous month.
    expect(row(res.body, 'utilities', 'PLN')).toMatchObject({ current: 0, previous: 30 });
    // June is outside both windows, so media disappears entirely.
    expect(row(res.body, 'media', 'PLN')).toBeUndefined();
  });

  it('shows why rolling is the default: on the 3rd, calendar inverts the verdict', async () => {
    const calendar = await request(app)
      .get('/api/insights/comparison?window=calendar&period=month&anchor=2026-08-03')
      .expect(200);
    const rolling = await request(app)
      .get('/api/insights/comparison?window=rolling&period=month&anchor=2026-08-03')
      .expect(200);

    // Three days of August measured against the whole of July.
    expect(calendar.body.current).toEqual({ start: '2026-08-01', end: '2026-08-31' });
    expect(row(calendar.body, 'groceries', 'PLN')).toMatchObject({ current: 50, previous: 100, deltaPct: -50 });

    // The same day, measured over two equal 30-day windows, is a rise.
    expect(rolling.body.current).toEqual({ start: '2026-07-05', end: '2026-08-03' });
    expect(rolling.body.previous).toEqual({ start: '2026-06-05', end: '2026-07-04' });
    expect(row(rolling.body, 'groceries', 'PLN')).toMatchObject({ current: 150, previous: 100, deltaPct: 50 });
  });

  it('treats calendar weeks as ISO weeks (Monday-Sunday)', async () => {
    const monday = await request(app)
      .get('/api/insights/comparison?window=calendar&period=week&anchor=2026-08-10')
      .expect(200);
    expect(monday.body.current).toEqual({ start: '2026-08-10', end: '2026-08-16' });
    expect(monday.body.previous).toEqual({ start: '2026-08-03', end: '2026-08-09' });
    // The 2026-08-05 taxi belongs to the week that just ended, not the new one.
    expect(row(monday.body, 'transport', 'PLN')).toMatchObject({ current: 0, previous: 40 });

    // 2026-08-09 is a Sunday: same week as the 10th minus one day.
    const sunday = await request(app)
      .get('/api/insights/comparison?window=calendar&period=week&anchor=2026-08-09')
      .expect(200);
    expect(sunday.body.current).toEqual({ start: '2026-08-03', end: '2026-08-09' });
  });

  it('supports week and year rolling windows', async () => {
    const week = await request(app)
      .get('/api/insights/comparison?period=week&anchor=2026-08-10')
      .expect(200);
    expect(week.body.current).toEqual({ start: '2026-08-04', end: '2026-08-10' });
    expect(week.body.previous).toEqual({ start: '2026-07-28', end: '2026-08-03' });

    const year = await request(app)
      .get('/api/insights/comparison?period=year&anchor=2026-08-10')
      .expect(200);
    expect(year.body.current).toEqual({ start: '2025-08-11', end: '2026-08-10' });
    expect(year.body.previous).toEqual({ start: '2024-08-11', end: '2025-08-10' });

    const calendarYear = await request(app)
      .get('/api/insights/comparison?window=calendar&period=year&anchor=2026-08-10')
      .expect(200);
    expect(calendarYear.body.current).toEqual({ start: '2026-01-01', end: '2026-12-31' });
    expect(calendarYear.body.previous).toEqual({ start: '2025-01-01', end: '2025-12-31' });
  });

  it('defaults to a rolling month anchored on today', async () => {
    const res = await request(app).get('/api/insights/comparison').expect(200);
    expect(res.body.window).toBe('rolling');
    expect(res.body.period).toBe('month');
    expect(Array.isArray(res.body.byCategory)).toBe(true);
  });

  it('rejects unknown parameter values', async () => {
    await request(app).get('/api/insights/comparison?window=sideways').expect(400);
    await request(app).get('/api/insights/comparison?period=decade').expect(400);
    await request(app).get('/api/insights/comparison?anchor=2026-13-01').expect(400);
    await request(app).get('/api/insights/comparison?anchor=last-tuesday').expect(400);
    const res = await request(app).get('/api/insights/comparison?currency=GBP').expect(400);
    expect(res.body.error).toBe('Validation failed');
  });

  it('refuses anchors from before year 1000 instead of answering wrongly', async () => {
    // Date.UTC turns a two-digit year into 19xx, so these cannot be computed honestly.
    await request(app).get('/api/insights/comparison?anchor=0050-06-15').expect(400);
    await request(app).get('/api/insights/comparison?anchor=0999-06-15').expect(400);

    // The model still formats such a year correctly on its own, rather than
    // leaning on the route to keep it out: an unpadded "999-01-01" would sort
    // after every real date and drag the whole ledger into the window.
    const result = insightsModel.getComparison({ window: 'calendar', period: 'year', anchor: '0999-06-15' });
    expect(result.current).toEqual({ start: '0999-01-01', end: '0999-12-31' });
    expect(result.previous).toEqual({ start: '0998-01-01', end: '0998-12-31' });
    expect(result.byCategory).toEqual([]);
  });
});

describe('GET /api/insights/recurring', () => {
  beforeAll(() => {
    reset([
      // A real monthly subscription, billed on the 5th. The description case and
      // padding vary on purpose: the grouping folds them into one series.
      { amount: 43, date: '2026-01-05', description: 'Netflix', category: 'media', currency: 'PLN' },
      { amount: 43, date: '2026-02-05', description: 'netflix', category: 'media', currency: 'PLN' },
      { amount: 43, date: '2026-03-05', description: '  NETFLIX  ', category: 'media', currency: 'PLN' },
      { amount: 43, date: '2026-04-05', description: 'Netflix', category: 'media', currency: 'PLN' },
      { amount: 43, date: '2026-05-05', description: 'Netflix', category: 'media', currency: 'PLN' },
      { amount: 43, date: '2026-06-05', description: 'netflix', category: 'media', currency: 'PLN' },
      { amount: 43, date: '2026-07-05', description: 'Netflix', category: 'media', currency: 'PLN' },
      { amount: 43, date: '2026-08-05', description: 'Netflix', category: 'media', currency: 'PLN' },

      // Same label, different currency — must stay a separate series.
      { amount: 0.0005, date: '2026-05-05', description: 'netflix', category: 'media', currency: 'BTC' },
      { amount: 0.0005, date: '2026-06-05', description: 'netflix', category: 'media', currency: 'BTC' },
      { amount: 0.0005, date: '2026-07-05', description: 'netflix', category: 'media', currency: 'BTC' },
      { amount: 0.0005, date: '2026-08-05', description: 'netflix', category: 'media', currency: 'BTC' },

      // Eight charges like Netflix, but on no schedule at all (median gap 16 days).
      { amount: 55, date: '2026-01-03', description: 'pizza night', category: 'other', currency: 'PLN' },
      { amount: 55, date: '2026-01-09', description: 'pizza night', category: 'other', currency: 'PLN' },
      { amount: 55, date: '2026-01-25', description: 'pizza night', category: 'other', currency: 'PLN' },
      { amount: 55, date: '2026-02-10', description: 'pizza night', category: 'other', currency: 'PLN' },
      { amount: 55, date: '2026-02-12', description: 'pizza night', category: 'other', currency: 'PLN' },
      { amount: 55, date: '2026-03-01', description: 'pizza night', category: 'other', currency: 'PLN' },
      { amount: 55, date: '2026-03-16', description: 'pizza night', category: 'other', currency: 'PLN' },
      { amount: 55, date: '2026-04-20', description: 'pizza night', category: 'other', currency: 'PLN' },

      // Monthly, but the amount moves around.
      { amount: 100, date: '2026-04-01', description: 'gym', category: 'other', currency: 'PLN' },
      { amount: 100, date: '2026-05-01', description: 'gym', category: 'other', currency: 'PLN' },
      { amount: 150, date: '2026-06-01', description: 'gym', category: 'other', currency: 'PLN' },
      { amount: 90, date: '2026-07-01', description: 'gym', category: 'other', currency: 'PLN' },
      { amount: 100, date: '2026-08-01', description: 'gym', category: 'other', currency: 'PLN' },

      // Monthly, then it stops.
      { amount: 25, date: '2025-09-10', description: 'old gazette', category: 'media', currency: 'PLN' },
      { amount: 25, date: '2025-10-10', description: 'old gazette', category: 'media', currency: 'PLN' },
      { amount: 25, date: '2025-11-10', description: 'old gazette', category: 'media', currency: 'PLN' },
      { amount: 25, date: '2025-12-10', description: 'old gazette', category: 'media', currency: 'PLN' },

      // Only two occurrences — below the default threshold.
      { amount: 2000, date: '2026-07-01', description: 'rent', category: 'utilities', currency: 'PLN' },
      { amount: 2000, date: '2026-08-01', description: 'rent', category: 'utilities', currency: 'PLN' }
    ]);
  });

  it('detects a monthly series and prices it per month', async () => {
    const res = await request(app).get('/api/insights/recurring?since=2025-01-01').expect(200);
    const netflix = res.body.recurring.find((r: any) => r.label === 'netflix' && r.currency === 'PLN');

    expect(netflix).toMatchObject({
      label: 'netflix',          // case and padding folded away
      cadence: 'monthly',
      medianAmount: 43,
      occurrences: 8,
      firstSeen: '2026-01-05',
      lastSeen: '2026-08-05',
      amountStability: 'stable',
      totalPaid: 344
    });
    // 43.00 every 31 days = 42.22 per average month.
    expect(netflix.monthlyCost).toBeCloseTo(42.22, 2);
  });

  it('rejects a frequent-but-irregular series with the same occurrence count', async () => {
    const res = await request(app).get('/api/insights/recurring?since=2025-01-01').expect(200);
    expect(res.body.recurring.find((r: any) => r.label === 'pizza night')).toBeUndefined();
    // ...even though it has as many charges as the subscription that was kept.
    expect(res.body.recurring.find((r: any) => r.label === 'netflix')).toBeTruthy();
  });

  it('flags a series whose amount moves as variable', async () => {
    const res = await request(app).get('/api/insights/recurring?since=2025-01-01').expect(200);
    const gym = res.body.recurring.find((r: any) => r.label === 'gym');
    expect(gym).toMatchObject({ cadence: 'monthly', medianAmount: 100, amountStability: 'variable' });
    expect(gym.monthlyCost).toBeCloseTo(99.8, 2);
  });

  it('keeps two currencies with the same label apart', async () => {
    const res = await request(app).get('/api/insights/recurring?since=2025-01-01').expect(200);
    const netflix = res.body.recurring.filter((r: any) => r.label === 'netflix');
    expect(netflix).toHaveLength(2);
    expect(netflix.map((r: any) => r.currency).sort()).toEqual(['BTC', 'PLN']);

    const btc = netflix.find((r: any) => r.currency === 'BTC');
    expect(btc.medianAmount).toBeCloseTo(0.0005, 8);
    expect(btc.totalPaid).toBeCloseTo(0.002, 8);
    // Rounded to whole satoshis, not to cents.
    expect(btc.monthlyCost).toBeCloseTo(0.00049097, 8);
  });

  it('honours minOccurrences', async () => {
    const withDefault = await request(app).get('/api/insights/recurring?since=2025-01-01').expect(200);
    expect(withDefault.body.recurring.find((r: any) => r.label === 'rent')).toBeUndefined();

    const withTwo = await request(app).get('/api/insights/recurring?since=2025-01-01&minOccurrences=2').expect(200);
    expect(withTwo.body.recurring.find((r: any) => r.label === 'rent')).toMatchObject({
      cadence: 'monthly',
      occurrences: 2
    });
  });

  it('excludes charges older than `since`', async () => {
    const res = await request(app).get('/api/insights/recurring?since=2026-01-01').expect(200);
    expect(res.body.recurring.find((r: any) => r.label === 'old gazette')).toBeUndefined();
  });

  it('orders by currency, then by what each one costs per month', async () => {
    const res = await request(app).get('/api/insights/recurring?since=2025-01-01').expect(200);
    expect(res.body.recurring.map((r: any) => `${r.currency}:${r.label}`)).toEqual([
      'BTC:netflix',
      'PLN:gym',
      'PLN:netflix',
      'PLN:old gazette'
    ]);
  });

  // `likelyCancelled` is the only field that depends on "now", so it is checked
  // against the model with an injected today rather than over HTTP.
  it('flags a stopped series as likely cancelled, and a live one as not', () => {
    const charges = insightsModel.getRecurring({ since: '2025-01-01', today: '2026-08-10' });
    const gazette = charges.find(c => c.label === 'old gazette');
    const netflix = charges.find(c => c.label === 'netflix' && c.currency === 'PLN');

    // Last seen 2025-12-10: eight months past a monthly cycle.
    expect(gazette).toMatchObject({ cadence: 'monthly', lastSeen: '2025-12-10', likelyCancelled: true });
    // Last seen five days ago, well inside 1.8 cycles.
    expect(netflix).toMatchObject({ lastSeen: '2026-08-05', likelyCancelled: false });
  });

  it('does not flag a series that is merely one late cycle in', () => {
    // 2026-09-20 is 46 days after the last charge — 1.5 monthly cycles, still within tolerance.
    expect(insightsModel.getRecurring({ since: '2025-01-01', today: '2026-09-20' })
      .find(c => c.label === 'netflix' && c.currency === 'PLN')?.likelyCancelled).toBe(false);
    // Two weeks later it has missed the cycle outright.
    expect(insightsModel.getRecurring({ since: '2025-01-01', today: '2026-10-05' })
      .find(c => c.label === 'netflix' && c.currency === 'PLN')?.likelyCancelled).toBe(true);
  });

  it('defaults `since` to the last twelve months', () => {
    // Anchored on a fixed today so the assertion cannot rot: a window opening
    // 2025-11-15 leaves the gazette with a single charge, below the threshold.
    const charges = insightsModel.getRecurring({ today: '2026-11-15' });
    expect(charges.find(c => c.label === 'old gazette')).toBeUndefined();
    expect(charges.find(c => c.label === 'netflix')).toBeTruthy();
  });

  it('rejects unknown parameter values', async () => {
    await request(app).get('/api/insights/recurring?since=nope').expect(400);
    await request(app).get('/api/insights/recurring?minOccurrences=1').expect(400);
    await request(app).get('/api/insights/recurring?minOccurrences=2.5').expect(400);
    const res = await request(app).get('/api/insights/recurring?minOccurrences=abc').expect(400);
    expect(res.body.error).toBe('Validation failed');
  });
});

describe('Recurring cadence classification', () => {
  // One series per band, plus one that is simply frequent.
  beforeAll(() => {
    reset([
      { amount: 12, date: '2026-06-01', description: 'tram pass', category: 'transport', currency: 'PLN' },
      { amount: 12, date: '2026-06-08', description: 'tram pass', category: 'transport', currency: 'PLN' },
      { amount: 12, date: '2026-06-15', description: 'tram pass', category: 'transport', currency: 'PLN' },
      { amount: 12, date: '2026-06-22', description: 'tram pass', category: 'transport', currency: 'PLN' },

      { amount: 90, date: '2025-09-15', description: 'water bill', category: 'utilities', currency: 'PLN' },
      { amount: 90, date: '2025-12-15', description: 'water bill', category: 'utilities', currency: 'PLN' },
      { amount: 90, date: '2026-03-15', description: 'water bill', category: 'utilities', currency: 'PLN' },
      { amount: 90, date: '2026-06-15', description: 'water bill', category: 'utilities', currency: 'PLN' },

      { amount: 60, date: '2024-06-01', description: 'domain renewal', category: 'other', currency: 'PLN' },
      { amount: 60, date: '2025-06-01', description: 'domain renewal', category: 'other', currency: 'PLN' },
      { amount: 60, date: '2026-06-01', description: 'domain renewal', category: 'other', currency: 'PLN' },

      // Every day for a week: frequent, not a subscription.
      { amount: 15, date: '2026-06-01', description: 'coffee', category: 'other', currency: 'PLN' },
      { amount: 15, date: '2026-06-02', description: 'coffee', category: 'other', currency: 'PLN' },
      { amount: 15, date: '2026-06-03', description: 'coffee', category: 'other', currency: 'PLN' },
      { amount: 15, date: '2026-06-04', description: 'coffee', category: 'other', currency: 'PLN' },
      { amount: 15, date: '2026-06-05', description: 'coffee', category: 'other', currency: 'PLN' }
    ]);
  });

  it('classifies every cadence band and normalises each to a monthly cost', async () => {
    const res = await request(app).get('/api/insights/recurring?since=2024-01-01').expect(200);
    const find = (label: string) => res.body.recurring.find((r: any) => r.label === label);

    expect(find('tram pass')).toMatchObject({ cadence: 'weekly', medianAmount: 12 });
    expect(find('tram pass').monthlyCost).toBeCloseTo(52.18, 2);   // 12.00 every 7 days

    expect(find('water bill')).toMatchObject({ cadence: 'quarterly', medianAmount: 90 });
    expect(find('water bill').monthlyCost).toBeCloseTo(30.11, 2);  // 90.00 every 91 days

    expect(find('domain renewal')).toMatchObject({ cadence: 'yearly', medianAmount: 60, occurrences: 3 });
    expect(find('domain renewal').monthlyCost).toBeCloseTo(5, 2);  // 60.00 every 365 days

    expect(find('coffee')).toBeUndefined();
  });
});

describe('Recurring grouping folds non-ASCII case', () => {
  // Regression: SQLite's built-in LOWER() only folds ASCII, so 'ŻABKA' and
  // 'Żabka' collapse together but 'żabka' does not. One merchant spelled both
  // ways became two series of two, each under the threshold of three — the
  // subscription disappeared from the report entirely rather than being
  // misgrouped. The fix is the `lower_unicode` function in config/database.ts.
  beforeAll(() => {
    reset([
      { amount: 30, date: '2026-05-06', description: 'Żabka', category: 'groceries', currency: 'PLN' },
      { amount: 30, date: '2026-06-06', description: 'żabka', category: 'groceries', currency: 'PLN' },
      { amount: 30, date: '2026-07-06', description: 'ŻABKA', category: 'groceries', currency: 'PLN' },
      { amount: 30, date: '2026-08-06', description: '  Żabka  ', category: 'groceries', currency: 'PLN' }
    ]);
  });

  it('groups one merchant spelled in mixed case as a single series', async () => {
    const res = await request(app).get('/api/insights/recurring?since=2026-01-01').expect(200);

    // Two series of two would both fall below the default threshold, so the
    // count here is what proves the folding rather than the label alone.
    expect(res.body.recurring).toHaveLength(1);
    expect(res.body.recurring[0]).toMatchObject({
      label: 'żabka',
      currency: 'PLN',
      cadence: 'monthly',
      occurrences: 4,
      medianAmount: 30,
      firstSeen: '2026-05-06',
      lastSeen: '2026-08-06',
      amountStability: 'stable'
    });
  });

  it('lowercases the diacritic itself, which SQLite LOWER() leaves alone', () => {
    const [ascii] = db.prepare("SELECT LOWER('Żabka') AS folded").all() as Array<{ folded: string }>;
    const [unicode] = db.prepare("SELECT lower_unicode('Żabka') AS folded").all() as Array<{ folded: string }>;

    expect(ascii.folded).toBe('Żabka');   // built-in: the Ż survives
    expect(unicode.folded).toBe('żabka'); // ours: it does not
  });
});

describe('Insights with an empty ledger', () => {
  beforeAll(() => {
    reset();
  });

  it('returns an empty comparison rather than failing', async () => {
    const res = await request(app).get('/api/insights/comparison?anchor=2026-08-10').expect(200);
    expect(res.body.byCategory).toEqual([]);
    expect(res.body.current).toEqual({ start: '2026-07-12', end: '2026-08-10' });
  });

  it('returns an empty recurring list rather than failing', async () => {
    const res = await request(app).get('/api/insights/recurring').expect(200);
    expect(res.body.recurring).toEqual([]);
  });
});
