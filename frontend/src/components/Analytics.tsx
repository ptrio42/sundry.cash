/**
 * Analytics Component
 * Shows spending analytics by time period and category.
 *
 * **Analytics is not Insights.** This screen answers "how much did I spend on X
 * between A and B?" and is driven by the user's filters — period pickers,
 * category checkboxes, a currency. `Insights.tsx` answers "what should I know
 * that I did not ask about?" and is driven by the data, which is why it has no
 * filter wall. A block that only says something once it has been configured
 * belongs here, not there.
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import { getAnalytics } from '../services/api';
import { Category, CurrencyInfo, ExpenseCategory, Currency, AppSettings, FxRates } from '../types/expense.types';
import { formatCurrency } from '../utils/format';
import { categoryColor, categoryLabel } from '../utils/categories';
import { relevantCurrencies } from '../utils/currencies';
import { convertAmount } from '../utils/fx';

type TimePeriod = 'week' | 'month' | 'year' | 'custom';

interface AnalyticsData {
  total: number;
  count: number;
  average: number;
  byCategory: Array<{ category: string; currency: string; total: number; count: number; average: number }>;
  byCurrency: Array<{ currency: string; total: number; count: number; average: number }>;
}

interface AnalyticsProps {
  settings: AppSettings;
  categories: Category[];
  currencies: CurrencyInfo[];
  rates: FxRates;
}

export default function Analytics({ settings, categories, currencies, rates }: AnalyticsProps) {
  const [timePeriod, setTimePeriod] = useState<TimePeriod>('month');
  // The filter tracks what has been *deselected* rather than what is selected.
  // Categories are data now, so the list can change underneath this component:
  // storing the exclusions means a newly added category is included by default
  // and a deleted one simply disappears, with no stale slug left in state.
  const [excludedCategories, setExcludedCategories] = useState<Set<string>>(() => new Set());
  const [selectedCurrency, setSelectedCurrency] = useState<Currency | 'all'>('all');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>('');

  const selectedCategories = useMemo(
    () => categories.filter(c => !excludedCategories.has(c.slug)).map(c => c.slug),
    [categories, excludedCategories]
  );
  const allSelected = excludedCategories.size === 0;

  // Unchecking every category means "show me nothing". The API reads a missing
  // `categories` parameter as *unfiltered*, so forwarding an empty selection
  // would answer with the whole ledger — the exact opposite of the question.
  // The answer is knowable without asking, so don't make the request at all.
  // Derived from `selectedCategories` rather than comparing sizes, because
  // `excludedCategories` may still hold the slug of a since-deleted category.
  const nothingSelected = categories.length > 0 && selectedCategories.length === 0;

  /**
   * Calculate date range based on time period
   */
  const getDateRange = (period: TimePeriod): { startDate: string; endDate: string } => {
    const now = new Date();
    const end = now.toISOString().split('T')[0];
    let start: Date;

    switch (period) {
      case 'week':
        start = new Date(now);
        start.setDate(now.getDate() - 7);
        break;
      case 'month':
        start = new Date(now);
        start.setMonth(now.getMonth() - 1);
        break;
      case 'year':
        start = new Date(now);
        start.setFullYear(now.getFullYear() - 1);
        break;
      default:
        return { startDate: '', endDate: '' };
    }

    return {
      startDate: start.toISOString().split('T')[0],
      endDate: end
    };
  };

  /**
   * Load analytics data
   */
  const loadAnalytics = async () => {
    setLoading(true);
    setError('');

    try {
      let dates: { startDate: string; endDate: string };

      if (timePeriod === 'custom') {
        dates = { startDate, endDate };
      } else {
        dates = getDateRange(timePeriod);
      }

      const data = await getAnalytics({
        startDate: dates.startDate,
        endDate: dates.endDate,
        categories: selectedCategories.length > 0 ? selectedCategories : undefined,
        currency: selectedCurrency !== 'all' ? selectedCurrency : undefined
      });

      setAnalytics(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load analytics');
    } finally {
      setLoading(false);
    }
  };

  /**
   * Handle category toggle
   */
  const toggleCategory = (category: ExpenseCategory) => {
    setExcludedCategories(prev => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  };

  /**
   * Handle select/deselect all categories
   */
  const toggleAllCategories = () => {
    setExcludedCategories(prev =>
      prev.size === 0 ? new Set(categories.map(c => c.slug)) : new Set()
    );
  };

  /**
   * Calculate days in period
   */
  const getDaysInPeriod = (): number => {
    let dates: { startDate: string; endDate: string };

    if (timePeriod === 'custom') {
      dates = { startDate, endDate };
    } else {
      dates = getDateRange(timePeriod);
    }

    if (!dates.startDate || !dates.endDate) return 0;

    const start = new Date(dates.startDate);
    const end = new Date(dates.endDate);
    const diffTime = Math.abs(end.getTime() - start.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    return diffDays;
  };

  /**
   * Load analytics when filters change
   */
  useEffect(() => {
    if (nothingSelected) {
      // Drop whatever the last query returned: it describes a filter the user
      // has since cleared, and leaving it would keep those numbers on screen.
      setAnalytics(null);
      setError('');
      return;
    }
    if (timePeriod !== 'custom' || (startDate && endDate)) {
      loadAnalytics();
    }
  }, [nothingSelected, timePeriod, selectedCategories, selectedCurrency, startDate, endDate]);

  /**
   * Format amount with currency symbol
   */
  // Everything below a mixed-currency query has to be expressed in ONE currency.
  // Filtering to a single currency means the server already scoped the numbers;
  // otherwise we combine using the user's own FX rates, exactly as the Dashboard
  // does. Summing raw major units across currencies (100 USD + 1 BTC = 101) was
  // the previous behaviour, and it was labelled "$" regardless of the data.
  const displayCurrency: Currency =
    selectedCurrency !== 'all' ? selectedCurrency : settings.primaryCurrency;

  // True only when we actually had to convert — used to caption the numbers.
  const isConverted =
    selectedCurrency === 'all' &&
    (analytics?.byCurrency.some(c => c.currency !== displayCurrency) ?? false);

  const formatAmount = (amount: number, currency?: string): string =>
    formatCurrency(amount, (currency as Currency) || displayCurrency);

  const toDisplay = useCallback(
    (amount: number, from: string) => convertAmount(amount, from as Currency, displayCurrency, rates),
    [displayCurrency, rates]
  );

  // Per-currency subtotals are exact, so convert each once and then add.
  const overallTotal = useMemo(
    () => (analytics?.byCurrency ?? []).reduce((sum, c) => sum + toDisplay(c.total, c.currency), 0),
    [analytics, toDisplay]
  );

  // Collapse the (category, currency) rows the API returns into one row per
  // category, converting as we go.
  const categoryTotals = useMemo(() => {
    const map = new Map<string, { total: number; count: number }>();
    for (const row of analytics?.byCategory ?? []) {
      const prev = map.get(row.category) || { total: 0, count: 0 };
      map.set(row.category, {
        total: prev.total + toDisplay(row.total, row.currency),
        count: prev.count + row.count,
      });
    }
    return Array.from(map.entries())
      .map(([category, d]) => ({ ...d, category, average: d.count > 0 ? d.total / d.count : 0 }))
      .sort((a, b) => b.total - a.total);
  }, [analytics, toDisplay]);

  const daysInPeriod = getDaysInPeriod();
  const averagePerDay = daysInPeriod > 0 ? overallTotal / daysInPeriod : 0;
  const overallAverage = analytics && analytics.count > 0 ? overallTotal / analytics.count : 0;

  return (
    <div className="analytics">
      <h2>📈 Spending Analytics</h2>

      {/* Filters */}
      <div className="analytics-filters">
        {/* Time Period Selection */}
        <div className="filter-section">
          <h3>Time Period</h3>
          <div className="time-period-buttons">
            <button
              className={timePeriod === 'week' ? 'active' : ''}
              onClick={() => setTimePeriod('week')}
            >
              Last 7 Days
            </button>
            <button
              className={timePeriod === 'month' ? 'active' : ''}
              onClick={() => setTimePeriod('month')}
            >
              Last 30 Days
            </button>
            <button
              className={timePeriod === 'year' ? 'active' : ''}
              onClick={() => setTimePeriod('year')}
            >
              Last Year
            </button>
            <button
              className={timePeriod === 'custom' ? 'active' : ''}
              onClick={() => setTimePeriod('custom')}
            >
              Custom Range
            </button>
          </div>

          {timePeriod === 'custom' && (
            <div className="custom-date-range">
              <div className="form-group">
                <label htmlFor="analytics-start-date">Start Date</label>
                <input
                  type="date"
                  id="analytics-start-date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label htmlFor="analytics-end-date">End Date</label>
                <input
                  type="date"
                  id="analytics-end-date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                />
              </div>
            </div>
          )}
        </div>

        {/* Category Selection */}
        <div className="filter-section">
          <h3>Categories</h3>
          <div className="category-checkboxes">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={toggleAllCategories}
              />
              <strong>All Categories</strong>
            </label>
            {categories.map(category => (
              <label key={category.slug} className="checkbox-label">
                <input
                  type="checkbox"
                  checked={!excludedCategories.has(category.slug)}
                  onChange={() => toggleCategory(category.slug)}
                />
                <span className="category-dot" style={{ background: category.color }} />
                {category.label}
              </label>
            ))}
          </div>
        </div>

        {/* Currency Selection */}
        <div className="filter-section">
          <h3>Currency</h3>
          <div className="currency-buttons">
            <button
              className={selectedCurrency === 'all' ? 'active' : ''}
              onClick={() => setSelectedCurrency('all')}
            >
              All Currencies
            </button>
            {/* Enabled currencies, plus any the results are already in — a
                currency switched off after the fact still has history to slice. */}
            {relevantCurrencies(currencies, (analytics?.byCurrency ?? []).map(c => c.currency)).map(currency => (
              <button
                key={currency.code}
                className={selectedCurrency === currency.code ? 'active' : ''}
                onClick={() => setSelectedCurrency(currency.code)}
              >
                {currency.code} ({currency.symbol})
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Error Display */}
      {error && <div className="error-message">{error}</div>}

      {/* Loading */}
      {loading && <div className="loading">Loading analytics...</div>}

      {/* Nothing selected — answered locally, no request was made. Guarding the
          results block on the same flag matters for the single render between
          the last checkbox coming off and the effect clearing `analytics`. */}
      {!loading && nothingSelected && (
        <div className="no-data">
          No expenses found for the selected period and categories.
        </div>
      )}

      {/* Results */}
      {!loading && !nothingSelected && analytics && (
        <div className="analytics-results">
          {/* Summary Cards */}
          <div className="analytics-summary">
            <div className="summary-card">
              <h3>Total Spent</h3>
              <p className="value">{formatAmount(overallTotal)}</p>
              <p className="subtitle">
                {isConverted ? `converted to ${displayCurrency}` : `${daysInPeriod} days`}
              </p>
            </div>
            <div className="summary-card">
              <h3>Total Expenses</h3>
              <p className="value">{analytics.count}</p>
              <p className="subtitle">transactions</p>
            </div>
            <div className="summary-card">
              <h3>Average per Expense</h3>
              <p className="value">{formatAmount(overallAverage)}</p>
              <p className="subtitle">per transaction</p>
            </div>
            <div className="summary-card">
              <h3>Average per Day</h3>
              <p className="value">{formatAmount(averagePerDay)}</p>
              <p className="subtitle">daily spending</p>
            </div>
          </div>

          {/* Native per-currency subtotals — exact, no conversion applied. */}
          {isConverted && (
            <div className="analytics-summary">
              {analytics.byCurrency.map(curr => (
                <div key={curr.currency} className="summary-card">
                  <h3>{curr.currency} Total</h3>
                  <p className="value">{formatAmount(curr.total, curr.currency)}</p>
                  <p className="subtitle">{curr.count} transactions</p>
                </div>
              ))}
            </div>
          )}

          {/* Category Breakdown */}
          {categoryTotals.length > 0 && (
            <div className="category-breakdown">
              <h3>
                Breakdown by Category
                {isConverted && (
                  <span className="subtitle"> · converted to {displayCurrency}</span>
                )}
              </h3>
              <div className="category-bars">
                {categoryTotals.map(cat => {
                  const percentage = overallTotal > 0 ? (cat.total / overallTotal) * 100 : 0;
                  return (
                    <div key={cat.category} className="category-bar-item">
                      <div className="category-bar-header">
                        <span className="category-name">
                          {categoryLabel(categories, cat.category)}
                        </span>
                        <span className="category-amount">
                          {formatAmount(cat.total)} ({percentage.toFixed(1)}%)
                        </span>
                      </div>
                      <div className="category-bar-track">
                        <div
                          className="category-bar-fill"
                          style={{
                            width: `${percentage}%`,
                            backgroundColor: categoryColor(categories, cat.category)
                          }}
                        />
                      </div>
                      <div className="category-bar-stats">
                        <span>{cat.count} transactions</span>
                        <span>Avg: {formatAmount(cat.average)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {categoryTotals.length === 0 && (
            <div className="no-data">
              No expenses found for the selected period and categories.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
