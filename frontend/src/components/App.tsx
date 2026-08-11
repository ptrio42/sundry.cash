/**
 * Main App Component
 * Manages application state and navigation between views
 */

import { useState, useEffect, useRef } from 'react';
import ExpenseForm from './ExpenseForm';
import ReceiptScan from './ReceiptScan';
import ExpenseTable from './ExpenseTable';
import Dashboard from './Dashboard';
import ExcelImport from './ExcelImport';
import Analytics from './Analytics';
import Budgets from './Budgets';
import Fx from './Fx';
import Settings from './Settings';
import EditExpenseModal from './EditExpenseModal';
import Login from './Login';
import { getExpenses, deleteExpense, updateExpense, deleteAllExpenses, getAuthStatus, getInstanceConfig, getToken, logout, getSettings, getFxRates, getCategories, getCurrencies } from '../services/api';
import { Expense, AppSettings, Category, CurrencyInfo, FxRates, InstanceConfig } from '../types/expense.types';
import { setCurrencyRegistry } from '../utils/format';
import '../App.css';

type View = 'form' | 'receipt' | 'table' | 'dashboard' | 'import' | 'analytics' | 'budgets' | 'fx' | 'settings';

type NavItem = { key: View; label: string; icon: string; short?: string };

/**
 * What to assume until `/api/config` answers — and what to keep assuming if it
 * never does.
 *
 * A private instance with every feature on: the same failure posture the auth
 * check already takes, because an unreachable config endpoint must not remove
 * a tab from someone's own install. The banner is the opposite case and stays
 * off by default: it is a claim about the data, and we only make it when the
 * server said so.
 */
const DEFAULT_INSTANCE: InstanceConfig = { demoMode: false, receiptsEnabled: true };

/** Where a visitor goes to see what this is. The banner's only link. */
const PRODUCT_URL = 'https://sundry.cash';

const DEFAULT_SETTINGS: AppSettings = {
  defaultCurrency: 'USD',
  defaultCategory: 'groceries',
  defaultBtcUnit: 'BTC',
  primaryCurrency: 'USD',
};

// Sensible fallback rates (match the backend seed) until the real ones load.
const DEFAULT_FX_RATES: FxRates = { USD: 1, PLN: 0.25, BTC: 65000 };

// The built-ins the backend seeds, mirrored here for the same reason as the FX
// rates above: the category fetch is non-fatal, and an empty list would leave
// every category dropdown in the app blank. These seven always exist server-side.
// Same idea for currencies: the three the backend enables out of the box, so a
// failed catalogue fetch narrows what is on offer rather than emptying it.
const DEFAULT_CURRENCIES: CurrencyInfo[] = [
  { code: 'USD', minorUnits: 100, symbol: '$', locale: 'en-US', isIso: true, enabled: true },
  { code: 'PLN', minorUnits: 100, symbol: 'zł', locale: 'pl-PL', isIso: true, enabled: true },
  { code: 'BTC', minorUnits: 100_000_000, symbol: '₿', locale: 'en-US', isIso: false, enabled: true },
];

const DEFAULT_CATEGORIES: Category[] = [
  { slug: 'groceries', label: 'Groceries', color: '#34d399', sortOrder: 0, isBuiltin: true },
  { slug: 'transport', label: 'Transport', color: '#60a5fa', sortOrder: 1, isBuiltin: true },
  { slug: 'media', label: 'Media', color: '#a78bfa', sortOrder: 2, isBuiltin: true },
  { slug: 'entertainment', label: 'Entertainment', color: '#fbbf24', sortOrder: 3, isBuiltin: true },
  { slug: 'utilities', label: 'Utilities', color: '#f87171', sortOrder: 4, isBuiltin: true },
  { slug: 'maintenance', label: 'Maintenance', color: '#fb923c', sortOrder: 5, isBuiltin: true },
  { slug: 'other', label: 'Other', color: '#94a3b8', sortOrder: 6, isBuiltin: true },
];

export default function App() {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [categories, setCategories] = useState<Category[]>(DEFAULT_CATEGORIES);
  const [currencies, setCurrencies] = useState<CurrencyInfo[]>(DEFAULT_CURRENCIES);
  const [fxRates, setFxRates] = useState<FxRates>(DEFAULT_FX_RATES);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>('');
  const [currentView, setCurrentView] = useState<View>('form');
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  const [authChecked, setAuthChecked] = useState<boolean>(false);
  const [authRequired, setAuthRequired] = useState<boolean>(false);
  const [authed, setAuthed] = useState<boolean>(false);
  const [instance, setInstance] = useState<InstanceConfig>(DEFAULT_INSTANCE);
  const [theme, setTheme] = useState<'dark' | 'light'>(() =>
    (typeof localStorage !== 'undefined' && localStorage.getItem('theme') === 'light') ? 'light' : 'dark'
  );
  // Mobile "More" sheet (holds the secondary nav + settings on small screens)
  const [moreOpen, setMoreOpen] = useState<boolean>(false);
  const moreButtonRef = useRef<HTMLButtonElement>(null);
  const moreSheetRef = useRef<HTMLDivElement>(null);

  const closeMore = () => {
    setMoreOpen(false);
    moreButtonRef.current?.focus();
  };

  // Close the mobile "More" sheet on Escape and move focus into it when it opens.
  useEffect(() => {
    if (!moreOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeMore(); };
    document.addEventListener('keydown', onKey);
    moreSheetRef.current?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [moreOpen]);

  // Apply and persist the theme (dark-first: dark is the default)
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('theme', theme);
  }, [theme]);

  /**
   * Ask the backend what it is before rendering anything, and listen for
   * session expiry.
   *
   * Both calls are public and both decide the first paint — whether to show the
   * login screen, whether to show a demo banner, whether the Scan Receipt tab
   * exists at all — so they go out together, before any token could exist.
   * Neither is fatal: each falls back independently, so a missing `/api/config`
   * (an older backend, a proxy hiccup) leaves the app fully usable rather than
   * quietly hiding a feature that works.
   */
  useEffect(() => {
    (async () => {
      try {
        const [status, config] = await Promise.all([
          // If the status check fails, fail open so local usage isn't blocked
          getAuthStatus().catch(() => ({ authRequired: false })),
          getInstanceConfig().catch(() => DEFAULT_INSTANCE),
        ]);
        setAuthRequired(status.authRequired);
        setAuthed(!status.authRequired || !!getToken());
        setInstance(config);
      } finally {
        setAuthChecked(true);
      }
    })();

    const onExpired = () => setAuthed(false);
    window.addEventListener('auth-expired', onExpired);
    return () => window.removeEventListener('auth-expired', onExpired);
  }, []);

  /**
   * Load expenses once authenticated
   */
  useEffect(() => {
    if (authChecked && authed) {
      loadExpenses();
    }
  }, [authChecked, authed]);

  /**
   * Load expenses from API
   */
  const loadExpenses = async () => {
    setLoading(true);
    setError('');

    try {
      // Expenses are required; settings, categories and FX rates are non-fatal
      // (fall back). Loaded here rather than per component so the whole app
      // agrees on one list, the same way settings and rates already do.
      const [data, loadedSettings, loadedCategories, loadedCurrencies, fx] = await Promise.all([
        getExpenses(),
        getSettings().catch(() => settings),
        getCategories().catch(() => categories),
        getCurrencies().catch(() => currencies),
        getFxRates().then(f => f.rates as FxRates).catch(() => fxRates),
      ]);
      setExpenses(data);
      setSettings(loadedSettings);
      setCategories(loadedCategories);
      applyCurrencies(loadedCurrencies);
      setFxRates(fx);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load expenses');
    } finally {
      setLoading(false);
    }
  };

  /**
   * Handle new expense added
   */
  const handleExpenseAdded = (newExpense: Expense) => {
    setExpenses(prev => [newExpense, ...prev]);
    // Switch to table view to see the new expense
    setCurrentView('table');
  };

  /**
   * Handle expense edit
   */
  const handleEdit = (expense: Expense) => {
    setEditingExpense(expense);
  };

  /**
   * Update an expense
   */
  const handleUpdateExpense = async (id: number, updates: Partial<Expense>) => {
    // Errors propagate to the caller (the edit modal), which surfaces them.
    const updated = await updateExpense(id, updates);
    setExpenses(prev => prev.map(exp => exp.id === id ? updated : exp));
  };

  /**
   * Close edit modal
   */
  const handleCloseEditModal = () => {
    setEditingExpense(null);
  };

  /**
   * Handle expense delete
   */
  const handleDelete = async (id: number) => {
    try {
      await deleteExpense(id);
      setExpenses(prev => prev.filter(exp => exp.id !== id));
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete expense');
    }
  };

  /**
   * Handle delete all expenses
   */
  const handleDeleteAll = async () => {
    const confirmMessage = `Are you sure you want to delete ALL ${expenses.length} expenses?\n\nThis action cannot be undone!`;

    if (!window.confirm(confirmMessage)) {
      return;
    }

    // Double confirmation for safety
    const doubleConfirm = window.confirm('Final confirmation: Delete all expenses permanently?');
    if (!doubleConfirm) {
      return;
    }

    try {
      const result = await deleteAllExpenses();
      setExpenses([]);
      alert(`Successfully deleted ${result.deletedCount} expenses`);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete all expenses');
    }
  };

  const handleLogout = () => {
    logout();
    setExpenses([]);
    setAuthed(false);
  };

  const handleSettingsSaved = (updated: AppSettings) => {
    setSettings(updated);
  };

  /**
   * Hold the catalogue in state *and* hand it to the formatter.
   *
   * `utils/format.ts` keeps a module-level registry rather than taking the
   * catalogue as an argument — it is called once per rendered amount, and
   * threading it through every call site would be noise. Updating it here,
   * before the setState that triggers the re-render, is what keeps the two in
   * step.
   */
  const applyCurrencies = (loaded: CurrencyInfo[]) => {
    setCurrencyRegistry(loaded);
    setCurrencies(loaded);
  };

  /**
   * Re-read the ledger without the full-screen loading state.
   *
   * Deleting a category with a reassignment target rewrites expense rows
   * server-side, so what we are holding is stale — but going through
   * `loadExpenses` would swap the Settings view out for "Loading expenses…"
   * mid-edit. This just swaps the data underneath.
   */
  const refreshExpenses = async () => {
    try {
      setExpenses(await getExpenses());
    } catch {
      // Keep showing the previous ledger rather than blanking the app; the
      // next real load will correct it.
    }
  };

  if (!authChecked) {
    return <div className="loading fullscreen-loading">Loading…</div>;
  }

  if (authRequired && !authed) {
    return <Login onSuccess={() => setAuthed(true)} />;
  }

  // `short` is the label the mobile bottom bar uses: five tabs share 375px, so
  // the full sidebar wording does not fit. The full label stays as the button's
  // accessible name, and each short form is a prefix of it (WCAG label-in-name).
  const ALL_NAV: NavItem[] = [
    { key: 'form', label: 'Add Expense', icon: '➕', short: 'Add' },
    { key: 'receipt', label: 'Scan Receipt', icon: '🧾', short: 'Scan' },
    { key: 'import', label: 'Import Excel', icon: '📥' },
    { key: 'table', label: 'All Expenses', icon: '📋', short: 'Expenses' },
    { key: 'dashboard', label: 'Dashboard', icon: '📊' },
    { key: 'analytics', label: 'Analytics', icon: '📈' },
    { key: 'budgets', label: 'Budgets', icon: '🎯' },
    { key: 'fx', label: 'Currencies', icon: '💱' },
    { key: 'settings', label: 'Settings', icon: '⚙️' }
  ];

  // An instance with receipts switched off has no Scan Receipt tab — the same
  // progressive disclosure the dashboard uses for currencies that are absent
  // from the data. Rendering a tab whose only possible outcome is a 403 would
  // be worse than not offering it.
  const NAV = ALL_NAV.filter(item => item.key !== 'receipt' || instance.receiptsEnabled);

  const VIEW_TITLES: Record<View, string> = {
    form: 'Add Expense',
    receipt: 'Scan Receipt',
    import: 'Import from Excel',
    table: 'All Expenses',
    dashboard: 'Dashboard',
    analytics: 'Analytics',
    budgets: 'Monthly Budgets',
    fx: 'Currency Conversion',
    settings: 'Preferences'
  };

  // Mobile bottom bar: a handful of primary tabs; the rest live behind "More".
  // Mapped over PRIMARY_KEYS rather than filtered out of NAV because the order
  // differs on purpose — Scan sits first on a phone. Keys that NAV no longer
  // holds (receipts off) simply drop out, leaving three tabs and "More".
  const PRIMARY_KEYS: View[] = ['receipt', 'form', 'table', 'dashboard'];
  const primaryItems = PRIMARY_KEYS
    .map(k => NAV.find(n => n.key === k))
    .filter((n): n is NavItem => n !== undefined);
  const secondaryItems = NAV.filter(n => !PRIMARY_KEYS.includes(n.key));
  const secondaryActive = secondaryItems.some(n => n.key === currentView);

  const goTo = (view: View) => {
    setCurrentView(view);
    setMoreOpen(false);
  };

  return (
    <div className="shell">
      {/*
        The banner is what makes the demo honest — not distorted data. The seed
        uses believable amounts and real shop names on purpose, so the
        disclosure has to live in the UI, above the sidebar and the content
        rather than beside them, where it cannot be mistaken for part of
        someone's finances.
      */}
      {instance.demoMode && (
        <div className="demo-banner">
          <span className="demo-banner-tag">Demo</span>
          <span>
            Everything here is fictional sample data, and the ledger is wiped and
            re-seeded every night. Nothing you add is kept, and nothing here belongs
            to a real person.
          </span>
          <a href={PRODUCT_URL} target="_blank" rel="noopener noreferrer">
            What Sundry is →
          </a>
        </div>
      )}

      <aside className="sidebar">
        <div className="sidebar-brand">
          <img className="logo" src="/icons/icon-192.png" alt="" aria-hidden="true" />
          <span>Sundry</span>
        </div>

        <nav className="sidebar-nav" aria-label="Main">
          {NAV.map(item => (
            <button
              key={item.key}
              className={currentView === item.key ? 'active' : ''}
              onClick={() => setCurrentView(item.key)}
              aria-current={currentView === item.key ? 'page' : undefined}
            >
              <span className="nav-icon" aria-hidden="true">{item.icon}</span>
              {item.label}
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          <button onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} title="Toggle light/dark theme">
            <span className="nav-icon" aria-hidden="true">{theme === 'dark' ? '☀️' : '🌙'}</span>
            {theme === 'dark' ? 'Light mode' : 'Dark mode'}
          </button>
          <button className="danger-button" onClick={handleDeleteAll} title="Delete all expenses from database">
            <span className="nav-icon" aria-hidden="true">🗑️</span>
            Wipe Database
          </button>
          {authRequired && (
            <button onClick={handleLogout} title="Sign out">
              <span className="nav-icon" aria-hidden="true">🔓</span>
              Logout
            </button>
          )}
        </div>
      </aside>

      <div className="content">
        <header className="topbar">
          <h1>{VIEW_TITLES[currentView]}</h1>
          <p className="tagline">Track your spending, stay on budget</p>
        </header>

        <main className="content-main">
          {error && (
            <div className="error-banner">
              {error}
              <button onClick={loadExpenses}>Retry</button>
            </div>
          )}

          {loading ? (
            <div className="loading">Loading expenses…</div>
          ) : (
            <>
              {currentView === 'form' && <ExpenseForm onExpenseAdded={handleExpenseAdded} settings={settings} categories={categories} currencies={currencies} />}
              {currentView === 'receipt' && <ReceiptScan onExpenseAdded={handleExpenseAdded} settings={settings} categories={categories} currencies={currencies} />}
              {currentView === 'import' && <ExcelImport settings={settings} currencies={currencies} />}
              {currentView === 'table' && (
                <ExpenseTable
                  expenses={expenses}
                  categories={categories}
                  currencies={currencies}
                  onEdit={handleEdit}
                  onDelete={handleDelete}
                  onUpdate={handleUpdateExpense}
                />
              )}
              {currentView === 'dashboard' && <Dashboard expenses={expenses} settings={settings} categories={categories} currencies={currencies} rates={fxRates} />}
              {currentView === 'analytics' && <Analytics settings={settings} categories={categories} currencies={currencies} rates={fxRates} />}
              {currentView === 'budgets' && <Budgets expenses={expenses} categories={categories} currencies={currencies} />}
              {currentView === 'fx' && <Fx expenses={expenses} currencies={currencies} rates={fxRates} onRatesChanged={setFxRates} />}
              {currentView === 'settings' && (
                <Settings
                  settings={settings}
                  categories={categories}
                  currencies={currencies}
                  onSaved={handleSettingsSaved}
                  onCurrenciesChanged={applyCurrencies}
                  onCategoriesChanged={setCategories}
                  onExpensesStale={refreshExpenses}
                />
              )}
            </>
          )}
        </main>
      </div>

      {/* Mobile bottom navigation (hidden on desktop via CSS) */}
      <nav className="bottom-nav" aria-label="Primary">
        {primaryItems.map(item => (
          <button
            key={item.key}
            className={currentView === item.key ? 'active' : ''}
            onClick={() => goTo(item.key)}
            aria-current={currentView === item.key ? 'page' : undefined}
            aria-label={item.label}
          >
            <span className="nav-icon" aria-hidden="true">{item.icon}</span>
            <span className="bottom-nav-label">{item.short ?? item.label}</span>
          </button>
        ))}
        <button
          ref={moreButtonRef}
          className={moreOpen || secondaryActive ? 'active' : ''}
          onClick={() => setMoreOpen(o => !o)}
          aria-expanded={moreOpen}
          aria-haspopup="dialog"
        >
          <span className="nav-icon" aria-hidden="true">☰</span>
          <span className="bottom-nav-label">More</span>
        </button>
      </nav>

      {/* "More" sheet: secondary views + settings, on mobile */}
      {moreOpen && (
        // Escape closes the sheet and focus is moved into it, so this click
        // handler is additive rather than the only way out.
        <div
          className="more-sheet-overlay"
          role="presentation"
          onClick={e => { if (e.target === e.currentTarget) closeMore(); }}
        >
          <div
            ref={moreSheetRef}
            className="more-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="More"
            tabIndex={-1}
          >
            <div className="more-sheet-handle" aria-hidden="true" />
            <div className="more-sheet-grid">
              {secondaryItems.map(item => (
                <button
                  key={item.key}
                  className={currentView === item.key ? 'active' : ''}
                  onClick={() => goTo(item.key)}
                >
                  <span className="nav-icon" aria-hidden="true">{item.icon}</span>
                  {item.label}
                </button>
              ))}
            </div>
            <div className="more-sheet-actions">
              <button onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
                <span className="nav-icon" aria-hidden="true">{theme === 'dark' ? '☀️' : '🌙'}</span>
                {theme === 'dark' ? 'Light mode' : 'Dark mode'}
              </button>
              <button className="danger-button" onClick={() => { setMoreOpen(false); handleDeleteAll(); }}>
                <span className="nav-icon" aria-hidden="true">🗑️</span>
                Wipe Database
              </button>
              {authRequired && (
                <button onClick={() => { setMoreOpen(false); handleLogout(); }}>
                  <span className="nav-icon" aria-hidden="true">🔓</span>
                  Logout
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      <EditExpenseModal
        expense={editingExpense}
        categories={categories}
        currencies={currencies}
        onSave={handleUpdateExpense}
        onClose={handleCloseEditModal}
      />
    </div>
  );
}
