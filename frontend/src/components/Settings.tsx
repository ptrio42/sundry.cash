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
 *   removed a working control rather than a redundant one. It also carries
 *   *"This device is…"*, the standing control for the label every row this
 *   browser adds is stamped with — **a label, not a login**: the household
 *   shares one password, so anyone can add an expense under any name. The Add
 *   sheet asks the question once; this is the only place either answer changes.
 * - **Danger zone** — Wipe Database, out of primary navigation (F15, change 15).
 *   Red meant three things in this product — "irreversible", "over budget",
 *   "spending rose"; taking the permanent one out of the sidebar is what lets
 *   the other two read as signal.
 *
 * Wave 4 folded the `Fx` screen in here (F12, change 13). Two destinations used
 * to answer to the word "currencies": the nav opened a rate editor titled
 * "Currency Conversion", while this section enabled and disabled them — and
 * which one you wanted depended on knowing that availability and rates are two
 * different tables. **One row per currency now carries all four facts**:
 * whether it is on, its symbol, its decimals and its rate.
 *
 * What did *not* move is the rest of that screen: its base picker, its combined
 * total and its per-currency table. Expenses prints exactly those figures over
 * the reader's own filters, and the standing answer to "which base" is the
 * Primary currency select forty lines above these rows. Settings is
 * configuration; the screen that reports money is Expenses.
 */

import { useState, FormEvent } from 'react';
import { Icon } from './Icon';
import { AppSettings, BtcUnit, Category, Currency, CurrencyInfo, Expense, ExpenseCategory, FxRates } from '../types/expense.types';
import {
  updateSettings,
  getCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  getCurrencies,
  setCurrencyEnabled,
  setFxRate,
} from '../services/api';
import { offeredCurrencies, relevantCurrencies } from '../utils/currencies';
import { MAX_WHO_LENGTH, readWho, setWho, skipWho } from '../utils/who';
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
  /**
   * The ledger, read for one thing only: which currencies still need a rate.
   * A currency you have switched off keeps its history, and that history still
   * has to convert — so it keeps a row here (`relevantCurrencies`).
   */
  expenses: Expense[];
  /** Owned by App, like `settings` and `categories`. */
  rates: FxRates;
  /** The names already in the ledger — what "This device is…" offers as buttons. */
  people: string[];
  /** For the theme control below — the shell owns the state and persists it. */
  theme: 'dark' | 'light';
  /** Whether this instance has a password, i.e. whether there is a session to end. */
  authRequired: boolean;
  onSaved: (settings: AppSettings) => void;
  /** Hand the fresh catalogue back to App, which also feeds the formatter. */
  onCurrenciesChanged: (currencies: CurrencyInfo[]) => void;
  /** Same shape, for the rates: the API answers with the whole set. */
  onRatesChanged: (rates: FxRates) => void;
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
  expenses,
  rates,
  people,
  theme,
  authRequired,
  onSaved,
  onCurrenciesChanged,
  onRatesChanged,
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

  // --- This device ---------------------------------------------------------
  /**
   * What this device calls itself on the rows it adds — the standing control the
   * Add sheet's one-time prompt points at.
   *
   * Held in state as well as in `localStorage` so the section re-renders when it
   * changes; `readWho` is the source of truth and is read once, at mount.
   */
  const [who, setWhoName] = useState<string>(() => readWho() ?? '');

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
  /** Rate fields being edited. An absent key means "show the saved rate". */
  const [rateDrafts, setRateDrafts] = useState<Record<string, string>>({});
  /**
   * Why one row's rate did not save — kept per row, not in `currencyError`.
   *
   * A refused draft stays in the box so it can be retried, which means the box
   * shows a number (or a blank) that is not the rate in force. The only thing
   * saying so is this message, so it must not be cleared by something that
   * happened to a different currency: `currencyError` is blanked by every
   * enable/disable, and folding rate failures into it left a row reading
   * "not set" against a stored rate the whole app was still converting at.
   */
  const [rateError, setRateError] = useState<{ code: string; message: string } | null>(null);

  /**
   * The currencies a rate row belongs to: everything enabled, plus everything
   * the ledger already holds.
   *
   * Not cosmetic. `PUT /api/fx` refuses a currency that is neither enabled nor
   * used, so an input outside this set would be a guaranteed 400 — which is
   * what "Show all 60 currencies" would otherwise render fifty-odd of.
   *
   * `relevantCurrencies` can also synthesise a row for a code the catalogue
   * does not know; it cannot happen from here, because `expenses.currency` is a
   * foreign key onto `currencies.code`.
   */
  const rateable = relevantCurrencies(currencies, expenses.map(e => e.currency));
  const hasRateRow = new Set(rateable.map(c => c.code));

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

  /**
   * Save one rate, on blur.
   *
   * Carried over from the deleted `Fx` screen, contract intact: an untouched
   * field never calls the API, a non-positive value is refused before it does,
   * and a failure leaves the typed value in the box so it can be retried. No
   * busy flag — `currencyBusy` names the code being *toggled*, and reusing it
   * would disable the wrong control mid-flight.
   */
  const saveRate = async (code: string) => {
    const raw = rateDrafts[code];
    if (raw === undefined) return;

    const rate = parseFloat(raw);
    if (isNaN(rate) || rate <= 0) {
      setRateError({ code, message: 'Rate must be a positive number' });
      return;
    }

    try {
      const data = await setFxRate(code, rate);
      onRatesChanged(data.rates as FxRates);
      setRateDrafts(prev => {
        const next = { ...prev };
        delete next[code];
        return next;
      });
      // Only this row's complaint: another row may still be holding one.
      setRateError(prev => (prev && prev.code === code ? null : prev));
    } catch (err) {
      setRateError({ code, message: err instanceof Error ? err.message : 'Failed to save rate' });
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
          {/* Since waves 3b and 3c this is three screens, not one: Expenses and
              Budgets both offer "All → " this currency too. */}
          <p className="field-hint">
            Home, Expenses and Budgets combine all spending into this currency, using the rates below.
          </p>
        </div>

        <div className="settings-actions">
          <button type="submit" className="btn-primary" disabled={saving || !dirty}>
            {saving ? 'Saving…' : 'Save Preferences'}
          </button>
          {saved && !dirty && <span className="settings-saved" role="status"><Icon name="check" size={14} /> Saved</span>}
        </div>
      </form>

      <section className="settings-section" aria-labelledby="currencies-heading">
        <h3 id="currencies-heading">Currencies</h3>
        <p className="settings-intro">
          Switch on the currencies you spend in, and say what each is worth. Turning one off
          only stops it being offered for new expenses — everything already recorded in it
          stays exactly where it is, which is why a currency you no longer use keeps its row
          and its rate here.
        </p>
        <p className="settings-intro">
          Rates are the value of one unit <strong>in US dollars</strong>, whatever your primary
          currency is; that is the anchor every converted figure in the app is worked out from.
        </p>

        {currencyError && <div className="error-message">{currencyError}</div>}

        <ul className="currency-manager">
          {(showAllCurrencies ? currencies : rateable).map((currency) => (
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
              {/* Deliberately outside the checkbox's label: an input inside it
                  would become part of the checkbox's accessible name. Only for
                  currencies the rate API will actually accept — see `rateable`. */}
              {hasRateRow.has(currency.code) && (
                <div className="currency-rate">
                  <span className="currency-rate-eq">1 {currency.code} =</span>
                  <div className="budget-input">
                    <span className="budget-input-symbol">$</span>
                    <input
                      type="number"
                      min="0"
                      step="any"
                      aria-label={`USD value of 1 ${currency.code}`}
                      placeholder="not set"
                      value={
                        currency.code === 'USD'
                          ? '1'
                          : (rateDrafts[currency.code] !== undefined
                              ? rateDrafts[currency.code]
                              // A rate of zero is what the backend seeds a newly
                              // enabled currency with, and `convertAmount` reads
                              // it as "cannot convert" — so it is the absence of
                              // a rate, not a rate of nothing. Showing "$0" here
                              // would state a value the app does not hold; the
                              // placeholder says what is true. Only visible now
                              // that these rows sit on a screen people open.
                              : (rates[currency.code] ? String(rates[currency.code]) : ''))
                      }
                      // The anchor cannot be worth anything but itself.
                      disabled={currency.code === 'USD'}
                      onChange={(e) => setRateDrafts(prev => ({ ...prev, [currency.code]: e.target.value }))}
                      onBlur={() => saveRate(currency.code)}
                      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                    />
                  </div>
                  {rateError?.code === currency.code && (
                    <span className="currency-rate-error">{rateError.message}</span>
                  )}
                </div>
              )}
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

        {/* The permanent home of the "who added it" label. The Add sheet asks
            once; this is where either answer is changed, including a "Not now"
            that has since become a yes.

            The help text says what it is not, because a name beside a row is
            exactly the shape of a login and this is not one — everyone on the
            instance shares one password. */}
        <div className="form-group who-setting">
          <label htmlFor="device-who">This device is…</label>
          <div className="who-setting-row">
            <input
              type="text"
              id="device-who"
              value={who}
              maxLength={MAX_WHO_LENGTH}
              placeholder="nobody in particular"
              onChange={(e) => setWhoName(e.target.value)}
              onBlur={() => setWho(who)}
              onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
            />
            <button
              type="button"
              className="btn-secondary"
              disabled={who.trim().length === 0}
              onClick={() => { setWhoName(''); skipWho(); }}
            >
              Clear
            </button>
          </div>
          {/* Only names the ledger already holds, so a household picks the
              spelling that is in use rather than inventing a second one. */}
          {people.length > 0 && (
            <div className="who-setting-people" role="group" aria-label="People already in the ledger">
              {people.map((person) => (
                <button
                  key={person}
                  type="button"
                  className={person === who ? 'btn-secondary active' : 'btn-secondary'}
                  aria-pressed={person === who}
                  onClick={() => { setWhoName(person); setWho(person); }}
                >
                  {person}
                </button>
              ))}
            </div>
          )}
          <p className="field-hint">
            Labels what you add from this browser, so a household sharing one instance can
            tell whose expense is whose. It is not a login: everyone here shares one
            password, and anyone can add an expense under any name. Leave it empty and your
            rows are simply unlabelled.
          </p>
        </div>

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
