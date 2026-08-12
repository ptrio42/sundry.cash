/**
 * Home — the boot screen, and the answer to "what am I missing?"
 *
 * One screen where there were three. `Dashboard` (overview), `Insights`
 * (ranking) and `InsightsStrip` (a notice box) were organised by technique, and
 * a user had no basis for choosing between them (F3 in
 * `docs/ux-review-findings.md`); two of them rendered the same category
 * decomposition. This is that merge, and afterwards the differentiator is the
 * first thing on the first screen instead of nav item seven.
 *
 * **Two clocks, both stated.** This is ruling R2 and it is the detail that makes
 * the merge safe rather than a worse version of the contradiction it replaces
 * (F1, F10):
 *
 *   - the **page window** control (`Last 30 days · This month · Last 12 months`)
 *     governs the headline, "Where it went" and the budget verdict;
 *   - the **habit sections** (subscriptions, merchants, weekdays) keep their own
 *     twelve months, because 30 days leaves a weekday about four samples and the
 *     merchant list goes thin.
 *
 * The governing rule, which is not optional: **every section states its window**
 * — and so does every finding that heads one. Wave 2 required only the first
 * half, which is how a 30-day weekend sentence came to sit fifteen pixels above
 * a 12-month weekday chart that disagreed with it. `/insights/summary` now scores
 * each finding over the window its section renders and divides `materiality` by
 * the spend in that same window; see `FINDING_WINDOW` in
 * `backend/src/models/insights.ts`.
 *
 * **Findings are section headlines, not a box.** `/insights/summary` still ranks
 * (it is the only thing that can: comparing a PLN finding with a USD one means
 * converting before scoring, so the scope goes to the server), but each sentence
 * it earns now heads the section that proves it. A box at the top repeating
 * three of this page's own sentences would duplicate *itself* — ruling R3. The
 * sentence templates live in `utils/home.ts`, next to the rest of what this
 * screen works out, and the API still refuses to emit prose so that PL/EN stays
 * a frontend concern.
 *
 * Every section **renders nothing when it has nothing to say**, which is the
 * progressive disclosure the dashboard already applied to absent currencies. An
 * empty box costs more than a section that is not there.
 */

import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BarChart, Bar, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import {
  getBudgets,
  getInsightsComparison,
  getInsightsMerchants,
  getInsightsPatterns,
  getInsightsRecurring,
  getInsightsSummary
} from '../services/api';
import {
  Budget,
  ComparisonResult,
  Currency,
  Finding,
  HomeProps,
  MerchantsResult,
  PatternsResult,
  RecurringCharge,
  SummaryResult
} from '../types/expense.types';
import { categoryColor, categoryLabel } from '../utils/categories';
import { scopeCurrencies } from '../utils/currencies';
import { formatCurrency, formatDate } from '../utils/format';
import { convertAmount } from '../utils/fx';
import {
  Scope,
  displayCurrency,
  dripMerchants,
  scopeComparison,
  scopeMerchants,
  scopePattern,
  scopeRecurring,
  weekendWorthSaying
} from '../utils/insights';
import {
  DEFAULT_PAGE_WINDOW,
  HEATMAP_WEEKS,
  HeatmapDay,
  HomeSection,
  PAGE_WINDOWS,
  PageWindow,
  budgetVerdict,
  daysLeft,
  describeWindow,
  findingSentence,
  findingsBySection,
  habitWindow,
  headlineFacts,
  heatmapDays,
  monthsInWindow,
  promotedSection,
  rampAnchor,
  rankCategories,
  todayISO,
  windowDates,
  windowDays
} from '../utils/home';
import CurrencyScope from './CurrencyScope';
import ExcelImport from './ExcelImport';

/** Which request a failure belongs to, so one 500 sinks one section. */
type Block = 'comparison' | 'recurring' | 'merchants' | 'patterns' | 'budgets';

/** The blocks each effect owns, so one effect's failures never clear another's. */
const SPENDING_BLOCKS: Block[] = ['comparison'];
const HABIT_BLOCKS: Block[] = ['recurring', 'merchants', 'patterns', 'budgets'];

/**
 * Asked for at the endpoint's maximum rather than its default of 20.
 *
 * The combined view merges several currencies and re-ranks them, and a merchant
 * the server already dropped cannot come back — so the request has to be
 * generous before the merge, not after it. Asking for the maximum every time
 * also keeps a currency switch a re-render instead of a round trip.
 */
const MERCHANT_LIMIT = 100;

/** How many merchant rows the table shows before it stops being a table. */
const MERCHANT_ROWS = 20;

/** Sunday first, matching the `dow` numbering the buckets come back in. */
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Where someone goes to see what this looks like with a real history behind it. */
const DEMO_URL = 'https://demo.sundry.cash';

/** A merchant key is a case-folded grouping key ('żabka'), not a display name. */
function asName(key: string): string {
  return key.charAt(0).toLocaleUpperCase() + key.slice(1);
}

function titleCase(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/**
 * A section whose endpoint could not be loaded.
 *
 * One quiet line rather than silence. Home is the boot screen now, so a section
 * that simply vanishes on a 500 is indistinguishable from one that had nothing
 * to say — and those two states are the whole vocabulary of this page.
 */
function BlockError({ what }: { what: string }) {
  return <p className="muted-text insight-error">Could not load {what}.</p>;
}

/**
 * `Promise.all` over requests that have already swallowed their own rejections:
 * one endpoint returning a 500 must cost its own section and nothing else.
 *
 * Module scope rather than a closure, so the effects that use it can list honest
 * dependencies instead of silencing the rule that checks them.
 */
function loader(failures: Set<Block>, cancelled: () => boolean) {
  return <T,>(block: Block, request: Promise<T>, apply: (value: T) => void): Promise<void> =>
    request
      .then(value => { if (!cancelled()) apply(value); })
      .catch(() => { failures.add(block); });
}

/**
 * One section: its finding as the headline, then the section's own name and the
 * window it measured over, then whatever proves the claim.
 *
 * DOM order is rank order — the claim first and largest, the label under it —
 * which is how a finding "becomes the heading" without the section losing the
 * short, stable name a screen reader and a scan both need. The window line is
 * never optional: two clocks on one screen are only safe while both are printed.
 */
function Section({ id, title, window: windowLine, claims = [], children }: {
  id: string;
  title: string;
  window: string;
  claims?: string[];
  children?: ReactNode;
}) {
  return (
    <section className="home-section" aria-labelledby={id}>
      <div className="home-section-head">
        {claims.map(claim => <p className="finding" key={claim}>{claim}</p>)}
        <div className="home-section-label">
          <h2 id={id}>{title}</h2>
          <p className="home-window">{windowLine}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

export default function Home({
  expenses,
  settings,
  categories,
  currencies,
  rates,
  onAddExpense,
  onExpensesStale
}: HomeProps) {
  const primary = settings.primaryCurrency;
  const label = (slug: string) => categoryLabel(categories, slug);
  const color = (slug: string) => categoryColor(categories, slug);

  const [pageWindow, setPageWindow] = useState<PageWindow>(DEFAULT_PAGE_WINDOW);
  const [chosenView, setChosenView] = useState<Currency | 'primary'>('primary');
  const [startImport, setStartImport] = useState<boolean>(false);

  const [comparison, setComparison] = useState<ComparisonResult | null>(null);
  const [summary, setSummary] = useState<SummaryResult | null>(null);
  const [recurring, setRecurring] = useState<RecurringCharge[]>([]);
  const [merchants, setMerchants] = useState<MerchantsResult | null>(null);
  const [patterns, setPatterns] = useState<PatternsResult | null>(null);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [failed, setFailed] = useState<Set<Block>>(() => new Set());
  const [loading, setLoading] = useState<boolean>(true);

  // Distinct currencies actually present in the data — including ones the
  // catalogue has since switched off, whose history is still here.
  const presentCurrencies = useMemo(
    () => Array.from(new Set(expenses.map(e => e.currency))),
    [expenses]
  );

  /**
   * One currency in the ledger means there is no choice to offer and nothing to
   * convert, so the control is not rendered and the view is that currency. The
   * combined option would otherwise convert PLN into PLN and label it
   * "All → PLN" — which is what a PLN-only user used to be shown permanently.
   */
  const view: Currency | 'primary' = presentCurrencies.length === 1 ? presentCurrencies[0] : chosenView;
  const converted = view === 'primary';
  const scope = useMemo<Scope>(() => ({ view, primary, rates }), [view, primary, rates]);
  const display = displayCurrency(scope);
  const fmt = (value: number) => formatCurrency(value, display);

  // Fixed for the life of the mount: "today" moving mid-session would silently
  // shift every window the page states, and the day boundary is not an event
  // this screen needs to react to.
  const today = useMemo(() => todayISO(), []);
  const habit = useMemo(() => habitWindow(today), [today]);

  /**
   * The first paint waits for the data; nothing after it does.
   *
   * Clicking a window button re-asks two of the six questions, and swapping the
   * whole page for "Loading…" on every click reads as the control being slow
   * rather than the data being fetched. So the loading state is the initial one
   * only, and a refetch replaces numbers underneath.
   */
  const settled = useRef({ spending: false, habits: false });
  const markSettled = useCallback((which: 'spending' | 'habits') => {
    settled.current[which] = true;
    if (settled.current.spending && settled.current.habits) setLoading(false);
  }, []);

  /** Replace only the failures this effect owns, so two effects cannot fight. */
  const applyFailures = useCallback((owned: Block[], failures: Set<Block>) => {
    setFailed(previous => {
      const next = new Set(previous);
      owned.forEach(block => next.delete(block));
      failures.forEach(block => next.add(block));
      return next;
    });
  }, []);

  const empty = expenses.length === 0;

  // The habit sections and the budget limits. None of them depends on the page
  // window or the currency scope, so they are asked once per ledger — a window
  // click must not cost five requests that would answer identically.
  useEffect(() => {
    let cancelled = false;

    // An empty ledger has nothing that repeats, nothing to rank and nothing to
    // compare. A fresh install should not spend a single request learning that.
    if (empty) {
      setRecurring([]);
      setMerchants(null);
      setPatterns(null);
      setBudgets([]);
      applyFailures(HABIT_BLOCKS, new Set());
      markSettled('habits');
      return;
    }

    const failures = new Set<Block>();
    const load = loader(failures, () => cancelled);

    Promise.all([
      load('recurring', getInsightsRecurring({ since: habit.start }), r => setRecurring(r.recurring)),
      load('merchants', getInsightsMerchants({ limit: MERCHANT_LIMIT }), setMerchants),
      load('patterns', getInsightsPatterns(), setPatterns),
      load('budgets', getBudgets(), setBudgets)
    ]).then(() => {
      if (cancelled) return;
      applyFailures(HABIT_BLOCKS, failures);
      markSettled('habits');
    });

    return () => { cancelled = true; };
  }, [expenses, empty, habit, applyFailures, markSettled]);

  // The spending sections. Asked without a `currency` filter and scoped
  // client-side, exactly as the Insights tab did: nothing here is ranked across
  // currencies, so a currency switch converts what is already in hand.
  useEffect(() => {
    let cancelled = false;

    if (empty) {
      setComparison(null);
      applyFailures(SPENDING_BLOCKS, new Set());
      markSettled('spending');
      return;
    }

    const failures = new Set<Block>();
    const load = loader(failures, () => cancelled);

    load('comparison', getInsightsComparison({ period: pageWindow.period, window: pageWindow.window }), setComparison)
      .then(() => {
        if (cancelled) return;
        applyFailures(SPENDING_BLOCKS, failures);
        markSettled('spending');
      });

    return () => { cancelled = true; };
  }, [expenses, empty, pageWindow, applyFailures, markSettled]);

  /**
   * The findings, which are the only thing on this page the server ranks.
   *
   * The scope *is* part of the question here, unlike everywhere else on the
   * screen: ranking a PLN finding against a USD one requires converting before
   * scoring, so switching currency costs a round trip and buys one
   * implementation of the merge instead of two. The page window goes with it, so
   * a finding heading a *spending* section measures the same window that section
   * does. The habit sections need nothing sent: the server measures those
   * findings over the twelve months `/merchants` and `/patterns` are asked for
   * here without a window of their own, which is why a window click does not
   * refetch them.
   *
   * A failure is silent. Findings are the emphasis on top of sections that work
   * perfectly well without them, and an error banner over a page of real numbers
   * would be the wrong trade.
   */
  useEffect(() => {
    let cancelled = false;

    if (empty) {
      setSummary(null);
      return;
    }

    (async () => {
      try {
        const result = await getInsightsSummary({
          scope: view,
          period: pageWindow.period,
          window: pageWindow.window
        });
        if (!cancelled) setSummary(result);
      } catch {
        if (!cancelled) setSummary(null);
      }
    })();

    return () => { cancelled = true; };
  }, [expenses, empty, pageWindow, view]);

  // --- the spending sections ------------------------------------------------

  const spendRows = useMemo(
    () => scopeComparison(comparison?.byCategory ?? [], scope),
    [comparison, scope]
  );

  const phrases = useMemo(
    () => comparison
      ? describeWindow(comparison.current, comparison.previous, pageWindow.window === 'calendar')
      : null,
    [comparison, pageWindow]
  );

  const headline = useMemo(
    () => comparison
      ? headlineFacts({ rows: spendRows, current: comparison.current, previous: comparison.previous, today })
      : null,
    [comparison, spendRows, today]
  );

  const ranked = useMemo(() => rankCategories(spendRows), [spendRows]);

  const verdict = useMemo(() => {
    if (!comparison) return null;
    const spent = new Map(spendRows.map(row => [row.category, row.current]));
    return budgetVerdict({
      budgets,
      spent,
      months: monthsInWindow(windowDays(comparison.current)),
      scope
    });
  }, [budgets, comparison, spendRows, scope]);

  // --- the habit sections ---------------------------------------------------

  const subscriptions = useMemo(() => scopeRecurring(recurring, scope), [recurring, scope]);
  const active = subscriptions.filter(charge => !charge.likelyCancelled);
  const stopped = subscriptions.filter(charge => charge.likelyCancelled);
  const activeMonthly = active.reduce((sum, charge) => sum + charge.monthlyCost, 0);

  const merchantRows = useMemo(() => scopeMerchants(merchants?.merchants ?? [], scope), [merchants, scope]);
  const drip = useMemo(() => dripMerchants(merchantRows), [merchantRows]);

  const pattern = useMemo(() => scopePattern(patterns?.byCurrency ?? [], scope), [patterns, scope]);
  const weekdayBars = pattern?.byWeekday.map(bucket => ({
    day: DAY_NAMES[bucket.dow],
    short: DAY_NAMES[bucket.dow].slice(0, 3),
    perDay: bucket.perDay
  })) ?? [];
  const hasWeekdaySpend = weekdayBars.some(bar => bar.perDay > 0);
  // Pulled out of `pattern` so the guard below narrows a plain const rather than
  // a property path.
  const weekendRatio = pattern?.weekendRatio ?? null;

  // The heatmap is the one chart Home computes itself: it needs a day per cell
  // over 13 weeks, which no endpoint returns, and the ledger is already loaded.
  const heatmap = useMemo(() => {
    const byDay = new Map<string, number>();
    for (const e of expenses) {
      if (!converted && e.currency !== view) continue;
      const amount = converted ? convertAmount(e.amount, e.currency, primary, rates) : e.amount;
      byDay.set(e.date, (byDay.get(e.date) ?? 0) + amount);
    }
    const days = heatmapDays(byDay, today);
    const anchor = rampAnchor(days.map(day => day.amount));
    const weeks: HeatmapDay[][] = [];
    for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));
    return { weeks, anchor };
  }, [expenses, converted, view, primary, rates, today]);

  // --- findings -------------------------------------------------------------

  // Memoised for its identity, not its cost: `?? []` is a fresh array every
  // render, and the two memos below would recompute on each one.
  const findings = useMemo(() => summary?.findings ?? [], [summary]);
  const bySection = useMemo(() => findingsBySection(findings), [findings]);
  const promoted = useMemo(() => promotedSection(findings), [findings]);

  const claimsFor = (section: HomeSection): string[] =>
    (bySection.get(section) ?? []).map(finding =>
      findingSentence(finding, categories, summary?.currency ?? display));

  /** True when a finding of this kind already heads the section. */
  const headedBy = (section: HomeSection, kind: Finding['kind']): boolean =>
    (bySection.get(section) ?? []).some(finding => finding.kind === kind);

  if (loading) {
    return <div className="loading">Loading your overview…</div>;
  }

  /**
   * A ledger with nothing in it: one Start card, and no tour.
   *
   * If it needed a tour the UI failed, and in a single-user self-hosted app the
   * tour is seen once — by the person who installed it (§5). There is also no
   * in-app seeding button: `backend/src/scripts/seed.ts` refuses unless
   * `DB_PATH` is set explicitly, is not the real ledger, and the ledger is
   * empty, and that guard exists to protect a real ledger. Anyone who wants to
   * see a full one gets the public demo instead.
   */
  if (empty) {
    return (
      <div className="home">
        <section className="start-card" aria-labelledby="home-start">
          <h2 id="home-start">Nothing recorded yet</h2>
          <p className="muted-text">
            Sundry works out what is worth knowing from your own history, so the fastest way to
            a useful screen is to bring the history you already have.
          </p>

          <div className="start-actions">
            <button
              type="button"
              className="btn-primary"
              onClick={() => setStartImport(value => !value)}
              aria-expanded={startImport}
            >
              Import a spreadsheet
            </button>
            <button type="button" className="btn-secondary" onClick={onAddExpense}>
              Add your first expense
            </button>
          </div>

          {/* Inline rather than a destination: importing is the lead action on an
              empty Home (change 12), and sending someone to another screen to do
              it would be the setup cost this product is a complaint about. */}
          {startImport && (
            <div className="start-import">
              <ExcelImport settings={settings} currencies={currencies} onImported={onExpensesStale} />
            </div>
          )}

          <p className="start-demo">
            <a href={DEMO_URL} target="_blank" rel="noopener noreferrer">
              See it with 18 months of sample data →
            </a>
          </p>
        </section>
      </div>
    );
  }

  const pageWindowLine = comparison
    ? `${pageWindow.label} · ${windowDates(comparison.current)}`
    : pageWindow.label;

  const months = comparison ? monthsInWindow(windowDays(comparison.current)) : 1;
  const left = comparison ? daysLeft(comparison.current, today) : 0;

  /**
   * The budget verdict, as one sentence.
   *
   * "Groceries 12% over with 9 days left · 1 close · 5 on track" — the answer
   * Budgets makes you scan ten cards for and then does not give (F4). The
   * caveat about which limits these are lives in the window line, because
   * budgets have no month dimension to compare a past window against.
   */
  const verdictSentence = (): string => {
    if (!verdict) return '';
    const parts = verdict.over.map(row => `${label(row.category)} ${row.pct - 100}% over`);
    if (parts.length === 0) parts.push('Nothing over');
    else if (left > 0) parts[parts.length - 1] += ` with ${left} ${left === 1 ? 'day' : 'days'} left`;
    if (verdict.close.length > 0) parts.push(`${verdict.close.length} close`);
    if (verdict.onTrack > 0) parts.push(`${verdict.onTrack} on track`);
    return `${parts.join(' · ')}.`;
  };

  const deltaText = (row: { deltaPct: number | null; categories: number }): string => {
    if (row.deltaPct === null) return row.categories === 1 ? 'new' : '';
    return `${row.deltaPct > 0 ? '+' : ''}${row.deltaPct.toFixed(1)}%`;
  };

  const deltaClass = (deltaPct: number | null): string =>
    deltaPct === null ? '' : deltaPct > 0 ? 'delta-up' : deltaPct < 0 ? 'delta-down' : '';

  // --- sections, in the reading order that is the product's argument ---------

  const sections: Array<{ key: HomeSection | 'budgets'; node: ReactNode }> = [];

  // 1. Where it went — replaces the donut *and* Analytics' bars. Ranked rows
  //    keep every number, add the delta the donut could not show, and stop
  //    spending resolution on slices thinner than their own padding gap.
  if (failed.has('comparison')) {
    sections.push({ key: 'categories', node: <BlockError key="categories" what="the category breakdown" /> });
  } else if (ranked.length > 0) {
    sections.push({
      key: 'categories',
      node: (
        <Section key="categories" id="home-categories" title="Where it went" window={pageWindowLine} claims={claimsFor('categories')}>
          <ul className="rank-list">
            {ranked.map(row => (
              <li className="rank-row" key={row.category ?? '\0everything-else'}>
                <span className="rank-name">
                  {/* The swatch carries the colour and the text does not, per the
                      rule above `.category-dot` in App.css: a hue picked to read
                      on the dark surface fails on the light one (F14). */}
                  <span
                    className="category-dot"
                    style={{ background: row.category ? color(row.category) : 'var(--text-muted)' }}
                  />
                  {row.category
                    ? label(row.category)
                    : `Everything else (${row.categories} ${row.categories === 1 ? 'category' : 'categories'})`}
                </span>
                <span className="rank-figures">
                  <strong>{fmt(row.current)}</strong>
                  <span className="rank-share">{Math.round(row.share * 100)}%</span>
                  <span className={`rank-delta ${deltaClass(row.deltaPct)}`}>{deltaText(row)}</span>
                </span>
                <span className="rank-bar-track">
                  <span
                    className="rank-bar-fill"
                    style={{
                      width: `${Math.max(1, row.share * 100)}%`,
                      background: row.category ? color(row.category) : 'var(--surface-3)'
                    }}
                  />
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )
    });
  }

  // 2. Budgets — the verdict, and nothing when no limits are set. That absence
  //    is also the state that used to produce a large red negative the moment a
  //    new user saved their first expense.
  if (failed.has('budgets')) {
    sections.push({ key: 'budgets', node: <BlockError key="budgets" what="your budgets" /> });
  } else if (verdict && verdict.limits > 0) {
    sections.push({
      key: 'budgets',
      node: (
        <Section
          key="budgets"
          id="home-budgets"
          title="Budgets"
          window={`${pageWindowLine} · against ${months > 1 ? `${months}× ` : ''}your current monthly limits`}
          claims={[verdictSentence()]}
        />
      )
    });
  }

  // 3. Subscriptions — the most actionable thing the API knows, and the reason
  //    it leads the habit sections: it is the one that makes someone act.
  if (failed.has('recurring')) {
    sections.push({ key: 'subscriptions', node: <BlockError key="subscriptions" what="subscriptions" /> });
  } else if (subscriptions.length > 0) {
    sections.push({
      key: 'subscriptions',
      node: (
        <Section
          key="subscriptions"
          id="home-subscriptions"
          title="Subscriptions"
          window={`Last 12 months · since ${formatDate(habit.start)}`}
          claims={claimsFor('subscriptions')}
        >
          {/* Suppressed when a `recurring_total` finding already heads the
              section: that sentence makes this exact claim, and printing both
              would duplicate one number at two ranks 40px apart. */}
          {active.length > 0 && !headedBy('subscriptions', 'recurring_total') && (
            <p className="insight-headline">
              <strong>{fmt(activeMonthly)}</strong> a month
              <span className="muted-text"> across {active.length} active {active.length === 1 ? 'charge' : 'charges'}</span>
            </p>
          )}

          {active.length > 0 && (
            <div className="table-scroll">
              <table className="insights-table">
                <thead>
                  <tr>
                    <th>Charge</th>
                    <th>Cadence</th>
                    <th className="numeric">Typical</th>
                    <th className="numeric">Per month</th>
                    <th className="numeric">Total paid</th>
                    <th>First seen</th>
                    <th>Last seen</th>
                  </tr>
                </thead>
                <tbody>
                  {active.map(charge => (
                    <tr key={`${charge.label}-${charge.currency}-${charge.firstSeen}`}>
                      <td>{asName(charge.label)}</td>
                      <td>{titleCase(charge.cadence)}</td>
                      <td className="numeric">
                        {fmt(charge.medianAmount)}
                        {charge.amountStability === 'variable' && (
                          <span className="insight-flag" title="The amount moves between charges">variable</span>
                        )}
                      </td>
                      <td className="numeric">{fmt(charge.monthlyCost)}</td>
                      <td className="numeric">{fmt(charge.totalPaid)}</td>
                      <td>{formatDate(charge.firstSeen)}</td>
                      <td>{formatDate(charge.lastSeen)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* The stopped ones are a quieter second list: money that is no longer
              going out is worth knowing, but it is not a decision. */}
          {stopped.length > 0 && (
            <div className="insight-subblock">
              <h3>Looks stopped</h3>
              <div className="table-scroll">
                <table className="insights-table">
                  <thead>
                    <tr>
                      <th>Charge</th>
                      <th>Cadence</th>
                      <th className="numeric">Was per month</th>
                      <th className="numeric">Total paid</th>
                      <th>Last seen</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stopped.map(charge => (
                      <tr key={`${charge.label}-${charge.currency}-${charge.firstSeen}`}>
                        <td>{asName(charge.label)}</td>
                        <td>{titleCase(charge.cadence)}</td>
                        <td className="numeric">{fmt(charge.monthlyCost)}</td>
                        <td className="numeric">{fmt(charge.totalPaid)}</td>
                        <td>{formatDate(charge.lastSeen)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </Section>
      )
    });
  }

  // 4. Where you shop — ranked by total, with the count and average that make
  //    the drip case visible.
  if (failed.has('merchants')) {
    sections.push({ key: 'shop', node: <BlockError key="shop" what="merchant totals" /> });
  } else if (merchants && merchantRows.length > 0) {
    sections.push({
      key: 'shop',
      node: (
        <Section
          key="shop"
          id="home-shop"
          title="Where you shop"
          window={`Last 12 months · ${windowDates({ start: merchants.since, end: merchants.until })}`}
          claims={claimsFor('shop')}
        >
          <div className="table-scroll">
            <table className="insights-table">
              <thead>
                <tr>
                  <th>Merchant</th>
                  <th className="numeric">Total</th>
                  <th className="numeric">Purchases</th>
                  <th className="numeric">Average</th>
                </tr>
              </thead>
              <tbody>
                {merchantRows.slice(0, MERCHANT_ROWS).map(merchant => (
                  <tr key={`${merchant.key}-${merchant.currency}`}>
                    <td>
                      {asName(merchant.key)}
                      {/* Many purchases, each below the typical one, adding up to
                          a total that matters — see `dripMerchants`. */}
                      {drip.has(merchant.key) && (
                        <span className="insight-flag" title="Many small purchases — the spend that is easy to miss">adds up</span>
                      )}
                    </td>
                    <td className="numeric">{fmt(merchant.total)}</td>
                    <td className="numeric">{merchant.count}</td>
                    <td className="numeric">{fmt(merchant.average)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* A silently short list reads as a complete one, so say which it is:
              the table is capped, and the server's own per-currency cap may have
              dropped rows before this ever saw them. */}
          {(merchantRows.length > MERCHANT_ROWS || merchants.truncated) && (
            <p className="muted-text insight-caveat">
              {merchantRows.length > MERCHANT_ROWS && `Showing the top ${MERCHANT_ROWS} of ${merchantRows.length}. `}
              {merchants.truncated && `The server returns at most ${merchants.limit} merchants per currency, so there are more than these.`}
            </p>
          )}
        </Section>
      )
    });
  }

  // 5. When you spend — the weekday bars *and* the 13-week heatmap. Both answer
  //    "when", so they belong to one section rather than two cards on opposite
  //    ends of a page. Every figure is per day: a week holds five weekdays and
  //    two weekend days, so totals would report the calendar as a habit.
  if (failed.has('patterns')) {
    sections.push({ key: 'when', node: <BlockError key="when" what="spending patterns" /> });
  } else if (patterns && (hasWeekdaySpend || heatmap.anchor > 0)) {
    sections.push({
      key: 'when',
      node: (
        <Section
          key="when"
          id="home-when"
          title="When you spend"
          window={`Last 12 months · ${windowDates({ start: patterns.since, end: patterns.until })}`}
          claims={claimsFor('when')}
        >
          {hasWeekdaySpend && (
            <div className="chart-box">
              <h3>Average spend per day of the week</h3>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={weekdayBars}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="short" />
                  <YAxis width={44} />
                  <Tooltip
                    formatter={(value: number) => [fmt(value), 'Per day']}
                    labelFormatter={(labelValue: string) => weekdayBars.find(b => b.short === labelValue)?.day ?? labelValue}
                  />
                  <Bar dataKey="perDay" fill="var(--accent)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Silent when the ratio is missing, sits near 1, or when a
              `weekend_skew` finding already heads the section: two halves of the
              week that cost the same are not a finding, and the same claim
              measured over two windows in one section is the contradiction this
              wave exists to remove. */}
          {weekendWorthSaying(weekendRatio) && !headedBy('when', 'weekend_skew') && pattern && (
            <p className="insight-headline">
              {weekendRatio > 1 ? 'Weekends' : 'Weekdays'} cost more —{' '}
              <strong>{fmt(weekendRatio > 1 ? pattern.weekendPerDay : pattern.weekdayPerDay)}</strong> a day
              against <strong>{fmt(weekendRatio > 1 ? pattern.weekdayPerDay : pattern.weekendPerDay)}</strong>
              <span className="muted-text">
                {' '}— a ratio of {(weekendRatio > 1 ? weekendRatio : 1 / weekendRatio).toFixed(2)}× over these 12 months
              </span>
            </p>
          )}

          {heatmap.anchor > 0 && (
            <div className="chart-box chart-full">
              {/* Its own window, stated: 13 weeks, not the 12 months above. */}
              <h3>Daily spend — last {HEATMAP_WEEKS} weeks</h3>
              <div className="heatmap-scroll">
                <div className="heatmap">
                  {heatmap.weeks.map((week, wi) => (
                    <div className="heatmap-col" key={wi}>
                      {week.map(day => {
                        // Anchored on the p90 of the days that had spending, not
                        // on the largest one: one payday used to flatten 91 days
                        // into about ten distinguishable shades (change 27).
                        const intensity = day.amount > 0
                          ? 0.2 + 0.8 * Math.min(1, day.amount / heatmap.anchor)
                          : 0;
                        return (
                          <div
                            key={day.date}
                            className="heatmap-cell"
                            style={{ background: day.amount > 0 ? `rgba(52, 211, 153, ${intensity})` : 'var(--surface-3)' }}
                            title={`${day.date}: ${fmt(day.amount)}`}
                          />
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>
              <div className="heatmap-legend">
                <span>Less</span>
                <span className="heatmap-cell" style={{ background: 'var(--surface-3)' }} />
                <span className="heatmap-cell" style={{ background: 'rgba(52,211,153,0.35)' }} />
                <span className="heatmap-cell" style={{ background: 'rgba(52,211,153,0.65)' }} />
                <span className="heatmap-cell" style={{ background: 'rgba(52,211,153,1)' }} />
                <span>More, from {fmt(heatmap.anchor)} up</span>
              </div>
            </div>
          )}
        </Section>
      )
    });
  }

  /**
   * At most one section may move, and only directly under the headline, when its
   * finding scores far above the rest. That is the only reordering allowed here:
   * the rest of the order is the product's argument, not a layout.
   */
  const ordered = promoted
    ? [...sections.filter(section => section.key === promoted), ...sections.filter(section => section.key !== promoted)]
    : sections;

  return (
    <div className="home">
      <div className="home-head">
        {/* The page window. It moves the spending sections and deliberately not
            the habit ones — see the file header, and ruling R2. */}
        <div className="time-period-buttons" role="group" aria-label="Period">
          {PAGE_WINDOWS.map(option => (
            <button
              key={option.key}
              className={pageWindow.key === option.key ? 'active' : ''}
              onClick={() => setPageWindow(option)}
              aria-pressed={pageWindow.key === option.key}
            >
              {option.label}
            </button>
          ))}
        </div>

        {/* Only when there is a choice to make, and only between currencies this
            screen has numbers in — `scopeCurrencies`, the one option set the
            report asks for (F9, change 14). Every button therefore leads
            somewhere: offering a currency the catalogue merely has enabled would
            put four guaranteed-blank screens behind four buttons, which is the
            half of F9 that was about Analytics rather than about Budgets. */}
        {presentCurrencies.length > 1 && (
          <CurrencyScope
            currencies={scopeCurrencies(currencies, presentCurrencies)}
            value={view}
            onChange={setChosenView}
            combined={{
              value: 'primary',
              label: `All → ${primary}`,
              title: 'All currencies converted to your primary currency'
            }}
          />
        )}
      </div>

      {/* The headline: one sentence, largest type on the page, answering "is
          this more than usual, overall?" — which today is only ever answered per
          category (change 5). This is also the slot the decided "typical monthly
          income" number later fills, and the only place it will appear. */}
      {headline && phrases ? (
        <p className="headline">
          You spent <strong>{fmt(headline.total)}</strong> {phrases.window}
          {' · '}≈{fmt(headline.perDay)}/day
          {headline.changePct === null ? (
            <> {' · '}nothing in {phrases.previous}</>
          ) : headline.changePct === 0 ? (
            <> {' · '}the same{headline.perDayComparison ? ' a day' : ''} as {phrases.previous}</>
          ) : (
            <>
              {' · '}
              <strong className={headline.changePct > 0 ? 'delta-up' : 'delta-down'}>
                {Math.abs(Math.round(headline.changePct))}% {headline.changePct > 0 ? 'more' : 'less'}
              </strong>
              {headline.perDayComparison ? ' a day' : ''} than {phrases.previous}
            </>
          )}
          {/* The FX caveat, collapsed to a clause: it used to be its own
              paragraph beside the currency buttons (§2). */}
          {converted && <span className="muted-text"> · converted at your rates</span>}
        </p>
      ) : (
        <p className="no-data">
          {converted
            ? `Nothing recorded ${phrases?.window ?? 'in this window'}.`
            : `No ${view} spending ${phrases?.window ?? 'in this window'}.`}
        </p>
      )}

      {ordered.map(section => section.node)}
    </div>
  );
}
