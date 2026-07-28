/**
 * Analytics Component
 * Shows spending analytics by time period and category
 */

import { useState, useEffect, useMemo } from 'react';
import { getAnalytics } from '../services/api';
import { ExpenseCategory, Currency, AppSettings, FxRates } from '../types/expense.types';
import { formatCurrency, CURRENCY_SYMBOLS } from '../utils/format';
import { convertAmount } from '../utils/fx';

const CATEGORIES: ExpenseCategory[] = ['groceries', 'transport', 'media', 'entertainment', 'utilities', 'maintenance', 'other'];
const CURRENCIES: Currency[] = ['USD', 'PLN', 'BTC'];

const CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  groceries: '🛒 Groceries',
  transport: '🚗 Transport',
  media: '📺 Media',
  entertainment: '🎮 Entertainment',
  utilities: '💡 Utilities',
  maintenance: '🔨 Maintenance',
  other: '📦 Other'
};

const CATEGORY_COLORS: Record<ExpenseCategory, string> = {
  groceries: '#34d399',
  transport: '#60a5fa',
  media: '#a78bfa',
  entertainment: '#fbbf24',
  utilities: '#f87171',
  maintenance: '#fb923c',
  other: '#94a3b8'
};

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
  rates: FxRates;
}

export default function Analytics({ settings, rates }: AnalyticsProps) {
  const [timePeriod, setTimePeriod] = useState<TimePeriod>('month');
  const [selectedCategories, setSelectedCategories] = useState<ExpenseCategory[]>([...CATEGORIES]);
  const [selectedCurrency, setSelectedCurrency] = useState<Currency | 'all'>('all');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>('');

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
    setSelectedCategories(prev =>
      prev.includes(category)
        ? prev.filter(c => c !== category)
        : [...prev, category]
    );
  };

  /**
   * Handle select/deselect all categories
   */
  const toggleAllCategories = () => {
    if (selectedCategories.length === CATEGORIES.length) {
      setSelectedCategories([]);
    } else {
      setSelectedCategories([...CATEGORIES]);
    }
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
    if (timePeriod !== 'custom' || (startDate && endDate)) {
      loadAnalytics();
    }
  }, [timePeriod, selectedCategories, selectedCurrency, startDate, endDate]);

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

  const toDisplay = (amount: number, from: string) =>
    convertAmount(amount, from as Currency, displayCurrency, rates);

  // Per-currency subtotals are exact, so convert each once and then add.
  const overallTotal = useMemo(
    () => (analytics?.byCurrency ?? []).reduce((sum, c) => sum + toDisplay(c.total, c.currency), 0),
    [analytics, displayCurrency, rates]
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
  }, [analytics, displayCurrency, rates]);

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
                checked={selectedCategories.length === CATEGORIES.length}
                onChange={toggleAllCategories}
              />
              <strong>All Categories</strong>
            </label>
            {CATEGORIES.map(category => (
              <label key={category} className="checkbox-label">
                <input
                  type="checkbox"
                  checked={selectedCategories.includes(category)}
                  onChange={() => toggleCategory(category)}
                />
                {CATEGORY_LABELS[category]}
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
            {CURRENCIES.map(currency => (
              <button
                key={currency}
                className={selectedCurrency === currency ? 'active' : ''}
                onClick={() => setSelectedCurrency(currency)}
              >
                {currency} ({CURRENCY_SYMBOLS[currency]})
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Error Display */}
      {error && <div className="error-message">{error}</div>}

      {/* Loading */}
      {loading && <div className="loading">Loading analytics...</div>}

      {/* Results */}
      {!loading && analytics && (
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
                          {CATEGORY_LABELS[cat.category as ExpenseCategory]}
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
                            backgroundColor: CATEGORY_COLORS[cat.category as ExpenseCategory]
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
