/**
 * Tests for the demo seed (src/scripts/seed.ts).
 *
 * Two things are being defended here, and they are not the same thing:
 *
 *   - the guards, because a seed that can reach the owner's real ledger
 *     destroys months of actual financial records, and an untested safety
 *     check is not a safety check. Those cases drive `guardTarget` directly
 *     with a fake ledger, so they can assert what it refuses to *open*.
 *   - the ledger's content, because the demo exists to make the insights strip
 *     say something. If a scoring threshold moves and the demo goes silent,
 *     this file should fail rather than the launch.
 *
 * Everything runs against a throwaway database belonging to this file alone
 * (see src/tests/db-per-file.ts). The snapshot/restore of settings, rates,
 * categories and budgets around the seeding block therefore owes nothing to the
 * next suite; it stays because `runSeed` rewrites all four, and a case added
 * after that block should not have to know what the demo left behind.
 */

import path from 'path';
import { db } from '../config/database';
import * as expenseModel from '../models/expense';
import * as budgetModel from '../models/budget';
import * as categoryModel from '../models/category';
import * as currencyModel from '../models/currency';
import * as fxModel from '../models/fx';
import * as settingsModel from '../models/settings';
import * as insights from '../models/insights';
import { buildLedger, guardTarget, parseArgs, runSeed, SeedRefusal } from '../scripts/seed';
import { AppSettings } from '../types/expense.types';

/** Fixed so every assertion below can name dates instead of computing them. */
const ANCHOR = '2026-08-10';
const WINDOW_START = '2026-07-12'; // the 30-day window the insights score

const ALL_KINDS: insights.FindingKind[] = [
  'category_moved', 'category_new', 'recurring_total',
  'recurring_stopped', 'merchant_drip', 'weekend_skew',
];

describe('seed guards', () => {
  /** A ledger that records whether it was opened at all. */
  const fakeLedger = (rows: number) => {
    const wipe = jest.fn(() => rows);
    return { ledger: { count: () => rows, wipe }, wipe };
  };

  it('refuses to run at all when DB_PATH is not set', async () => {
    const open = jest.fn();
    await expect(guardTarget({ dbPath: undefined, open })).rejects.toThrow(/DB_PATH is not set/);
    // The refusal has to come *before* anything opens a database: loading
    // config/database is what would create the file this guard exists to avoid.
    expect(open).not.toHaveBeenCalled();
  });

  it('refuses an empty DB_PATH the same way as a missing one', async () => {
    await expect(guardTarget({ dbPath: '', open: jest.fn() })).rejects.toThrow(SeedRefusal);
  });

  it('refuses the default database, however it is spelled', async () => {
    const cwd = path.join(path.sep, 'srv', 'sundry', 'backend');
    const open = jest.fn();

    for (const spelling of [
      './data/expenses.db',
      'data/expenses.db',
      'data/../data/expenses.db',
      path.join(cwd, 'data', 'expenses.db'),
    ]) {
      await expect(guardTarget({ dbPath: spelling, cwd, force: true, open }))
        .rejects.toThrow(/that is the default database/);
    }

    expect(open).not.toHaveBeenCalled();
  });

  it('allows any other path', async () => {
    const cwd = path.join(path.sep, 'srv', 'sundry', 'backend');
    const { ledger } = fakeLedger(0);
    const result = await guardTarget({ dbPath: './data/demo.db', cwd, open: async () => ledger });
    expect(result.target).toBe(path.join(cwd, 'data', 'demo.db'));
    expect(result.deleted).toBe(0);
  });

  it('refuses a ledger that already holds expenses', async () => {
    const { ledger, wipe } = fakeLedger(412);
    await expect(guardTarget({ dbPath: '/tmp/demo.db', open: async () => ledger }))
      .rejects.toThrow(/already holds 412 expense\(s\)/);
    expect(wipe).not.toHaveBeenCalled();
  });

  it('wipes it with --force, and says how many rows went', async () => {
    const { ledger, wipe } = fakeLedger(412);
    const result = await guardTarget({ dbPath: '/tmp/demo.db', force: true, open: async () => ledger });
    expect(wipe).toHaveBeenCalledTimes(1);
    expect(result.deleted).toBe(412);
  });

  it('still clears an already-empty ledger under --force', async () => {
    // The wipe is also what resets the AUTOINCREMENT counter, so skipping it
    // would let a database emptied by something else hand its old sequence to
    // the demo — and the row ids would stop being reproducible.
    const { ledger, wipe } = fakeLedger(0);
    const result = await guardTarget({ dbPath: '/tmp/demo.db', force: true, open: async () => ledger });
    expect(wipe).toHaveBeenCalledTimes(1);
    expect(result.deleted).toBe(0);
  });
});

describe('seed CLI arguments', () => {
  it('reads the anchor and the force flag', () => {
    expect(parseArgs(['--anchor=2026-08-10', '--force'])).toEqual({ anchor: '2026-08-10', force: true });
    expect(parseArgs([])).toEqual({ anchor: undefined, force: false });
  });

  it('refuses an argument it does not understand rather than ignoring it', () => {
    // `--anchor 2026-08-10` with a space would otherwise seed a different demo
    // than the one asked for, silently.
    expect(() => parseArgs(['--anchor', '2026-08-10'])).toThrow(SeedRefusal);
  });

  it('refuses an anchor that is not a real date', async () => {
    await expect(runSeed({ anchor: '2026-02-30', force: true })).rejects.toThrow(/real date/);
    await expect(runSeed({ anchor: 'yesterday', force: true })).rejects.toThrow(SeedRefusal);
  });
});

describe('the seeded demo ledger', () => {
  interface Row {
    id: number;
    amount: number;
    date: string;
    description: string;
    category: string;
    currency: string;
    merchant: string | null;
  }

  /** Everything that decides what a row means — `created_at` is a clock, so it is out. */
  const snapshot = (): Row[] =>
    db.prepare('SELECT id, amount, date, description, category, currency, merchant FROM expenses ORDER BY id')
      .all() as Row[];

  let originalSettings: AppSettings;
  let originalRates: Array<{ currency: string; rate: number }>;
  let first: Awaited<ReturnType<typeof runSeed>>;
  let second: Awaited<ReturnType<typeof runSeed>>;
  let firstRows: Row[];
  let secondRows: Row[];

  beforeAll(async () => {
    originalSettings = settingsModel.getSettings();
    originalRates = db.prepare('SELECT currency, rate FROM fx_rates').all() as typeof originalRates;

    first = await runSeed({ anchor: ANCHOR, force: true });
    firstRows = snapshot();
    second = await runSeed({ anchor: ANCHOR, force: true });
    secondRows = snapshot();
  });

  afterAll(() => {
    expenseModel.deleteAll();
    for (const budget of budgetModel.getAll()) budgetModel.remove(budget.category, budget.currency);
    for (const slug of first.categories) categoryModel.remove(slug);

    currencyModel.setEnabled('EUR', false);
    db.prepare('DELETE FROM fx_rates').run();
    for (const rate of originalRates) fxModel.setRate(rate.currency, rate.rate);
    settingsModel.updateSettings(originalSettings);
  });

  it('writes a few hundred rows across roughly eighteen months', () => {
    expect(first.expenses).toBe(firstRows.length);
    expect(firstRows.length).toBeGreaterThan(400);
    expect(firstRows.length).toBeLessThan(900);
    expect(first.from).toBe('2025-02-10');
  });

  it('produces identical rows on a second run at the same anchor', () => {
    // Ids included: `deleteAll` resets the autoincrement, so a deterministic
    // insert order has to reproduce the same ids too.
    expect(secondRows).toEqual(firstRows);
    expect(second.deleted).toBe(first.expenses);
  });

  it('keeps the demo current: the newest row is inside the scored window', () => {
    const newest = (db.prepare('SELECT MAX(date) AS date FROM expenses').get() as { date: string }).date;
    expect(newest <= ANCHOR).toBe(true);
    expect(newest >= WINDOW_START).toBe(true);
  });

  it('spends in more than one currency, PLN in the bulk', () => {
    expect(first.currencies).toEqual(['BTC', 'EUR', 'PLN']);
    const pln = firstRows.filter(row => row.currency === 'PLN').length;
    expect(pln / firstRows.length).toBeGreaterThan(0.85);
    expect(currencyModel.getByCode('EUR')).toMatchObject({ enabled: true });
  });

  it('adds categories beyond the built-in seven, and spends in them', () => {
    for (const slug of first.categories) {
      expect(categoryModel.getBySlug(slug)).toMatchObject({ slug, isBuiltin: false });
      expect(firstRows.some(row => row.category === slug)).toBe(true);
    }
  });

  it('sets a merchant on a few rows and leaves the rest NULL', () => {
    const scanned = firstRows.filter(row => row.merchant !== null);
    expect(scanned.length).toBeGreaterThan(0);
    expect(scanned.length / firstRows.length).toBeLessThan(0.1);
    // The fallback the merchant column exists for: a row whose description the
    // user rewrote still groups under the shop the scan saw.
    expect(scanned.some(row => row.merchant === 'Żabka' && row.description !== 'Żabka')).toBe(true);
  });

  it('leaves receipt_image NULL, since no placeholder image ships with the repo', () => {
    const withImage = db.prepare('SELECT COUNT(*) AS n FROM expenses WHERE receipt_image IS NOT NULL')
      .get() as { n: number };
    expect(withImage.n).toBe(0);
  });

  it('gives the Budgets tab something to show', () => {
    expect(budgetModel.getAll().length).toBeGreaterThanOrEqual(4);
  });

  it('round-trips a BTC amount through the integer column', () => {
    const planned = buildLedger(ANCHOR).filter(row => row.currency === 'BTC');
    const stored = expenseModel.getAll({ currency: 'BTC' });

    expect(stored).toHaveLength(planned.length);
    expect(stored.map(row => row.amount).sort()).toEqual(planned.map(row => row.amount).sort());
    // Eight decimals, not two: the point of these rows is that a satoshi
    // survives `toMinorUnits` and comes back as the same number.
    expect(stored.map(row => row.amount)).toContain(0.000032);
  });

  it('reports only the subscriptions it planted, and the one that stopped', () => {
    // The seed's shop and restaurant streams rotate through fixed pools for
    // exactly this reason: a randomly chosen description repeats on a median
    // gap that drifts into a cadence band, and the demo starts claiming the
    // weekly grocery run is a subscription. This is the assertion that catches
    // it coming back.
    const charges = insights.getRecurring({ today: ANCHOR });

    expect(charges.map(charge => charge.label).sort()).toEqual([
      'electricity', 'gym membership', 'internet', 'monthly transit pass',
      'netflix', 'spotify', 'water and sewage',
    ]);
    expect(charges.filter(charge => charge.likelyCancelled).map(charge => charge.label))
      .toEqual(['gym membership']);
    expect(charges.map(charge => charge.cadence)).toContain('quarterly');
  });

  it('gives the insights strip three things to say', () => {
    const summary = insights.getSummary({ anchor: ANCHOR, scope: 'primary' });
    expect(summary.currency).toBe('PLN');
    expect(summary.findings).toHaveLength(insights.DEFAULT_SUMMARY_LIMIT);
  });

  it('reaches every kind of finding the insights model can emit', () => {
    // The acceptance test for the whole file. Every scope, because a finding
    // that only exists in one currency still has to be reachable — and because
    // ranking is per scope, the union is what "the seed plants all six" means.
    const reached = new Set<insights.FindingKind>();
    for (const scope of ['primary', 'PLN', 'EUR', 'BTC']) {
      const summary = insights.getSummary({ anchor: ANCHOR, scope, limit: insights.MAX_SUMMARY_LIMIT });
      for (const finding of summary.findings) reached.add(finding.kind);
    }

    expect([...reached].sort()).toEqual([...ALL_KINDS].sort());
  });

  it('plants a category that rose and one that fell', () => {
    const byCategory = insights.getComparison({ anchor: ANCHOR, currency: 'PLN' }).byCategory;
    const rose = byCategory.find(row => row.category === 'entertainment');
    const fell = byCategory.find(row => row.category === 'maintenance');

    expect(rose!.current).toBeGreaterThan(rose!.previous * 1.5);
    expect(fell!.previous).toBeGreaterThan(0);
    expect(fell!.current).toBe(0);
  });

  it('spends noticeably more per day at weekends', () => {
    const patterns = insights.getPatterns({ since: WINDOW_START, until: ANCHOR, currency: 'PLN' });
    expect(patterns.byCurrency[0].weekendRatio).toBeGreaterThan(1.4);
  });

  it('hides real money in one merchant\'s small purchases', () => {
    const merchants = insights.getMerchants({ since: WINDOW_START, until: ANCHOR, currency: 'PLN' });
    const drip = merchants.merchants.find(merchant => merchant.key === 'żabka');

    expect(drip!.count).toBeGreaterThanOrEqual(insights.SCORING.MIN_DRIP_COUNT);
    expect(drip!.average).toBeLessThan(30);
  });
});
