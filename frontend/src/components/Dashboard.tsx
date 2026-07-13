/**
 * Dashboard Component
 * Displays charts and statistics for expense visualization
 */

import { useMemo, useState } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid } from 'recharts';
import { DashboardProps, Currency } from '../types/expense.types';
import { formatCurrency } from '../utils/format';

// Colors for different categories
const COLORS: Record<string, string> = {
  groceries: '#34d399',
  transport: '#60a5fa',
  media: '#a78bfa',
  entertainment: '#fbbf24',
  utilities: '#f87171',
  maintenance: '#fb923c',
  other: '#94a3b8'
};

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

export default function Dashboard({ expenses }: DashboardProps) {
  const [timeGrouping, setTimeGrouping] = useState<TimeGrouping>('day');

  /**
   * Calculate statistics by category
   */
  const categoryStats = useMemo(() => {
    const stats: Record<string, number> = {};

    expenses.forEach(expense => {
      stats[expense.category] = (stats[expense.category] || 0) + expense.amount;
    });

    return Object.entries(stats).map(([category, total]) => ({
      name: category.charAt(0).toUpperCase() + category.slice(1),
      value: parseFloat(total.toFixed(2)),
      category
    }));
  }, [expenses]);

  /**
   * Calculate trend data based on time grouping
   */
  const trendData = useMemo(() => {
    if (expenses.length === 0) return [];

    const grouped: Record<string, number> = {};

    expenses.forEach(expense => {
      const date = new Date(expense.date);
      let key: string;

      if (timeGrouping === 'day') {
        key = expense.date;
      } else if (timeGrouping === 'week') {
        // Get start of week (Sunday)
        const startOfWeek = new Date(date);
        startOfWeek.setDate(date.getDate() - date.getDay());
        key = startOfWeek.toISOString().split('T')[0];
      } else {
        // Month
        key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      }

      grouped[key] = (grouped[key] || 0) + expense.amount;
    });

    return Object.entries(grouped)
      .map(([date, total]) => ({
        date,
        total: parseFloat(total.toFixed(2))
      }))
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-30); // Show last 30 periods
  }, [expenses, timeGrouping]);

  /**
   * Calculate summary statistics grouped by currency
   */
  const summary = useMemo(() => {
    const byCurrency = expenses.reduce((acc, exp) => {
      if (!acc[exp.currency]) {
        acc[exp.currency] = { total: 0, count: 0, amounts: [] };
      }
      acc[exp.currency].total += exp.amount;
      acc[exp.currency].count += 1;
      acc[exp.currency].amounts.push(exp.amount);
      return acc;
    }, {} as Record<Currency, { total: number; count: number; amounts: number[] }>);

    const formatCurrencyValues = (values: Record<Currency, number>) => {
      return Object.entries(values)
        .map(([currency, value]) => formatCurrency(value, currency as Currency))
        .join(' + ');
    };

    const totals = Object.entries(byCurrency).reduce((acc, [currency, data]) => {
      acc[currency as Currency] = data.total;
      return acc;
    }, {} as Record<Currency, number>);

    const averages = Object.entries(byCurrency).reduce((acc, [currency, data]) => {
      acc[currency as Currency] = data.total / data.count;
      return acc;
    }, {} as Record<Currency, number>);

    const highest = Object.entries(byCurrency).reduce((acc, [currency, data]) => {
      acc[currency as Currency] = Math.max(...data.amounts);
      return acc;
    }, {} as Record<Currency, number>);

    return {
      total: formatCurrencyValues(totals),
      count: expenses.length,
      average: formatCurrencyValues(averages),
      highest: formatCurrencyValues(highest)
    };
  }, [expenses]);

  return (
    <div className="dashboard">
      <h2>Dashboard</h2>

      {expenses.length === 0 ? (
        <p className="no-data">No expenses to display. Add some expenses to see your statistics!</p>
      ) : (
        <>
          {/* Summary Cards */}
          <div className="summary-cards">
            <div className="summary-card">
              <h3>Total Expenses</h3>
              <p className="value">{summary.total}</p>
            </div>
            <div className="summary-card">
              <h3>Number of Expenses</h3>
              <p className="value">{summary.count}</p>
            </div>
            <div className="summary-card">
              <h3>Average Expense</h3>
              <p className="value">{summary.average}</p>
            </div>
            <div className="summary-card">
              <h3>Highest Expense</h3>
              <p className="value">{summary.highest}</p>
            </div>
          </div>

          {/* Charts Section */}
          <div className="charts-container">
            {/* Category Pie Chart */}
            <div className="chart-box">
              <h3>Expenses by Category</h3>
              <ResponsiveContainer width="100%" height={350}>
                <PieChart>
                  <Pie
                    data={categoryStats}
                    cx="50%"
                    cy="50%"
                    labelLine={true}
                    label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                    outerRadius={90}
                    fill="#8884d8"
                    dataKey="value"
                  >
                    {categoryStats.map((entry) => (
                      <Cell key={entry.category} fill={COLORS[entry.category]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value: number) => value.toFixed(2)} />
                  <Legend verticalAlign="bottom" height={36} />
                </PieChart>
              </ResponsiveContainer>
            </div>

            {/* Trend Bar Chart */}
            <div className="chart-box">
              <div className="chart-header">
                <h3>Expense Trends</h3>
                <div className="time-grouping">
                  <button
                    className={timeGrouping === 'day' ? 'active' : ''}
                    onClick={() => setTimeGrouping('day')}
                  >
                    Daily
                  </button>
                  <button
                    className={timeGrouping === 'week' ? 'active' : ''}
                    onClick={() => setTimeGrouping('week')}
                  >
                    Weekly
                  </button>
                  <button
                    className={timeGrouping === 'month' ? 'active' : ''}
                    onClick={() => setTimeGrouping('month')}
                  >
                    Monthly
                  </button>
                </div>
              </div>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={trendData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis
                    dataKey="date"
                    angle={-45}
                    textAnchor="end"
                    height={80}
                    tickFormatter={formatPeriodTick}
                    interval="preserveStartEnd"
                    minTickGap={16}
                  />
                  <YAxis />
                  <Tooltip formatter={(value: number) => value.toFixed(2)} />
                  <Bar dataKey="total" fill="#34d399" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
