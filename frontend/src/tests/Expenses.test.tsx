/**
 * Tests for the Expenses screen — the ledger with Analytics folded into it.
 *
 * Three things are being pinned down here, and all three are the point of
 * change 4 in `docs/ux-review-findings.md`:
 *
 *   1. **One state.** The filter bar has to move the table, the summary row and
 *      both charts together. Analytics fetched its aggregates from the API while
 *      the table filtered the same rows in the browser, so the two could
 *      describe different sets — and did, since the search box has no server
 *      equivalent at all.
 *   2. **It arrives answering.** Every row is on screen before anything is
 *      configured, no category is pre-selected, and the summary covers the whole
 *      ledger (F8).
 *   3. **The Analytics assertions that still describe behaviour this screen
 *      has** — converting a mixed set instead of adding raw major units, keeping
 *      the exact per-currency subtotals, and counting the days of a window —
 *      moved here rather than vanishing with the component.
 *
 * The API layer is mocked: the screen reaches it for the Excel export, the
 * importer, and the authenticated receipt fetch inside the table.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import Expenses from '../components/Expenses';
import { TEST_CATEGORIES } from './categories.fixture';
import { TEST_CURRENCIES } from './currencies.fixture';
import { exportExpensesXlsx } from '../services/api';
import { AppSettings, Expense, FxRates } from '../types/expense.types';

vi.mock('../services/api', () => ({
  exportExpensesXlsx: vi.fn(),
  fetchReceiptObjectUrl: vi.fn(),
  previewImport: vi.fn(),
  confirmImport: vi.fn(),
}));

// 1 PLN = 0.25 USD, i.e. 1 USD = 4 PLN.
const rates: FxRates = { USD: 1, PLN: 0.25, BTC: 65000 };

const settings = (primaryCurrency: AppSettings['primaryCurrency'] = 'PLN'): AppSettings => ({
  defaultCurrency: 'PLN',
  defaultCategory: 'groceries',
  defaultBtcUnit: 'BTC',
  primaryCurrency,
});

/** `YYYY-MM-DD` in local time, the same calendar the component reads. */
const iso = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

const daysAgo = (days: number): string => {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return iso(date);
};

const TODAY = iso(new Date());

/**
 * A ledger spanning two currencies and more than a year, so every preset has
 * something on each side of it.
 *
 * Totals in PLN: 400 + 60 + 30 native, plus 25 USD which is 100 PLN — 590 over
 * everything, and 500 over the last 30 days.
 */
const LEDGER: Expense[] = [
  { id: 1, date: TODAY, description: 'Corner shop', category: 'groceries', currency: 'USD', amount: 25 },
  { id: 2, date: daysAgo(5), description: 'Weekly shop', category: 'groceries', currency: 'PLN', amount: 400 },
  { id: 3, date: daysAgo(100), description: 'Train fare', category: 'transport', currency: 'PLN', amount: 60 },
  { id: 4, date: daysAgo(400), description: 'Netflix', category: 'media', currency: 'PLN', amount: 30 },
];

const renderScreen = (expenses: Expense[] = LEDGER, primary: string = 'PLN') =>
  render(
    <Expenses
      expenses={expenses}
      settings={settings(primary)}
      categories={TEST_CATEGORIES}
      currencies={TEST_CURRENCIES}
      rates={rates}
      onEdit={vi.fn()}
      onDelete={vi.fn()}
      onUpdate={vi.fn().mockResolvedValue(undefined)}
      onExpensesStale={vi.fn()}
    />
  );

/** The `.summary-card` whose heading is `heading`. */
const card = (heading: string): HTMLElement => {
  const el = screen.getByRole('heading', { level: 3, name: heading }).closest('.summary-card');
  if (!el) throw new Error(`no summary card titled "${heading}"`);
  return el as HTMLElement;
};

/** Descriptions of the rows currently in the table body, top to bottom. */
const rowDescriptions = (container: HTMLElement): string[] =>
  Array.from(container.querySelectorAll('tbody tr')).map(tr => tr.children[2].textContent?.trim() ?? '');

/** Category names in the breakdown, biggest first. */
const barNames = (container: HTMLElement): string[] =>
  Array.from(container.querySelectorAll('.category-breakdown .category-name')).map(
    el => el.textContent?.trim() ?? ''
  );

const windowLine = (container: HTMLElement): string =>
  container.querySelector('.ledger-window')?.textContent?.trim() ?? '';

beforeEach(() => vi.clearAllMocks());

describe('Expenses — arriving', () => {
  it('shows every row, with nothing selected and nothing to configure', () => {
    const { container } = renderScreen();

    expect(rowDescriptions(container)).toHaveLength(LEDGER.length);
    // The founding complaint reproduced verbatim was eleven category checkboxes
    // ticked on arrival. None of these chips is pressed.
    for (const category of TEST_CATEGORIES) {
      expect(screen.getByRole('button', { name: category.label })).toHaveAttribute('aria-pressed', 'false');
    }
    expect(screen.getByRole('button', { name: 'All time' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('summarises the whole ledger, not a default window of it', () => {
    const { container } = renderScreen();

    // 400 + 60 + 30 PLN, plus 25 USD converted at 4 PLN = 590.
    expect(card('Total')).toHaveTextContent(/590,00\s*zł/);
    expect(card('Expenses')).toHaveTextContent('4');
    // The window came from the data, and it says which dates that was.
    expect(windowLine(container)).toContain('All time');
    expect(windowLine(container)).toMatch(/401 days/);
  });

  it('states the window it measured, and the day count it divided by', () => {
    const { container } = renderScreen();

    fireEvent.click(screen.getByRole('button', { name: 'Last 30 days' }));

    expect(windowLine(container)).toContain('Last 30 days');
    expect(windowLine(container)).toMatch(/\b30 days\b/);
    expect(card('Per day')).toHaveTextContent('over 30 days');
  });

  it('has no filter wall: the first number is above the fold, not below eleven checkboxes', () => {
    const { container } = renderScreen();

    // The summary row precedes the table, and no checkbox filter exists at all.
    expect(container.querySelector('.summary-cards')).toBeInTheDocument();
    expect(container.querySelectorAll('.filters input[type="checkbox"]')).toHaveLength(0);
  });
});

describe('Expenses — one filter bar, one state', () => {
  it('moves the table, the summary and both charts together', () => {
    const { container } = renderScreen();

    fireEvent.click(screen.getByRole('button', { name: 'Transport' }));

    expect(rowDescriptions(container)).toEqual(['Train fare']);
    expect(card('Expenses')).toHaveTextContent('1');
    expect(card('Total')).toHaveTextContent(/60,00\s*zł/);
    expect(barNames(container)).toEqual(['Transport']);
    expect(container.querySelector('.category-breakdown .chart-note')).toHaveTextContent('1 category');
  });

  it('narrows down from everything as categories are added, never up from nothing', () => {
    const { container } = renderScreen();

    fireEvent.click(screen.getByRole('button', { name: 'Transport' }));
    expect(rowDescriptions(container)).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'Media' }));
    expect(rowDescriptions(container)).toEqual(['Train fare', 'Netflix']);

    // Deselecting the last one goes back to the whole ledger rather than to an
    // empty screen: an empty selection is every category.
    fireEvent.click(screen.getByRole('button', { name: 'Transport' }));
    fireEvent.click(screen.getByRole('button', { name: 'Media' }));
    expect(rowDescriptions(container)).toHaveLength(LEDGER.length);
  });

  it('searches description, category and amount — which no server filter can do', () => {
    const { container } = renderScreen();
    const search = screen.getByLabelText('Search:');

    fireEvent.change(search, { target: { value: 'netflix' } });
    expect(rowDescriptions(container)).toEqual(['Netflix']);
    expect(card('Expenses')).toHaveTextContent('1');

    fireEvent.change(search, { target: { value: 'groceries' } });
    expect(rowDescriptions(container)).toEqual(['Corner shop', 'Weekly shop']);

    fireEvent.change(search, { target: { value: '60' } });
    expect(rowDescriptions(container)).toEqual(['Train fare']);
  });

  it('restores the whole ledger through Clear', () => {
    const { container } = renderScreen();

    fireEvent.click(screen.getByRole('button', { name: 'Transport' }));
    fireEvent.change(screen.getByLabelText('Search:'), { target: { value: 'nothing' } });
    expect(rowDescriptions(container)).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));

    expect(rowDescriptions(container)).toHaveLength(LEDGER.length);
    expect(screen.getByRole('button', { name: 'Clear' })).toBeDisabled();
  });

  it('draws no chart over an empty selection', () => {
    const { container } = renderScreen();

    fireEvent.change(screen.getByLabelText('Search:'), { target: { value: 'no such thing' } });

    expect(screen.getByText(/no expenses found/i)).toBeInTheDocument();
    expect(container.querySelector('.ledger-charts')).not.toBeInTheDocument();
  });
});

describe('Expenses — currencies', () => {
  it('converts a mixed set instead of adding raw major units, and keeps the exact subtotals', () => {
    renderScreen();

    // 490 PLN + (25 USD * 4) = 590 PLN. The old code produced a bare 515 and
    // labelled it "$" regardless of the underlying currencies.
    expect(card('Total')).toHaveTextContent(/590,00\s*zł/);
    expect(card('Total')).toHaveTextContent(/converted to PLN/i);
    expect(screen.queryByText(/515/)).not.toBeInTheDocument();

    const natives = within(card('Total')).getAllByRole('listitem').map(li => li.textContent ?? '');
    expect(natives[0]).toMatch(/490,00\s*zł/);
    expect(natives[1]).toMatch(/\$25\.00/);
  });

  it('converts into USD when that is the primary currency', () => {
    renderScreen(LEDGER, 'USD');

    // 490 PLN * 0.25 = 122.50 USD, plus 25 USD = 147.50.
    expect(card('Total')).toHaveTextContent('$147.50');
    expect(card('Total')).toHaveTextContent(/converted to USD/i);
  });

  it('scopes to one currency, and says nothing about conversion when it did none', () => {
    const { container } = renderScreen();

    fireEvent.click(screen.getByRole('button', { name: 'PLN (zł)' }));

    expect(rowDescriptions(container)).toEqual(['Weekly shop', 'Train fare', 'Netflix']);
    expect(card('Total')).toHaveTextContent(/490,00\s*zł/);
    expect(card('Total')).not.toHaveTextContent(/converted/i);
    expect(within(card('Total')).queryAllByRole('listitem')).toHaveLength(0);
  });

  it('keeps the exact figure visible when the whole selection had to be converted', () => {
    // One foreign currency is the case where the headline number is entirely an
    // estimate at the user's own rates, so the native subtotal is worth most.
    renderScreen();

    // Filtered down to the one USD row while the scope is still "All → PLN",
    // so the total is 25 USD expressed at 4 PLN.
    fireEvent.change(screen.getByLabelText('Search:'), { target: { value: 'Corner shop' } });

    expect(card('Total')).toHaveTextContent(/100,00\s*zł/);
    expect(card('Total')).toHaveTextContent(/converted to PLN/i);
    expect(within(card('Total')).getAllByRole('listitem')[0]).toHaveTextContent(/\$25\.00/);
  });

  it('offers only currencies the ledger actually holds', () => {
    renderScreen();

    expect(screen.getByRole('button', { name: 'PLN (zł)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'USD ($)' })).toBeInTheDocument();
    // Enabled in the catalogue, never spent — a button that could only ever
    // produce a blank screen (F9).
    expect(screen.queryByRole('button', { name: /^BTC/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^EUR/ })).not.toBeInTheDocument();
  });

  it('keeps the control on screen when the ledger loses the currency it is scoped to', () => {
    // A bulk delete, or an import that reloads the ledger, can empty the
    // currency you are standing in. Hiding the control then would leave an empty
    // table over a filter bar giving no reason for it.
    const { rerender } = renderScreen();
    fireEvent.click(screen.getByRole('button', { name: 'USD ($)' }));

    rerender(
      <Expenses
        expenses={LEDGER.filter(expense => expense.currency !== 'USD')}
        settings={settings()}
        categories={TEST_CATEGORIES}
        currencies={TEST_CURRENCIES}
        rates={rates}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onUpdate={vi.fn().mockResolvedValue(undefined)}
        onExpensesStale={vi.fn()}
      />
    );

    expect(screen.getByText(/no expenses found/i)).toBeInTheDocument();
    // Still pressed, still there to be unpressed.
    expect(screen.getByRole('button', { name: 'USD ($)' })).toHaveClass('active');
    fireEvent.click(screen.getByRole('button', { name: /^All →/ }));
    expect(screen.queryByText(/no expenses found/i)).not.toBeInTheDocument();
  });

  it('offers no currency control at all when the ledger holds one currency', () => {
    renderScreen(LEDGER.filter(expense => expense.currency === 'PLN'));

    expect(screen.queryByRole('button', { name: /^PLN/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^All →/ })).not.toBeInTheDocument();
    expect(card('Total')).toHaveTextContent(/490,00\s*zł/);
  });

  it('collapses the rows of one category in two currencies into a single bar', () => {
    const { container } = renderScreen();

    fireEvent.click(screen.getByRole('button', { name: 'Groceries' }));

    // 400 PLN and 25 USD are one category, so one bar holding the converted
    // total — and the whole 100% of the selection.
    const bars = container.querySelectorAll('.category-breakdown .category-bar-item');
    expect(bars).toHaveLength(1);
    expect(bars[0]).toHaveTextContent(/500,00\s*zł\s*\(100\.0%\)/);
    expect(bars[0]).toHaveTextContent('2 expenses');
  });
});

describe('Expenses — date ranges', () => {
  it('means thirty days by "Last 30 days"', () => {
    const { container } = renderScreen();

    fireEvent.click(screen.getByRole('button', { name: 'Last 30 days' }));

    // Both ends inclusive, so the window starts 29 days back and the count is 30
    // — not the 31 the old `setMonth(now.getMonth() - 1)` produced under a label
    // that said 30 (F2).
    expect(windowLine(container)).toContain('Last 30 days');
    expect(card('Per day')).toHaveTextContent('over 30 days');
    expect(rowDescriptions(container)).toEqual(['Corner shop', 'Weekly shop']);
    expect(card('Total')).toHaveTextContent(/500,00\s*zł/);
  });

  it('measures "This month" over the part of it that has happened', () => {
    const { container } = renderScreen();
    const dayOfMonth = new Date().getDate();

    fireEvent.click(screen.getByRole('button', { name: 'This month' }));

    // The defect wave 2 shipped and had to fix: a calendar month divided by 31
    // on the 11th understates the daily rate by two thirds.
    expect(card('Per day')).toHaveTextContent(
      `over ${dayOfMonth} ${dayOfMonth === 1 ? 'day' : 'days'}`
    );
    expect(windowLine(container)).toContain('This month');
  });

  it('counts a single-day custom range as one day, not none', () => {
    const { container } = renderScreen();

    fireEvent.click(screen.getByRole('button', { name: 'Custom' }));
    fireEvent.change(screen.getByLabelText('From:'), { target: { value: TODAY } });
    fireEvent.change(screen.getByLabelText('To:'), { target: { value: TODAY } });

    // Zero days made "per day" divide by nothing and print 0 for a range that
    // plainly held something.
    expect(card('Per day')).toHaveTextContent('over 1 day');
    expect(rowDescriptions(container)).toEqual(['Corner shop']);
    // 25 USD converted at 4 PLN, over one day.
    expect(card('Per day')).toHaveTextContent(/100,00\s*zł/);
  });

  it('reaches a whole past calendar month through Custom', () => {
    const now = new Date();
    const first = iso(new Date(now.getFullYear(), now.getMonth() - 1, 1));
    const last = iso(new Date(now.getFullYear(), now.getMonth(), 0));
    const { container } = renderScreen([
      { id: 20, date: first, description: 'First of last month', category: 'other', currency: 'PLN', amount: 10 },
      { id: 21, date: last, description: 'Last of last month', category: 'other', currency: 'PLN', amount: 10 },
      { id: 22, date: TODAY, description: 'Today', category: 'other', currency: 'PLN', amount: 10 },
    ]);

    fireEvent.click(screen.getByRole('button', { name: 'Custom' }));
    fireEvent.change(screen.getByLabelText('From:'), { target: { value: first } });
    fireEvent.change(screen.getByLabelText('To:'), { target: { value: last } });

    // Both ends of the month, and nothing from this one leaks in.
    expect(rowDescriptions(container)).toEqual(['Last of last month', 'First of last month']);
    expect(card('Per day')).toHaveTextContent(`over ${new Date(now.getFullYear(), now.getMonth(), 0).getDate()} days`);
  });

  it('slices the chart by day over a month and by month over a year', () => {
    const { container } = renderScreen();

    fireEvent.click(screen.getByRole('button', { name: 'Last 30 days' }));
    expect(container.querySelector('.chart-box .chart-note')).toHaveTextContent('by day');

    fireEvent.click(screen.getByRole('button', { name: 'Last 12 months' }));
    expect(container.querySelector('.chart-box .chart-note')).toHaveTextContent('by month');
  });
});

describe('Expenses — the toolbar', () => {
  it('puts Import and Export at the same level, in the same row', () => {
    const { container } = renderScreen();
    const toolbar = container.querySelector('.ledger-toolbar') as HTMLElement;

    expect(within(toolbar).getByRole('button', { name: 'Import' })).toBeInTheDocument();
    expect(within(toolbar).getByRole('button', { name: /^Export/ })).toBeInTheDocument();
  });

  it('opens the importer in place rather than sending you to a destination', () => {
    renderScreen();

    expect(screen.queryByLabelText(/Select Excel File/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));
    expect(screen.getByLabelText(/Select Excel File/)).toBeInTheDocument();
  });

  /**
   * Capture the blobs the CSV export hands to the browser, and put the real
   * functions back afterwards — the receipt viewer in the table below uses the
   * same two object-URL calls.
   *
   * The anchor click is stubbed as well: jsdom implements no navigation, so a
   * real one logs a "Not implemented" stack for every export under test.
   */
  const captureDownloads = (): { blobs: Blob[]; restore: () => void } => {
    const original = {
      create: URL.createObjectURL,
      revoke: URL.revokeObjectURL,
      click: HTMLAnchorElement.prototype.click
    };
    const blobs: Blob[] = [];
    URL.createObjectURL = vi.fn((blob: Blob) => { blobs.push(blob); return 'blob:csv'; }) as typeof URL.createObjectURL;
    URL.revokeObjectURL = vi.fn();
    HTMLAnchorElement.prototype.click = vi.fn();
    return {
      blobs,
      restore: () => {
        URL.createObjectURL = original.create;
        URL.revokeObjectURL = original.revoke;
        HTMLAnchorElement.prototype.click = original.click;
      }
    };
  };

  /** jsdom's Blob has no `text()`, so read it the way a browser used to. */
  const readBlob = (blob: Blob): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(blob);
    });

  it('offers CSV and Excel behind one Export control, and still exports both', () => {
    const downloads = captureDownloads();
    try {
      renderScreen();

      expect(screen.queryByRole('button', { name: 'CSV' })).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: /^Export/ }));

      fireEvent.click(screen.getByRole('button', { name: 'CSV' }));
      expect(downloads.blobs).toHaveLength(1);
      // The menu closes behind the action it performed.
      expect(screen.queryByRole('button', { name: 'CSV' })).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: /^Export/ }));
      fireEvent.click(screen.getByRole('button', { name: 'Excel' }));
      expect(exportExpensesXlsx).toHaveBeenCalled();
      // The list closes under the focused button, so focus has to be handed
      // back — otherwise a keyboard user resumes from the top of the document.
      expect(screen.getByRole('button', { name: /^Export/ })).toHaveFocus();
    } finally {
      downloads.restore();
    }
  });

  it('closes on Escape and returns focus to the control that opened it', () => {
    renderScreen();

    fireEvent.click(screen.getByRole('button', { name: /^Export/ }));
    expect(screen.getByRole('button', { name: 'CSV' })).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByRole('button', { name: 'CSV' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Export/ })).toHaveFocus();
  });

  it('exports what the filter left standing, not the whole ledger', async () => {
    const downloads = captureDownloads();
    try {
      renderScreen();
      fireEvent.click(screen.getByRole('button', { name: 'Transport' }));
      fireEvent.click(screen.getByRole('button', { name: /^Export/ }));
      fireEvent.click(screen.getByRole('button', { name: 'CSV' }));

      const csv = await readBlob(downloads.blobs[0]);
      expect(csv).toContain('Train fare');
      expect(csv).not.toContain('Weekly shop');
    } finally {
      downloads.restore();
    }
  });
});

/**
 * The "who added it" filter (docs/who-label-spec.md).
 *
 * Client-side, through the same `LedgerQuery` everything else on this screen is
 * driven by — nothing about this asks the server, exactly as with the search box
 * and the category chips.
 */
describe('Expenses — filtering by who added it', () => {
  const HOUSEHOLD: Expense[] = [
    { ...LEDGER[0], who: 'Ania' },
    { ...LEDGER[1], who: 'Alex' },
    { ...LEDGER[2], who: 'ania' },
    { ...LEDGER[3], who: null },
  ];

  const whoGroup = () => screen.queryByRole('group', { name: 'Who:' });

  /** Either spelling: the chip carries whichever the ledger uses most. */
  const ANIA = /^ania$/i;

  it('offers nothing while one person has added everything', () => {
    // Same rule as the currency scope: a control with one option is a control
    // that cannot change the answer.
    renderScreen(LEDGER.map(row => ({ ...row, who: 'Ania' })));

    expect(whoGroup()).not.toBeInTheDocument();
  });

  it('offers nothing on a ledger nobody has labelled', () => {
    renderScreen();
    expect(whoGroup()).not.toBeInTheDocument();
  });

  it('offers each person once the ledger names more than one', () => {
    renderScreen(HOUSEHOLD);

    const group = whoGroup() as HTMLElement;
    // 'Ania' and 'ania' are one person, so there are two chips and not three.
    // Which of the two spellings the chip carries is the majority's, and this
    // fixture has one of each — `ledgerPeople` owns that rule and pins it.
    expect(within(group).getAllByRole('button')).toHaveLength(2);
    expect(within(group).getByRole('button', { name: ANIA })).toHaveAttribute('aria-pressed', 'false');
  });

  it('narrows the table, the summary and the charts together', () => {
    const { container } = renderScreen(HOUSEHOLD);

    fireEvent.click(within(whoGroup() as HTMLElement).getByRole('button', { name: ANIA }));

    // Both spellings of one person, and nobody else.
    expect(rowDescriptions(container)).toEqual(['Corner shop', 'Train fare']);
    expect(card('Expenses')).toHaveTextContent('2');
    expect(barNames(container)).toEqual(['Groceries', 'Transport']);
  });

  it('leaves the rows nobody labelled out of a named selection', () => {
    const { container } = renderScreen(HOUSEHOLD);

    fireEvent.click(within(whoGroup() as HTMLElement).getByRole('button', { name: 'Alex' }));
    expect(rowDescriptions(container)).toEqual(['Weekly shop']);
  });

  it('keeps the chip on screen and clears with everything else', () => {
    const { container } = renderScreen(HOUSEHOLD);

    const clear = screen.getByRole('button', { name: 'Clear' });
    expect(clear).toBeDisabled();

    fireEvent.click(within(whoGroup() as HTMLElement).getByRole('button', { name: ANIA }));
    expect(clear).toBeEnabled();

    fireEvent.click(clear);
    expect(rowDescriptions(container)).toHaveLength(HOUSEHOLD.length);
    expect(within(whoGroup() as HTMLElement).getByRole('button', { name: ANIA }))
      .toHaveAttribute('aria-pressed', 'false');
  });

  it('draws the ledger column from the whole ledger, so filtering cannot remove it', () => {
    const { container } = renderScreen(HOUSEHOLD);
    expect(screen.getByRole('columnheader', { name: 'Who' })).toBeInTheDocument();

    fireEvent.click(within(whoGroup() as HTMLElement).getByRole('button', { name: 'Alex' }));

    expect(screen.getByRole('columnheader', { name: 'Who' })).toBeInTheDocument();
    expect(container.querySelector('.who-cell')).toHaveTextContent('Alex');
  });
});
