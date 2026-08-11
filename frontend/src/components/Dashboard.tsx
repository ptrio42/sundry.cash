/**
 * Dashboard Component
 * Currency-scoped spending overview: donut breakdown, stacked category trend,
 * and a calendar heatmap of daily spend.
 */

import { useMemo, useState, useEffect, useRef } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid } from 'recharts';
import { DashboardProps, Currency } from '../types/expense.types';
import { formatCurrency } from '../utils/format';
import { categoryColor, categoryLabel, stackedCategorySeries } from '../utils/categories';
import { relevantCurrencies } from '../utils/currencies';
import { convertAmount } from '../utils/fx';
import CurrencyScope from './CurrencyScope';
import InsightsStrip from './InsightsStrip';

type TimeGrouping = 'day' | 'week' | 'month';

/** Shorten a trend bucket key ('YYYY-MM-DD' or 'YYYY-MM') for the chart axis. */
function formatPeriodTick(key: string): string {
  const iso = key.length === 7 ? `${key}-01` : key;
  const d = new Date(`${iso}T00:00:00Z`);
  if (isNaN(d.getTime())) return key;
  return key.length === 7
    ? new Intl.DateTimeFormat(undefined, { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(d)
    : new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(d);
}

export default function Dashboard({ expenses, settings, categories, currencies, rates }: DashboardProps) {
  const primary = settings.primaryCurrency;
  const label = (slug: string) => categoryLabel(categories, slug);
  const color = (slug: string) => categoryColor(categories, slug);

  // Distinct currencies actually present in the data.
  const presentCurrencies = useMemo(
    () => Array.from(new Set(expenses.map(e => e.currency))),
    [expenses]
  );

  // View can be a single native currency, or 'primary' = all currencies
  // converted to the primary currency and combined.
  const [view, setView] = useState<Currency | 'primary'>('primary');

  // Pick the default once the data actually arrives. A lazy useState initializer
  // cannot do this: App fetches expenses *after* mount, so on the first render
  // `expenses` is always [] and the single-currency default never fired — a
  // PLN-only user was permanently shown "All -> PLN", converting PLN to PLN.
  // `defaulted` keeps this to one shot so it never overrides a later choice.
  const defaulted = useRef(false);
  useEffect(() => {
    if (defaulted.current || presentCurrencies.length === 0) return;
    defaulted.current = true;
    if (presentCurrencies.length === 1) setView(presentCurrencies[0]);
  }, [presentCurrencies]);
  const [timeGrouping, setTimeGrouping] = useState<TimeGrouping>('day');

  const converted = view === 'primary';
  const displayCurrency: Currency = converted ? primary : view;

  // Rows the whole dashboard is computed from: either native single-currency
  // rows, or every expense converted into the primary currency.
  const filtered = useMemo(() => {
    if (converted) {
      return expenses.map(e => ({ ...e, amount: convertAmount(e.amount, e.currency, primary, rates), currency: primary }));
    }
    return expenses.filter(e => e.currency === view);
  }, [expenses, view, converted, primary, rates]);

  const summary = useMemo(() => {
    const count = filtered.length;
    const total = filtered.reduce((s, e) => s + e.amount, 0);
    const highest = filtered.reduce((m, e) => Math.max(m, e.amount), 0);
    return { count, total, average: count ? total / count : 0, highest };
  }, [filtered]);

  const categoryStats = useMemo(() => {
    const stats: Record<string, number> = {};
    filtered.forEach(e => { stats[e.category] = (stats[e.category] || 0) + e.amount; });
    return Object.entries(stats)
      // `categoryLabel` rather than the `label` helper: the helper closes over
      // `categories`, which the dependency list already covers.
      .map(([category, value]) => ({ name: categoryLabel(categories, category), value, category }))
      .sort((a, b) => b.value - a.value);
  }, [filtered, categories]);

  // One stacked series per category, plus one for any slug the ledger uses that
  // the list does not have — see `stackedCategorySeries`.
  const trendSeries = useMemo(
    () => stackedCategorySeries(categories, filtered.map(e => e.category)),
    [categories, filtered]
  );

  const trendData = useMemo(() => {
    const grouped: Record<string, Record<string, number>> = {};
    filtered.forEach(e => {
      let key: string;
      if (timeGrouping === 'day') {
        key = e.date;
      } else if (timeGrouping === 'week') {
        const d = new Date(`${e.date}T00:00:00Z`);
        d.setUTCDate(d.getUTCDate() - d.getUTCDay());
        key = d.toISOString().split('T')[0];
      } else {
        key = e.date.slice(0, 7);
      }
      if (!grouped[key]) grouped[key] = {};
      grouped[key][e.category] = (grouped[key][e.category] || 0) + e.amount;
    });
    return Object.entries(grouped)
      .map(([date, cats]) => ({ date, ...cats }))
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-26);
  }, [filtered, timeGrouping]);

  // Calendar heatmap: last 13 weeks of daily spend, aligned to Sundays.
  const heatmap = useMemo(() => {
    const byDay: Record<string, number> = {};
    filtered.forEach(e => { byDay[e.date] = (byDay[e.date] || 0) + e.amount; });

    const WEEKS = 13;
    const now = new Date();
    const end = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
    const start = new Date(end);
    start.setUTCDate(end.getUTCDate() - (WEEKS * 7 - 1));
    start.setUTCDate(start.getUTCDate() - start.getUTCDay()); // back up to Sunday

    const days: { date: string; amount: number }[] = [];
    const cursor = new Date(start);
    while (cursor <= end) {
      const key = cursor.toISOString().split('T')[0];
      days.push({ date: key, amount: byDay[key] || 0 });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    const max = Math.max(1, ...days.map(d => d.amount));
    const weeks: { date: string; amount: number }[][] = [];
    for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));
    return { weeks, max };
  }, [filtered]);

  const fmt = (v: number) => formatCurrency(v, displayCurrency);

  return (
    <div className="dashboard">
      {/* Reads the currency scope chosen below it, and hides itself when the
          data has nothing to say. `expenses` is what tells it to refetch. */}
      <InsightsStrip view={view} categories={categories} expenses={expenses} />

      <div className="dashboard-head">
        <div className="dashboard-head-controls">
          {/* Only the currencies actually in the ledger get a button — including
              ones since disabled, whose history is still here. The option set
              stays this screen's own for now; `CurrencyScope` shares the
              control, not the choice of what goes in it. */}
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
          {converted && (
            <p className="dashboard-note muted-text">
              Converted from all currencies using your FX rates (editable under Currencies).
            </p>
          )}
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="no-data">
          {converted
            ? 'No expenses yet. Add some to see your dashboard.'
            : `No ${view} expenses yet. Add some to see your dashboard.`}
        </p>
      ) : (
        <>
          {/* Summary */}
          <div className="summary-cards">
            <div className="summary-card">
              <h3>Total Spent</h3>
              <p className="value">{fmt(summary.total)}</p>
            </div>
            <div className="summary-card">
              <h3>Expenses</h3>
              <p className="value">{summary.count}</p>
            </div>
            <div className="summary-card">
              <h3>Average</h3>
              <p className="value">{fmt(summary.average)}</p>
            </div>
            <div className="summary-card">
              <h3>Largest</h3>
              <p className="value">{fmt(summary.highest)}</p>
            </div>
          </div>

          <div className="charts-container">
            {/* Donut */}
            <div className="chart-box">
              <h3>By Category</h3>
              {/* 264 = the 300px box minus the 36px recharts' own <Legend> used to
                  reserve, so the donut (and .donut-center, pinned at 132px) stay put. */}
              <div className="donut-wrap">
                <ResponsiveContainer width="100%" height={264}>
                  <PieChart>
                    <Pie
                      data={categoryStats}
                      cx="50%"
                      cy="50%"
                      innerRadius={72}
                      outerRadius={104}
                      paddingAngle={2}
                      dataKey="value"
                      stroke="none"
                    >
                      {categoryStats.map(entry => (
                        <Cell key={entry.category} fill={color(entry.category)} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value: number) => fmt(value)} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="donut-center">
                  <span className="donut-total">{fmt(summary.total)}</span>
                  <span className="donut-label">total</span>
                </div>
              </div>
              {/* The legend is ours rather than recharts' <Legend>: that one renders
                  into an absolutely-positioned box whose height recharts fixes up
                  front, so on a phone the seven categories wrapped to three rows and
                  spilled out of the card. Plain flow content just grows instead. */}
              {/* The swatch carries the colour and the text does not, per the
                  rule written above `.category-dot` in App.css: a hue picked to
                  read on the dark surface fails on the light one, and all ten of
                  these labels did (F14). */}
              <ul className="chart-legend">
                {categoryStats.map(entry => (
                  <li key={entry.category}>
                    <span className="chart-legend-swatch" style={{ background: color(entry.category) }} />
                    {entry.name}
                  </li>
                ))}
              </ul>
            </div>

            {/* Stacked trend */}
            <div className="chart-box">
              <div className="chart-header">
                <h3>Trend by Category</h3>
                <div className="time-grouping">
                  {(['day', 'week', 'month'] as TimeGrouping[]).map(g => (
                    <button key={g} className={timeGrouping === g ? 'active' : ''} onClick={() => setTimeGrouping(g)}>
                      {g.charAt(0).toUpperCase() + g.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={trendData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="date" tickFormatter={formatPeriodTick} interval="preserveStartEnd" minTickGap={16} />
                  <YAxis width={44} />
                  <Tooltip formatter={(value: number, name: string) => [fmt(value), label(name)]} />
                  {trendSeries.map((series, i) => (
                    <Bar
                      key={series.slug}
                      dataKey={series.slug}
                      stackId="a"
                      fill={series.color}
                      radius={i === trendSeries.length - 1 ? [4, 4, 0, 0] : undefined}
                    />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Calendar heatmap */}
          <div className="chart-box chart-full">
            <h3>Daily Spend — last 13 weeks</h3>
            <div className="heatmap-scroll">
              <div className="heatmap">
                {heatmap.weeks.map((week, wi) => (
                  <div className="heatmap-col" key={wi}>
                    {week.map((d, di) => {
                      const intensity = d.amount > 0 ? 0.2 + 0.8 * (d.amount / heatmap.max) : 0;
                      return (
                        <div
                          key={di}
                          className="heatmap-cell"
                          style={{ background: d.amount > 0 ? `rgba(52, 211, 153, ${intensity})` : 'var(--surface-3)' }}
                          title={`${d.date}: ${fmt(d.amount)}`}
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
              <span>More</span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
