/**
 * EditExpenseModal Component
 * Modal for editing existing expenses
 */

import { useState, useEffect, useRef, FormEvent } from 'react';
import { Icon } from './Icon';
import { Category, CurrencyInfo, Expense, ExpenseCategory, Currency } from '../types/expense.types';
import { SATS_PER_BTC } from '../utils/format';
import { categoryLabel } from '../utils/categories';
import { offeredCurrencies } from '../utils/currencies';

interface EditExpenseModalProps {
  expense: Expense | null;
  categories: Category[];
  currencies: CurrencyInfo[];
  onSave: (id: number, updates: Partial<Expense>) => Promise<void>;
  onClose: () => void;
}

export default function EditExpenseModal({ expense, categories, currencies, onSave, onClose }: EditExpenseModalProps) {
  const [amount, setAmount] = useState<string>('');
  const [date, setDate] = useState<string>('');
  const [description, setDescription] = useState<string>('');
  // Placeholders, not defaults: the effect below fills both from the expense
  // before anything is shown (the component renders nothing without one). They
  // deliberately do *not* follow `settings` the way the entry forms do — an edit
  // has to open on what the row is denominated in, not on what a new expense
  // would be, or saving would silently re-denominate it.
  const [category, setCategory] = useState<ExpenseCategory>('other');
  const [currency, setCurrency] = useState<Currency>('USD');
  const [btcUnit, setBtcUnit] = useState<'BTC' | 'sats'>('BTC');
  const [saving, setSaving] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

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

  // Accessible dialog behavior: move focus in, trap Tab, close on Escape,
  // and restore focus to the triggering element on close.
  useEffect(() => {
    if (!expense) return;

    previouslyFocused.current = document.activeElement as HTMLElement;
    const node = dialogRef.current;
    const firstField =
      node?.querySelector<HTMLElement>('input, select, textarea') ??
      node?.querySelector<HTMLElement>('button');
    firstField?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key === 'Tab' && node) {
        const focusable = Array.from(
          node.querySelectorAll<HTMLElement>(
            'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
          )
        ).filter((el) => el.offsetParent !== null);
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      previouslyFocused.current?.focus();
    };
  }, [expense, onClose]);

  // Handle unit switching - convert displayed amount when unit changes
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
        finalAmount = finalAmount / SATS_PER_BTC; // Convert sats to BTC
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
    // Backdrop click is a convenience: the dialog traps focus, closes on Escape,
    // and has a visible Cancel control, so the keyboard path does not rely on it.
    <div className="modal-backdrop" onClick={handleBackdropClick} role="presentation">
      <div
        className="modal-content"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-expense-title"
      >
        <div className="modal-header">
          <h2 id="edit-expense-title">Edit Expense</h2>
          <button className="modal-close" onClick={onClose} type="button" aria-label="Close dialog">
            <Icon name="close" size={16} />
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
                  ? `${(parseFloat(amount) / SATS_PER_BTC).toFixed(8)} BTC`
                  : `${(parseFloat(amount) * SATS_PER_BTC).toFixed(0)} sats`
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
              {/* If the expense points at a category that has since been
                  deleted, keep it as an option rather than letting the select
                  fall back to the first entry and silently recategorize the
                  row on save. */}
              {!categories.some(cat => cat.slug === category) && (
                <option value={category}>{categoryLabel(categories, category)}</option>
              )}
              {categories.map(cat => (
                <option key={cat.slug} value={cat.slug}>
                  {cat.label}
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
              {/* Same reason as the category select above: an expense in a
                  since-disabled currency must not be silently re-denominated
                  by the select falling back to its first option. */}
              {!offeredCurrencies(currencies).some(c => c.code === currency) && (
                <option value={currency}>{currency}</option>
              )}
              {offeredCurrencies(currencies).map(curr => (
                <option key={curr.code} value={curr.code}>
                  {curr.code}
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
