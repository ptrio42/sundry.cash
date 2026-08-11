/**
 * Demo seed — fills an explicitly named, empty database with a believable
 * fictional ledger.
 *
 *   DB_PATH=./data/demo.db npm run seed --prefix backend
 *
 * `sundry.cash` runs a public demo instance, so this ledger is the first thing
 * a stranger sees. It has to read like a real person's spending and contain
 * nothing that belongs to a real person: shop names are real (they are not
 * personal data, and they are what makes the demo read as genuine), while
 * everything the rows imply about the person spending is invented and dull on
 * purpose. Honesty comes from the banner in the UI, never from odd numbers.
 *
 * Two properties are load-bearing, and both are covered by src/tests/seed.test.ts:
 *
 *   - It refuses to touch the real ledger. See `guardTarget`, and note that no
 *     application module is imported at the top of this file — loading
 *     `config/database` *creates* the database at DB_PATH, so the imports are
 *     dynamic and happen only once the guards have approved the path.
 *   - It is deterministic. Every random choice comes from a seeded xorshift32,
 *     so two runs at the same anchor produce byte-identical rows and the demo
 *     does not shift under people's feet between resets.
 */

import path from 'path';
import type Database from 'better-sqlite3';
import type { CreateExpenseDTO } from '../types/expense.types';

// ---------------------------------------------------------------------------
// Guards — the part of this file that must never be wrong
// ---------------------------------------------------------------------------

/** A refusal, as opposed to a crash: `main` prints it and exits non-zero. */
export class SeedRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SeedRefusal';
  }
}

/** The two things the guards need from a database, and nothing more. */
export interface Ledger {
  /** How many expenses the target already holds. */
  count(): number;
  /** Remove them all, returning how many went. */
  wipe(): number;
}

/**
 * Decide whether this run may write, and to what.
 *
 * All three guards live here, in order, because a reader looking for "why did
 * it refuse?" should find one place rather than three:
 *
 *   1. DB_PATH must be set. `config/database.ts` falls back to
 *      `<cwd>/data/expenses.db` when it is not, which is the owner's real
 *      ledger — months of actual financial records. That fallback is the whole
 *      accident, so this script has no default at all.
 *   2. The path must not resolve to that default anyway. Compared as resolved
 *      absolute paths, since `./data/expenses.db` and `data/../data/expenses.db`
 *      are the same file and only one of them looks like it.
 *   3. The ledger must be empty, unless `--force` was passed — in which case it
 *      is cleared first and the number of deleted rows is reported, so nobody
 *      destroys records without being told how many.
 *
 * Guard 3 needs the database open, which is exactly what guards 1 and 2 permit,
 * so it arrives as `open`: a callback this function runs only after the path
 * has been approved. Tests pass a fake one; `runSeed` passes the real models.
 */
export async function guardTarget<T extends Ledger>(options: {
  dbPath: string | undefined;
  cwd?: string;
  force?: boolean;
  open: (target: string) => Promise<T>;
}): Promise<{ target: string; ledger: T; deleted: number }> {
  const cwd = options.cwd ?? process.cwd();

  if (!options.dbPath) {
    throw new SeedRefusal(
      'DB_PATH is not set. Name the database to seed explicitly, e.g. ' +
      'DB_PATH=./data/demo.db — this script never falls back to a default, ' +
      'because the default is the real ledger.'
    );
  }

  const target = path.resolve(cwd, options.dbPath);
  const defaultPath = path.resolve(cwd, 'data', 'expenses.db');
  if (target === defaultPath) {
    throw new SeedRefusal(
      `Refusing to seed ${target}: that is the default database this app stores real ` +
      'expenses in. Point DB_PATH at a file that belongs to the demo.'
    );
  }

  const ledger = await options.open(target);
  const existing = ledger.count();
  if (existing > 0 && !options.force) {
    throw new SeedRefusal(
      `Refusing to seed ${target}: it already holds ${existing} expense(s). ` +
      'Pass --force to delete them first, or point DB_PATH at an empty file.'
    );
  }

  // `--force` wipes even when the count is already zero. `deleteAll` is also
  // what resets the AUTOINCREMENT counter, and "the same anchor produces the
  // same ledger" has to include the row ids — a database that was emptied by
  // something else would otherwise carry its old sequence into the demo.
  return { target, ledger, deleted: options.force ? ledger.wipe() : 0 };
}

// ---------------------------------------------------------------------------
// Deterministic randomness
// ---------------------------------------------------------------------------

/**
 * mulberry32. Small, fast, seeded — and, unlike the bare xorshift32 this
 * started as, well enough mixed to survive the way the generator below draws
 * from it.
 *
 * That is not a theoretical preference. The day loop consumes a variable,
 * highly structured number of values per day, and against xorshift32's raw
 * output that pattern showed up in the data: the corner-shop stream came out at
 * an effective p of 0.32 where 0.40 was asked for, and one supermarket was
 * chosen three times as often as another. mulberry32 costs one multiply more
 * and the same amount of state.
 */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 0x1_0000_0000;
  };
}

/** Fixed on purpose. Changing it reshuffles the whole demo. */
const PRNG_SEED = 0x5EEDCA5E;

/**
 * Deterministic round-robin over a pool of names.
 *
 * A random choice would be the obvious thing and it is wrong here, because of
 * how `models/insights.ts` reads the result: `getRecurring` groups by
 * description and calls any series whose *median* gap falls in a cadence band
 * (6-8, 27-34, 88-95 or 360-370 days) a subscription. Randomly chosen names
 * produce geometrically distributed gaps whose median drifts into those bands,
 * and the first draft of this file duly reported the demo's supermarket runs as
 * a weekly subscription costing 524 zł a month. A round-robin makes the gap
 * (pool size / events per month) and keeps it there, so every pool below is
 * sized to land between the bands rather than inside one.
 */
function rotation<T>(pool: readonly T[]): () => T {
  let index = 0;
  return () => pool[index++ % pool.length];
}

// ---------------------------------------------------------------------------
// Dates
//
// Deliberately re-implemented rather than imported from models/insights.ts:
// everything in `models/` pulls in `config/database`, and this file must be
// importable — by the test suite, and by `main` before the guards run — without
// opening a database. Twenty lines of calendar arithmetic is the cheaper half
// of that trade. UTC throughout, like the model, so a run west of UTC does not
// land its rows a day early.
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

/** Add whole months, clamping the day to the target month's length. */
function addMonths(iso: string, months: number): string {
  const [year, month, day] = iso.split('-').map(Number);
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  return toISO(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), Math.min(day, lastDay)));
}

/** 0 = Sunday .. 6 = Saturday, the numbering `models/insights.ts` uses. */
function dayOfWeek(iso: string): number {
  return new Date(toUTC(iso)).getUTCDay();
}

/** Today as a local calendar date — same rule as `models/insights.todayISO`. */
function todayISO(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  // Round-trip rejects 2026-02-30 and friends, which Date.UTC happily rolls over.
  return toISO(toUTC(value)) === value && value >= '1000-01-01';
}

/**
 * Every `dayOfMonth` between `from` and `to`, stepping `months` at a time.
 *
 * The gaps this produces are what `getRecurring` classifies: 28-31 days reads
 * as monthly, ~91 as quarterly, ~365 as yearly.
 */
function schedule(from: string, to: string, dayOfMonth: number, months: number): string[] {
  const dates: string[] = [];
  const [year, month] = from.split('-').map(Number);
  let cursor = toISO(Date.UTC(year, month - 1, dayOfMonth));
  while (cursor < from) cursor = addMonths(cursor, months);
  while (cursor <= to) {
    dates.push(cursor);
    cursor = addMonths(cursor, months);
  }
  return dates;
}

// ---------------------------------------------------------------------------
// The catalogue the demo needs beyond what the app ships
// ---------------------------------------------------------------------------

/**
 * Categories are rows, so a demo that only used the built-in seven would leave
 * a visitor thinking the list is fixed. Three extras, created only if absent so
 * a re-run does not collide with itself.
 */
const CUSTOM_CATEGORIES: Array<{ slug: string; label: string; color: string }> = [
  { slug: 'travel', label: 'Travel', color: '#22d3ee' },
  { slug: 'sport', label: 'Sport', color: '#f472b6' },
  { slug: 'gifts', label: 'Gifts', color: '#a3e635' },
];

/**
 * EUR ships disabled; the demo enables it so the currency buttons appear and
 * the conversion work is visible. Rates are set explicitly rather than left to
 * whatever the schema seeded, because "two runs produce the same demo" has to
 * include the numbers every combined total is converted through.
 */
const DEMO_CURRENCY = 'EUR';
const DEMO_RATES: Array<[code: string, usdRate: number]> = [
  ['PLN', 0.25],
  ['EUR', 1.08],
  ['BTC', 65_000],
];

/** Monthly limits, so the Budgets tab is not an empty page. */
const DEMO_BUDGETS: Array<[category: string, currency: string, amount: number]> = [
  ['groceries', 'PLN', 1200],
  ['entertainment', 'PLN', 700],
  ['transport', 'PLN', 900],
  ['utilities', 'PLN', 450],
];

// ---------------------------------------------------------------------------
// The ledger itself
// ---------------------------------------------------------------------------

/** How far back the history runs. Enough for the 26-bucket trend to fill up. */
const HISTORY_MONTHS = 18;

/**
 * Build the whole ledger for an anchor date. Pure: no database, no clock, no
 * `Math.random`, so the tests can call it and compare two runs directly.
 *
 * The shape is not arbitrary. `models/insights.ts` can emit six kinds of
 * finding, and a demo whose insights strip says nothing is a demo of an empty
 * box, so each kind has something planted for it. The comment on each stream
 * names what it is there for; the scoring window every one of them is measured
 * against is the 30 days ending at the anchor, with the 30 before that as the
 * comparison.
 */
export function buildLedger(anchor: string): CreateExpenseDTO[] {
  const random = mulberry32(PRNG_SEED);
  const rows: CreateExpenseDTO[] = [];

  const start = addMonths(anchor, -HISTORY_MONTHS);
  // The window the insights score is the 30 days ending at the anchor; this is
  // the day the 30 before those begin, which is where the fall below is planted.
  const previousStart = addDays(anchor, -59);

  const chance = (probability: number): boolean => random() < probability;

  /**
   * An amount in the range, times an optional multiplier, rounded to grosze.
   *
   * The multiplier is a parameter rather than something callers apply
   * afterwards so that the rounding stays in one place — and so it cannot be
   * applied to the BTC literals further down, where two decimals would round
   * 0.000032 to nothing and trip `CHECK(amount > 0)`.
   */
  const money = (min: number, max: number, factor = 1): number =>
    Math.round((min + random() * (max - min)) * factor * 100) / 100;

  const add = (
    date: string,
    amount: number,
    description: string,
    category: string,
    currency = 'PLN',
    merchant?: string
  ): void => {
    rows.push({ amount, date, description, category, currency, merchant: merchant ?? null });
  };

  // Pool sizes are load-bearing — see `rotation`. Each one turns into a gap of
  // (pool size / events per month) between two rows with the same description,
  // and that gap has to miss every cadence band: supermarkets land near 20
  // days, restaurants near 60, rides near 52. The rarer pools are sized so no
  // single name reaches the three occurrences `getRecurring` needs at all.
  const supermarket = rotation(['Biedronka', 'Lidl', 'Auchan']);
  const restaurant = rotation(['Pizzeria', 'Sushi bar', 'Burger place', 'Ramen bar', 'Bistro', 'Kebab', 'Thai takeaway']);
  const outing = rotation(['Cinema', 'Concert', 'Bowling', 'Escape room', 'Theatre', 'Comedy club', 'Board game café', 'Karaoke']);
  const shop = rotation([
    'Rossmann', 'IKEA', 'Bookstore', 'Hardware store',
    'Barber', 'Flower shop', 'Stationery shop', 'Home goods',
  ]);
  const ride = rotation(['Bolt', 'Uber', 'FreeNow', 'iTaxi']);
  const trip = rotation(['Day trip', 'Hiking trip', 'Aquapark', 'Zoo tickets', 'Botanical garden']);
  const repair = rotation(['Plumber', 'Car service', 'Locksmith', 'Appliance repair', 'Bike service']);
  const scanned = rotation([
    'Sandwich and coffee', 'Lunch', 'Evening snacks',
    'Roll and an energy drink', 'Cold drink and crisps', 'Bread and milk',
  ]);
  const online = rotation([
    { name: 'Steam', category: 'entertainment', min: 9, max: 42 },
    { name: 'Amazon.de', category: 'other', min: 14, max: 68 },
    { name: 'GOG', category: 'entertainment', min: 8, max: 35 },
    { name: 'eBay', category: 'other', min: 12, max: 55 },
  ]);

  for (let date = start; date <= anchor; date = addDays(date, 1)) {
    const dow = dayOfWeek(date);
    const weekend = dow === 0 || dow === 6;

    // merchant_drip — the corner shop. Ten visits a month, none of them worth
    // noticing on its own, and the one line of the report that surprises
    // people. A few rows carry `merchant` instead, exactly as a receipt scan
    // leaves them: the same shop, under a description the user rewrote.
    if (chance(0.28)) {
      const amount = money(5.5, 27);
      if (chance(0.09)) add(date, amount, scanned(), 'groceries', 'PLN', 'Żabka');
      else add(date, amount, 'Żabka', 'groceries');
    }

    if (chance([0.14, 0.03, 0.03, 0.05, 0.07, 0.21, 0.25][dow])) {
      add(date, money(38, 130, weekend ? 1.25 : 1), restaurant(), 'entertainment');
    }

    if (weekend && chance(0.09)) {
      add(date, money(32, 95), outing(), 'entertainment');
    }

    // The custom `travel` category, kept alive between the two holidays below.
    if (weekend && chance(0.06)) {
      add(date, money(45, 130), trip(), 'travel');
    }

    if (chance(0.035)) {
      add(date, money(24, 165), shop(), 'other');
    }
  }

  // --- fixed schedules -----------------------------------------------------

  // Fuel every fifteen days. One chain, one interval, chosen to sit between the
  // weekly and monthly bands so the car never becomes a subscription.
  for (let date = addDays(start, 2); date <= anchor; date = addDays(date, 15)) {
    add(date, money(238, 330), 'Orlen', 'transport', 'PLN', chance(0.2) ? 'Orlen' : undefined);
  }

  // weekend_skew — the big shop every Saturday and the market every third one.
  //
  // Deterministic rather than sampled, and that is the point: this finding is
  // scored over one 30-day window, and a coin flip that came up quiet for a
  // month would leave the demo's first sentence saying nothing. Rotating three
  // chains over a weekly event also puts 21 days between two rows with the
  // same name, which is between the weekly and monthly bands.
  const firstSaturday = addDays(start, (6 - dayOfWeek(start) + 7) % 7);
  for (let date = firstSaturday; date <= anchor; date = addDays(date, 7)) {
    const name = supermarket();
    add(date, money(95, 225), name, 'groceries', 'PLN', chance(0.12) ? name : undefined);
  }
  for (let date = firstSaturday; date <= anchor; date = addDays(date, 21)) {
    add(date, money(42, 118), 'Farmers market', 'groceries');
  }

  for (let date = addDays(start, 5); date <= anchor; date = addDays(date, 24)) {
    add(date, money(21, 29), 'Swimming pool', 'sport');
  }

  // Rides and online orders come one per block rather than as a daily coin
  // flip. A random stream this thin has a *median* gap that wanders, and
  // `getRecurring` classifies on exactly that: the previous draft reported two
  // taxi apps and a games shop as monthly subscriptions. One event per block
  // fixes the average gap; the rotation multiplies it by the pool size, which
  // is what puts both series safely between the bands.
  for (let block = addDays(start, 3); block <= anchor; block = addDays(block, 15)) {
    const date = addDays(block, Math.floor(random() * 15));
    if (date <= anchor) add(date, money(16, 52), ride(), 'transport');
  }

  for (let block = addDays(start, 7); block <= anchor; block = addDays(block, 16)) {
    const purchase = online();
    const date = addDays(block, Math.floor(random() * 16));
    if (date <= anchor) add(date, money(purchase.min, purchase.max), purchase.name, purchase.category, 'EUR');
  }

  // recurring_total — what the active subscriptions cost per month. Monthly,
  // plus a quarterly bill; the utility bills belong here too, because a
  // standing charge is exactly what the report is for.
  for (const date of schedule(start, anchor, 7, 1)) add(date, 43, 'Netflix', 'media');
  for (const date of schedule(start, anchor, 19, 1)) add(date, 23.99, 'Spotify', 'media');
  for (const date of schedule(start, anchor, 2, 1)) add(date, 110, 'Monthly transit pass', 'transport');
  for (const date of schedule(start, anchor, 12, 1)) add(date, 79, 'Internet', 'utilities');
  for (const date of schedule(start, anchor, 15, 1)) add(date, money(148, 265), 'Electricity', 'utilities');
  for (const date of schedule(start, anchor, 22, 3)) add(date, money(205, 255), 'Water and sewage', 'utilities');

  // The yearly one. Planted because the spec asks for a subscription at every
  // cadence, but worth knowing: `getRecurring` needs three occurrences and
  // defaults to the last twelve months, so a yearly charge is never detected —
  // eighteen months of history only holds two of them.
  for (const date of schedule(start, anchor, 9, 12)) add(date, 84, 'Hosting', 'other', 'EUR');

  // recurring_stopped — a gym membership that ran for ten months and stopped
  // four months before the anchor. Well past 1.8 missed cycles, so the report
  // calls it cancelled rather than late.
  for (const date of schedule(addMonths(anchor, -14), addMonths(anchor, -4), 3, 1)) {
    add(date, 149, 'Gym membership', 'sport');
  }

  // Pet food every three weeks, the pet shop every third trip: two more gaps
  // parked between cadence bands.
  let petTrip = 0;
  for (let date = addDays(start, 4); date <= anchor; date = addDays(date, 21)) {
    add(date, money(58, 98), 'Pet food', 'other');
    if (petTrip++ % 3 === 0) add(addDays(date, 3), money(18, 60), 'Pet shop', 'other');
  }

  // category_moved (down) — a repair in the previous window and nothing since.
  // Planted opposite the rise above so the comparison has a fall to find too;
  // the maintenance stream is deliberately stopped before the current window.
  add(addDays(previousStart, 9), 380, 'Plumber', 'maintenance');
  for (let date = start; date < previousStart; date = addDays(date, 1)) {
    if (chance(0.018)) add(date, money(85, 480), repair(), 'maintenance');
  }

  // --- the last thirty days, written out rather than sampled ---------------
  //
  // Everything above is a distribution, and a distribution has quiet months.
  // This one window cannot afford one: it is what the insights strip is scored
  // against, and a visitor who lands on a quiet month is shown an empty box.
  // The three findings that would otherwise be left to luck are planted.

  // category_moved (up) — a month with visitors in it. One-off descriptions, so
  // none of them joins a series `getRecurring` would pick up.
  const treats: Array<[daysAgo: number, amount: number, description: string]> = [
    [26, 168, 'Birthday dinner'],
    [19, 142, 'Tasting menu'],
    [12, 96, 'Jazz club'],
    [7, 128, 'Food festival'],
    [3, 116, 'Rooftop bar'],
  ];
  for (const [daysAgo, amount, description] of treats) {
    add(addDays(anchor, -daysAgo), amount, description, 'entertainment');
  }

  // merchant_drip — a floor under the corner-shop count, which has to clear
  // `SCORING.MIN_DRIP_COUNT` (5) in this window for the finding to exist.
  for (const daysAgo of [23, 15, 6]) {
    add(addDays(anchor, -daysAgo), money(9, 24), 'Żabka', 'groceries');
  }

  // category_new — spend in the current window and none before it. A category
  // the user has just created is the honest way to get one.
  add(addDays(anchor, -21), 189, 'Birthday present', 'gifts');
  add(addDays(anchor, -12), 74.5, 'Flowers', 'gifts');
  add(addDays(anchor, -4), 96, 'Bookshop voucher', 'gifts');

  // Two holidays, in EUR, for the currency buttons and the travel category.
  for (const monthsAgo of [5, 11]) {
    const trip = addMonths(anchor, -monthsAgo);
    add(trip, money(180, 260), 'Hotel', 'travel', 'EUR');
    add(addDays(trip, 1), money(35, 70), 'Museum tickets', 'travel', 'EUR');
    add(addDays(trip, 1), money(40, 90), 'Dinner out', 'entertainment', 'EUR');
    add(addDays(trip, 2), money(60, 140), 'Train tickets', 'travel', 'EUR');
  }

  // A few satoshis. Exact amounts: the point of these rows is that eight
  // decimals survive the round trip through the integer column.
  add(addMonths(anchor, -13), 0.00021, 'Hardware wallet', 'other', 'BTC');
  add(addMonths(anchor, -6), 0.000085, 'VPN, one year', 'utilities', 'BTC');
  add(addDays(anchor, -9), 0.000032, 'Coffee over Lightning', 'entertainment', 'BTC');

  // Insert order decides the row ids, so it has to be as deterministic as the
  // data. Date first, then description, then amount: no two rows can tie.
  rows.sort((a, b) =>
    a.date.localeCompare(b.date) ||
    a.description.localeCompare(b.description) ||
    a.amount - b.amount ||
    a.currency.localeCompare(b.currency)
  );

  return rows;
}

// ---------------------------------------------------------------------------
// Writing it
// ---------------------------------------------------------------------------

/**
 * The application modules, loaded on demand.
 *
 * Every write below goes through the model layer, never raw SQL:
 * `ExpenseModel.create` is what applies `toMinorUnits` against the currency's
 * own exponent, so a hand-written INSERT would put satoshis where grosze
 * belong and nothing would notice until a total looked wrong.
 */
interface Backend extends Ledger {
  db: Database.Database;
  close(): void;
  expenses: typeof import('../models/expense');
  categories: typeof import('../models/category');
  currencies: typeof import('../models/currency');
  budgets: typeof import('../models/budget');
  fx: typeof import('../models/fx');
  settings: typeof import('../models/settings');
}

async function loadBackend(): Promise<Backend> {
  // Dynamic: importing `config/database` opens — and creates — the file at
  // DB_PATH, so this may only run once `guardTarget` has approved it.
  const [database, expenses, categories, currencies, budgets, fx, settings] = await Promise.all([
    import('../config/database'),
    import('../models/expense'),
    import('../models/category'),
    import('../models/currency'),
    import('../models/budget'),
    import('../models/fx'),
    import('../models/settings'),
  ]);

  return {
    db: database.db,
    close: database.closeDatabase,
    expenses,
    categories,
    currencies,
    budgets,
    fx,
    settings,
    count: () => expenses.getAll().length,
    wipe: () => expenses.deleteAll(),
  };
}

/** Categories, currencies, rates and settings the ledger below depends on. */
function configureCatalogue(backend: Backend): void {
  for (const category of CUSTOM_CATEGORIES) {
    if (!backend.categories.getBySlug(category.slug)) backend.categories.create(category);
  }

  backend.currencies.setEnabled(DEMO_CURRENCY, true);
  for (const [code, rate] of DEMO_RATES) backend.fx.setRate(code, rate);

  // PLN is the bulk of the ledger, so it is what combined totals should be
  // converted into — a demo whose primary currency is USD reads as an American
  // app that happens to hold złoty.
  backend.settings.updateSettings({
    defaultCurrency: 'PLN',
    primaryCurrency: 'PLN',
    defaultCategory: 'groceries',
    defaultBtcUnit: 'sats',
  });
}

export interface SeedOptions {
  /** Defaults to today: the demo has to look current every time it is reset. */
  anchor?: string;
  force?: boolean;
  /** Defaults to `process.env.DB_PATH`. */
  dbPath?: string;
  cwd?: string;
}

export interface SeedReport {
  target: string;
  anchor: string;
  from: string;
  /** Rows `--force` removed before writing. */
  deleted: number;
  expenses: number;
  categories: string[];
  currencies: string[];
}

/** Guard, configure, write. Leaves the database open; `main` closes it. */
export async function runSeed(options: SeedOptions = {}): Promise<SeedReport> {
  const anchor = options.anchor ?? todayISO();
  if (!isCalendarDate(anchor)) {
    throw new SeedRefusal(`--anchor must be a real date in YYYY-MM-DD form, got "${anchor}".`);
  }

  const { target, ledger: backend, deleted } = await guardTarget({
    dbPath: options.dbPath ?? process.env.DB_PATH,
    cwd: options.cwd,
    force: options.force,
    open: loadBackend,
  });

  const rows = buildLedger(anchor);

  configureCatalogue(backend);

  // One transaction for several hundred inserts: better-sqlite3 would
  // otherwise fsync per row, and a half-written demo is worse than none.
  backend.db.transaction(() => {
    for (const row of rows) backend.expenses.create(row);
    for (const [category, currency, amount] of DEMO_BUDGETS) {
      backend.budgets.upsert(category, currency, amount);
    }
  })();

  return {
    target,
    anchor,
    from: addMonths(anchor, -HISTORY_MONTHS),
    deleted,
    expenses: rows.length,
    categories: CUSTOM_CATEGORIES.map(category => category.slug),
    currencies: Array.from(new Set(rows.map(row => row.currency))).sort(),
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export function parseArgs(argv: string[]): { anchor?: string; force: boolean } {
  let anchor: string | undefined;
  let force = false;

  for (const arg of argv) {
    if (arg === '--force') force = true;
    else if (arg.startsWith('--anchor=')) anchor = arg.slice('--anchor='.length);
    // Refused rather than ignored: `--anchor 2026-08-10` (a space, not an
    // equals sign) would otherwise seed a silently different demo.
    else throw new SeedRefusal(`Unknown argument "${arg}". Usage: seed [--anchor=YYYY-MM-DD] [--force]`);
  }

  return { anchor, force };
}

async function main(): Promise<void> {
  try {
    const { anchor, force } = parseArgs(process.argv.slice(2));
    const report = await runSeed({ anchor, force });

    if (report.deleted > 0) console.log(`Deleted ${report.deleted} existing expense(s) (--force).`);
    console.log(
      `Seeded ${report.expenses} expenses into ${report.target}\n` +
      `  ${report.from} .. ${report.anchor}\n` +
      `  currencies: ${report.currencies.join(', ')}\n` +
      `  categories added: ${report.categories.join(', ')}`
    );

    const { closeDatabase } = await import('../config/database');
    closeDatabase();
  } catch (error) {
    // A refusal is the expected failure and deserves a message, not a stack.
    console.error(error instanceof SeedRefusal ? `seed: ${error.message}` : error);
    process.exitCode = 1;
  }
}

if (require.main === module) void main();
