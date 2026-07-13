/**
 * EditExpenseModal Component
 * Modal for editing existing expenses
 */

import { useState, useEffect, FormEvent } from 'react';
import { Expense, ExpenseCategory, Currency } from '../types/expense.types';

interface EditExpenseModalProps {
  expense: Expense | null;
  onSave: (id: number, updates: Partial<Expense>) => Promise<void>;
  onClose: () => void;
}

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

export default function EditExpenseModal({ expense, onSave, onClose }: EditExpenseModalProps) {
  const [amount, setAmount] = useState<string>('');
  const [date, setDate] = useState<string>('');
  const [description, setDescription] = useState<string>('');
  const [category, setCategory] = useState<ExpenseCategory>('other');
  const [currency, setCurrency] = useState<Currency>('USD');
  const [btcUnit, setBtcUnit] = useState<'BTC' | 'sats'>('BTC');
  const [saving, setSaving] = useState<boolean>(false);
  const [error, setError] = useState<string>('');

  // Populate form when expense changes
  useEffect(() => {
    if (expense) {
      setAmount(expense.amount.toString());
      setDate(expense.date);
      setDescription(expense.description);
      setCategory(expense.category);
      setCurrency(expense.currency);
      setBtcUnit('BTC'); // Reset to BTC by default
    }
  }, [expense]);

  // Handle unit switching - convert displayed amount when unit changes
  const handleUnitChange = (newUnit: 'BTC' | 'sats') => {
    if (currency === 'BTC' && amount) {
      const currentAmount = parseFloat(amount);
      if (!isNaN(currentAmount) && currentAmount > 0) {
        if (newUnit === 'sats' && btcUnit === 'BTC') {
          // Converting from BTC to sats
          setAmount((currentAmount * 100000000).toFixed(0));
        } else if (newUnit === 'BTC' && btcUnit === 'sats') {
          // Converting from sats to BTC
          setAmount((currentAmount / 100000000).toFixed(8));
        }
      }
    }
    setBtcUnit(newUnit);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();

    if (!expense) return;

    setError('');
    setSaving(true);

    try {
      const updates: Partial<Expense> = {};

      // Convert amount to BTC if in satoshis
      let finalAmount = parseFloat(amount);
      if (currency === 'BTC' && btcUnit === 'sats') {
        finalAmount = finalAmount / 100000000; // Convert sats to BTC
      }

      // Only include changed fields
      if (finalAmount !== expense.amount) {
        updates.amount = finalAmount;
      }
      if (date !== expense.date) {
        updates.date = date;
      }
      if (description !== expense.description) {
        updates.description = description;
      }
      if (category !== expense.category) {
        updates.category = category;
      }
      if (currency !== expense.currency) {
        updates.currency = currency;
      }

      await onSave(expense.id!, updates);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update expense');
    } finally {
      setSaving(false);
    }
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  if (!expense) return null;

  return (
    <div className="modal-backdrop" onClick={handleBackdropClick}>
      <div className="modal-content">
        <div className="modal-header">
          <h2>Edit Expense</h2>
          <button className="modal-close" onClick={onClose} type="button">
            ✕
          </button>
        </div>

        {error && <div className="error-message">{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="edit-amount">Amount *</label>
            {currency === 'BTC' && (
              <div className="btc-unit-toggle">
                <label>
                  <input
                    type="radio"
                    name="edit-btc-unit"
                    value="BTC"
                    checked={btcUnit === 'BTC'}
                    onChange={() => handleUnitChange('BTC')}
                  />
                  <span className="btc-unit-label">₿ BTC</span>
                </label>
                <label>
                  <input
                    type="radio"
                    name="edit-btc-unit"
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
              id="edit-amount"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              step={currency === 'BTC' ? (btcUnit === 'sats' ? '1' : '0.00000001') : '0.01'}
              min={currency === 'BTC' && btcUnit === 'sats' ? '1' : '0.01'}
              required
            />
            {currency === 'BTC' && amount && !isNaN(parseFloat(amount)) && (
              <div className="btc-conversion-hint">
                {btcUnit === 'sats'
                  ? `${(parseFloat(amount) / 100000000).toFixed(8)} BTC`
                  : `${(parseFloat(amount) * 100000000).toFixed(0)} sats`
                }
              </div>
            )}
          </div>

          <div className="form-group">
            <label htmlFor="edit-date">Date *</label>
            <input
              type="date"
              id="edit-date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="edit-description">Description *</label>
            <input
              type="text"
              id="edit-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="edit-category">Category *</label>
            <select
              id="edit-category"
              value={category}
              onChange={(e) => setCategory(e.target.value as ExpenseCategory)}
              required
            >
              {CATEGORIES.map(cat => (
                <option key={cat} value={cat}>
                  {CATEGORY_LABELS[cat]}
                </option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label htmlFor="edit-currency">Currency *</label>
            <select
              id="edit-currency"
              value={currency}
              onChange={(e) => setCurrency(e.target.value as Currency)}
              required
            >
              {CURRENCIES.map(curr => (
                <option key={curr} value={curr}>
                  {curr}
                </option>
              ))}
            </select>
          </div>

          <div className="modal-actions">
            <button type="submit" disabled={saving} className="btn-primary">
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
            <button type="button" onClick={onClose} className="btn-secondary">
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
