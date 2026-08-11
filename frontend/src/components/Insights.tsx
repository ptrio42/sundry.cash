/**
 * Insights Component
 *
 * The four analyses the API has always computed and nothing has ever shown.
 * `comparison` returns every category × currency, `recurring` every detected
 * subscription, `merchants` the top spend per currency, `patterns` seven weekday
 * buckets — until this screen existed, all of it was funnelled into the three
 * sentences of the Dashboard strip and the rest was thrown away.
 *
 * **Insights is not Analytics.** Analytics answers "how much did I spend on X
 * between A and B?" and is driven by the user's filters. Insights answers "what
 * should I know that I did not ask about?" and is driven by the data. So there
 * is no filter wall here — at most a currency scope. A block that needs to be
 * configured before it will say anything belongs in Analytics instead.
 *
 * The strip on the Dashboard is not replaced by any of this. An insight you have
 * to navigate to is an insight nobody reads; this tab is the other job, for when
 * someone does want to dig.
 *
 * Every block renders nothing at all when it has nothing to say — the same
 * progressive disclosure the Dashboard uses for absent currencies — and a block
 * whose endpoint failed says so on its own rather than taking the tab down.
 */

import { useEffect, useMemo, useState } from 'react';
import { BarChart, Bar, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { getInsightsComparison, getInsightsMerchants, getInsightsPatterns, getInsightsRecurring } from '../services/api';
import {
  AppSettings,
  Category,
  ComparisonResult,
  Currency,
  CurrencyInfo,
  Expense,
  FxRates,
  MerchantsResult,
  PatternsResult,
  RecurringCharge
} from '../types/expense.types';
import { formatCurrency, formatDate } from '../utils/format';
import { categoryLabel } from '../utils/categories';
import { relevantCurrencies } from '../utils/currencies';
import CurrencyScope from './CurrencyScope';
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

interface InsightsProps {
  /** Read for the currencies present in the ledger, and as the staleness signal. */
  expenses: Expense[];
  settings: AppSettings;
  categories: Category[];
  currencies: CurrencyInfo[];
  rates: FxRates;
}

/** Which of the four requests a failure belongs to, so one 500 sinks one block. */
type Block = 'recurring' | 'merchants' | 'patterns' | 'comparison';

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

/** A merchant key is a case-folded grouping key ('żabka'), not a display name. */
function asName(key: string): string {
  return key.charAt(0).toLocaleUpperCase() + key.slice(1);
}

function titleCase(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/**
 * A block that could not be loaded.
 *
 * One quiet line rather than silence: the strip on the Dashboard stays silent
 * because it is an enhancement nobody asked for, but this tab is the thing the
 * user navigated to, and a block that vanishes on a 500 is indistinguishable
 * from one that had nothing to say.
 */
function BlockError({ what }: { what: string }) {
  return <p className="muted-text insight-error">Could not load {what}.</p>;
}

export default function Insights({ expenses, settings, categories, currencies, rates }: InsightsProps) {
  const primary = settings.primaryCurrency;

  const [recurring, setRecurring] = useState<RecurringCharge[]>([]);
  const [merchants, setMerchants] = useState<MerchantsResult | null>(null);
  const [patterns, setPatterns] = useState<PatternsResult | null>(null);
  const [comparison, setComparison] = useState<ComparisonResult | null>(null);
  const [failed, setFailed] = useState<Set<Block>>(() => new Set());
  const [loading, setLoading] = useState<boolean>(true);

  // Distinct currencies actually present in the data, exactly as the Dashboard
  // derives them — including ones the catalogue has since switched off.
  const presentCurrencies = useMemo(
    () => Array.from(new Set(expenses.map(e => e.currency))),
    [expenses]
  );

  const [view, setView] = useState<Currency | 'primary'>('primary');
  const scope = useMemo<Scope>(() => ({ view, primary, rates }), [view, primary, rates]);
  const display = displayCurrency(scope);
  const fmt = (value: number) => formatCurrency(value, display);

  /**
   * One fetch per block, and one failure per block.
   *
   * `Promise.all` over four requests that have already swallowed their own
   * rejections: the tab must not go blank because `/patterns` returned a 500,
   * and the three that answered are still worth showing.
   *
   * The currency scope is *not* a dependency. Unlike the strip, nothing here is
   * ranked across currencies, so switching the view converts what is already in
   * hand rather than asking a new question.
   */
  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    const failures = new Set<Block>();
    const load = <T,>(block: Block, request: Promise<T>, apply: (value: T) => void): Promise<void> =>
      request
        .then(value => { if (!cancelled) apply(value); })
        .catch(() => { failures.add(block); });

    Promise.all([
      load('recurring', getInsightsRecurring(), result => setRecurring(result.recurring)),
      load('merchants', getInsightsMerchants({ limit: MERCHANT_LIMIT }), setMerchants),
      load('patterns', getInsightsPatterns(), setPatterns),
      load('comparison', getInsightsComparison(), setComparison)
    ]).then(() => {
      if (cancelled) return;
      setFailed(failures);
      setLoading(false);
    });

    return () => { cancelled = true; };
  }, [expenses]);

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
  // Pulled out of `pattern` so the guard below narrows a plain const rather
  // than a property path.
  const weekendRatio = pattern?.weekendRatio ?? null;

  const changes = useMemo(() => scopeComparison(comparison?.byCategory ?? [], scope), [comparison, scope]);

  const nothingToShow =
    failed.size === 0 && subscriptions.length === 0 && merchantRows.length === 0 &&
    !hasWeekdaySpend && changes.length === 0;

  if (loading) {
    return <div className="loading">Loading insights…</div>;
  }

  return (
    <div className="insights">
      <div className="dashboard-head">
        <div className="dashboard-head-controls">
          <CurrencyScope
            currencies={relevantCurrencies(currencies, presentCurrencies)
              .filter(c => presentCurrencies.includes(c.code))}
            value={view}
            onChange={setView}
            combined={{
              value: 'primary',
              label: `All → ${primary}`,
              title: 'All currencies converted to your primary currency'
            }}
          />
          {view === 'primary' && (
            <p className="dashboard-note muted-text">
              Converted from all currencies using your FX rates (editable under Currencies).
            </p>
          )}
        </div>
      </div>

      {nothingToShow && (
        <p className="no-data">
          Nothing to report yet. Insights need a few months of history before they have anything to compare.
        </p>
      )}

      {/* 1. Subscriptions — the most actionable thing the API knows, and the
             reason this block is first: it is the one that makes someone act. */}
      {failed.has('recurring')
        ? <BlockError what="subscriptions" />
        : subscriptions.length > 0 && (
          <section className="insight-block" aria-labelledby="insights-subscriptions">
            <div className="insight-block-head">
              <h2 id="insights-subscriptions">Subscriptions</h2>
              {active.length > 0 && (
                <p className="insight-headline">
                  <strong>{fmt(activeMonthly)}</strong> a month
                  <span className="muted-text"> across {active.length} active {active.length === 1 ? 'charge' : 'charges'}</span>
                </p>
              )}
            </div>

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

            {/* The stopped ones are a quieter second list: money that is no
                longer going out is worth knowing, but it is not a decision. */}
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
          </section>
        )}

      {/* 2. Where the money goes — ranked by total, with the count and average
             that make the drip case visible. */}
      {failed.has('merchants')
        ? <BlockError what="merchant totals" />
        : merchantRows.length > 0 && merchants && (
          <section className="insight-block" aria-labelledby="insights-merchants">
            <div className="insight-block-head">
              <h2 id="insights-merchants">Where the money goes</h2>
              <p className="muted-text">{formatDate(merchants.since)} – {formatDate(merchants.until)}</p>
            </div>
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
                        {/* Many purchases, each below the typical one, adding up
                            to a total that matters — see `dripMerchants`. */}
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
            {/* A silently short list reads as a complete one, so say which it
                is: the table is capped, and the server's own per-currency cap
                may have dropped rows before this ever saw them. */}
            {(merchantRows.length > MERCHANT_ROWS || merchants.truncated) && (
              <p className="muted-text insight-caveat">
                {merchantRows.length > MERCHANT_ROWS && `Showing the top ${MERCHANT_ROWS} of ${merchantRows.length}. `}
                {merchants.truncated && `The server returns at most ${merchants.limit} merchants per currency, so there are more than these.`}
              </p>
            )}
          </section>
        )}

      {/* 3. When you spend — per day, never totals: a week holds five weekdays
             and two weekend days, so totals would be arithmetic, not behaviour. */}
      {failed.has('patterns')
        ? <BlockError what="spending patterns" />
        : pattern && hasWeekdaySpend && (
          <section className="insight-block" aria-labelledby="insights-patterns">
            <div className="insight-block-head">
              <h2 id="insights-patterns">When you spend</h2>
              {patterns && <p className="muted-text">{formatDate(patterns.since)} – {formatDate(patterns.until)}</p>}
            </div>
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
            {/* Silent when the ratio is missing or sits near 1: two halves of
                the week that cost the same are not a finding. */}
            {weekendWorthSaying(weekendRatio) && (
              <p className="insight-headline">
                {weekendRatio > 1 ? 'Weekends' : 'Weekdays'} cost more —{' '}
                <strong>{fmt(weekendRatio > 1 ? pattern.weekendPerDay : pattern.weekdayPerDay)}</strong> a day
                against <strong>{fmt(weekendRatio > 1 ? pattern.weekdayPerDay : pattern.weekendPerDay)}</strong>
                <span className="muted-text">
                  {' '}— a ratio of {(weekendRatio > 1 ? weekendRatio : 1 / weekendRatio).toFixed(2)}×
                </span>
              </p>
            )}
          </section>
        )}

      {/* 4. What changed — the whole table the strip only ever shows one row of. */}
      {failed.has('comparison')
        ? <BlockError what="the category comparison" />
        : changes.length > 0 && comparison && (
          <section className="insight-block" aria-labelledby="insights-comparison">
            <div className="insight-block-head">
              <h2 id="insights-comparison">What changed</h2>
              <p className="muted-text">
                {formatDate(comparison.current.start)} – {formatDate(comparison.current.end)}, against{' '}
                {formatDate(comparison.previous.start)} – {formatDate(comparison.previous.end)}
              </p>
            </div>
            <div className="table-scroll">
              <table className="insights-table">
                <thead>
                  <tr>
                    <th>Category</th>
                    <th className="numeric">Previous</th>
                    <th className="numeric">Current</th>
                    <th className="numeric">Change</th>
                    <th className="numeric">%</th>
                  </tr>
                </thead>
                <tbody>
                  {changes.map(row => (
                    <tr key={`${row.category}-${row.currency}`}>
                      <td>{categoryLabel(categories, row.category)}</td>
                      <td className="numeric">{fmt(row.previous)}</td>
                      <td className="numeric">{fmt(row.current)}</td>
                      <td className={`numeric ${row.delta > 0 ? 'delta-up' : row.delta < 0 ? 'delta-down' : ''}`}>
                        {row.delta > 0 ? '+' : ''}{fmt(row.delta)}
                      </td>
                      {/* No previous spend means no percentage. "new" is the
                          fact; a dash or a 0% would both be wrong. */}
                      <td className="numeric">
                        {row.deltaPct === null
                          ? <span className="insight-flag">new</span>
                          : `${row.deltaPct > 0 ? '+' : ''}${row.deltaPct.toFixed(1)}%`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
    </div>
  );
}
