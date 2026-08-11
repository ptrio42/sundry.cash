/**
 * Tests for the App shell's response to `GET /api/config`.
 *
 * Two facts about the instance change what the app renders before anyone can
 * log in: whether to disclose that the data is fictional, and whether receipt
 * scanning exists here at all. The API layer is mocked, so these drive the
 * shell through the config values a real backend would send.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import App from '../components/App';
import { TEST_CATEGORIES } from './categories.fixture';
import { TEST_CURRENCIES } from './currencies.fixture';
import {
  getAuthStatus,
  getInstanceConfig,
  getExpenses,
  getSettings,
  getCategories,
  getCurrencies,
  getFxRates,
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
  getToken: vi.fn(() => null),
  logout: vi.fn(),
  createExpense: vi.fn(),
  updateExpense: vi.fn(),
  deleteExpense: vi.fn(),
  deleteAllExpenses: vi.fn(),
  getInsightsSummary: vi.fn(),
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
});

/** Render and wait for the shell — the nav appears once the config call settles. */
const renderApp = async (config?: Partial<InstanceConfig>) => {
  if (config) {
    mocked(getInstanceConfig).mockResolvedValue({ demoMode: false, receiptsEnabled: true, ...config });
  }
  render(<App />);
  await screen.findByRole('navigation', { name: 'Main' });
};

/** Both navs label the tab with its full name, so a present tab matches twice. */
const receiptTabs = () => screen.queryAllByRole('button', { name: 'Scan Receipt' });

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

  it('does not take receipt scanning away just because it is a demo', async () => {
    // The flags are orthogonal by design; this asserts the UI keeps them so.
    await renderApp({ demoMode: true, receiptsEnabled: true });
    expect(receiptTabs().length).toBeGreaterThan(0);
  });
});

describe('App — receipt tab gating', () => {
  it('offers Scan Receipt when the instance has receipts enabled', async () => {
    await renderApp({ receiptsEnabled: true });
    expect(receiptTabs().length).toBeGreaterThan(0);
  });

  it('hides Scan Receipt when the instance has receipts disabled', async () => {
    await renderApp({ receiptsEnabled: false });

    expect(receiptTabs()).toHaveLength(0);
    // Only that tab goes; the rest of the app is untouched. (Counted rather than
    // fetched singly: the sidebar and the mobile bottom bar both render a tab,
    // and both are in the DOM at once — CSS decides which one you see.)
    expect(screen.getAllByRole('button', { name: 'Add Expense' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: 'Dashboard' }).length).toBeGreaterThan(0);
  });
});

describe('App — when /api/config cannot be reached', () => {
  it('keeps every feature and shows no banner', async () => {
    // An older backend, or a proxy hiccup. Hiding a working tab on someone's own
    // install would be the worse failure; claiming their data is fake is worse still.
    mocked(getInstanceConfig).mockRejectedValue(new Error('HTTP error 404'));

    render(<App />);
    await screen.findByRole('navigation', { name: 'Main' });

    expect(receiptTabs().length).toBeGreaterThan(0);
    expect(screen.queryByText(/fictional sample data/i)).not.toBeInTheDocument();
    // The ledger still loads: the failed call is not allowed to abort the rest.
    expect(getExpenses).toHaveBeenCalled();
  });
});
