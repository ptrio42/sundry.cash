/**
 * Main App Component
 *
 * The navigation shell: four destinations, one persistent action, no overflow
 * sheet (§2 of `docs/ux-review-findings.md`). It also owns the route table, the
 * per-screen status line and the application state every screen is fed from.
 *
 * Home is the real thing as of wave 2: `Dashboard`, `Insights` and
 * `InsightsStrip` merged into one screen that leads with what it found.
 *
 * Wave 3 finished the other two. Add is a sheet over whatever you were reading,
 * so `ExpenseForm` and `ReceiptScan` are mounted by `AddSheet` rather than by a
 * route here (3a). Expenses is the ledger, the query tool and the door for bulk
 * data at once — `Analytics` folded into it and is gone from the repo (3b).
 *
 * Wave 4 closed the list. `Fx` was the last screen with no nav entry; its rate
 * editor is a control inside Settings' Currencies section now and the component
 * is gone from the repo (change 13). `ExcelImport` is reachable from two places
 * — Home's Start card and the Expenses toolbar — and from no destination of its
 * own. Four destinations, one sheet, nothing unreachable.
 */

import { useState, useEffect } from 'react';
import { Icon, type IconName } from './Icon';
import AddSheet, { AddedLine } from './AddSheet';
import Expenses from './Expenses';
import Home from './Home';
import Budgets from './Budgets';
import Settings from './Settings';
import EditExpenseModal from './EditExpenseModal';
import Login from './Login';
import { getExpenses, deleteExpense, updateExpense, deleteAllExpenses, getAuthStatus, getInstanceConfig, getToken, logout, getSettings, getFxRates, getCategories, getCurrencies } from '../services/api';
import { Expense, AppSettings, Category, CurrencyInfo, FxRates, InstanceConfig } from '../types/expense.types';
import { setCurrencyRegistry } from '../utils/format';
import { Destination, useRoute } from '../utils/route';
/* The outlined pair, not the editable one: "outlined" means the wordmark is
   vector paths, so the mark carries no font dependency and cannot render in a
   fallback serif before Newsreader arrives. Two files rather than one recoloured
   by CSS — the receipt's lower bar takes the *background* colour, so a mark that
   followed the theme through `fill` would need the SVG inlined into the bundle
   and its three fills rewritten. Imported from src/ so Vite content-hashes
   them: `/icons/` has to keep stable paths for the manifest, the sidebar mark
   does not, and a hashed name is what lets nginx serve it immutable. */
import logoLight from '../assets/brand/logo-horizontal-light.svg';
import logoDark from '../assets/brand/logo-horizontal-dark.svg';
import '../App.css';

type NavItem = { key: Destination; label: string; icon: IconName };

/**
 * Four destinations. No "More": five slots hold five things, and the overflow
 * sheet only ever existed because ten items did not fit into them.
 *
 * The labels are also the page titles (see `TITLES`) — four of them used to
 * disagree with the nav entry that opened them (F12).
 *
 * The icon is a name, not a size: the sidebar draws these at 18px beside their
 * label and the mobile bar draws the same four at 22px above it, so the size
 * belongs to the render site.
 */
const NAV: NavItem[] = [
  { key: 'home', label: 'Home', icon: 'home' },
  { key: 'expenses', label: 'Expenses', icon: 'expenses' },
  { key: 'budgets', label: 'Budgets', icon: 'budgets' },
  { key: 'settings', label: 'Settings', icon: 'settings' },
];

/**
 * Sidebar icons, against ~15px labels. The mobile bar draws the same four names
 * bigger, because down there the icon is above a 0.66rem label rather than
 * beside a 0.94rem one and is carrying most of the recognition itself.
 */
const NAV_ICON = 18;
const TAB_ICON = 22;
const TAB_ADD_ICON = 26;

/**
 * The persistent action. Not a destination and no longer even a route: it opens
 * `AddSheet` over wherever you are (change 10), and closing it leaves you there.
 */
const ADD_LABEL = 'Add expense';

const TITLES: Record<Destination, string> = {
  home: 'Home',
  expenses: 'Expenses',
  budgets: 'Budgets',
  settings: 'Settings',
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
 * `receiptsEnabled` gates the Add sheet's Scan tab, which is the only way into
 * scanning since wave 3a — an instance with OCR off would 403 the upload, so
 * the tab is not offered.
 */
const DEFAULT_INSTANCE: InstanceConfig = { demoMode: false, receiptsEnabled: true };

/** Where a visitor goes to see what this is. The banner's only link. */
const PRODUCT_URL = 'https://sundry.cash';

/**
 * Where the device's theme choice lives. Namespaced like `sundry-token` and
 * `sundry-add-method`, and deliberately *not* the old bare `theme` — see the
 * comment on the state below, and the twin of this constant in `index.html`,
 * which reads the same key before React exists.
 */
const THEME_KEY = 'sundry-theme';

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
  const { destination, addOpen, navigate, openAdd, closeAdd } = useRoute(BOOT_DESTINATION);
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  /** The expense the Add sheet just saved, while its confirmation is still up. */
  const [lastAdded, setLastAdded] = useState<Expense | null>(null);
  const [authChecked, setAuthChecked] = useState<boolean>(false);
  const [authRequired, setAuthRequired] = useState<boolean>(false);
  const [authed, setAuthed] = useState<boolean>(false);
  const [instance, setInstance] = useState<InstanceConfig>(DEFAULT_INSTANCE);
  /* Light-first since the brand landed: off-white is the brand's own background
     and `:root` is the light theme now, so the stored value is read for the
     *exception*.

     The key is new, and that is the point. The dark-first shell wrote
     `localStorage.theme = 'dark'` on every mount, for everyone, whether or not
     they had ever touched the toggle — so reading that key would have resolved
     every existing install to dark and shipped the whole rebrand to first-time
     visitors only. `sundry-theme` starts empty for all of them, which puts them
     on the new default once and leaves the toggle to say otherwise. It also
     matches how the two other keys in the app are named. */
  const [theme, setTheme] = useState<'dark' | 'light'>(() =>
    (typeof localStorage !== 'undefined' && localStorage.getItem(THEME_KEY) === 'dark') ? 'dark' : 'light'
  );

  const toggleTheme = () => setTheme(t => (t === 'dark' ? 'light' : 'dark'));

  // Apply and persist the theme (light-first: light is the default)
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(THEME_KEY, theme);
    /* The browser paints its own chrome — the address bar on Android, the status
       bar in an installed PWA — from this tag, and nothing but this line ever
       rewrites it. Left static it would frame a charcoal app in off-white for
       everyone on dark. Read from the stylesheet rather than repeated here, so
       the tag cannot drift from `--bg`. */
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      meta.setAttribute('content',
        getComputedStyle(document.documentElement).getPropertyValue('--bg').trim());
    }
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
   *
   * Change 11: the sheet closes, you stay exactly where you were, and a line
   * says what was saved. Saving used to `navigate('expenses')` and say nothing
   * at all, so the only evidence that anything had happened was that the app had
   * moved you — on the most frequent action in the product (F7).
   */
  const handleExpenseAdded = (newExpense: Expense) => {
    setExpenses(prev => [newExpense, ...prev]);
    closeAdd();
    setLastAdded(newExpense);
  };

  /** Open the sheet. The previous confirmation goes: it is about to be replaced. */
  const handleOpenAdd = () => {
    setLastAdded(null);
    openAdd();
  };

  /**
   * Go somewhere, and drop the confirmation on the way.
   *
   * The line says what you just did *here*; carrying it to another screen would
   * make it a notification, which is not what it is.
   */
  const goTo = (next: Destination) => {
    setLastAdded(null);
    navigate(next);
  };

  /** Undo: take back the row the confirmation is about. */
  const handleUndoAdd = async () => {
    if (!lastAdded) return;
    try {
      await deleteExpense(lastAdded.id);
      setExpenses(prev => prev.filter(exp => exp.id !== lastAdded.id));
      setLastAdded(null);
    } catch (err) {
      // Keep the line up: the row is still there, and Undo is still the fix.
      alert(err instanceof Error ? err.message : 'Failed to undo');
    }
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
    // The confirmation names an amount and a category. Editing the row it is
    // about through its own Edit link must not leave it stating the old ones.
    setLastAdded(prev => (prev && prev.id === id ? updated : prev));
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
    const noun = expenses.length === 1 ? 'expense' : 'expenses';
    const confirmMessage = `Are you sure you want to delete ALL ${expenses.length} ${noun}?\n\nThis action cannot be undone!`;

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
      alert(`Successfully deleted ${result.deletedCount} ${result.deletedCount === 1 ? 'expense' : 'expenses'}`);
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
   * own. Expenses is the other one, for the opposite reason: since wave 3 the
   * window is the user's own choice, so the screen prints it back under its
   * filter bar rather than having the shell guess at it.
   */
  const STATUS: Record<Destination, string> = {
    home: 'What stands out, and what you spent — every section states its own period.',
    expenses: 'Every expense you have recorded — filter it, chart it, import and export it.',
    // No month here since wave 3c: Budgets carries a stepper, and a status line
    // naming August above a screen showing July is the contradiction F10 was.
    budgets: 'Your standing limits, against the month you pick.',
    settings: 'Defaults, currencies and categories for this install.',
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
          {/* The arrow was a font character pointing vaguely rightwards; the
              destination is a different origin in a new tab, and the icon says
              so. `external-link` ships a 14px optical cut, which is why 14. */}
          <a href={PRODUCT_URL} target="_blank" rel="noopener noreferrer">
            What Sundry is <Icon name="external-link" size={14} />
          </a>
        </div>
      )}

      <aside className="sidebar">
        {/* The horizontal logo carries the wordmark, so the `<span>Sundry</span>`
            that used to sit beside a 26px app icon would now be the name twice.
            The alt text is what keeps it once for a screen reader. Picked at
            render rather than at build: the mark has a light and a dark cut and
            the toggle has to move it. */}
        <div className="sidebar-brand">
          <img className="logo" src={theme === 'dark' ? logoDark : logoLight} alt="Sundry" />
        </div>

        {/* Above the destinations and styled unlike them, because it is not a
            place you can be — it is the thing you do from wherever you are.
            `aria-expanded` rather than `aria-current`, now that it opens a
            sheet instead of going to a page. */}
        <button
          className="btn-add-expense"
          onClick={handleOpenAdd}
          aria-haspopup="dialog"
          aria-expanded={addOpen}
        >
          <span className="nav-icon" aria-hidden="true"><Icon name="add" size={NAV_ICON} /></span>
          {ADD_LABEL}
        </button>

        <nav className="sidebar-nav" aria-label="Main">
          {NAV.map(item => (
            <button
              key={item.key}
              className={destination === item.key ? 'active' : ''}
              onClick={() => goTo(item.key)}
              aria-current={destination === item.key ? 'page' : undefined}
            >
              <span className="nav-icon" aria-hidden="true"><Icon name={item.icon} size={NAV_ICON} /></span>
              {item.label}
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          {/* Icon and label both name the *destination* state, not the current
              one: on dark you are offered a sun and the word "Light mode". */}
          <button onClick={toggleTheme} title="Toggle light/dark theme">
            <span className="nav-icon" aria-hidden="true">
              <Icon name={theme === 'dark' ? 'light-mode' : 'dark-mode'} size={NAV_ICON} />
            </span>
            {theme === 'dark' ? 'Light mode' : 'Dark mode'}
          </button>
          {/* Decorative, despite the icon spec calling this "the label-less
              sign-out button": the word Logout is right there, so the button is
              already named and an `aria-label` here would only override it with
              a second wording. */}
          {authRequired && (
            <button onClick={handleLogout} title="Sign out">
              <span className="nav-icon" aria-hidden="true"><Icon name="sign-out" size={NAV_ICON} /></span>
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

        {/* Under the title of the screen you did not leave, which is the whole
            point of it (change 11). */}
        <AddedLine
          expense={lastAdded}
          categories={categories}
          onUndo={handleUndoAdd}
          onEdit={() => lastAdded && setEditingExpense(lastAdded)}
          onDismiss={() => setLastAdded(null)}
        />

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
              {destination === 'expenses' && (
                <Expenses
                  expenses={expenses}
                  settings={settings}
                  categories={categories}
                  currencies={currencies}
                  rates={fxRates}
                  onEdit={handleEdit}
                  onDelete={handleDelete}
                  onUpdate={handleUpdateExpense}
                  onExpensesStale={refreshExpenses}
                />
              )}
              {destination === 'home' && (
                <Home
                  expenses={expenses}
                  settings={settings}
                  categories={categories}
                  currencies={currencies}
                  rates={fxRates}
                  onAddExpense={handleOpenAdd}
                  onExpensesStale={refreshExpenses}
                />
              )}
              {destination === 'budgets' && <Budgets expenses={expenses} settings={settings} categories={categories} currencies={currencies} rates={fxRates} />}
              {destination === 'settings' && (
                <Settings
                  settings={settings}
                  categories={categories}
                  currencies={currencies}
                  expenses={expenses}
                  rates={fxRates}
                  theme={theme}
                  authRequired={authRequired}
                  onSaved={handleSettingsSaved}
                  onCurrenciesChanged={applyCurrencies}
                  onRatesChanged={setFxRates}
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
            onClick={() => goTo(item.key)}
            aria-current={destination === item.key ? 'page' : undefined}
          >
            <span className="nav-icon" aria-hidden="true"><Icon name={item.icon} size={TAB_ICON} /></span>
            <span className="bottom-nav-label">{item.label}</span>
          </button>
        ))}

        <button
          className={`bottom-nav-add${addOpen ? ' active' : ''}`}
          onClick={handleOpenAdd}
          aria-haspopup="dialog"
          aria-expanded={addOpen}
        >
          <span className="nav-icon" aria-hidden="true"><Icon name="add" size={TAB_ADD_ICON} /></span>
          <span className="sr-only">{ADD_LABEL}</span>
        </button>

        {rightTabs.map(item => (
          <button
            key={item.key}
            className={destination === item.key ? 'active' : ''}
            onClick={() => goTo(item.key)}
            aria-current={destination === item.key ? 'page' : undefined}
          >
            <span className="nav-icon" aria-hidden="true"><Icon name={item.icon} size={TAB_ICON} /></span>
            <span className="bottom-nav-label">{item.label}</span>
          </button>
        ))}
      </nav>

      {/* Over whatever is above, from anywhere, and back to it when it closes. */}
      <AddSheet
        open={addOpen}
        receiptsEnabled={instance.receiptsEnabled}
        settings={settings}
        categories={categories}
        currencies={currencies}
        onExpenseAdded={handleExpenseAdded}
        onClose={closeAdd}
      />

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
