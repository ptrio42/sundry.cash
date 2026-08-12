/**
 * Tests for the App shell.
 *
 * Three things live here, all of them the shell's own: the navigation it offers,
 * the routes behind it, and the two facts about the instance that change what it
 * renders before anyone can log in — whether to disclose that the data is
 * fictional, and what a missing `/api/config` is allowed to take away.
 *
 * The API layer is mocked, so these drive the shell through the values a real
 * backend would send. Every screen the shell can mount is mounted for real,
 * which is why the mock has to answer for those screens' calls too.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, fireEvent, waitFor } from '@testing-library/react';
import App from '../components/App';
import { TEST_CATEGORIES } from './categories.fixture';
import { TEST_CURRENCIES } from './currencies.fixture';
import { currentMonthKey, monthLabel } from '../utils/format';
import {
  getAuthStatus,
  getInstanceConfig,
  getExpenses,
  getSettings,
  getCategories,
  getCurrencies,
  getFxRates,
  getBudgets,
  getInsightsSummary,
  createExpense,
  deleteExpense,
} from '../services/api';
import { AppSettings, InstanceConfig } from '../types/expense.types';

const TEST_SETTINGS: AppSettings = {
  defaultCurrency: 'PLN',
  defaultCategory: 'groceries',
  defaultBtcUnit: 'BTC',
  primaryCurrency: 'PLN',
};

// Every export the shell or the views it can mount might reach for. A factory
// mock replaces the whole module, so anything missing here would fail as an
// undefined export rather than as the behaviour under test.
vi.mock('../services/api', () => ({
  getAuthStatus: vi.fn(),
  getInstanceConfig: vi.fn(),
  getExpenses: vi.fn(),
  getSettings: vi.fn(),
  getCategories: vi.fn(),
  getCurrencies: vi.fn(),
  getFxRates: vi.fn(),
  getBudgets: vi.fn(),
  setBudget: vi.fn(),
  deleteBudget: vi.fn(),
  getToken: vi.fn(() => null),
  logout: vi.fn(),
  createExpense: vi.fn(),
  updateExpense: vi.fn(),
  deleteExpense: vi.fn(),
  deleteAllExpenses: vi.fn(),
  getInsightsSummary: vi.fn(),
  // The Add sheet's two panels. Only the tab that is selected is mounted, so
  // the scanning pair is never called from here — see AddSheet.test.tsx.
  scanReceipt: vi.fn(),
  createReceiptExpense: vi.fn(),
  // Home's five other calls, and the two the importer inside its Start card
  // makes. Nothing here has a ledger to report on, so they are never called —
  // but a missing export would fail as `undefined is not a function` the day one
  // of these cases does load expenses.
  getInsightsComparison: vi.fn(),
  getInsightsRecurring: vi.fn(),
  getInsightsMerchants: vi.fn(),
  getInsightsPatterns: vi.fn(),
  previewImport: vi.fn(),
  confirmImport: vi.fn(),
  exportExpensesXlsx: vi.fn(),
  fetchReceiptObjectUrl: vi.fn(),
  updateSettings: vi.fn(),
  createCategory: vi.fn(),
  updateCategory: vi.fn(),
  deleteCategory: vi.fn(),
  setCurrencyEnabled: vi.fn(),
}));

const mocked = (fn: unknown) => fn as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  mocked(getAuthStatus).mockResolvedValue({ authRequired: false });
  mocked(getExpenses).mockResolvedValue([]);
  mocked(getSettings).mockResolvedValue(TEST_SETTINGS);
  mocked(getCategories).mockResolvedValue(TEST_CATEGORIES);
  mocked(getCurrencies).mockResolvedValue(TEST_CURRENCIES);
  mocked(getFxRates).mockResolvedValue({ base: 'USD', rates: { USD: 1, PLN: 0.25, BTC: 65000 } });
  mocked(getInstanceConfig).mockResolvedValue({ demoMode: false, receiptsEnabled: true });
  mocked(getBudgets).mockResolvedValue([]);
  mocked(getInsightsSummary).mockResolvedValue({ scope: 'primary', currency: 'PLN', windowDays: 30, findings: [] });
  // The route is read from the URL, and jsdom keeps one window for the whole
  // file — so start every case on a URL that names nothing.
  window.history.replaceState(null, '', '/');
  // The Add sheet remembers which tab was used last, and jsdom keeps one
  // localStorage too. Cleared, every case opens on the desktop default (Type),
  // which is what these tests type into.
  localStorage.removeItem('sundry-add-method');
});

/** Render and wait for the shell — the nav appears once the config call settles. */
const renderApp = async (config?: Partial<InstanceConfig>) => {
  if (config) {
    mocked(getInstanceConfig).mockResolvedValue({ demoMode: false, receiptsEnabled: true, ...config });
  }
  render(<App />);
  await screen.findByRole('navigation', { name: 'Main' });
  // Screens only mount once the ledger has loaded.
  await waitFor(() => expect(screen.queryByText(/loading expenses/i)).not.toBeInTheDocument());
};

const sidebarNav = () => screen.getByRole('navigation', { name: 'Main' });
const mobileNav = () => screen.getByRole('navigation', { name: 'Primary' });
const title = () => screen.getByRole('heading', { level: 1 });
const statusLine = () => document.querySelector('.status-line');

/** The four destinations, in the order the sidebar lists them. */
const DESTINATIONS = ['Home', 'Expenses', 'Budgets', 'Settings'];

/**
 * Entries that left primary navigation in this wave, and the sheet that held
 * some of them. "Add Expense" is not on the list because the form's own submit
 * button still reads that — the nav entry going is covered by counting the nav.
 */
const GONE = ['Dashboard', 'Analytics', 'Insights', 'Currencies', 'Import Excel', 'Scan Receipt', 'All Expenses', 'More'];

const goTo = (label: string) => fireEvent.click(within(sidebarNav()).getByRole('button', { name: label }));

/** The persistent action, from the sidebar. Both navs offer it; either will do. */
const openSheet = () => fireEvent.click(screen.getAllByRole('button', { name: 'Add expense' })[0]);
const sheet = () => screen.queryByRole('dialog', { name: 'Add expense' });

/** One expense, saved through the sheet's "Type it" tab. */
const SAVED = {
  id: 7,
  amount: 24.9,
  date: '2026-08-11',
  description: 'Coffee',
  category: 'groceries',
  currency: 'PLN',
};

const typeAndSave = async () => {
  openSheet();
  await screen.findByRole('dialog', { name: 'Add expense' });
  fireEvent.change(screen.getByLabelText(/^amount$/i), { target: { value: '24.90' } });
  fireEvent.change(screen.getByLabelText(/^description$/i), { target: { value: 'Coffee' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add Expense' }));
  await waitFor(() => expect(sheet()).not.toBeInTheDocument());
};

describe('App — navigation', () => {
  it('offers four destinations and no more', async () => {
    await renderApp();

    expect(within(sidebarNav()).getAllByRole('button')).toHaveLength(4);
    for (const label of DESTINATIONS) {
      expect(within(sidebarNav()).getByRole('button', { name: label })).toBeInTheDocument();
    }
  });

  it('keeps Add expense out of the destinations and reachable from both navs', async () => {
    // It is an action, not a place: one per nav, neither of them inside the list.
    await renderApp();

    expect(within(sidebarNav()).queryByRole('button', { name: 'Add expense' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Add expense' })).toHaveLength(2);
  });

  it('no longer offers the entries that moved, nor the overflow sheet', async () => {
    await renderApp();

    for (const label of GONE) {
      expect(screen.queryByRole('button', { name: label })).not.toBeInTheDocument();
    }
    expect(screen.queryByRole('dialog', { name: 'More' })).not.toBeInTheDocument();
  });

  it('keeps the one irreversible action out of navigation', async () => {
    await renderApp();

    expect(within(sidebarNav()).queryByRole('button', { name: /wipe/i })).not.toBeInTheDocument();
    expect(within(mobileNav()).queryByRole('button', { name: /wipe/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /wipe/i })).not.toBeInTheDocument();
  });

  it('finds Wipe database in the Settings danger zone instead', async () => {
    await renderApp();
    goTo('Settings');

    const wipe = await screen.findByRole('button', { name: /wipe database/i });
    expect(wipe.closest('.danger-zone')).not.toBeNull();
  });

  it('titles every page with the word the nav used to get there', async () => {
    // Four of these used to disagree: Import Excel opened "Import from Excel",
    // Budgets opened "Monthly Budgets", Settings opened "Preferences" (F12).
    await renderApp();

    for (const label of DESTINATIONS) {
      goTo(label);
      expect(await screen.findByRole('heading', { level: 1, name: label })).toBeInTheDocument();
    }
  });

  it('does not repeat the page title as a card heading one line below it', async () => {
    await renderApp();

    goTo('Expenses');
    await screen.findByRole('heading', { level: 1, name: 'Expenses' });
    expect(screen.queryByRole('heading', { level: 2, name: /expenses/i })).not.toBeInTheDocument();

    goTo('Budgets');
    await screen.findByRole('heading', { level: 1, name: 'Budgets' });
    expect(screen.queryByRole('heading', { level: 2, name: /budgets/i })).not.toBeInTheDocument();
  });
});

describe('App — the status line', () => {
  it('replaces the tagline that pitched a budgeting app on every screen', async () => {
    await renderApp();
    expect(screen.queryByText(/track your spending, stay on budget/i)).not.toBeInTheDocument();
    expect(statusLine()).not.toBeNull();
  });

  it('says something different on each destination', async () => {
    // Four lines for four destinations. There used to be a fifth, for Add —
    // which is not a screen any more but a sheet over one, and the line under
    // the title goes on describing the screen you did not leave.
    await renderApp();

    const seen = new Set<string>();
    for (const label of DESTINATIONS) {
      goTo(label);
      await screen.findByRole('heading', { level: 1, name: label });
      seen.add(statusLine()?.textContent ?? '');
    }

    expect(seen.size).toBe(4);
  });

  /**
   * The status line used to name the month for Budgets. Wave 3 gave that screen
   * a stepper, so the shell stopped: a line reading "January 2026" above a
   * screen showing December is the contradiction F10 was about. The month is
   * stated once, by the control that can change it.
   */
  it('leaves the month to Budgets, which now carries the stepper', async () => {
    await renderApp();
    goTo('Budgets');

    await screen.findByRole('heading', { level: 1, name: 'Budgets' });
    expect(statusLine()).not.toHaveTextContent(monthLabel(currentMonthKey()));
    expect(await screen.findByText(monthLabel(currentMonthKey()))).toHaveClass('month-current');
  });
});

describe('App — the mobile bar', () => {
  it('holds five slots with the action raised in the middle', async () => {
    await renderApp();

    const slots = within(mobileNav()).getAllByRole('button');
    expect(slots).toHaveLength(5);
    expect(slots[2]).toBe(within(mobileNav()).getByRole('button', { name: 'Add expense' }));
    expect(slots[2]).toHaveClass('bottom-nav-add');
  });

  it('runs one accessible-name strategy across all five', async () => {
    // It used to run two: four tabs set `aria-label` to a longer name than the
    // one they rendered, and the fifth relied on its content (report R6). Every
    // button here now takes its name from what it contains.
    await renderApp();

    for (const slot of within(mobileNav()).getAllByRole('button')) {
      expect(slot).not.toHaveAttribute('aria-label');
    }
  });
});

describe('App — routing', () => {
  it('gives every destination its own URL', async () => {
    await renderApp();

    for (const label of DESTINATIONS) {
      goTo(label);
      await waitFor(() => expect(window.location.hash).toBe(`#/${label.toLowerCase()}`));
    }
  });

  it('renders the destination the URL names, so a reload comes back to it', async () => {
    window.history.replaceState(null, '', '#/budgets');
    await renderApp();

    expect(title()).toHaveTextContent('Budgets');
  });

  it('names the boot destination in the URL when the URL names nothing', async () => {
    // Home, as of wave 2 (change 2) — a product that tells you things must not
    // open on a blank form and ask you to work before it says anything. This is
    // the last line of that wave, not the first: the flip is worthless until
    // Home is worth opening.
    await renderApp();

    expect(window.location.hash).toBe('#/home');
    expect(title()).toHaveTextContent('Home');
  });

  it('falls back to the boot destination for a route that does not exist', async () => {
    window.history.replaceState(null, '', '#/analytics');
    await renderApp();

    expect(title()).toHaveTextContent('Home');
  });

  it('moves Back between destinations instead of leaving the app', async () => {
    await renderApp();

    goTo('Home');
    await waitFor(() => expect(window.location.hash).toBe('#/home'));
    goTo('Budgets');
    await waitFor(() => expect(window.location.hash).toBe('#/budgets'));

    window.history.back();

    await waitFor(() => expect(window.location.hash).toBe('#/home'));
    expect(title()).toHaveTextContent('Home');
  });
});

describe('App — demo banner', () => {
  it('says nothing about demo data on a normal instance', async () => {
    await renderApp();
    expect(screen.queryByText(/fictional sample data/i)).not.toBeInTheDocument();
  });

  it('discloses fictional data and nightly resets when demoMode is true', async () => {
    await renderApp({ demoMode: true });

    expect(screen.getByText('Demo')).toBeInTheDocument();
    expect(screen.getByText(/fictional sample data/i)).toBeInTheDocument();
    expect(screen.getByText(/wiped and re-seeded every night/i)).toBeInTheDocument();
  });

  it('links out to the product from the banner', async () => {
    await renderApp({ demoMode: true });

    const link = screen.getByRole('link', { name: /what sundry is/i });
    expect(link).toHaveAttribute('href', 'https://sundry.cash');
    // A new tab from an untrusted page needs both, or the opener is reachable.
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });
});

describe('App — when /api/config cannot be reached', () => {
  it('keeps every destination and shows no banner', async () => {
    // An older backend, or a proxy hiccup. Losing a destination on someone's own
    // install would be the worse failure; claiming their data is fake is worse still.
    mocked(getInstanceConfig).mockRejectedValue(new Error('HTTP error 404'));

    await renderApp();

    expect(within(sidebarNav()).getAllByRole('button')).toHaveLength(4);
    expect(screen.queryByText(/fictional sample data/i)).not.toBeInTheDocument();
    // The ledger still loads: the failed call is not allowed to abort the rest.
    expect(getExpenses).toHaveBeenCalled();
  });

  it('keeps receipt scanning, which a failed config call must not take away', async () => {
    // The flag has a consumer again since wave 3a — the Add sheet's Scan tab —
    // so the fail-open default matters: an unreachable `/api/config` on
    // someone's own install must not remove a way of recording an expense.
    mocked(getInstanceConfig).mockRejectedValue(new Error('HTTP error 404'));

    await renderApp();
    openSheet();

    expect(await screen.findByRole('tab', { name: /scan a receipt/i })).toBeInTheDocument();
  });

  it('drops the Scan tab on an instance that has scanning switched off', async () => {
    await renderApp({ receiptsEnabled: false });
    openSheet();

    await screen.findByRole('dialog', { name: 'Add expense' });
    expect(screen.queryByRole('tab', { name: /scan a receipt/i })).not.toBeInTheDocument();
  });
});

describe('App — the Add sheet', () => {
  it('opens over the destination you are on, which stays rendered underneath', async () => {
    // Change 10: recording is an input method, not a place. The screen you were
    // reading is still there when you close it, because you never left it.
    await renderApp();
    expect(screen.getByRole('button', { name: 'Add your first expense' })).toBeInTheDocument();

    openSheet();
    await screen.findByRole('dialog', { name: 'Add expense' });

    expect(title()).toHaveTextContent('Home');
    expect(screen.getByRole('button', { name: 'Add your first expense' })).toBeInTheDocument();
    await waitFor(() => expect(window.location.hash).toBe('#/home/add'));
  });

  it('opens over every one of them, not over one chosen for you', async () => {
    await renderApp();

    for (const label of DESTINATIONS) {
      goTo(label);
      await screen.findByRole('heading', { level: 1, name: label });

      openSheet();
      await screen.findByRole('dialog', { name: 'Add expense' });
      expect(title()).toHaveTextContent(label);
      await waitFor(() => expect(window.location.hash).toBe(`#/${label.toLowerCase()}/add`));

      fireEvent.click(screen.getByRole('button', { name: /close dialog/i }));
      await waitFor(() => expect(sheet()).not.toBeInTheDocument());
      // Closing pops a history entry, which lands a task later: wait for it, or
      // the next destination race the pop and lose.
      await waitFor(() => expect(window.location.hash).toBe(`#/${label.toLowerCase()}`));
    }
  });

  it('closes on save, leaves you where you were, and says what was saved', async () => {
    // F7: this used to `navigate('expenses')` and say nothing at all, so the
    // only evidence that a save had happened was that the app had moved you.
    mocked(createExpense).mockResolvedValue(SAVED);
    await renderApp();
    goTo('Budgets');
    await screen.findByRole('heading', { level: 1, name: 'Budgets' });

    await typeAndSave();

    expect(title()).toHaveTextContent('Budgets');
    await waitFor(() => expect(window.location.hash).toBe('#/budgets'));
    const line = screen.getByRole('status');
    expect(line).toHaveTextContent(/Added/);
    expect(line).toHaveTextContent('Groceries');
  });

  it('takes the row back when the confirmation is undone', async () => {
    mocked(createExpense).mockResolvedValue(SAVED);
    mocked(deleteExpense).mockResolvedValue(undefined);
    await renderApp();
    goTo('Budgets');
    await screen.findByRole('heading', { level: 1, name: 'Budgets' });
    await typeAndSave();

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));

    await waitFor(() => expect(deleteExpense).toHaveBeenCalledWith(7));
    await waitFor(() => expect(screen.getByRole('status')).toBeEmptyDOMElement());
  });

  it('opens the edit modal on the row the confirmation is about', async () => {
    mocked(createExpense).mockResolvedValue(SAVED);
    await renderApp();
    goTo('Budgets');
    await screen.findByRole('heading', { level: 1, name: 'Budgets' });
    await typeAndSave();

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));

    const modal = await screen.findByRole('dialog', { name: 'Edit Expense' });
    expect((within(modal).getByLabelText(/description/i) as HTMLInputElement).value).toBe('Coffee');
  });

  it('closes on Back rather than leaving the destination', async () => {
    await renderApp();
    goTo('Budgets');
    await waitFor(() => expect(window.location.hash).toBe('#/budgets'));

    openSheet();
    await screen.findByRole('dialog', { name: 'Add expense' });
    await waitFor(() => expect(window.location.hash).toBe('#/budgets/add'));

    window.history.back();

    await waitFor(() => expect(sheet()).not.toBeInTheDocument());
    expect(window.location.hash).toBe('#/budgets');
    expect(title()).toHaveTextContent('Budgets');
  });

  it('leaves nothing behind for Back to reopen once it is closed', async () => {
    // Closing pops the entry opening pushed. Without that, the gesture for
    // "back to what I was reading" would put the sheet up again.
    await renderApp();
    goTo('Budgets');
    await waitFor(() => expect(window.location.hash).toBe('#/budgets'));

    openSheet();
    await waitFor(() => expect(window.location.hash).toBe('#/budgets/add'));
    fireEvent.click(screen.getByRole('button', { name: /close dialog/i }));
    await waitFor(() => expect(window.location.hash).toBe('#/budgets'));

    window.history.back();

    await waitFor(() => expect(window.location.hash).toBe('#/home'));
    expect(sheet()).not.toBeInTheDocument();
    expect(title()).toHaveTextContent('Home');
  });

  it('renders the sheet for a URL that names it, without a Back press to pop', async () => {
    // A reload, or a shared link. Nothing of ours is behind this entry, so
    // closing rewrites the URL in place rather than popping out of the app.
    window.history.replaceState(null, '', '#/budgets/add');
    await renderApp();

    expect(await screen.findByRole('dialog', { name: 'Add expense' })).toBeInTheDocument();
    expect(title()).toHaveTextContent('Budgets');

    fireEvent.click(screen.getByRole('button', { name: /close dialog/i }));

    await waitFor(() => expect(sheet()).not.toBeInTheDocument());
    expect(window.location.hash).toBe('#/budgets');
  });
});
