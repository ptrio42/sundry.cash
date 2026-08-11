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
    await renderApp();

    const seen = new Set<string>();
    for (const label of DESTINATIONS) {
      goTo(label);
      await screen.findByRole('heading', { level: 1, name: label });
      seen.add(statusLine()?.textContent ?? '');
    }
    // Plus the Add action, which is not one of the destinations.
    fireEvent.click(screen.getAllByRole('button', { name: 'Add expense' })[0]);
    await screen.findByRole('heading', { level: 1, name: 'Add expense' });
    seen.add(statusLine()?.textContent ?? '');

    expect(seen.size).toBe(5);
  });

  it('states the window a screen actually has — the month, on Budgets', async () => {
    await renderApp();
    goTo('Budgets');

    await screen.findByRole('heading', { level: 1, name: 'Budgets' });
    expect(statusLine()).toHaveTextContent(monthLabel(currentMonthKey()));
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

  it('offers no receipt scanning either way, until the Add sheet exists', async () => {
    // `receiptsEnabled` has no consumer between this wave and wave 3: scanning is
    // not reachable from anywhere, so there is nothing for the flag to gate. Wave
    // 3 puts Scan back behind the Add sheet and this expectation inverts.
    await renderApp({ receiptsEnabled: true });

    expect(screen.queryByRole('button', { name: /scan receipt/i })).not.toBeInTheDocument();
  });
});
