/**
 * Tests for the Dashboard component.
 *
 * The charts are untestable in jsdom (no layout), but the currency handling
 * around them is the part that can silently go wrong: the dashboard either
 * shows one native currency, or converts every expense into the primary
 * currency through the user's FX rates. Which of those it starts on depends on
 * how many currencies the data actually spans. The summary tiles are the
 * visible output of that choice, so they are what these tests pin down.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import Dashboard from '../components/Dashboard';
import { TEST_CATEGORIES } from './categories.fixture';
import { TEST_CURRENCIES } from './currencies.fixture';
import { AppSettings, Expense, FxRates } from '../types/expense.types';

// The dashboard renders the insights strip above everything else, and that
// strip fetches on mount. It has its own suite; stubbing it here keeps these
// tests about the charts and free of network doubles.
//
// The stub renders a marker and records its props rather than returning null:
// a stub that renders nothing makes the whole suite pass even if the strip is
// deleted from Dashboard entirely, so the one thing these tests could check —
// that the two are wired together at all — would go unchecked.
const { insightsProps } = vi.hoisted(() => ({ insightsProps: vi.fn() }));
vi.mock('../components/InsightsStrip', () => ({
  default: (props: Record<string, unknown>) => {
    insightsProps(props);
    return <div data-testid="insights-strip" />;
  }
}));

// Value of one unit in USD: 1 PLN = 0.25 USD (so 1 USD = 4 PLN), 1 BTC = 65000 USD.
const rates: FxRates = { USD: 1, PLN: 0.25, BTC: 65000 };

const settings = (primaryCurrency: AppSettings['primaryCurrency']): AppSettings => ({
  defaultCurrency: 'USD',
  defaultCategory: 'groceries',
  defaultBtcUnit: 'BTC',
  primaryCurrency,
});

const expense = (e: Partial<Expense> & Pick<Expense, 'id' | 'amount'>): Expense => ({
  date: '2026-07-10',
  description: 'x',
  category: 'groceries',
  currency: 'USD',
  ...e,
});

// One currency only. Total 200.00, 3 expenses, average 66.666… , largest 120.
const usdOnly: Expense[] = [
  expense({ id: 1, amount: 120, category: 'groceries' }),
  expense({ id: 2, amount: 50, category: 'transport', date: '2026-07-11' }),
  expense({ id: 3, amount: 30, category: 'media', date: '2026-07-12' }),
];

// Three currencies. Converted into PLN: 25 USD -> 100, 400 PLN -> 400,
// 0.002 BTC -> 0.002 * 65000 / 0.25 = 520. Total 1020 over 3 expenses.
const mixed: Expense[] = [
  expense({ id: 1, amount: 25, currency: 'USD', category: 'groceries' }),
  expense({ id: 2, amount: 400, currency: 'PLN', category: 'transport', date: '2026-07-11' }),
  expense({ id: 3, amount: 0.002, currency: 'BTC', category: 'media', date: '2026-07-12' }),
];

/** The `.summary-card` whose heading is `heading`. */
const card = (heading: string): HTMLElement => {
  const el = screen.getByText(heading).closest('.summary-card');
  if (!el) throw new Error(`no summary card titled "${heading}"`);
  return el as HTMLElement;
};

describe('Dashboard', () => {
  it('computes the summary tiles from a single-currency fixture', () => {
    // Primary is PLN, but the data is USD-only, so nothing should be converted.
    render(<Dashboard expenses={usdOnly} categories={TEST_CATEGORIES} currencies={TEST_CURRENCIES} settings={settings('PLN')} rates={rates} />);

    expect(card('Total Spent')).toHaveTextContent('$200.00'); // 120 + 50 + 30
    expect(card('Expenses')).toHaveTextContent('3');
    expect(card('Average')).toHaveTextContent('$66.67'); // 200 / 3
    expect(card('Largest')).toHaveTextContent('$120.00');
  });

  it('starts on the sole native currency when the data spans only one', () => {
    render(<Dashboard expenses={usdOnly} categories={TEST_CATEGORIES} currencies={TEST_CURRENCIES} settings={settings('PLN')} rates={rates} />);

    expect(screen.getByRole('button', { name: /^USD/ })).toHaveClass('active');
    expect(screen.getByRole('button', { name: /^All/ })).not.toHaveClass('active');
    // The combined view's caveat belongs to the converted view only.
    expect(screen.queryByText(/converted from all currencies/i)).not.toBeInTheDocument();
    // 200 USD would be 800 PLN if it had been converted to the primary currency.
    expect(card('Total Spent')).not.toHaveTextContent('800');
  });

  it('starts on the combined view and converts everything into the primary currency', () => {
    render(<Dashboard expenses={mixed} categories={TEST_CATEGORIES} currencies={TEST_CURRENCIES} settings={settings('PLN')} rates={rates} />);

    expect(screen.getByRole('button', { name: /^All → PLN/ })).toHaveClass('active');
    expect(screen.getByText(/converted from all currencies/i)).toBeInTheDocument();

    // 100 + 400 + 520 = 1020 PLN, not the meaningless raw sum of 425.002.
    expect(card('Total Spent')).toHaveTextContent(/1\s*020,00\s*zł/);
    expect(card('Expenses')).toHaveTextContent('3');
    expect(card('Average')).toHaveTextContent(/340,00\s*zł/); // 1020 / 3
    // The BTC row is the smallest raw number but the largest once converted.
    expect(card('Largest')).toHaveTextContent(/520,00\s*zł/);
  });

  it('converts into USD instead when USD is the primary currency', () => {
    render(<Dashboard expenses={mixed} categories={TEST_CATEGORIES} currencies={TEST_CURRENCIES} settings={settings('USD')} rates={rates} />);

    // 25 + (400 * 0.25) + (0.002 * 65000) = 25 + 100 + 130 = 255 USD.
    expect(screen.getByRole('button', { name: /^All → USD/ })).toHaveClass('active');
    expect(card('Total Spent')).toHaveTextContent('$255.00');
    expect(card('Largest')).toHaveTextContent('$130.00');
  });

  it('narrows to a single native currency and back again', () => {
    render(<Dashboard expenses={mixed} categories={TEST_CATEGORIES} currencies={TEST_CURRENCIES} settings={settings('PLN')} rates={rates} />);

    fireEvent.click(screen.getByRole('button', { name: /^USD/ }));

    // Only the one USD expense survives, and it is shown unconverted.
    expect(card('Expenses')).toHaveTextContent('1');
    expect(card('Total Spent')).toHaveTextContent('$25.00');
    expect(card('Largest')).toHaveTextContent('$25.00');
    expect(card('Total Spent')).not.toHaveTextContent('zł');
    expect(screen.queryByText(/converted from all currencies/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^All → PLN/ }));
    expect(card('Total Spent')).toHaveTextContent(/1\s*020,00\s*zł/);
    expect(card('Expenses')).toHaveTextContent('3');
  });

  it('shows a native BTC view in BTC units', () => {
    render(<Dashboard expenses={mixed} categories={TEST_CATEGORIES} currencies={TEST_CURRENCIES} settings={settings('PLN')} rates={rates} />);

    fireEvent.click(screen.getByRole('button', { name: /^BTC/ }));

    expect(card('Total Spent')).toHaveTextContent('₿0.002');
    expect(card('Expenses')).toHaveTextContent('1');
    expect(card('Largest')).toHaveTextContent('₿0.002');
  });

  it('only offers currencies the data actually contains', () => {
    render(<Dashboard expenses={usdOnly} categories={TEST_CATEGORIES} currencies={TEST_CURRENCIES} settings={settings('PLN')} rates={rates} />);

    // USD is present, so it is offered alongside the combined view. PLN and BTC
    // are not in the data and would lead to a guaranteed-empty dashboard, so
    // they are not offered at all.
    expect(screen.getByRole('button', { name: /^USD/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^PLN/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^BTC/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^USD/ }));
    expect(card('Total Spent')).toHaveTextContent('$200.00');
  });

  it('defaults to the sole native currency once the data arrives', () => {
    // The default is applied in an effect, not a lazy useState initializer:
    // App fetches expenses after mount, so on the first render there is no data
    // to inspect and a single-currency user would otherwise be stuck on the
    // combined view converting USD to PLN.
    render(<Dashboard expenses={usdOnly} categories={TEST_CATEGORIES} currencies={TEST_CURRENCIES} settings={settings('PLN')} rates={rates} />);

    expect(screen.getByRole('button', { name: /^USD/ })).toHaveClass('active');
    expect(card('Total Spent')).toHaveTextContent('$200.00');
  });

  it('labels the donut with its own legend, one entry per category present', () => {
    // The legend is plain markup rather than recharts' <Legend> precisely so it
    // can wrap: recharts sizes that box up front, so on a 375px phone the
    // categories overflowed it and pushed the page sideways.
    const { container } = render(<Dashboard expenses={usdOnly} categories={TEST_CATEGORIES} currencies={TEST_CURRENCIES} settings={settings('PLN')} rates={rates} />);

    const entries = [...container.querySelectorAll('.chart-legend li')].map(li => li.textContent);
    expect(entries).toEqual(['Groceries', 'Transport', 'Media']); // largest first
    expect(container.querySelectorAll('.chart-legend-swatch')).toHaveLength(3);
  });

  it('renders the combined empty state when there are no expenses at all', () => {
    render(<Dashboard expenses={[]} categories={TEST_CATEGORIES} currencies={TEST_CURRENCIES} settings={settings('PLN')} rates={rates} />);

    expect(screen.getByText('No expenses yet. Add some to see your dashboard.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^All → PLN/ })).toHaveClass('active');
    expect(screen.queryByText('Expenses')).not.toBeInTheDocument();
    expect(screen.queryByText(/Daily Spend/)).not.toBeInTheDocument();
  });
});

/**
 * The strip's own behaviour is covered by InsightsStrip.test.tsx. What only the
 * dashboard can prove is that the two are connected: that the strip is mounted,
 * that it sits above the charts, and that it is handed the same currency scope
 * the tiles below it are using — otherwise the sentences would describe one
 * currency while the numbers described another.
 */
describe('Dashboard wires up the insights strip', () => {
  beforeEach(() => insightsProps.mockClear());

  const lastProps = () => insightsProps.mock.calls[insightsProps.mock.calls.length - 1][0];

  it('mounts the strip ahead of everything else on the page', () => {
    const { container } = render(<Dashboard expenses={mixed} categories={TEST_CATEGORIES} currencies={TEST_CURRENCIES} settings={settings('PLN')} rates={rates} />);

    const strip = screen.getByTestId('insights-strip');
    const head = container.querySelector('.dashboard-head');

    expect(strip).toBeInTheDocument();
    expect(head).not.toBeNull();
    // DOCUMENT_POSITION_FOLLOWING: the head comes after the strip.
    expect(strip.compareDocumentPosition(head as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('hands over the ledger and the combined currency scope', () => {
    render(<Dashboard expenses={mixed} categories={TEST_CATEGORIES} currencies={TEST_CURRENCIES} settings={settings('PLN')} rates={rates} />);

    // `view` is the whole scope: the strip asks the backend for the merge and
    // gets its currency back in the payload, so it needs no rates of its own.
    expect(lastProps()).toMatchObject({ view: 'primary' });
    // The same array, so the strip can tell a new ledger from a re-render.
    expect(lastProps().expenses).toBe(mixed);
  });

  it('passes the sole native currency when the dashboard defaults to one', () => {
    render(<Dashboard expenses={usdOnly} categories={TEST_CATEGORIES} currencies={TEST_CURRENCIES} settings={settings('PLN')} rates={rates} />);

    // The tiles show unconverted USD here, so the strip must be told 'USD' too.
    expect(lastProps()).toMatchObject({ view: 'USD' });
  });

  it('re-scopes the strip when the currency buttons are used', () => {
    render(<Dashboard expenses={mixed} categories={TEST_CATEGORIES} currencies={TEST_CURRENCIES} settings={settings('PLN')} rates={rates} />);
    expect(lastProps().view).toBe('primary');

    fireEvent.click(screen.getByRole('button', { name: /^USD/ }));
    expect(lastProps().view).toBe('USD');

    fireEvent.click(screen.getByRole('button', { name: /^All → PLN/ }));
    expect(lastProps().view).toBe('primary');
  });
});

describe('Dashboard with categories that are not in the list', () => {
  // An expense can legitimately carry a slug the loaded list does not have: the
  // category fetch is non-fatal (App falls back to the built-ins), and another
  // device can delete a custom category while this tab still holds its rows.
  const orphanLedger = [
    expense({ id: 1, amount: 120, category: 'groceries' }),
    expense({ id: 2, amount: 80, category: 'pet-food', date: '2026-07-11' }),
  ];

  it('counts an unknown category in the total and shows it in the legend', () => {
    const { container } = render(<Dashboard expenses={orphanLedger} categories={TEST_CATEGORIES} currencies={TEST_CURRENCIES} settings={settings('USD')} rates={rates} />);

    expect(card('Total Spent')).toHaveTextContent('$200.00');
    const entries = [...container.querySelectorAll('.chart-legend li')].map(li => li.textContent);
    expect(entries).toEqual(['Groceries', 'Pet food']);
  });

  it('hands the trend chart a series for the unknown category too', () => {
    // The chart itself cannot be asserted in jsdom (no layout, so recharts
    // renders nothing inside ResponsiveContainer). The rule it depends on is
    // `stackedCategorySeries`, unit-tested in categories.util.test.ts; what is
    // checked here is that the unknown slug reaches the dashboard at all.
    render(<Dashboard expenses={orphanLedger} categories={TEST_CATEGORIES} currencies={TEST_CURRENCIES} settings={settings('USD')} rates={rates} />);

    expect(card('Expenses')).toHaveTextContent('2');
    expect(card('Largest')).toHaveTextContent('$120.00');
  });
});
