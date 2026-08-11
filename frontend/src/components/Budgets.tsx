/**
 * Budgets Component
 * Set a monthly spending limit per category and track progress against it
 * (current-month spend is computed client-side from the expenses list).
 */

import { useState, useEffect, useMemo } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer } from 'recharts';
import { BudgetsProps, Budget, ExpenseCategory, Currency } from '../types/expense.types';
import { getBudgets, setBudget as apiSetBudget, deleteBudget as apiDeleteBudget } from '../services/api';
import { formatCurrency, CURRENCY_SYMBOLS } from '../utils/format';

const CURRENCIES: Currency[] = ['USD', 'PLN', 'BTC'];

function currentMonthKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export default function Budgets({ expenses, categories }: BudgetsProps) {
  const [currency, setCurrency] = useState<Currency>('USD');
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      setBudgets(await getBudgets());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load budgets');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const monthKey = currentMonthKey();
  const monthLabel = new Intl.DateTimeFormat(undefined, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC'
  }).format(new Date(`${monthKey}-01T00:00:00Z`));

  // Spend this month per category, in the selected currency
  const spentByCategory = useMemo(() => {
    const map: Record<string, number> = {};
    for (const e of expenses) {
      if (e.currency !== currency) continue;
      if (!e.date.startsWith(monthKey)) continue;
      map[e.category] = (map[e.category] || 0) + e.amount;
    }
    return map;
  }, [expenses, currency, monthKey]);

  // Cumulative spend per day of the current month (for the burn-down chart)
  const burndown = useMemo(() => {
    const [y, m] = monthKey.split('-').map(Number);
    const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const perDay: Record<number, number> = {};
    for (const e of expenses) {
      if (e.currency !== currency) continue;
      if (!e.date.startsWith(monthKey)) continue;
      const day = Number(e.date.slice(8, 10));
      perDay[day] = (perDay[day] || 0) + e.amount;
    }
    const data: { day: number; cumulative: number }[] = [];
    let cum = 0;
    for (let d = 1; d <= daysInMonth; d++) {
      cum += perDay[d] || 0;
      data.push({ day: d, cumulative: Number(cum.toFixed(8)) });
    }
    return data;
  }, [expenses, currency, monthKey]);

  const budgetFor = (cat: ExpenseCategory): number | undefined =>
    budgets.find(b => b.category === cat && b.currency === currency)?.amount;

  const changeCurrency = (c: Currency) => {
    setCurrency(c);
    setDrafts({});
  };

  const saveDraft = async (cat: ExpenseCategory) => {
    const raw = drafts[cat];
    if (raw === undefined) return; // untouched
    const amount = parseFloat(raw);
    try {
      if (raw.trim() === '' || isNaN(amount) || amount <= 0) {
        if (budgetFor(cat) !== undefined) await apiDeleteBudget(cat, currency);
      } else {
        await apiSetBudget(cat, currency, amount);
      }
      await load();
      setDrafts(prev => {
        const next = { ...prev };
        delete next[cat];
        return next;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save budget');
    }
  };

  const clearBudget = async (cat: ExpenseCategory) => {
    try {
      await apiDeleteBudget(cat, currency);
      await load();
      setDrafts(prev => {
        const next = { ...prev };
        delete next[cat];
        return next;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to clear budget');
    }
  };

  const budgetedCategories = budgets.filter(b => b.currency === currency);
  const totalBudget = budgetedCategories.reduce((s, b) => s + b.amount, 0);
  const totalSpent = Object.values(spentByCategory).reduce((s, v) => s + v, 0);
  const remaining = totalBudget - totalSpent;

  return (
    <div className="budgets">
      <div className="budgets-head">
        <div>
          <h2>Monthly Budgets</h2>
          <p className="muted-text">{monthLabel} · spending vs. limits</p>
        </div>
        <div className="currency-buttons">
          {CURRENCIES.map(c => (
            <button key={c} className={currency === c ? 'active' : ''} onClick={() => changeCurrency(c)}>
              {c} ({CURRENCY_SYMBOLS[c]})
            </button>
          ))}
        </div>
      </div>

      {error && <div className="error-message">{error}</div>}

      {loading ? (
        <div className="loading">Loading budgets…</div>
      ) : (
        <>
          <div className="summary-cards">
            <div className="summary-card">
              <h3>Budgeted</h3>
              <p className="value">{formatCurrency(totalBudget, currency)}</p>
              <p className="subtitle">across categories</p>
            </div>
            <div className="summary-card">
              <h3>Spent so far</h3>
              <p className="value">{formatCurrency(totalSpent, currency)}</p>
              <p className="subtitle">{monthLabel}</p>
            </div>
            <div className="summary-card">
              <h3>Remaining</h3>
              <p className="value" style={{ color: remaining < 0 ? 'var(--danger)' : 'var(--accent)' }}>
                {formatCurrency(remaining, currency)}
              </p>
              <p className="subtitle">
                {totalBudget > 0 ? `${Math.round((totalSpent / totalBudget) * 100)}% used` : 'set a limit below'}
              </p>
            </div>
          </div>

          {totalSpent > 0 && (
            <div className="chart-box chart-full" style={{ marginBottom: '18px' }}>
              <h3>Spending this month{totalBudget > 0 ? ' vs. budget' : ''}</h3>
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={burndown}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="day" tickFormatter={(d: number) => String(d)} minTickGap={16} />
                  <YAxis width={56} tickFormatter={(v: number) => `${CURRENCY_SYMBOLS[currency]}${Math.round(v)}`} />
                  <Tooltip
                    formatter={(v: number) => formatCurrency(v, currency)}
                    labelFormatter={(d) => `Day ${d}`}
                  />
                  {totalBudget > 0 && (
                    <ReferenceLine
                      y={totalBudget}
                      stroke="var(--danger)"
                      strokeDasharray="5 4"
                      label={{ value: 'Budget', fill: 'var(--danger)', fontSize: 11, position: 'insideTopRight' }}
                    />
                  )}
                  <Line type="monotone" dataKey="cumulative" stroke="#34d399" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          <div className="budget-list">
            {categories.map(category => {
              const cat = category.slug;
              const limit = budgetFor(cat);
              const spent = spentByCategory[cat] || 0;
              const pct = limit ? Math.min(100, (spent / limit) * 100) : 0;
              const over = limit !== undefined && spent > limit;
              const draftVal = drafts[cat] !== undefined ? drafts[cat] : limit !== undefined ? String(limit) : '';

              return (
                <div key={cat} className={`budget-row ${over ? 'over' : ''}`}>
                  <div className="budget-row-head">
                    <span className="budget-cat">
                      <span className="category-dot" style={{ background: category.color }} />
                      {category.label}
                    </span>
                    <span className="budget-figures">
                      <strong>{formatCurrency(spent, currency)}</strong>
                      {limit !== undefined && <span className="muted-text"> / {formatCurrency(limit, currency)}</span>}
                      {over && <span className="over-badge">over</span>}
                    </span>
                  </div>

                  <div className="budget-bar-track">
                    <div
                      className="budget-bar-fill"
                      style={{ width: `${pct}%`, background: over ? 'var(--danger)' : 'var(--accent)' }}
                    />
                  </div>

                  <div className="budget-row-actions">
                    <div className="budget-input">
                      <span className="budget-input-symbol">{CURRENCY_SYMBOLS[currency]}</span>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="No limit"
                        aria-label={`Monthly limit for ${category.label}`}
                        value={draftVal}
                        onChange={e => setDrafts(prev => ({ ...prev, [cat]: e.target.value }))}
                        onBlur={() => saveDraft(cat)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                        }}
                      />
                    </div>
                    {limit !== undefined && (
                      <button type="button" className="btn-link" onClick={() => clearBudget(cat)}>
                        Clear
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
