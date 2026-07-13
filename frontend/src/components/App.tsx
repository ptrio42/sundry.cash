/**
 * Main App Component
 * Manages application state and navigation between views
 */

import { useState, useEffect } from 'react';
import ExpenseForm from './ExpenseForm';
import ExpenseTable from './ExpenseTable';
import Dashboard from './Dashboard';
import ExcelImport from './ExcelImport';
import Analytics from './Analytics';
import EditExpenseModal from './EditExpenseModal';
import Login from './Login';
import { getExpenses, deleteExpense, updateExpense, deleteAllExpenses, getAuthStatus, getToken, logout } from '../services/api';
import { Expense } from '../types/expense.types';
import '../App.css';

type View = 'form' | 'table' | 'dashboard' | 'import' | 'analytics';

export default function App() {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>('');
  const [currentView, setCurrentView] = useState<View>('form');
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  const [authChecked, setAuthChecked] = useState<boolean>(false);
  const [authRequired, setAuthRequired] = useState<boolean>(false);
  const [authed, setAuthed] = useState<boolean>(false);

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
      const data = await getExpenses();
      setExpenses(data);
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

  if (!authChecked) {
    return <div className="loading fullscreen-loading">Loading…</div>;
  }

  if (authRequired && !authed) {
    return <Login onSuccess={() => setAuthed(true)} />;
  }

  return (
    <div className="app">
      {/* Header */}
      <header className="app-header">
        <h1>💰 Expense Tracker</h1>
        <p className="tagline">Track your spending, stay on budget</p>
      </header>

      {/* Navigation */}
      <nav className="app-nav">
        <button
          className={currentView === 'form' ? 'active' : ''}
          onClick={() => setCurrentView('form')}
        >
          ➕ Add Expense
        </button>
        <button
          className={currentView === 'import' ? 'active' : ''}
          onClick={() => setCurrentView('import')}
        >
          📥 Import Excel
        </button>
        <button
          className={currentView === 'table' ? 'active' : ''}
          onClick={() => setCurrentView('table')}
        >
          📋 All Expenses
        </button>
        <button
          className={currentView === 'dashboard' ? 'active' : ''}
          onClick={() => setCurrentView('dashboard')}
        >
          📊 Dashboard
        </button>
        <button
          className={currentView === 'analytics' ? 'active' : ''}
          onClick={() => setCurrentView('analytics')}
        >
          📈 Analytics
        </button>
        <button
          className="danger-button"
          onClick={handleDeleteAll}
          title="Delete all expenses from database"
        >
          🗑️ Wipe Database
        </button>
        {authRequired && (
          <button
            className="logout-button"
            onClick={handleLogout}
            title="Sign out"
          >
            🔓 Logout
          </button>
        )}
      </nav>

      {/* Main Content */}
      <main className="app-main">
        {error && (
          <div className="error-banner">
            {error}
            <button onClick={loadExpenses}>Retry</button>
          </div>
        )}

        {loading ? (
          <div className="loading">Loading expenses...</div>
        ) : (
          <>
            {currentView === 'form' && (
              <ExpenseForm onExpenseAdded={handleExpenseAdded} />
            )}

            {currentView === 'import' && (
              <ExcelImport />
            )}

            {currentView === 'table' && (
              <ExpenseTable
                expenses={expenses}
                onEdit={handleEdit}
                onDelete={handleDelete}
                onUpdate={handleUpdateExpense}
              />
            )}

            {currentView === 'dashboard' && (
              <Dashboard expenses={expenses} />
            )}

            {currentView === 'analytics' && (
              <Analytics />
            )}
          </>
        )}
      </main>

      {/* Footer */}
      <footer className="app-footer">
        <p>Expense Tracker · Built with React + TypeScript + Express</p>
      </footer>

      {/* Edit Expense Modal */}
      <EditExpenseModal
        expense={editingExpense}
        onSave={handleUpdateExpense}
        onClose={handleCloseEditModal}
      />
    </div>
  );
}
