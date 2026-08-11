/**
 * Tests for the insights API (comparison + recurring + merchants + patterns).
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
    // A code the shipped catalogue does not carry at all. GBP used to belong
    // here; it is a real (if disabled) currency now, so it is answerable —
    // see the case below.
    const res = await request(app).get('/api/insights/comparison?currency=ZZZ').expect(400);
    expect(res.body.error).toBe('Validation failed');
  });

  it('answers for a real but disabled currency instead of rejecting it', async () => {
    // Insights read history, and disabling a currency never removes the
    // expenses recorded in it — so the question is valid, the answer is just
    // empty for a currency that was never used.
    const res = await request(app).get('/api/insights/comparison?currency=GBP').expect(200);
    expect(res.body.byCategory).toEqual([]);
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

describe('GET /api/insights/merchants', () => {
  // Window used by every case below: 2026-01-01..2026-08-31.
  beforeAll(() => {
    reset([
      // Six coffees at 15 zł. Individually trivial, together the third-biggest
      // line in the ledger — the spend a category total cannot show you.
      { amount: 15, date: '2026-02-02', description: 'Coffee Shop', category: 'other', currency: 'PLN' },
      { amount: 15, date: '2026-02-09', description: 'coffee shop', category: 'other', currency: 'PLN' },
      { amount: 15, date: '2026-02-16', description: 'COFFEE SHOP', category: 'other', currency: 'PLN' },
      { amount: 15, date: '2026-02-23', description: '  Coffee Shop  ', category: 'other', currency: 'PLN' },
      { amount: 15, date: '2026-03-02', description: 'Coffee Shop', category: 'other', currency: 'PLN' },
      { amount: 15, date: '2026-03-09', description: 'Coffee Shop', category: 'other', currency: 'PLN' },

      // One shop, four spellings, and a receipt-sourced merchant on a row whose
      // description the user rewrote into something else entirely.
      { amount: 30, date: '2026-05-06', description: 'Żabka', category: 'groceries', currency: 'PLN' },
      { amount: 30, date: '2026-06-06', description: 'żabka', category: 'groceries', currency: 'PLN' },
      { amount: 30, date: '2026-07-06', description: 'ŻABKA', category: 'groceries', currency: 'PLN' },
      { amount: 40, date: '2026-08-06', description: "beer for Ada's party", category: 'groceries', currency: 'PLN', merchant: 'Żabka' },

      // The merchant wins over the description whenever it is present.
      { amount: 45, date: '2026-04-01', description: 'lunch', category: 'other', currency: 'PLN', merchant: 'Pasibus' },
      { amount: 55, date: '2026-04-15', description: 'burger and fries', category: 'other', currency: 'PLN', merchant: 'Pasibus' },

      // An empty-string merchant is not a merchant: these two must land in the
      // same 'kiosk' group as the row that has none at all (hence the NULLIF).
      { amount: 12, date: '2026-03-01', description: 'Kiosk', category: 'other', currency: 'PLN', merchant: '' },
      { amount: 8, date: '2026-03-02', description: 'kiosk', category: 'other', currency: 'PLN' },

      // Biggest single line, so ordering is checkable.
      { amount: 2000, date: '2026-04-05', description: 'Landlord', category: 'utilities', currency: 'PLN' },

      // Same label in two currencies, which must never merge.
      { amount: 0.0015, date: '2026-05-01', description: 'Netflix', category: 'media', currency: 'BTC' },
      { amount: 43, date: '2026-05-01', description: 'Netflix', category: 'media', currency: 'PLN' },

      // Exactly on each edge, which is inclusive, and one day outside each.
      { amount: 1, date: '2026-01-01', description: 'first day', category: 'other', currency: 'PLN' },
      { amount: 1, date: '2026-08-31', description: 'last day', category: 'other', currency: 'PLN' },
      { amount: 5000, date: '2025-12-31', description: 'last year', category: 'other', currency: 'PLN' },
      { amount: 5000, date: '2026-09-01', description: 'next month', category: 'other', currency: 'PLN' }
    ]);
  });

  const merchants = (body: any, key: string, currency = 'PLN') =>
    body.merchants.find((m: any) => m.key === key && m.currency === currency);

  it('adds up small frequent purchases the category total hides', async () => {
    const res = await request(app).get('/api/insights/merchants?since=2026-01-01&until=2026-08-31').expect(200);
    expect(merchants(res.body, 'coffee shop')).toMatchObject({
      key: 'coffee shop',   // case and padding folded away, as in `recurring`
      currency: 'PLN',
      total: 90,
      count: 6,
      average: 15,
      firstSeen: '2026-02-02',
      lastSeen: '2026-03-09'
    });
  });

  it('falls back to the description when no merchant was captured', async () => {
    const res = await request(app).get('/api/insights/merchants?since=2026-01-01&until=2026-08-31').expect(200);
    expect(merchants(res.body, 'landlord')).toMatchObject({ total: 2000, count: 1 });
  });

  it('prefers the detected merchant over the description', async () => {
    const res = await request(app).get('/api/insights/merchants?since=2026-01-01&until=2026-08-31').expect(200);
    expect(merchants(res.body, 'pasibus')).toMatchObject({ total: 100, count: 2, average: 50 });
    // The descriptions those two rows carry are not groups of their own.
    expect(merchants(res.body, 'lunch')).toBeUndefined();
    expect(merchants(res.body, 'burger and fries')).toBeUndefined();
  });

  it('folds non-ASCII case and merges a scanned merchant with a typed one', async () => {
    const res = await request(app).get('/api/insights/merchants?since=2026-01-01&until=2026-08-31').expect(200);
    // Three spellings plus one row that only knows it was Żabka from the scan.
    expect(merchants(res.body, 'żabka')).toMatchObject({
      total: 130,
      count: 4,
      firstSeen: '2026-05-06',
      lastSeen: '2026-08-06'
    });
    expect(merchants(res.body, "beer for ada's party")).toBeUndefined();
  });

  it('treats an empty-string merchant as no merchant at all', async () => {
    const res = await request(app).get('/api/insights/merchants?since=2026-01-01&until=2026-08-31').expect(200);
    expect(merchants(res.body, 'kiosk')).toMatchObject({ total: 20, count: 2 });
    // Not a group keyed on the empty string, which is what a bare COALESCE gives.
    expect(res.body.merchants.some((m: any) => m.key === '')).toBe(false);
  });

  it('never merges currencies', async () => {
    const res = await request(app).get('/api/insights/merchants?since=2026-01-01&until=2026-08-31').expect(200);
    const netflix = res.body.merchants.filter((m: any) => m.key === 'netflix');
    expect(netflix).toHaveLength(2);
    expect(merchants(res.body, 'netflix', 'BTC')).toMatchObject({ total: 0.0015, count: 1 });
    expect(merchants(res.body, 'netflix', 'PLN')).toMatchObject({ total: 43, count: 1 });
  });

  it('respects the window on both sides', async () => {
    const res = await request(app).get('/api/insights/merchants?since=2026-01-01&until=2026-08-31').expect(200);

    // Both ends are inclusive: a charge dated exactly on an edge counts, and
    // the day either side of it does not. `until` defaults to today, so an
    // off-by-one here would drop everything entered today.
    expect(merchants(res.body, 'first day')).toMatchObject({ count: 1, firstSeen: '2026-01-01' });
    expect(merchants(res.body, 'last day')).toMatchObject({ count: 1, lastSeen: '2026-08-31' });
    expect(merchants(res.body, 'last year')).toBeUndefined();
    expect(merchants(res.body, 'next month')).toBeUndefined();

    // Widened, both appear.
    const wider = await request(app).get('/api/insights/merchants?since=2025-01-01&until=2026-12-31&limit=100').expect(200);
    expect(merchants(wider.body, 'last year')).toBeTruthy();
    expect(merchants(wider.body, 'next month')).toBeTruthy();
  });

  it('says so when the limit cut the list', async () => {
    const cut = await request(app).get('/api/insights/merchants?since=2026-01-01&until=2026-08-31&limit=2').expect(200);
    expect(cut.body.truncated).toBe(true);
    expect(cut.body.limit).toBe(2);
    // Two per currency, biggest first, so a truncated list is still the
    // interesting end of each one.
    expect(cut.body.merchants.map((m: any) => `${m.currency}:${m.key}`)).toEqual([
      'BTC:netflix',
      'PLN:landlord',
      'PLN:żabka'
    ]);

    const whole = await request(app).get('/api/insights/merchants?since=2026-01-01&until=2026-08-31&limit=100').expect(200);
    expect(whole.body.truncated).toBe(false);
    expect(whole.body.merchants.map((m: any) => `${m.currency}:${m.key}`)).toEqual([
      'BTC:netflix',
      'PLN:landlord',
      'PLN:żabka',
      'PLN:pasibus',
      'PLN:coffee shop',
      'PLN:netflix',
      'PLN:kiosk',
      'PLN:first day',
      'PLN:last day'
    ]);
  });

  it('cuts each currency to the limit rather than ranking satoshis against grosze', async () => {
    // 0.0015 BTC is 150 000 satoshis; 2000 zł is 200 000 grosze. A single
    // ordered top-N over the raw column would therefore have dropped BTC
    // entirely here — and on a default install (USD, PLN, BTC) one BTC row
    // would outrank almost every PLN merchant there is.
    const res = await request(app).get('/api/insights/merchants?since=2026-01-01&until=2026-08-31&limit=1').expect(200);

    expect(res.body.merchants.map((m: any) => `${m.currency}:${m.key}`)).toEqual(['BTC:netflix', 'PLN:landlord']);
    expect(res.body.truncated).toBe(true);
  });

  it('reports the window it used and defaults it to the last twelve months', () => {
    // Anchored on a fixed today so the assertion cannot rot.
    const result = insightsModel.getMerchants({ today: '2026-08-31' });
    expect(result).toMatchObject({ since: '2025-08-31', until: '2026-08-31', limit: 20 });
    // 2026-09-01 is past `until`, 2025-12-31 is inside the twelve months.
    expect(result.merchants.find(m => m.key === 'next month')).toBeUndefined();
    expect(result.merchants.find(m => m.key === 'last year')).toBeTruthy();

    // `since` defaults relative to `until`, not to today, so an old `until`
    // still answers for the year before it rather than for an empty window.
    const historical = insightsModel.getMerchants({ until: '2026-03-31', today: '2026-08-31' });
    expect(historical.since).toBe('2025-03-31');
    expect(historical.merchants.find(m => m.key === 'coffee shop')).toMatchObject({ count: 6 });
  });

  it('filters to a single currency on request', async () => {
    const res = await request(app)
      .get('/api/insights/merchants?since=2026-01-01&until=2026-08-31&currency=BTC')
      .expect(200);
    expect(res.body.merchants).toHaveLength(1);
    expect(res.body.merchants[0]).toMatchObject({ key: 'netflix', currency: 'BTC', total: 0.0015, average: 0.0015 });
  });

  it('rejects unknown parameter values', async () => {
    await request(app).get('/api/insights/merchants?since=nope').expect(400);
    await request(app).get('/api/insights/merchants?until=2026-13-01').expect(400);
    await request(app).get('/api/insights/merchants?since=2026-08-01&until=2026-07-01').expect(400);
    await request(app).get('/api/insights/merchants?currency=ZZZ').expect(400);
    await request(app).get('/api/insights/merchants?limit=0').expect(400);
    await request(app).get('/api/insights/merchants?limit=101').expect(400);
    const res = await request(app).get('/api/insights/merchants?limit=2.5').expect(400);
    expect(res.body.error).toBe('Validation failed');
  });
});

describe('GET /api/insights/patterns', () => {
  // 2026-06-01 is a Monday, so 06-06 is the Saturday and 06-07 the Sunday.
  beforeAll(() => {
    reset([
      // Exactly 100 PLN on every day of one week. The weekday *total* is 500
      // against the weekend's 200 — which is a fact about the calendar, not
      // about the spending, and is precisely what the per-day figures remove.
      { amount: 100, date: '2026-06-01', description: 'mon', category: 'other', currency: 'PLN' },
      { amount: 100, date: '2026-06-02', description: 'tue', category: 'other', currency: 'PLN' },
      { amount: 100, date: '2026-06-03', description: 'wed', category: 'other', currency: 'PLN' },
      { amount: 100, date: '2026-06-04', description: 'thu', category: 'other', currency: 'PLN' },
      { amount: 100, date: '2026-06-05', description: 'fri', category: 'other', currency: 'PLN' },
      { amount: 100, date: '2026-06-06', description: 'sat', category: 'other', currency: 'PLN' },
      { amount: 100, date: '2026-06-07', description: 'sun', category: 'other', currency: 'PLN' },

      // A second currency in the same window, spent only at the weekend.
      { amount: 0.001, date: '2026-06-06', description: 'sat btc', category: 'other', currency: 'BTC' },
      { amount: 0.001, date: '2026-06-07', description: 'sun btc', category: 'other', currency: 'BTC' }
    ]);
  });

  const forCurrency = (body: any, currency: string) =>
    body.byCurrency.find((c: any) => c.currency === currency);

  it('reports a ratio of 1.0 for an even spread, not a weekday win', async () => {
    const res = await request(app).get('/api/insights/patterns?since=2026-06-01&until=2026-06-07').expect(200);
    const pln = forCurrency(res.body, 'PLN');

    expect(pln.weekdayPerDay).toBe(100);
    expect(pln.weekendPerDay).toBe(100);
    expect(pln.weekendRatio).toBe(1);

    // The totals the naive version would have compared: 5:2, all calendar.
    const weekdayTotal = [1, 2, 3, 4, 5].reduce((sum, dow) => sum + pln.byWeekday[dow].total, 0);
    const weekendTotal = pln.byWeekday[0].total + pln.byWeekday[6].total;
    expect(weekdayTotal).toBe(500);
    expect(weekendTotal).toBe(200);
  });

  it('returns all seven days, Sunday first, with zeros where nothing was spent', async () => {
    const res = await request(app).get('/api/insights/patterns?since=2026-06-01&until=2026-06-05').expect(200);
    const pln = forCurrency(res.body, 'PLN');

    expect(pln.byWeekday).toHaveLength(7);
    expect(pln.byWeekday.map((d: any) => d.dow)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    // Monday to Friday only: the weekend buckets exist and are empty.
    expect(pln.byWeekday[0]).toMatchObject({ dow: 0, days: 0, total: 0, count: 0, perDay: 0 });
    expect(pln.byWeekday[6]).toMatchObject({ dow: 6, days: 0, total: 0, count: 0, perDay: 0 });
    expect(pln.byWeekday[1]).toMatchObject({ dow: 1, days: 1, total: 100, count: 1, perDay: 100 });
  });

  it('has no ratio when the window contains no weekend to compare against', async () => {
    const res = await request(app).get('/api/insights/patterns?since=2026-06-01&until=2026-06-05').expect(200);
    // Null rather than 0: the answer is "cannot say", not "nothing at weekends".
    expect(forCurrency(res.body, 'PLN').weekendRatio).toBeNull();
  });

  it('divides by the days the window actually holds, not by 5 and 2', async () => {
    // Ten days: Mon 2026-06-01 to Wed 2026-06-10, so Mon/Tue/Wed occur twice.
    const res = await request(app).get('/api/insights/patterns?since=2026-06-01&until=2026-06-10').expect(200);
    const pln = forCurrency(res.body, 'PLN');

    expect(res.body.days).toBe(10);
    expect(pln.byWeekday.map((d: any) => d.days)).toEqual([1, 2, 2, 2, 1, 1, 1]);

    // Only the first week has spending: 500 across 8 weekday-slots, 200 across 2.
    expect(pln.weekdayPerDay).toBe(62.5);
    expect(pln.weekendPerDay).toBe(100);
    expect(pln.weekendRatio).toBe(1.6);
    // Monday's own average halves, because the window holds two Mondays.
    expect(pln.byWeekday[1]).toMatchObject({ days: 2, total: 100, count: 1, perDay: 50 });
  });

  it('keeps currencies apart and rounds each to its own minor unit', async () => {
    const res = await request(app).get('/api/insights/patterns?since=2026-06-01&until=2026-06-07').expect(200);
    expect(res.body.byCurrency.map((c: any) => c.currency)).toEqual(['BTC', 'PLN']);

    const btc = forCurrency(res.body, 'BTC');
    expect(btc.weekendPerDay).toBe(0.001);
    // Nothing on weekdays, so there is nothing to divide by — null, not Infinity.
    expect(btc.weekdayPerDay).toBe(0);
    expect(btc.weekendRatio).toBeNull();
  });

  it('filters to a single currency on request', async () => {
    const res = await request(app)
      .get('/api/insights/patterns?since=2026-06-01&until=2026-06-07&currency=PLN')
      .expect(200);
    expect(res.body.byCurrency).toHaveLength(1);
    expect(res.body.byCurrency[0].currency).toBe('PLN');
  });

  it('defaults the window to the last twelve months', () => {
    // Fixed today, so the assertion cannot rot.
    const result = insightsModel.getPatterns({ today: '2026-06-30' });
    expect(result).toMatchObject({ since: '2025-06-30', until: '2026-06-30', days: 366 });
    expect(result.byCurrency.map(c => c.currency)).toEqual(['BTC', 'PLN']);
  });

  it('counts weekdays the same way a brute-force walk would', () => {
    // The closed-form count is the load-bearing part of this endpoint, so it is
    // checked against the obvious implementation over a batch of odd windows.
    const bruteForce = (start: string, end: string): number[] => {
      const counts = [0, 0, 0, 0, 0, 0, 0];
      for (let ms = Date.parse(`${start}T00:00:00Z`); ms <= Date.parse(`${end}T00:00:00Z`); ms += 86_400_000) {
        counts[new Date(ms).getUTCDay()]++;
      }
      return counts;
    };

    const windows: Array<[string, string]> = [
      ['2026-06-01', '2026-06-01'], // one day
      ['2026-06-01', '2026-06-03'], // three days
      ['2026-06-01', '2026-06-07'], // a whole week
      ['2026-06-01', '2026-06-10'], // a week and a bit
      ['2026-02-01', '2026-03-15'], // spans a month boundary
      ['2024-02-01', '2024-03-01'], // spans a leap day
      ['2025-06-30', '2026-06-30']  // the default window
    ];

    for (const [since, until] of windows) {
      // A row inside the window, so there is a currency bucket to read the day
      // counts off; removed again below so the rest of the suite is untouched.
      expenseModel.create({ amount: 1, date: since, description: 'weekday probe', category: 'other', currency: 'PLN' });

      const expected = bruteForce(since, until);
      const result = insightsModel.getPatterns({ since, until, currency: 'PLN' });

      expect(result.byCurrency[0].byWeekday.map(d => d.days)).toEqual(expected);
      expect(result.days).toBe(expected.reduce((sum, n) => sum + n, 0));

      db.exec(`DELETE FROM expenses WHERE description = 'weekday probe'`);
    }
  });

  it('rejects unknown parameter values', async () => {
    await request(app).get('/api/insights/patterns?since=nope').expect(400);
    await request(app).get('/api/insights/patterns?until=2026-13-01').expect(400);
    await request(app).get('/api/insights/patterns?since=2026-08-01&until=2026-07-01').expect(400);
    // Years below 1000 land in the 20th century via Date.UTC, which would count
    // the wrong weekdays — refused rather than answered wrongly, like `anchor`.
    await request(app).get('/api/insights/patterns?since=0999-01-01').expect(400);
    const res = await request(app).get('/api/insights/patterns?currency=ZZZ').expect(400);
    expect(res.body.error).toBe('Validation failed');
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

  it('returns an empty merchant list rather than failing', async () => {
    const res = await request(app).get('/api/insights/merchants').expect(200);
    expect(res.body.merchants).toEqual([]);
    expect(res.body.truncated).toBe(false);
  });

  it('returns no patterns rather than a division by zero', async () => {
    const res = await request(app).get('/api/insights/patterns?since=2026-06-01&until=2026-06-07').expect(200);
    expect(res.body.byCurrency).toEqual([]);
    expect(res.body.days).toBe(7);
  });
});
