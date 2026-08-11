/**
 * Main App Component
 *
 * The navigation shell: four destinations, one persistent action, no overflow
 * sheet (§2 of `docs/ux-review-findings.md`). It also owns the route table, the
 * per-screen status line and the application state every screen is fed from.
 *
 * Home is the real thing as of wave 2: `Dashboard`, `Insights` and
 * `InsightsStrip` merged into one screen that leads with what it found. Waves 3
 * and 4 rebuild Expenses and Budgets the same way. `Analytics`, `Fx` and
 * `ReceiptScan` are still not reachable: they lose their nav entries here and
 * are re-entered from within their new homes, so they are deliberately not
 * imported rather than deleted. `ExcelImport` is reachable again, but from
 * inside Home's Start card rather than from a destination of its own.
 */

import { useState, useEffect } from 'react';
import ExpenseForm from './ExpenseForm';
import ExpenseTable from './ExpenseTable';
import Home from './Home';
import Budgets from './Budgets';
import Settings from './Settings';
import EditExpenseModal from './EditExpenseModal';
import Login from './Login';
import { getExpenses, deleteExpense, updateExpense, deleteAllExpenses, getAuthStatus, getInstanceConfig, getToken, logout, getSettings, getFxRates, getCategories, getCurrencies } from '../services/api';
import { Expense, AppSettings, Category, CurrencyInfo, FxRates, InstanceConfig } from '../types/expense.types';
import { setCurrencyRegistry } from '../utils/format';
import { Destination, useRoute } from '../utils/route';
import '../App.css';

type NavItem = { key: Destination; label: string; icon: string };

/**
 * Four destinations. No "More": five slots hold five things, and the overflow
 * sheet only ever existed because ten items did not fit into them.
 *
 * The labels are also the page titles (see `TITLES`) — four of them used to
 * disagree with the nav entry that opened them (F12).
 */
const NAV: NavItem[] = [
  { key: 'home', label: 'Home', icon: '🏠' },
  { key: 'expenses', label: 'Expenses', icon: '📋' },
  { key: 'budgets', label: 'Budgets', icon: '🎯' },
  { key: 'settings', label: 'Settings', icon: '⚙️' },
];

/** The persistent action. Not a destination: it is reachable from every one of them. */
const ADD_LABEL = 'Add expense';

const TITLES: Record<Destination, string> = {
  home: 'Home',
  expenses: 'Expenses',
  budgets: 'Budgets',
  settings: 'Settings',
  add: ADD_LABEL,
};

/**
 * Where a visitor goes when the app boots without a route.
 *
 * Home, as of wave 2 — change 2, and the last line of that wave rather than the
 * first. The report is explicit that flipping this is worthless until Home is
 * worth opening, and that it is the one change altering what every user sees
 * first: a product that tells you things must not open on a blank form and ask
 * you to work before it says anything.
 */
const BOOT_DESTINATION: Destination = 'home';

/**
 * What to assume until `/api/config` answers — and what to keep assuming if it
 * never does.
 *
 * A private instance with every feature on: the same failure posture the auth
 * check already takes, because an unreachable config endpoint must not remove
 * a tab from someone's own install. The banner is the opposite case and stays
 * off by default: it is a claim about the data, and we only make it when the
 * server said so.
 *
 * `receiptsEnabled` has no consumer in this wave — scanning is not reachable
 * from anywhere until wave 3 puts it behind the Add sheet, which is where the
 * flag will gate it again.
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
  const [destination, navigate] = useRoute(BOOT_DESTINATION);
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  const [authChecked, setAuthChecked] = useState<boolean>(false);
  const [authRequired, setAuthRequired] = useState<boolean>(false);
  const [authed, setAuthed] = useState<boolean>(false);
  const [instance, setInstance] = useState<InstanceConfig>(DEFAULT_INSTANCE);
  const [theme, setTheme] = useState<'dark' | 'light'>(() =>
    (typeof localStorage !== 'undefined' && localStorage.getItem('theme') === 'light') ? 'light' : 'dark'
  );

  const toggleTheme = () => setTheme(t => (t === 'dark' ? 'light' : 'dark'));

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
   * login screen, whether to show a demo banner — so they go out together,
   * before any token could exist. Neither is fatal: each falls back
   * independently, so a missing `/api/config` (an older backend, a proxy
   * hiccup) leaves the app fully usable rather than quietly hiding a feature
   * that works.
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
    // Straight to the ledger, as today. Change 11 — staying where you were, with
    // an inline confirmation — arrives with the Add sheet in wave 3.
    navigate('expenses');
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
   *
   * Lives here because App owns the ledger, and is handed to the Settings danger
   * zone — the only place it is offered from since it left primary navigation
   * (F15). Both confirmations stay: it is the one irreversible action in the app.
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

  /**
   * What you are looking at, and over what period — the line that replaced the
   * tagline (F18, change 16). "Track your spending, stay on budget" pitched a
   * budgeting app under every one of ten page titles and never carried a fact.
   *
   * Home is the one screen this line cannot state a window for, and says so:
   * it carries two on purpose (ruling R2) and each of its sections prints its
   * own. Expenses still states the window it actually has, which is the whole
   * ledger, until wave 3 gives it a filter bar.
   */
  const STATUS: Record<Destination, string> = {
    home: 'What stands out, and what you spent — every section states its own period.',
    expenses: 'Your whole ledger — filter, sort and export it.',
    // No month here since wave 3: Budgets carries a stepper, and a status line
    // naming August above a screen showing July is the contradiction F10 was.
    budgets: 'Your standing limits, against the month you pick.',
    settings: 'Defaults, currencies and categories for this install.',
    add: 'One expense. It opens in the ledger once saved.',
  };

  /**
   * The mobile bar is `[ Home ] [ Expenses ] ( + ) [ Budgets ] [ Settings ]`:
   * the action sits in the middle as a raised button rather than a fifth tab, so
   * the destinations are split around it instead of mapped in one pass.
   */
  const leftTabs = NAV.slice(0, 2);
  const rightTabs = NAV.slice(2);

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

        {/* Above the destinations and styled unlike them, because it is not a
            place you can be — it is the thing you do from wherever you are. */}
        <button
          className="btn-add-expense"
          onClick={() => navigate('add')}
          aria-current={destination === 'add' ? 'page' : undefined}
        >
          <span className="nav-icon" aria-hidden="true">＋</span>
          {ADD_LABEL}
        </button>

        <nav className="sidebar-nav" aria-label="Main">
          {NAV.map(item => (
            <button
              key={item.key}
              className={destination === item.key ? 'active' : ''}
              onClick={() => navigate(item.key)}
              aria-current={destination === item.key ? 'page' : undefined}
            >
              <span className="nav-icon" aria-hidden="true">{item.icon}</span>
              {item.label}
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          <button onClick={toggleTheme} title="Toggle light/dark theme">
            <span className="nav-icon" aria-hidden="true">{theme === 'dark' ? '☀️' : '🌙'}</span>
            {theme === 'dark' ? 'Light mode' : 'Dark mode'}
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
          <h1>{TITLES[destination]}</h1>
          <p className="status-line">{STATUS[destination]}</p>
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
              {destination === 'add' && <ExpenseForm onExpenseAdded={handleExpenseAdded} settings={settings} categories={categories} currencies={currencies} />}
              {destination === 'expenses' && (
                <ExpenseTable
                  expenses={expenses}
                  categories={categories}
                  currencies={currencies}
                  onEdit={handleEdit}
                  onDelete={handleDelete}
                  onUpdate={handleUpdateExpense}
                />
              )}
              {destination === 'home' && (
                <Home
                  expenses={expenses}
                  settings={settings}
                  categories={categories}
                  currencies={currencies}
                  rates={fxRates}
                  onAddExpense={() => navigate('add')}
                  onExpensesStale={refreshExpenses}
                />
              )}
              {destination === 'budgets' && <Budgets expenses={expenses} settings={settings} categories={categories} currencies={currencies} rates={fxRates} />}
              {destination === 'settings' && (
                <Settings
                  settings={settings}
                  categories={categories}
                  currencies={currencies}
                  theme={theme}
                  authRequired={authRequired}
                  onSaved={handleSettingsSaved}
                  onCurrenciesChanged={applyCurrencies}
                  onCategoriesChanged={setCategories}
                  onExpensesStale={refreshExpenses}
                  onToggleTheme={toggleTheme}
                  onLogout={handleLogout}
                  onWipeDatabase={handleDeleteAll}
                />
              )}
            </>
          )}
        </main>
      </div>

      {/* Mobile bottom navigation (hidden on desktop via CSS).
          Every button here takes its accessible name from its own content — the
          four tabs from the word they show, the action from a visually hidden
          one, because a raised "+" is a glyph by design. That is one naming
          strategy; the bar used to run two, with four `aria-label`s spelling out
          a longer name than the tab rendered (report R6). */}
      <nav className="bottom-nav" aria-label="Primary">
        {leftTabs.map(item => (
          <button
            key={item.key}
            className={destination === item.key ? 'active' : ''}
            onClick={() => navigate(item.key)}
            aria-current={destination === item.key ? 'page' : undefined}
          >
            <span className="nav-icon" aria-hidden="true">{item.icon}</span>
            <span className="bottom-nav-label">{item.label}</span>
          </button>
        ))}

        <button
          className={`bottom-nav-add${destination === 'add' ? ' active' : ''}`}
          onClick={() => navigate('add')}
          aria-current={destination === 'add' ? 'page' : undefined}
        >
          <span className="nav-icon" aria-hidden="true">＋</span>
          <span className="sr-only">{ADD_LABEL}</span>
        </button>

        {rightTabs.map(item => (
          <button
            key={item.key}
            className={destination === item.key ? 'active' : ''}
            onClick={() => navigate(item.key)}
            aria-current={destination === item.key ? 'page' : undefined}
          >
            <span className="nav-icon" aria-hidden="true">{item.icon}</span>
            <span className="bottom-nav-label">{item.label}</span>
          </button>
        ))}
      </nav>

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
