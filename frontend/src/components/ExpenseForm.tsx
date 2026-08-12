/**
 * ExpenseForm Component
 * Form for adding new expenses with validation.
 *
 * The "Type it" tab of `AddSheet` since wave 3, and not a destination any more
 * (change 10). It renders no heading of its own: the sheet's header says "Add
 * expense" once, and the tab above says which of the two ways this is.
 */

import { useState, FormEvent } from 'react';
import { createExpense } from '../services/api';
import { ExpenseFormProps, ExpenseCategory, Currency } from '../types/expense.types';
import { SATS_PER_BTC } from '../utils/format';
import { offeredCurrencies } from '../utils/currencies';

export default function ExpenseForm({ onExpenseAdded, settings, categories, currencies }: ExpenseFormProps) {
  const [amount, setAmount] = useState<string>('');
  const [date, setDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [description, setDescription] = useState<string>('');
  const [category, setCategory] = useState<ExpenseCategory>(settings.defaultCategory);
  const [currency, setCurrency] = useState<Currency>(settings.defaultCurrency);
  const [btcUnit, setBtcUnit] = useState<'BTC' | 'sats'>(settings.defaultBtcUnit);
  const [error, setError] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);

  /**
   * Handle unit switching - convert displayed amount when unit changes
   */
  const handleUnitChange = (newUnit: 'BTC' | 'sats') => {
    if (currency === 'BTC' && amount) {
      const currentAmount = parseFloat(amount);
      if (!isNaN(currentAmount) && currentAmount > 0) {
        if (newUnit === 'sats' && btcUnit === 'BTC') {
          // Converting from BTC to sats
          setAmount((currentAmount * SATS_PER_BTC).toFixed(0));
        } else if (newUnit === 'BTC' && btcUnit === 'sats') {
          // Converting from sats to BTC
          setAmount((currentAmount / SATS_PER_BTC).toFixed(8));
        }
      }
    }
    setBtcUnit(newUnit);
  };

  /**
   * Validate form data before submission
   */
  const validateForm = (): boolean => {
    // Validate amount
    const amountNum = parseFloat(amount);
    if (isNaN(amountNum) || amountNum <= 0) {
      setError('Amount must be a positive number');
      return false;
    }

    // Validate date
    if (!date) {
      setError('Date is required');
      return false;
    }

    // Validate description
    if (description.trim().length === 0) {
      setError('Description cannot be empty');
      return false;
    }

    return true;
  };

  /**
   * Handle form submission
   */
  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');

    // Validate form
    if (!validateForm()) {
      return;
    }

    setLoading(true);

    try {
      // Convert amount to BTC if in satoshis
      let finalAmount = parseFloat(amount);
      if (currency === 'BTC' && btcUnit === 'sats') {
        finalAmount = finalAmount / SATS_PER_BTC; // Convert sats to BTC
      }

      // Create expense via API
      const newExpense = await createExpense({
        amount: finalAmount,
        date,
        description: description.trim(),
        category,
        currency
      });

      // Notify parent component
      onExpenseAdded(newExpense);

      // Reset form back to the configured defaults
      setAmount('');
      setDate(new Date().toISOString().split('T')[0]);
      setDescription('');
      setCategory(settings.defaultCategory);
      setCurrency(settings.defaultCurrency);
      setBtcUnit(settings.defaultBtcUnit);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create expense');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="expense-form">
      {error && <div className="error-message">{error}</div>}

      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label htmlFor="amount">Amount</label>
          {currency === 'BTC' && (
            <div className="btc-unit-toggle">
              <label>
                <input
                  type="radio"
                  name="btc-unit"
                  value="BTC"
                  checked={btcUnit === 'BTC'}
                  onChange={() => handleUnitChange('BTC')}
                />
                <span className="btc-unit-label">₿ BTC</span>
              </label>
              <label>
                <input
                  type="radio"
                  name="btc-unit"
                  value="sats"
                  checked={btcUnit === 'sats'}
                  onChange={() => handleUnitChange('sats')}
                />
                <span className="btc-unit-label">Satoshis</span>
              </label>
            </div>
          )}
          <input
            type="number"
            id="amount"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder={currency === 'BTC' && btcUnit === 'sats' ? '0' : '0.00'}
            step={currency === 'BTC' ? (btcUnit === 'sats' ? '1' : '0.00000001') : '0.01'}
            min={currency === 'BTC' && btcUnit === 'sats' ? '1' : '0.01'}
            required
          />
          {currency === 'BTC' && amount && !isNaN(parseFloat(amount)) && (
            <div className="btc-conversion-hint">
              {btcUnit === 'sats'
                ? `${(parseFloat(amount) / SATS_PER_BTC).toFixed(8)} BTC`
                : `${(parseFloat(amount) * SATS_PER_BTC).toFixed(0)} sats`
              }
            </div>
          )}
        </div>

        <div className="form-group">
          <label htmlFor="currency">Currency</label>
          <select
            id="currency"
            value={currency}
            onChange={(e) => setCurrency(e.target.value as Currency)}
            required
          >
            {offeredCurrencies(currencies).map((curr) => (
              <option key={curr.code} value={curr.code}>
                {curr.code}
              </option>
            ))}
          </select>
        </div>

        <div className="form-group">
          <label htmlFor="date">Date</label>
          <input
            type="date"
            id="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            required
          />
        </div>

        <div className="form-group">
          <label htmlFor="description">Description</label>
          <input
            type="text"
            id="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Enter expense description"
            required
          />
        </div>

        <div className="form-group">
          <label htmlFor="category">Category</label>
          <select
            id="category"
            value={category}
            onChange={(e) => setCategory(e.target.value as ExpenseCategory)}
            required
          >
            {categories.map((cat) => (
              <option key={cat.slug} value={cat.slug}>
                {cat.label}
              </option>
            ))}
          </select>
        </div>

        <button type="submit" disabled={loading}>
          {loading ? 'Adding...' : 'Add Expense'}
        </button>
      </form>
    </div>
  );
}
