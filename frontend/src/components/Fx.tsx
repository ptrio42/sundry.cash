/**
 * Fx Component
 * Manual exchange rates + a single normalized total across all currencies.
 * Fixes the "you can't sum USD + PLN + BTC" gap by converting to a base currency.
 */

import { useState, useEffect, useMemo } from 'react';
import { FxProps, Currency } from '../types/expense.types';
import { getFxRates, setFxRate } from '../services/api';
import { formatCurrency, CURRENCY_SYMBOLS } from '../utils/format';

const CURRENCIES: Currency[] = ['USD', 'PLN', 'BTC'];

export default function Fx({ expenses }: FxProps) {
  const [rates, setRates] = useState<Record<Currency, number>>({ USD: 1, PLN: 0, BTC: 0 });
  const [base, setBase] = useState<Currency>('USD');
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await getFxRates();
      setRates(data.rates as Record<Currency, number>);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load rates');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const perCurrency = useMemo(() => {
    const map: Record<string, { count: number; total: number }> = {};
    for (const e of expenses) {
      if (!map[e.currency]) map[e.currency] = { count: 0, total: 0 };
      map[e.currency].count += 1;
      map[e.currency].total += e.amount;
    }
    return map;
  }, [expenses]);

  // value of `amount` (in `from`) expressed in the selected base currency
  const toBase = (amount: number, from: Currency): number => {
    const r = rates[from];
    const rb = rates[base];
    if (!r || !rb) return 0;
    return (amount * r) / rb;
  };

  const grandBase = useMemo(
    () => Object.entries(perCurrency).reduce((s, [cur, d]) => s + toBase(d.total, cur as Currency), 0),
    [perCurrency, rates, base]
  );

  const saveRate = async (cur: Currency) => {
    const raw = drafts[cur];
    if (raw === undefined) return;
    const rate = parseFloat(raw);
    if (isNaN(rate) || rate <= 0) {
      setError('Rate must be a positive number');
      return;
    }
    try {
      const data = await setFxRate(cur, rate);
      setRates(data.rates as Record<Currency, number>);
      setDrafts(prev => {
        const next = { ...prev };
        delete next[cur];
        return next;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save rate');
    }
  };

  return (
    <div className="fx">
      <div className="budgets-head">
        <div>
          <h2>Currency Conversion</h2>
          <p className="muted-text">Normalize all spending into one base currency</p>
        </div>
        <div className="currency-buttons">
          {CURRENCIES.map(c => (
            <button key={c} className={base === c ? 'active' : ''} onClick={() => setBase(c)}>
              Base: {c}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="error-message">{error}</div>}

      {loading ? (
        <div className="loading">Loading rates…</div>
      ) : (
        <>
          <div className="summary-cards">
            <div className="summary-card">
              <h3>Total spend in {base}</h3>
              <p className="value">{formatCurrency(grandBase, base)}</p>
              <p className="subtitle">all currencies combined</p>
            </div>
          </div>

          <div className="chart-box chart-full" style={{ marginBottom: '18px' }}>
            <h3>
              Exchange rates <span className="muted-text">(value of 1 unit in USD)</span>
            </h3>
            <div className="fx-rates">
              {CURRENCIES.map(cur => {
                const draftVal = drafts[cur] !== undefined ? drafts[cur] : String(rates[cur] ?? '');
                return (
                  <div className="fx-rate-row" key={cur}>
                    <span className="fx-cur">
                      {cur} ({CURRENCY_SYMBOLS[cur]})
                    </span>
                    <span className="fx-eq">1 {cur} =</span>
                    <div className="budget-input">
                      <span className="budget-input-symbol">$</span>
                      <input
                        type="number"
                        min="0"
                        step="any"
                        aria-label={`USD value of 1 ${cur}`}
                        value={cur === 'USD' ? '1' : draftVal}
                        disabled={cur === 'USD'}
                        onChange={e => setDrafts(prev => ({ ...prev, [cur]: e.target.value }))}
                        onBlur={() => saveRate(cur)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="chart-box chart-full">
            <h3>By currency</h3>
            <div className="table-container">
              <table>
                <thead>
                  <tr>
                    <th>Currency</th>
                    <th>Expenses</th>
                    <th>Native total</th>
                    <th>In {base}</th>
                  </tr>
                </thead>
                <tbody>
                  {CURRENCIES.filter(c => perCurrency[c]).map(cur => (
                    <tr key={cur}>
                      <td>{cur}</td>
                      <td>{perCurrency[cur].count}</td>
                      <td className="amount">{formatCurrency(perCurrency[cur].total, cur)}</td>
                      <td className="amount">{formatCurrency(toBase(perCurrency[cur].total, cur), base)}</td>
                    </tr>
                  ))}
                  {CURRENCIES.filter(c => perCurrency[c]).length === 0 && (
                    <tr>
                      <td colSpan={4} className="no-data" style={{ padding: '24px' }}>
                        No expenses yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
