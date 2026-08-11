/**
 * Tests for the Fx ("Currency Conversion") component. The API layer is mocked.
 *
 * The behaviour that matters here is that money is never added across
 * currencies: each currency keeps an exact native subtotal, and the combined
 * figures are converted through the user's rates into whichever base is
 * selected. Editing a rate must reach the API and the new set must be reported
 * back up to App, which owns the rates.
 *
 * The pure conversion helper is covered by fx.test.ts — this file is about what
 * the component renders and what an interaction does.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import Fx from '../components/Fx';
import { TEST_CURRENCIES } from './currencies.fixture';
import { setFxRate } from '../services/api';
import { AppSettings, Expense, FxRates } from '../types/expense.types';

vi.mock('../services/api', () => ({ setFxRate: vi.fn() }));

const mockSetFxRate = setFxRate as unknown as ReturnType<typeof vi.fn>;

// 1 PLN = 0.25 USD (so 1 USD = 4 PLN); 1 BTC = 65 000 USD.
const rates: FxRates = { USD: 1, PLN: 0.25, BTC: 65000 };

// Only `primaryCurrency` matters here — it is what the base defaults to.
const settings = (primaryCurrency: AppSettings['primaryCurrency']): AppSettings => ({
  defaultCurrency: 'USD',
  defaultCategory: 'groceries',
  defaultBtcUnit: 'BTC',
  primaryCurrency,
});

const expense = (id: number, amount: number, currency: Expense['currency']): Expense => ({
  id,
  amount,
  currency,
  date: '2026-07-01',
  description: `expense ${id}`,
  category: 'groceries',
});

// USD 25 | PLN 300 + 100 = 400 | BTC 0.001
// -> in USD: 25 + 100 + 65 = 190 ; in PLN: 100 + 400 + 260 = 760
const expenses: Expense[] = [
  expense(1, 25, 'USD'),
  expense(2, 300, 'PLN'),
  expense(3, 100, 'PLN'),
  expense(4, 0.001, 'BTC'),
];

/** The "By currency" row whose first cell is `cur`. */
const currencyRow = (cur: string): HTMLElement => {
  const row = screen.getAllByRole('row').find(r => r.querySelector('td')?.textContent === cur);
  if (!row) throw new Error(`no "By currency" row for ${cur}`);
  return row;
};

const rateInput = (cur: string): HTMLInputElement =>
  screen.getByLabelText(`USD value of 1 ${cur}`) as HTMLInputElement;

beforeEach(() => vi.clearAllMocks());

describe('Fx', () => {
  it('renders the current rates, with USD pinned to 1 and not editable', () => {
    render(<Fx expenses={expenses} settings={settings('USD')} currencies={TEST_CURRENCIES} rates={rates} onRatesChanged={vi.fn()} />);

    expect(rateInput('USD').value).toBe('1');
    expect(rateInput('USD')).toBeDisabled();
    expect(rateInput('PLN').value).toBe('0.25');
    expect(rateInput('BTC').value).toBe('65000');
  });

  it('shows both the exact native total and the converted total for each currency', () => {
    render(<Fx expenses={expenses} settings={settings('USD')} currencies={TEST_CURRENCIES} rates={rates} onRatesChanged={vi.fn()} />);

    // PLN: two expenses, 400 zł natively, worth $100 at 1 PLN = $0.25.
    const pln = within(currencyRow('PLN'));
    expect(pln.getByText('2')).toBeInTheDocument();
    expect(pln.getByText(/400,00\s*zł/)).toBeInTheDocument();
    expect(pln.getByText('$100.00')).toBeInTheDocument();

    // BTC keeps its fractional native amount rather than being rounded to cents.
    const btc = within(currencyRow('BTC'));
    expect(btc.getByText('₿0.001')).toBeInTheDocument();
    expect(btc.getByText('$65.00')).toBeInTheDocument();

    // And the headline is the sum of the converted values, not of raw amounts.
    expect(screen.getByText('Total spend in USD')).toBeInTheDocument();
    expect(screen.getByText('$190.00')).toBeInTheDocument();
    expect(screen.queryByText(/425\.00/)).not.toBeInTheDocument();
  });

  it('opens on the primary currency from settings rather than on USD', () => {
    render(<Fx expenses={expenses} settings={settings('PLN')} currencies={TEST_CURRENCIES} rates={rates} onRatesChanged={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Base: PLN' }).className).toMatch(/\bactive\b/);
    expect(screen.getByText('Total spend in PLN')).toBeInTheDocument();
    expect(screen.getByText(/760,00\s*zł/)).toBeInTheDocument();
    // The rates themselves stay anchored to USD whatever the base is.
    expect(rateInput('USD').value).toBe('1');
    expect(rateInput('USD')).toBeDisabled();
    expect(rateInput('PLN').value).toBe('0.25');
  });

  it('re-scopes every figure when the base currency changes', () => {
    render(<Fx expenses={expenses} settings={settings('USD')} currencies={TEST_CURRENCIES} rates={rates} onRatesChanged={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Base: PLN' }));

    expect(screen.getByText('Total spend in PLN')).toBeInTheDocument();
    expect(screen.getByText(/760,00\s*zł/)).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'In PLN' })).toBeInTheDocument();

    // $25 becomes 100 zł; the PLN row is now identical in both columns.
    expect(within(currencyRow('USD')).getByText(/100,00\s*zł/)).toBeInTheDocument();
    expect(within(currencyRow('BTC')).getByText(/260,00\s*zł/)).toBeInTheDocument();
  });

  it('saves an edited rate on blur and adopts the rates the API returns', async () => {
    const updated: FxRates = { USD: 1, PLN: 0.3, BTC: 65000 };
    mockSetFxRate.mockResolvedValue({ rates: updated });
    const onRatesChanged = vi.fn();

    const { rerender } = render(<Fx expenses={expenses} settings={settings('USD')} currencies={TEST_CURRENCIES} rates={rates} onRatesChanged={onRatesChanged} />);

    fireEvent.change(rateInput('PLN'), { target: { value: '0.3' } });
    fireEvent.blur(rateInput('PLN'));

    await waitFor(() => expect(mockSetFxRate).toHaveBeenCalledWith('PLN', 0.3));
    await waitFor(() => expect(onRatesChanged).toHaveBeenCalledWith(updated));

    // App owns the rates, so the saved value comes back down as a prop; the
    // local draft must not shadow it.
    rerender(<Fx expenses={expenses} settings={settings('USD')} currencies={TEST_CURRENCIES} rates={updated} onRatesChanged={onRatesChanged} />);
    expect(rateInput('PLN').value).toBe('0.3');
    // 400 zł * 0.3 = $120, so the combined total moves to 25 + 120 + 65.
    expect(screen.getByText('$210.00')).toBeInTheDocument();
  });

  it('rejects a non-positive rate without calling the API', async () => {
    render(<Fx expenses={expenses} settings={settings('USD')} currencies={TEST_CURRENCIES} rates={rates} onRatesChanged={vi.fn()} />);

    fireEvent.change(rateInput('PLN'), { target: { value: '0' } });
    fireEvent.blur(rateInput('PLN'));

    expect(await screen.findByText(/rate must be a positive number/i)).toBeInTheDocument();
    expect(mockSetFxRate).not.toHaveBeenCalled();
  });

  it('surfaces an API failure instead of silently dropping the edit', async () => {
    mockSetFxRate.mockRejectedValue(new Error('Rate service unavailable'));
    const onRatesChanged = vi.fn();
    render(<Fx expenses={expenses} settings={settings('USD')} currencies={TEST_CURRENCIES} rates={rates} onRatesChanged={onRatesChanged} />);

    fireEvent.change(rateInput('BTC'), { target: { value: '70000' } });
    fireEvent.blur(rateInput('BTC'));

    expect(await screen.findByText('Rate service unavailable')).toBeInTheDocument();
    expect(onRatesChanged).not.toHaveBeenCalled();
    // The user's unsaved input stays put so it can be retried.
    expect(rateInput('BTC').value).toBe('70000');
  });

  it('says so when there is nothing to convert', () => {
    render(<Fx expenses={[]} settings={settings('USD')} currencies={TEST_CURRENCIES} rates={rates} onRatesChanged={vi.fn()} />);

    expect(screen.getByText(/no expenses yet/i)).toBeInTheDocument();
    expect(screen.getByText('$0.00')).toBeInTheDocument();
  });
});
