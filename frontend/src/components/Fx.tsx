/**
 * Fx Component
 * Edit manual exchange rates and see a single normalized total across all
 * currencies. Rates are owned by App (single source of truth) and passed in;
 * saving a rate reports the new set back up via onRatesChanged.
 */

import { useState, useMemo } from 'react';
import { FxProps, Currency, FxRates } from '../types/expense.types';
import { setFxRate } from '../services/api';
import { convertAmount } from '../utils/fx';
import { formatCurrency } from '../utils/format';
import { relevantCurrencies } from '../utils/currencies';

export default function Fx({ expenses, currencies, rates, onRatesChanged }: FxProps) {
  // Enabled currencies plus any the ledger already holds. A rate is what
  // converts *history*, so a currency you have stopped using still needs a row
  // here — the backend applies the same rule to PUT /api/fx.
  const rows = useMemo(
    () => relevantCurrencies(currencies, expenses.map(e => e.currency)),
    [currencies, expenses]
  );

  const [base, setBase] = useState<Currency>('USD');
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string>('');

  const perCurrency = useMemo(() => {
    const map: Record<string, { count: number; total: number }> = {};
    for (const e of expenses) {
      if (!map[e.currency]) map[e.currency] = { count: 0, total: 0 };
      map[e.currency].count += 1;
      map[e.currency].total += e.amount;
    }
    return map;
  }, [expenses]);

  const grandBase = useMemo(
    () => Object.entries(perCurrency).reduce((s, [cur, d]) => s + convertAmount(d.total, cur as Currency, base, rates), 0),
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
      onRatesChanged(data.rates as FxRates);
      setDrafts(prev => {
        const next = { ...prev };
        delete next[cur];
        return next;
      });
      setError('');
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
          {rows.map(c => (
            <button key={c.code} className={base === c.code ? 'active' : ''} onClick={() => setBase(c.code)}>
              Base: {c.code}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="error-message">{error}</div>}

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
          {rows.map(({ code: cur, symbol }) => {
            const draftVal = drafts[cur] !== undefined ? drafts[cur] : String(rates[cur] ?? '');
            return (
              <div className="fx-rate-row" key={cur}>
                <span className="fx-cur">
                  {cur} ({symbol})
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
              {rows.filter(c => perCurrency[c.code]).map(({ code: cur }) => (
                <tr key={cur}>
                  <td>{cur}</td>
                  <td>{perCurrency[cur].count}</td>
                  <td className="amount">{formatCurrency(perCurrency[cur].total, cur)}</td>
                  <td className="amount">{formatCurrency(convertAmount(perCurrency[cur].total, cur, base, rates), base)}</td>
                </tr>
              ))}
              {rows.filter(c => perCurrency[c.code]).length === 0 && (
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
    </div>
  );
}
