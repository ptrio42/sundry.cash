/**
 * Settings Component
 * Edit single-user preferences (defaults for new expenses). Saved to the
 * backend so they're shared across every device on the network.
 */

import { useState, FormEvent } from 'react';
import { AppSettings, BtcUnit, Currency, ExpenseCategory } from '../types/expense.types';
import { updateSettings } from '../services/api';

const CATEGORIES: ExpenseCategory[] = ['groceries', 'transport', 'media', 'entertainment', 'utilities', 'maintenance', 'other'];
const CURRENCIES: Currency[] = ['USD', 'PLN', 'BTC'];
const BTC_UNITS: BtcUnit[] = ['BTC', 'sats'];

interface SettingsProps {
  settings: AppSettings;
  onSaved: (settings: AppSettings) => void;
}

export default function Settings({ settings, onSaved }: SettingsProps) {
  const [defaultCurrency, setDefaultCurrency] = useState<Currency>(settings.defaultCurrency);
  const [defaultCategory, setDefaultCategory] = useState<ExpenseCategory>(settings.defaultCategory);
  const [defaultBtcUnit, setDefaultBtcUnit] = useState<BtcUnit>(settings.defaultBtcUnit);
  const [primaryCurrency, setPrimaryCurrency] = useState<Currency>(settings.primaryCurrency);
  const [saving, setSaving] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const [saved, setSaved] = useState<boolean>(false);

  const dirty =
    defaultCurrency !== settings.defaultCurrency ||
    defaultCategory !== settings.defaultCategory ||
    defaultBtcUnit !== settings.defaultBtcUnit ||
    primaryCurrency !== settings.primaryCurrency;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setSaved(false);
    setSaving(true);
    try {
      const updated = await updateSettings({ defaultCurrency, defaultCategory, defaultBtcUnit, primaryCurrency });
      onSaved(updated);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="settings">
      <h2>Preferences</h2>
      <p className="settings-intro">
        Defaults for new expenses. Saved on the server, so they apply on every device.
      </p>

      {error && <div className="error-message">{error}</div>}

      <form onSubmit={handleSubmit} className="settings-form">
        <div className="form-group">
          <label htmlFor="default-currency">Default currency</label>
          <select
            id="default-currency"
            value={defaultCurrency}
            onChange={(e) => { setDefaultCurrency(e.target.value as Currency); setSaved(false); }}
          >
            {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <p className="field-hint">Pre-selected when adding an expense, scanning a receipt, or importing.</p>
        </div>

        <div className="form-group">
          <label htmlFor="default-category">Default category</label>
          <select
            id="default-category"
            value={defaultCategory}
            onChange={(e) => { setDefaultCategory(e.target.value as ExpenseCategory); setSaved(false); }}
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
            ))}
          </select>
        </div>

        <div className="form-group">
          <label htmlFor="default-btc-unit">Default Bitcoin unit</label>
          <select
            id="default-btc-unit"
            value={defaultBtcUnit}
            onChange={(e) => { setDefaultBtcUnit(e.target.value as BtcUnit); setSaved(false); }}
          >
            {BTC_UNITS.map((u) => (
              <option key={u} value={u}>{u === 'BTC' ? '₿ BTC' : 'Satoshis'}</option>
            ))}
          </select>
          <p className="field-hint">Used when the currency is Bitcoin.</p>
        </div>

        <div className="form-group">
          <label htmlFor="primary-currency">Primary currency (reports)</label>
          <select
            id="primary-currency"
            value={primaryCurrency}
            onChange={(e) => { setPrimaryCurrency(e.target.value as Currency); setSaved(false); }}
          >
            {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <p className="field-hint">The dashboard can combine all spending into this currency using your FX rates.</p>
        </div>

        <div className="settings-actions">
          <button type="submit" className="btn-primary" disabled={saving || !dirty}>
            {saving ? 'Saving…' : 'Save Preferences'}
          </button>
          {saved && !dirty && <span className="settings-saved" role="status">✓ Saved</span>}
        </div>
      </form>
    </div>
  );
}
