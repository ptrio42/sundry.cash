/**
 * Settings Component
 * Edit single-user preferences (defaults for new expenses) and manage the
 * category list. Both are saved to the backend so they're shared across every
 * device on the network.
 *
 * Categories live here rather than behind their own tab: they are configuration
 * you touch a handful of times, not a place you go to look at your money.
 *
 * Two blocks arrived with the navigation shell, both because the mobile "More"
 * sheet that used to hold them is gone (§2 of `docs/ux-review-findings.md`):
 *
 * - **This device** — theme, and signing out where there is a session. The
 *   desktop sidebar still offers both as shortcuts; on a phone this is the only
 *   route to either, and deleting the sheet without rehoming them would have
 *   removed a working control rather than a redundant one.
 * - **Danger zone** — Wipe Database, out of primary navigation (F15, change 15).
 *   Red meant three things in this product — "irreversible", "over budget",
 *   "spending rose"; taking the permanent one out of the sidebar is what lets
 *   the other two read as signal.
 */

import { useState, FormEvent } from 'react';
import { AppSettings, BtcUnit, Category, Currency, CurrencyInfo, ExpenseCategory } from '../types/expense.types';
import {
  updateSettings,
  getCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  getCurrencies,
  setCurrencyEnabled,
} from '../services/api';
import { offeredCurrencies } from '../utils/currencies';
const BTC_UNITS: BtcUnit[] = ['BTC', 'sats'];

// Slugs are what every expense row stores, so the field is derived from the
// label rather than typed: 'Pet food' -> 'pet-food'. Same shape the backend
// enforces (lowercase letters, digits and hyphens).
function slugify(label: string): string {
  return label
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip diacritics so 'Ogród' -> 'ogrod'
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
}

const NEW_CATEGORY_COLOR = '#38bdf8';

interface SettingsProps {
  settings: AppSettings;
  categories: Category[];
  currencies: CurrencyInfo[];
  /** For the theme control below — the shell owns the state and persists it. */
  theme: 'dark' | 'light';
  /** Whether this instance has a password, i.e. whether there is a session to end. */
  authRequired: boolean;
  onSaved: (settings: AppSettings) => void;
  /** Hand the fresh catalogue back to App, which also feeds the formatter. */
  onCurrenciesChanged: (currencies: CurrencyInfo[]) => void;
  /** Hand the fresh list back to App, which owns it for the whole app. */
  onCategoriesChanged: (categories: Category[]) => void;
  /** Deleting with a reassignment target rewrites expense rows server-side. */
  onExpensesStale: () => void;
  onToggleTheme: () => void;
  onLogout: () => void;
  /** App owns the ledger, and keeps both confirmations. */
  onWipeDatabase: () => void;
}

export default function Settings({
  settings,
  categories,
  currencies,
  theme,
  authRequired,
  onSaved,
  onCurrenciesChanged,
  onCategoriesChanged,
  onExpensesStale,
  onToggleTheme,
  onLogout,
  onWipeDatabase,
}: SettingsProps) {
  const [defaultCurrency, setDefaultCurrency] = useState<Currency>(settings.defaultCurrency);
  const [defaultCategory, setDefaultCategory] = useState<ExpenseCategory>(settings.defaultCategory);
  const [defaultBtcUnit, setDefaultBtcUnit] = useState<BtcUnit>(settings.defaultBtcUnit);
  const [primaryCurrency, setPrimaryCurrency] = useState<Currency>(settings.primaryCurrency);
  const [saving, setSaving] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const [saved, setSaved] = useState<boolean>(false);

  // --- Category management -------------------------------------------------
  const [newLabel, setNewLabel] = useState<string>('');
  const [newColor, setNewColor] = useState<string>(NEW_CATEGORY_COLOR);
  const [categoryError, setCategoryError] = useState<string>('');
  const [categoryBusy, setCategoryBusy] = useState<boolean>(false);
  // The slug awaiting a "where should its rows go?" answer, and the answer.
  const [pendingDelete, setPendingDelete] = useState<string>('');
  const [reassignTo, setReassignTo] = useState<string>('other');

  // --- Currency management -------------------------------------------------
  const [currencyError, setCurrencyError] = useState<string>('');
  const [currencyBusy, setCurrencyBusy] = useState<string>('');
  const [showAllCurrencies, setShowAllCurrencies] = useState<boolean>(false);

  const toggleCurrency = async (code: string, enabled: boolean) => {
    setCurrencyError('');
    setCurrencyBusy(code);
    try {
      await setCurrencyEnabled(code, enabled);
      onCurrenciesChanged(await getCurrencies());
    } catch (err) {
      setCurrencyError(err instanceof Error ? err.message : 'Failed to update the currency');
    } finally {
      setCurrencyBusy('');
    }
  };

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

  /** Run a category mutation, then re-read the list so App holds the truth. */
  const withCategories = async (mutate: () => Promise<void>) => {
    setCategoryError('');
    setCategoryBusy(true);
    try {
      await mutate();
      onCategoriesChanged(await getCategories());
    } catch (err) {
      setCategoryError(err instanceof Error ? err.message : 'Failed to update categories');
    } finally {
      setCategoryBusy(false);
    }
  };

  const handleAddCategory = async (e: FormEvent) => {
    e.preventDefault();
    const label = newLabel.trim();
    const slug = slugify(label);
    if (!slug) {
      setCategoryError('Give the category a name using letters or digits');
      return;
    }
    await withCategories(async () => {
      await createCategory({ slug, label, color: newColor });
      setNewLabel('');
      setNewColor(NEW_CATEGORY_COLOR);
    });
  };

  const handleRename = (slug: string, label: string) => {
    void withCategories(() => updateCategory(slug, { label }).then(() => undefined));
  };

  const handleRecolor = (slug: string, color: string) => {
    void withCategories(() => updateCategory(slug, { color }).then(() => undefined));
  };

  const startDelete = (slug: string) => {
    setCategoryError('');
    setPendingDelete(slug);
    // Default the target to 'other', the built-in everything already falls back to.
    setReassignTo(categories.find(c => c.slug === 'other' && c.slug !== slug) ? 'other' : '');
  };

  const confirmDelete = async () => {
    const slug = pendingDelete;
    await withCategories(async () => {
      await deleteCategory(slug, reassignTo || undefined);
      setPendingDelete('');
      // The rows that used it now carry a different slug.
      if (reassignTo) onExpensesStale();
    });
  };

  const reassignTargets = categories.filter(c => c.slug !== pendingDelete);

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
            {offeredCurrencies(currencies).map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}
          </select>
          <p className="field-hint">Pre-selected when adding an expense, scanning a receipt, or importing.</p>
        </div>

        <div className="form-group">
          <label htmlFor="default-category">Default category</label>
          <select
            id="default-category"
            value={defaultCategory}
            onChange={(e) => { setDefaultCategory(e.target.value); setSaved(false); }}
          >
            {categories.map((c) => (
              <option key={c.slug} value={c.slug}>{c.label}</option>
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
            {offeredCurrencies(currencies).map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}
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

      <section className="settings-section" aria-labelledby="currencies-heading">
        <h3 id="currencies-heading">Currencies</h3>
        <p className="settings-intro">
          Switch on the currencies you spend in. Turning one off only stops it being offered
          for new expenses — everything already recorded in it stays exactly where it is.
        </p>

        {currencyError && <div className="error-message">{currencyError}</div>}

        <ul className="currency-manager">
          {(showAllCurrencies ? currencies : currencies.filter(c => c.enabled)).map((currency) => (
            <li key={currency.code} className="currency-manager-row">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={currency.enabled}
                  disabled={currencyBusy === currency.code}
                  onChange={(e) => toggleCurrency(currency.code, e.target.checked)}
                />
                <strong>{currency.code}</strong>
                <span className="currency-symbol-badge">{currency.symbol}</span>
              </label>
              {/* The exponent is shown because it is the one thing about a
                  currency that cannot be changed once it has been used. */}
              <span className="currency-decimals muted-text">
                {Math.round(Math.log10(currency.minorUnits))} decimal places
              </span>
            </li>
          ))}
        </ul>

        <button type="button" className="btn-link" onClick={() => setShowAllCurrencies(s => !s)}>
          {showAllCurrencies ? 'Show only the ones I use' : `Show all ${currencies.length} currencies`}
        </button>
      </section>

      <section className="settings-section" aria-labelledby="categories-heading">
        <h3 id="categories-heading">Categories</h3>
        <p className="settings-intro">
          Rename or recolour any category, and add your own. The seven we ship cannot be
          deleted — auto-categorization falls back to them.
        </p>

        {categoryError && <div className="error-message">{categoryError}</div>}

        <ul className="category-manager">
          {categories.map((category) => (
            <li key={category.slug} className="category-manager-row">
              <input
                type="color"
                className="category-color-input"
                value={category.color}
                aria-label={`Colour for ${category.label}`}
                disabled={categoryBusy}
                onChange={(e) => handleRecolor(category.slug, e.target.value)}
              />
              {/* Uncontrolled, so typing does not round-trip to the server on
                  every keystroke — the rename is sent on blur. The key carries
                  the label so a saved (or rejected) value re-seeds the field. */}
              <input
                type="text"
                className="category-label-input"
                defaultValue={category.label}
                key={`${category.slug}-${category.label}`}
                aria-label={`Name for ${category.label}`}
                maxLength={40}
                disabled={categoryBusy}
                onBlur={(e) => {
                  const next = e.target.value.trim();
                  if (!next) {
                    // The field is uncontrolled and the key has not changed, so
                    // React will not re-seed it: put the old name back by hand
                    // rather than leaving the row looking nameless.
                    setCategoryError(`"${category.label}" needs a name`);
                    e.target.value = category.label;
                    return;
                  }
                  if (next !== category.label) handleRename(category.slug, next);
                }}
                onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
              />
              <code className="category-slug">{category.slug}</code>
              {category.isBuiltin ? (
                <span className="category-builtin-badge" title="Shipped with the app">built-in</span>
              ) : (
                <button
                  type="button"
                  className="btn-link"
                  disabled={categoryBusy}
                  onClick={() => startDelete(category.slug)}
                >
                  Delete
                </button>
              )}
            </li>
          ))}
        </ul>

        {pendingDelete && (
          <div className="category-delete-confirm" role="group" aria-label="Confirm category deletion">
            <p>
              Delete <strong>{categories.find(c => c.slug === pendingDelete)?.label}</strong> and move
              anything that used it to:
            </p>
            <div className="category-delete-actions">
              <label className="sr-only" htmlFor="reassign-to">Move expenses to</label>
              <select id="reassign-to" value={reassignTo} onChange={(e) => setReassignTo(e.target.value)}>
                {reassignTargets.map((c) => (
                  <option key={c.slug} value={c.slug}>{c.label}</option>
                ))}
              </select>
              <button type="button" className="btn-primary" disabled={categoryBusy} onClick={confirmDelete}>
                Delete category
              </button>
              <button type="button" className="btn-secondary" disabled={categoryBusy} onClick={() => setPendingDelete('')}>
                Cancel
              </button>
            </div>
          </div>
        )}

        <form className="category-add" onSubmit={handleAddCategory}>
          <div className="form-group">
            <label htmlFor="new-category-label">Add a category</label>
            <div className="category-add-row">
              <input
                type="color"
                className="category-color-input"
                id="new-category-color"
                aria-label="Colour for the new category"
                value={newColor}
                onChange={(e) => setNewColor(e.target.value)}
              />
              <input
                type="text"
                id="new-category-label"
                placeholder="e.g. Pet food"
                maxLength={40}
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
              />
              <button type="submit" className="btn-secondary" disabled={categoryBusy || !newLabel.trim()}>
                Add
              </button>
            </div>
            {newLabel.trim() && (
              <p className="field-hint">
                Stored as <code>{slugify(newLabel) || '—'}</code>, which cannot be changed later.
              </p>
            )}
          </div>
        </form>
      </section>

      <section className="settings-section" aria-labelledby="device-heading">
        <h3 id="device-heading">This device</h3>
        <p className="settings-intro">
          Kept in this browser rather than on the server, so it does not follow you to
          another device.
        </p>

        <div className="settings-device-actions">
          <button type="button" className="btn-secondary" onClick={onToggleTheme}>
            {theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          </button>
          {authRequired && (
            <button type="button" className="btn-secondary" onClick={onLogout}>
              Sign out
            </button>
          )}
        </div>
      </section>

      <section className="settings-section danger-zone" aria-labelledby="danger-heading">
        <h3 id="danger-heading">Danger zone</h3>
        <p className="settings-intro">
          Wiping the database deletes every expense, and every receipt image stored with
          one, permanently. Budgets, categories and preferences stay. There is no undo —
          export from the ledger first if you want a copy.
        </p>

        <button type="button" className="btn-danger" onClick={onWipeDatabase}>
          Wipe database
        </button>
      </section>
    </div>
  );
}
