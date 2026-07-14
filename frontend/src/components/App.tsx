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
import { getExpenses, deleteExpense, updateExpense, deleteAllExpenses, getAuthStatus, getToken, logout, getSettings } from '../services/api';
import { Expense, AppSettings } from '../types/expense.types';
import '../App.css';

type View = 'form' | 'receipt' | 'table' | 'dashboard' | 'import' | 'analytics' | 'budgets' | 'fx' | 'settings';

const DEFAULT_SETTINGS: AppSettings = {
  defaultCurrency: 'USD',
  defaultCategory: 'groceries',
  defaultBtcUnit: 'BTC',
};

export default function App() {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>('');
  const [currentView, setCurrentView] = useState<View>('form');
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  const [authChecked, setAuthChecked] = useState<boolean>(false);
  const [authRequired, setAuthRequired] = useState<boolean>(false);
  const [authed, setAuthed] = useState<boolean>(false);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moreOpen]);

  // Apply and persist the theme (dark-first: dark is the default)
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('theme', theme);
  }, [theme]);

  /**
   * Check whether the backend requires a password, and listen for session expiry
   */
  useEffect(() => {
    (async () => {
      try {
        const status = await getAuthStatus();
        setAuthRequired(status.authRequired);
        setAuthed(!status.authRequired || !!getToken());
      } catch {
        // If the status check fails, fail open so local usage isn't blocked
        setAuthRequired(false);
        setAuthed(true);
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
      // Expenses are required; settings are non-fatal (fall back to current).
      const [data, loadedSettings] = await Promise.all([
        getExpenses(),
        getSettings().catch(() => settings),
      ]);
      setExpenses(data);
      setSettings(loadedSettings);
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
    try {
      const updated = await updateExpense(id, updates);
      setExpenses(prev => prev.map(exp => exp.id === id ? updated : exp));
    } catch (err) {
      throw err;
    }
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

  if (!authChecked) {
    return <div className="loading fullscreen-loading">Loading…</div>;
  }

  if (authRequired && !authed) {
    return <Login onSuccess={() => setAuthed(true)} />;
  }

  const NAV: { key: View; label: string; icon: string }[] = [
    { key: 'form', label: 'Add Expense', icon: '➕' },
    { key: 'receipt', label: 'Scan Receipt', icon: '🧾' },
    { key: 'import', label: 'Import Excel', icon: '📥' },
    { key: 'table', label: 'All Expenses', icon: '📋' },
    { key: 'dashboard', label: 'Dashboard', icon: '📊' },
    { key: 'analytics', label: 'Analytics', icon: '📈' },
    { key: 'budgets', label: 'Budgets', icon: '🎯' },
    { key: 'fx', label: 'Currencies', icon: '💱' },
    { key: 'settings', label: 'Settings', icon: '⚙️' }
  ];
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
  const PRIMARY_KEYS: View[] = ['receipt', 'form', 'table', 'dashboard'];
  const primaryItems = PRIMARY_KEYS.map(k => NAV.find(n => n.key === k)!);
  const secondaryItems = NAV.filter(n => !PRIMARY_KEYS.includes(n.key));
  const secondaryActive = secondaryItems.some(n => n.key === currentView);

  const goTo = (view: View) => {
    setCurrentView(view);
    setMoreOpen(false);
  };

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <span className="logo" aria-hidden="true">💰</span>
          <span>Expense Tracker</span>
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
              {currentView === 'form' && <ExpenseForm onExpenseAdded={handleExpenseAdded} settings={settings} />}
              {currentView === 'receipt' && <ReceiptScan onExpenseAdded={handleExpenseAdded} settings={settings} />}
              {currentView === 'import' && <ExcelImport settings={settings} />}
              {currentView === 'table' && (
                <ExpenseTable
                  expenses={expenses}
                  onEdit={handleEdit}
                  onDelete={handleDelete}
                  onUpdate={handleUpdateExpense}
                />
              )}
              {currentView === 'dashboard' && <Dashboard expenses={expenses} />}
              {currentView === 'analytics' && <Analytics />}
              {currentView === 'budgets' && <Budgets expenses={expenses} />}
              {currentView === 'fx' && <Fx expenses={expenses} />}
              {currentView === 'settings' && <Settings settings={settings} onSaved={handleSettingsSaved} />}
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
          >
            <span className="nav-icon" aria-hidden="true">{item.icon}</span>
            <span className="bottom-nav-label">{item.label}</span>
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
        <div className="more-sheet-overlay" onClick={closeMore}>
          <div
            ref={moreSheetRef}
            className="more-sheet"
            onClick={e => e.stopPropagation()}
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
        onSave={handleUpdateExpense}
        onClose={handleCloseEditModal}
      />
    </div>
  );
}
