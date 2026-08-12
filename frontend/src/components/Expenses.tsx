/**
 * Expenses — the ledger, the query tool, and the door for bulk data.
 *
 * One screen where there were two. `Analytics` was a *query* tool with its own
 * three-panel filter wall, and the ledger underneath it had a second filter bar
 * asking the same questions of the same rows (F3, F8 in
 * `docs/ux-review-findings.md`). Ruling R4 sends the query here rather than to
 * Home: querying belongs where the rows are, and Home is a standing answer that
 * must never grow a filter wall.
 *
 * **One state, five consumers.** The filter bar drives the table, the summary
 * row, the spend-over-time chart and the category breakdown from a single
 * `LedgerQuery`. Analytics fetched its aggregates from
 * `/expenses/stats/analytics` while the table filtered the same rows in the
 * browser, so the two could — and did — describe different sets. Everything on
 * this screen is derived from the ledger `App` already holds; the search box
 * alone settles it, since the API has no search parameter and a chart fetched
 * from it could never honour one.
 *
 * **It arrives answering.** Every control starts neutral: no search, no
 * category, every currency, `All time`. Analytics opened with roughly 450px of
 * controls and eleven category checkboxes all ticked — the largest control on
 * the screen doing nothing, which is the founding complaint of this product
 * reproduced verbatim (F8). Categories filter *down* from everything.
 *
 * **Import sits beside Export**, same level, same toolbar (change 12). Import
 * used to hold a destination of its own for one file picker while Export was two
 * buttons in a table header — one job at two ranks (F17).
 *
 * The arithmetic lives in `utils/expenses.ts`, which is where to look for what
 * any number here means.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from './Icon';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Currency, ExpensesProps, SortField, SortOrder } from '../types/expense.types';
import { categoryColor, categoryLabel } from '../utils/categories';
import { scopeCurrencies } from '../utils/currencies';
import {
  EMPTY_QUERY,
  LedgerQuery,
  RANGES,
  RangeKey,
  categoryTotals,
  describeLedgerWindow,
  filterExpenses,
  grainForWindow,
  isEmptyQuery,
  measureWindow,
  queryBounds,
  sortExpenses,
  spendOverTime,
  summarise
} from '../utils/expenses';
import { exportExpensesCsv } from '../utils/export';
import { formatCurrency } from '../utils/format';
import { todayISO } from '../utils/home';
import { exportExpensesXlsx } from '../services/api';
import CurrencyScope from './CurrencyScope';
import ExcelImport from './ExcelImport';
import ExpenseTable from './ExpenseTable';

/** How many characters of a description the "Largest" tile shows. */
const LARGEST_DESCRIPTION = 42;

/** A description cut to fit a stat tile, saying so when it was cut. */
function shorten(description: string): string {
  return description.length > LARGEST_DESCRIPTION
    ? `${description.slice(0, LARGEST_DESCRIPTION - 1).trimEnd()}…`
    : description;
}

export default function Expenses({
  expenses,
  settings,
  categories,
  currencies,
  rates,
  onEdit,
  onDelete,
  onUpdate,
  onExpensesStale
}: ExpensesProps) {
  const [query, setQuery] = useState<LedgerQuery>(EMPTY_QUERY);
  const [sortField, setSortField] = useState<SortField>('date');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
  const [importing, setImporting] = useState<boolean>(false);
  const [exportOpen, setExportOpen] = useState<boolean>(false);

  const exportRef = useRef<HTMLDivElement>(null);
  const exportButtonRef = useRef<HTMLButtonElement>(null);

  // Fixed for the life of the mount, as on Home: "today" moving mid-session
  // would silently shift the window every number on the screen is measured over.
  const today = useMemo(() => todayISO(), []);

  const patch = (changes: Partial<LedgerQuery>) => setQuery(previous => ({ ...previous, ...changes }));

  /**
   * Which currencies this screen can be scoped to: the ones the **ledger** has,
   * not the ones the catalogue merely has enabled. Offering an enabled currency
   * nothing was ever spent in puts a guaranteed-blank screen behind a button,
   * which is the half of F9 that was about Analytics (change 14).
   *
   * From the whole ledger rather than the filtered set, so narrowing the dates
   * cannot make the button you are standing on disappear.
   */
  const presentCurrencies = useMemo(
    () => Array.from(new Set(expenses.map(expense => expense.currency))),
    [expenses]
  );

  /**
   * One currency in the ledger means there is nothing to choose and nothing to
   * convert: the control is not rendered, and every figure is in that currency.
   * The combined option would otherwise convert PLN into PLN and label it
   * "All → PLN".
   */
  const single = presentCurrencies.length === 1 ? presentCurrencies[0] : null;

  /**
   * The currencies the control offers, and whether to render it at all.
   *
   * A scope in force counts as a currency to offer even after the ledger stops
   * holding it — a bulk delete, or an import that reloads the ledger, can empty
   * the currency you are standing in. Hiding the control then would leave an
   * empty table over a filter bar that gives no reason for it, and the only way
   * out would be a Clear button the reader has no cause to suspect. Keeping the
   * pressed button on screen says what is filtering, and lets it be unpressed.
   */
  const scoped = query.currency !== 'all' ? [...presentCurrencies, query.currency] : presentCurrencies;
  const offerScope = presentCurrencies.length > 1 || query.currency !== 'all';
  const display: Currency = query.currency !== 'all' ? query.currency : (single ?? settings.primaryCurrency);
  const scope = useMemo(() => ({ display, rates }), [display, rates]);
  const fmt = (value: number) => formatCurrency(value, display);
  const label = (slug: string) => categoryLabel(categories, slug);

  const filtered = useMemo(
    () => filterExpenses(expenses, query, categories, today),
    [expenses, query, categories, today]
  );

  const rows = useMemo(
    () => sortExpenses(filtered, sortField, sortOrder, categories),
    [filtered, sortField, sortOrder, categories]
  );

  // `measured`, not `window`: a local by that name would shadow the global one
  // for the whole component.
  const measured = useMemo(
    () => measureWindow(queryBounds(query, today), filtered, today),
    [query, filtered, today]
  );

  const summary = useMemo(() => summarise(filtered, scope, measured), [filtered, scope, measured]);
  const breakdown = useMemo(() => categoryTotals(filtered, scope), [filtered, scope]);

  const grain = grainForWindow(measured);
  const buckets = useMemo(
    () => spendOverTime(filtered, scope, measured, grain),
    [filtered, scope, measured, grain]
  );

  /**
   * The page returns to the top when the **query** changes, and stays put when
   * the ledger does — deleting a row on page 3 must not throw you back to page 1.
   */
  const queryKey = [
    query.search, query.categories.join(','), query.currency,
    query.range, query.customStart, query.customEnd, sortField, sortOrder
  ].join('|');

  /**
   * Close the export list, and put focus back where it came from.
   *
   * Only for the paths the user drove deliberately — Escape, and picking a
   * format. A click elsewhere on the page has already moved focus somewhere the
   * user chose, and pulling it back here would steal it.
   */
  const closeExport = () => {
    setExportOpen(false);
    exportButtonRef.current?.focus();
  };

  // A list that stays open behind the click that dismissed it is one the user
  // has to close twice.
  useEffect(() => {
    if (!exportOpen) return;
    const onDown = (event: MouseEvent) => {
      if (!exportRef.current?.contains(event.target as Node)) setExportOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setExportOpen(false);
        exportButtonRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [exportOpen]);

  const handleSort = (field: SortField) => {
    if (field === sortField) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
      return;
    }
    // A newly chosen column starts on descending: the interesting end of every
    // one of them — newest, biggest — is the top.
    setSortField(field);
    setSortOrder('desc');
  };

  const toggleCategory = (slug: string) => {
    patch({
      categories: query.categories.includes(slug)
        ? query.categories.filter(selected => selected !== slug)
        : [...query.categories, slug]
    });
  };

  const exportCsv = () => {
    closeExport();
    exportExpensesCsv(rows);
  };

  const exportExcel = async () => {
    closeExport();
    try {
      await exportExpensesXlsx();
    } catch {
      alert('Export failed. Please try again.');
    }
  };

  const rangeLabel = RANGES.find(option => option.key === query.range)?.label ?? '';
  const windowLine = describeLedgerWindow(rangeLabel, measured);
  // Only when something was actually converted, so a single-currency ledger is
  // never captioned with an estimate it did not make.
  const converted = summary.natives.some(native => native.currency !== display);

  const grainLabel: Record<string, string> = { day: 'by day', week: 'by week', month: 'by month' };

  return (
    <div className="ledger">
      {/* Import and Export, side by side and at the same rank. Import is a
          disclosure rather than a destination: sending someone to another screen
          to point at a file is the setup cost this product is a complaint
          about (F17, change 12). */}
      <div className="ledger-toolbar">
        <button
          type="button"
          className="btn-secondary"
          onClick={() => setImporting(open => !open)}
          aria-expanded={importing}
        >
          Import…
        </button>

        {/* A disclosure, not an ARIA menu. `role="menu"` promises the whole
            menu-button pattern — focus moved into the list, arrow keys between
            items, a roving tabindex — and a screen reader that switches to
            application mode on the strength of that promise then hands arrow
            keys to a list that ignores them. Two buttons behind
            `aria-expanded` owe nothing they do not deliver. */}
        <div className="export-menu" ref={exportRef}>
          <button
            ref={exportButtonRef}
            type="button"
            className="btn-secondary"
            onClick={() => setExportOpen(open => !open)}
            aria-expanded={exportOpen}
          >
            Export <Icon name="chevron-down" size={14} />
          </button>
          {exportOpen && (
            <div className="export-menu-list">
              <button type="button" onClick={exportCsv}>CSV</button>
              <button type="button" onClick={exportExcel}>Excel</button>
            </div>
          )}
        </div>
      </div>

      {importing && (
        <div className="ledger-import">
          <ExcelImport settings={settings} currencies={currencies} onImported={onExpensesStale} />
        </div>
      )}

      {/* One filter bar, replacing Analytics' three stacked panels and the
          table's own. Every control arrives neutral. */}
      <div className="filters">
        <div className="filter-group search-group">
          <label htmlFor="ledger-search">Search:</label>
          <input
            type="text"
            id="ledger-search"
            placeholder="Search description, category, or amount…"
            value={query.search}
            onChange={event => patch({ search: event.target.value })}
          />
        </div>

        {/* Rendered only when there is a choice to make — the one option set the
            report asks for, and the one control (F9, change 14). */}
        {offerScope && (
          <div className="filter-group">
            <span className="filter-legend" id="ledger-currency">Currency:</span>
            <div role="group" aria-labelledby="ledger-currency">
              <CurrencyScope
                currencies={scopeCurrencies(currencies, scoped)}
                value={query.currency}
                onChange={currency => patch({ currency })}
                combined={{
                  value: 'all',
                  label: `All → ${settings.primaryCurrency}`,
                  title: 'All currencies converted to your primary currency'
                }}
              />
            </div>
          </div>
        )}

        <button
          type="button"
          className="clear-filters"
          onClick={() => setQuery(EMPTY_QUERY)}
          disabled={isEmptyQuery(query)}
        >
          Clear
        </button>

        {/* No category is selected on arrival, and none has to be: an empty
            selection is every category. Analytics ticked all eleven instead,
            which meant its largest control said nothing until you used it. */}
        <div className="filter-group chips-group">
          <span className="filter-legend" id="ledger-categories">Categories:</span>
          <div className="category-chips" role="group" aria-labelledby="ledger-categories">
            {categories.map(category => (
              <button
                key={category.slug}
                type="button"
                className={query.categories.includes(category.slug) ? 'active' : ''}
                aria-pressed={query.categories.includes(category.slug)}
                onClick={() => toggleCategory(category.slug)}
              >
                <span className="category-dot" style={{ background: category.color }} />
                {category.label}
              </button>
            ))}
          </div>
        </div>

        <div className="filter-group chips-group">
          <span className="filter-legend" id="ledger-range">Date range:</span>
          <div className="time-period-buttons" role="group" aria-labelledby="ledger-range">
            {RANGES.map(option => (
              <button
                key={option.key}
                type="button"
                className={query.range === option.key ? 'active' : ''}
                aria-pressed={query.range === option.key}
                onClick={() => patch({ range: option.key as RangeKey })}
              >
                {option.label}
              </button>
            ))}
          </div>

          {query.range === 'custom' && (
            <div className="custom-date-range">
              <div className="filter-group">
                <label htmlFor="ledger-start">From:</label>
                <input
                  type="date"
                  id="ledger-start"
                  value={query.customStart}
                  onChange={event => patch({ customStart: event.target.value })}
                />
              </div>
              <div className="filter-group">
                <label htmlFor="ledger-end">To:</label>
                <input
                  type="date"
                  id="ledger-end"
                  value={query.customEnd}
                  onChange={event => patch({ customEnd: event.target.value })}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* The window this screen is showing, stated (change 1). On Home the app
          picks it; here the user does, which makes printing it back the only
          way the summary and the table can be read as one answer. */}
      <p className="ledger-window">{windowLine}</p>

      <div className="summary-cards">
        <div className="summary-card">
          <h3>Total</h3>
          <p className="value">{fmt(summary.total)}</p>
          {converted && <p className="subtitle">converted to {display} at your rates</p>}
          {/* The exact subtotals underneath the estimate that combined them.
              Shown whenever anything was converted, not only when two
              currencies were: a lone foreign subtotal is the case where the
              figure above is entirely an estimate, which is when the exact
              number is worth most. */}
          {converted && (
            <ul className="native-totals">
              {summary.natives.map(native => (
                <li key={native.currency}>
                  {formatCurrency(native.total, native.currency)}
                  <span className="muted-text"> · {native.count}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="summary-card">
          <h3>Expenses</h3>
          <p className="value">{summary.count}</p>
          <p className="subtitle">{summary.count === 1 ? 'entry' : 'entries'}</p>
        </div>

        <div className="summary-card">
          <h3>Per day</h3>
          <p className={measured ? 'value' : 'value value-none'}>{measured ? fmt(summary.perDay) : '—'}</p>
          <p className="subtitle">
            {measured
              ? `over ${measured.days} ${measured.days === 1 ? 'day' : 'days'}`
              : 'no window to divide by'}
          </p>
        </div>

        <div className="summary-card">
          <h3>Largest</h3>
          <p className={summary.largest ? 'value' : 'value value-none'}>
            {summary.largest ? fmt(summary.largest.amount) : '—'}
          </p>
          <p className="subtitle">
            {summary.largest ? shorten(summary.largest.description) : 'nothing in this selection'}
          </p>
        </div>
      </div>

      <ExpenseTable
        expenses={rows}
        categories={categories}
        onEdit={onEdit}
        onDelete={onDelete}
        onUpdate={onUpdate}
        sortField={sortField}
        sortOrder={sortOrder}
        onSort={handleSort}
        queryKey={queryKey}
      />

      {/* Both charts describe the same filtered set as the table above them, and
          render nothing when it is empty — an empty chart costs more than a
          chart that is not there. */}
      {filtered.length > 0 && (
        <div className="ledger-charts">
          {buckets.length > 1 && (
            <div className="chart-box chart-full">
              <h2>Spend over time</h2>
              <p className="chart-note">{grainLabel[grain]} · {windowLine}</p>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={buckets}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" interval="preserveStartEnd" minTickGap={16} />
                  <YAxis width={64} />
                  <Tooltip formatter={(value: number) => [fmt(value), 'Spent']} />
                  <Bar dataKey="total" fill="var(--accent)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          <div className="category-breakdown">
            <h2>Where it went</h2>
            <p className="chart-note">
              {breakdown.length} {breakdown.length === 1 ? 'category' : 'categories'}
              {converted && ` · converted to ${display}`}
            </p>
            <div className="category-bars">
              {breakdown.map(row => (
                <div key={row.category} className="category-bar-item">
                  <div className="category-bar-header">
                    <span className="category-name">
                      {/* The swatch carries the colour and the text does not: a
                          hue picked to read on the dark surface fails on the
                          light one (F14). */}
                      <span className="category-dot" style={{ background: categoryColor(categories, row.category) }} />
                      {label(row.category)}
                    </span>
                    <span className="category-amount">
                      {fmt(row.total)} ({(row.share * 100).toFixed(1)}%)
                    </span>
                  </div>
                  <div className="category-bar-track">
                    <div
                      className="category-bar-fill"
                      style={{ width: `${row.share * 100}%`, backgroundColor: categoryColor(categories, row.category) }}
                    />
                  </div>
                  <div className="category-bar-stats">
                    <span>{row.count} {row.count === 1 ? 'expense' : 'expenses'}</span>
                    <span>Avg: {fmt(row.average)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
