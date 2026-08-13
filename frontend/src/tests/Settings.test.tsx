/**
 * Tests for the Settings component. The API layer is mocked.
 *
 * Three halves, since wave 4: the preference form, the category manager that
 * arrived when categories stopped being a hardcoded enum, and the currency
 * manager — which now carries the rate editor that used to be its own screen
 * (change 13). The cases at the bottom of this file came from `Fx.test.tsx`,
 * which is deleted; what did not come with them is everything that screen said
 * about *money*, because Expenses says it against the reader's own filters.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import Settings from '../components/Settings';
import {
  updateSettings,
  getCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  getCurrencies,
  setCurrencyEnabled,
  setFxRate,
} from '../services/api';
import { setWho } from '../utils/who';
import { AppSettings, Category, CurrencyInfo, Expense, FxRates } from '../types/expense.types';
import { TEST_CATEGORIES } from './categories.fixture';
import { TEST_CURRENCIES } from './currencies.fixture';

vi.mock('../services/api', () => ({
  updateSettings: vi.fn(),
  getCategories: vi.fn(),
  createCategory: vi.fn(),
  updateCategory: vi.fn(),
  deleteCategory: vi.fn(),
  getCurrencies: vi.fn(),
  setCurrencyEnabled: vi.fn(),
  setFxRate: vi.fn(),
}));

const mock = (fn: unknown) => fn as unknown as ReturnType<typeof vi.fn>;

const settings: AppSettings = { defaultCurrency: 'USD', defaultCategory: 'groceries', defaultBtcUnit: 'BTC', primaryCurrency: 'USD' };

const CUSTOM: Category = { slug: 'pet-food', label: 'Pet food', color: '#f472b6', sortOrder: 7, isBuiltin: false };

// 1 PLN = 0.25 USD (so 1 USD = 4 PLN); 1 BTC = 65 000 USD. Carried over from
// the deleted Fx suite.
const RATES: FxRates = { USD: 1, PLN: 0.25, BTC: 65000 };

const expense = (id: number, currency: Expense['currency']): Expense => ({
  id,
  amount: 10,
  currency,
  date: '2026-07-01',
  description: `expense ${id}`,
  category: 'groceries',
});

interface Overrides {
  categories?: Category[];
  currencies?: CurrencyInfo[];
  /** Defaults to an empty ledger, so the ~20 cases predating wave 4 are unmoved. */
  expenses?: Expense[];
  rates?: FxRates;
  /** The names the ledger holds — what "This device is…" offers as buttons. */
  people?: string[];
  theme?: 'dark' | 'light';
  authRequired?: boolean;
  onCategoriesChanged?: ReturnType<typeof vi.fn>;
  onCurrenciesChanged?: ReturnType<typeof vi.fn>;
  onRatesChanged?: ReturnType<typeof vi.fn>;
  onExpensesStale?: ReturnType<typeof vi.fn>;
}

const renderSettings = ({
  categories = TEST_CATEGORIES,
  currencies = TEST_CURRENCIES,
  expenses = [],
  rates = RATES,
  people = [],
  theme = 'dark',
  authRequired = false,
  onCategoriesChanged = vi.fn(),
  onCurrenciesChanged = vi.fn(),
  onRatesChanged = vi.fn(),
  onExpensesStale = vi.fn(),
}: Overrides = {}) => {
  const onSaved = vi.fn();
  const onToggleTheme = vi.fn();
  const onLogout = vi.fn();
  const onWipeDatabase = vi.fn();
  const props = {
    settings,
    categories,
    currencies,
    expenses,
    rates,
    people,
    theme,
    authRequired,
    onSaved,
    onCurrenciesChanged,
    onRatesChanged,
    onCategoriesChanged,
    onExpensesStale,
    onToggleTheme,
    onLogout,
    onWipeDatabase,
  };
  const view = render(<Settings {...props} />);
  return {
    ...view,
    props,
    onSaved,
    onCategoriesChanged,
    onCurrenciesChanged,
    onRatesChanged,
    onExpensesStale,
    onToggleTheme,
    onLogout,
    onWipeDatabase,
  };
};

/** The enable/disable checkbox for `code`. */
const currencyCheckbox = (code: string) => screen.getByRole('checkbox', { name: new RegExp(`^${code}`) });

/** The rate field for `code` — same accessible name the Fx screen used. */
const rateInput = (code: string): HTMLInputElement =>
  screen.getByLabelText(`USD value of 1 ${code}`) as HTMLInputElement;

/** The whole row for `code`: checkbox, symbol, decimals and rate. */
const currencyRow = (code: string): HTMLElement => {
  const row = currencyCheckbox(code).closest('.currency-manager-row');
  if (!row) throw new Error(`no currency row for "${code}"`);
  return row as HTMLElement;
};

/** The name field of the category currently labelled `label`. */
const nameField = (label: string): HTMLInputElement =>
  screen.getByRole('textbox', { name: `Name for ${label}` }) as HTMLInputElement;

/** The `.category-manager-row` for the category currently labelled `label`. */
const categoryRow = (label: string): HTMLElement => {
  const row = nameField(label).closest('.category-manager-row');
  if (!row) throw new Error(`no category row for "${label}"`);
  return row as HTMLElement;
};

beforeEach(() => {
  vi.clearAllMocks();
  mock(getCategories).mockResolvedValue(TEST_CATEGORIES);
  mock(getCurrencies).mockResolvedValue(TEST_CURRENCIES);
});

describe('Settings preferences', () => {
  it('renders the preference controls pre-filled from props', () => {
    renderSettings();
    expect((screen.getByLabelText(/default currency/i) as HTMLSelectElement).value).toBe('USD');
    expect((screen.getByLabelText(/default category/i) as HTMLSelectElement).value).toBe('groceries');
    expect((screen.getByLabelText(/default bitcoin unit/i) as HTMLSelectElement).value).toBe('BTC');
  });

  it('offers every category from props as a default, by label', () => {
    renderSettings({ categories: [...TEST_CATEGORIES, CUSTOM] });
    const select = screen.getByLabelText(/default category/i) as HTMLSelectElement;
    expect(Array.from(select.options).map(o => o.value)).toContain('pet-food');
    expect(Array.from(select.options).map(o => o.textContent)).toContain('Pet food');
  });

  it('keeps Save disabled until a value changes, then saves and reports back', async () => {
    const updatedSettings: AppSettings = { defaultCurrency: 'PLN', defaultCategory: 'groceries', defaultBtcUnit: 'BTC', primaryCurrency: 'USD' };
    mock(updateSettings).mockResolvedValue(updatedSettings);
    const { onSaved } = renderSettings();

    const saveBtn = screen.getByRole('button', { name: /save preferences/i });
    expect(saveBtn).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/default currency/i), { target: { value: 'PLN' } });
    expect(saveBtn).not.toBeDisabled();

    fireEvent.click(saveBtn);
    await waitFor(() =>
      expect(updateSettings).toHaveBeenCalledWith({ defaultCurrency: 'PLN', defaultCategory: 'groceries', defaultBtcUnit: 'BTC', primaryCurrency: 'USD' })
    );
    expect(onSaved).toHaveBeenCalledWith(updatedSettings);
  });
});

describe('Settings category manager', () => {
  it('lists every category and marks the built-ins as undeletable', () => {
    renderSettings({ categories: [...TEST_CATEGORIES, CUSTOM] });

    expect(within(categoryRow('Groceries')).getByText('built-in')).toBeInTheDocument();
    expect(within(categoryRow('Groceries')).queryByRole('button', { name: /delete/i })).not.toBeInTheDocument();
    expect(within(categoryRow('Pet food')).getByRole('button', { name: /delete/i })).toBeInTheDocument();
  });

  it('derives the slug from the label when adding a category', async () => {
    mock(createCategory).mockResolvedValue(CUSTOM);
    mock(getCategories).mockResolvedValue([...TEST_CATEGORIES, CUSTOM]);
    const { onCategoriesChanged } = renderSettings();

    fireEvent.change(screen.getByLabelText(/add a category/i), { target: { value: 'Pet food' } });
    // The slug is shown before saving, because it is the part that is permanent.
    expect(screen.getByText('pet-food')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^add$/i }));

    await waitFor(() =>
      expect(createCategory).toHaveBeenCalledWith({ slug: 'pet-food', label: 'Pet food', color: '#38bdf8' })
    );
    await waitFor(() => expect(onCategoriesChanged).toHaveBeenCalledWith([...TEST_CATEGORIES, CUSTOM]));
  });

  it('renames a category on blur, leaving its slug alone', async () => {
    mock(updateCategory).mockResolvedValue({ ...TEST_CATEGORIES[2], label: 'Subscriptions' });
    renderSettings();

    const field = nameField('Media');
    fireEvent.change(field, { target: { value: 'Subscriptions' } });
    fireEvent.blur(field);

    await waitFor(() => expect(updateCategory).toHaveBeenCalledWith('media', { label: 'Subscriptions' }));
  });

  it('does not call the API when a rename does not change anything', () => {
    renderSettings();
    fireEvent.blur(nameField('Media'));
    expect(updateCategory).not.toHaveBeenCalled();
  });

  it('says so and restores the name when the field is cleared', () => {
    // The field is uncontrolled, so a silent early return would leave the row
    // looking nameless with nothing explaining why.
    renderSettings();

    const field = nameField('Media');
    fireEvent.change(field, { target: { value: '   ' } });
    fireEvent.blur(field);

    expect(updateCategory).not.toHaveBeenCalled();
    expect(field.value).toBe('Media');
    expect(screen.getByText('"Media" needs a name')).toBeInTheDocument();
  });

  it('asks where the rows should go before deleting, then reports the ledger stale', async () => {
    mock(deleteCategory).mockResolvedValue(undefined);
    const { onExpensesStale } = renderSettings({ categories: [...TEST_CATEGORIES, CUSTOM] });

    fireEvent.click(within(categoryRow('Pet food')).getByRole('button', { name: /delete/i }));

    // Nothing is deleted until the target is confirmed.
    expect(deleteCategory).not.toHaveBeenCalled();
    const target = screen.getByLabelText(/move expenses to/i) as HTMLSelectElement;
    expect(target.value).toBe('other');
    // Cannot reassign a category to itself.
    expect(Array.from(target.options).map(o => o.value)).not.toContain('pet-food');

    fireEvent.change(target, { target: { value: 'groceries' } });
    fireEvent.click(screen.getByRole('button', { name: /delete category/i }));

    await waitFor(() => expect(deleteCategory).toHaveBeenCalledWith('pet-food', 'groceries'));
    await waitFor(() => expect(onExpensesStale).toHaveBeenCalled());
  });

  it('surfaces a rejected category change instead of failing silently', async () => {
    mock(updateCategory).mockRejectedValue(new Error('Label must be at most 40 characters'));
    renderSettings();

    const field = nameField('Media');
    fireEvent.change(field, { target: { value: 'A far too long label' } });
    fireEvent.blur(field);

    expect(await screen.findByText('Label must be at most 40 characters')).toBeInTheDocument();
  });
});

describe('Settings currency manager', () => {
  it('lists only the enabled currencies until asked for the rest', () => {
    renderSettings();

    expect(currencyCheckbox('USD')).toBeChecked();
    expect(screen.queryByRole('checkbox', { name: /^EUR/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /show all 5 currencies/i }));

    expect(currencyCheckbox('EUR')).not.toBeChecked();
  });

  it('shows the decimal places, which is the part that cannot be changed later', () => {
    renderSettings();
    fireEvent.click(screen.getByRole('button', { name: /show all/i }));

    const jpyRow = currencyCheckbox('JPY').closest('.currency-manager-row') as HTMLElement;
    expect(within(jpyRow).getByText('0 decimal places')).toBeInTheDocument();

    const usdRow = currencyCheckbox('USD').closest('.currency-manager-row') as HTMLElement;
    expect(within(usdRow).getByText('2 decimal places')).toBeInTheDocument();
  });

  it('enables a currency and reports the fresh catalogue back', async () => {
    const enabled = TEST_CURRENCIES.map(c => (c.code === 'EUR' ? { ...c, enabled: true } : c));
    mock(setCurrencyEnabled).mockResolvedValue({ code: 'EUR', enabled: true });
    mock(getCurrencies).mockResolvedValue(enabled);
    const { onCurrenciesChanged } = renderSettings();

    fireEvent.click(screen.getByRole('button', { name: /show all/i }));
    fireEvent.click(currencyCheckbox('EUR'));

    await waitFor(() => expect(setCurrencyEnabled).toHaveBeenCalledWith('EUR', true));
    await waitFor(() => expect(onCurrenciesChanged).toHaveBeenCalledWith(enabled));
  });

  it('offers only enabled currencies as a default, not the whole catalogue', () => {
    renderSettings();

    const codes = Array.from((screen.getByLabelText(/default currency/i) as HTMLSelectElement).options).map(o => o.value);
    expect(codes).toEqual(['BTC', 'PLN', 'USD']);
    expect(codes).not.toContain('EUR');
  });

  it('surfaces the backend refusal instead of silently doing nothing', async () => {
    mock(setCurrencyEnabled).mockRejectedValue(new Error('USD is still your default currency — change that first'));
    renderSettings();

    fireEvent.click(currencyCheckbox('USD'));

    expect(await screen.findByText(/still your default currency/i)).toBeInTheDocument();
  });
});

/**
 * The rate editor, folded in from the deleted `Fx` screen (F12, change 13).
 *
 * The claim change 13 makes is that one row answers the whole question about a
 * currency — whether it is on, what it looks like, how precise it is, and what
 * it is worth — so the first case here is the one that would fail if the merge
 * were only a relocation.
 */
describe('Settings currency manager — rates', () => {
  it('carries all four facts about a currency on one row', () => {
    renderSettings();

    const row = within(currencyRow('PLN'));
    expect(row.getByText('zł')).toBeInTheDocument();
    expect(row.getByText('2 decimal places')).toBeInTheDocument();
    expect(row.getByLabelText('USD value of 1 PLN')).toHaveValue(0.25);
  });

  it('renders the current rates, with USD pinned to 1 and not editable', () => {
    renderSettings();

    expect(rateInput('USD').value).toBe('1');
    expect(rateInput('USD')).toBeDisabled();
    expect(rateInput('PLN').value).toBe('0.25');
    expect(rateInput('BTC').value).toBe('65000');
  });

  it('anchors the rates to USD whatever the primary currency is', () => {
    // The one assertion worth keeping from the deleted screen's base picker:
    // "Base: PLN" moved the *display*, never the stored rate.
    renderSettings({ rates: RATES });

    expect(rateInput('PLN').value).toBe('0.25');
    expect(rateInput('USD').value).toBe('1');
    expect(screen.getByText(/value of one unit/i)).toBeInTheDocument();
  });

  it('keeps a rate row for a currency that is switched off but still in the ledger', () => {
    // The `relevantCurrencies` contract. Disabling a currency stops it being
    // offered for new expenses; the history it already holds still converts, so
    // hiding its rate would make old expenses unconvertible.
    const withDisabledEur = TEST_CURRENCIES.map(c => (c.code === 'EUR' ? { ...c, enabled: false } : c));
    renderSettings({ currencies: withDisabledEur, expenses: [expense(1, 'EUR')] });

    expect(currencyCheckbox('EUR')).not.toBeChecked();
    expect(rateInput('EUR')).toBeInTheDocument();
  });

  it('offers no rate field for a currency the rate API would refuse', () => {
    // PUT /api/fx takes only enabled-or-used currencies, so a catalogue row
    // nobody has touched gets a checkbox and nothing else.
    renderSettings();
    fireEvent.click(screen.getByRole('button', { name: /show all 5 currencies/i }));

    expect(currencyCheckbox('JPY')).toBeInTheDocument();
    expect(screen.queryByLabelText('USD value of 1 JPY')).not.toBeInTheDocument();
  });

  it('saves an edited rate on blur and adopts the rates the API returns', async () => {
    const updated: FxRates = { USD: 1, PLN: 0.3, BTC: 65000 };
    mock(setFxRate).mockResolvedValue({ rates: updated });
    const { onRatesChanged, rerender, props } = renderSettings();

    fireEvent.change(rateInput('PLN'), { target: { value: '0.3' } });
    fireEvent.blur(rateInput('PLN'));

    await waitFor(() => expect(setFxRate).toHaveBeenCalledWith('PLN', 0.3));
    await waitFor(() => expect(onRatesChanged).toHaveBeenCalledWith(updated));

    // App owns the rates, so the saved value comes back down as a prop; the
    // local draft must not shadow it.
    rerender(<Settings {...props} rates={updated} />);
    expect(rateInput('PLN').value).toBe('0.3');
  });

  it('rejects a non-positive rate without calling the API', async () => {
    renderSettings();

    fireEvent.change(rateInput('PLN'), { target: { value: '0' } });
    fireEvent.blur(rateInput('PLN'));

    expect(await screen.findByText(/rate must be a positive number/i)).toBeInTheDocument();
    expect(setFxRate).not.toHaveBeenCalled();
  });

  it('surfaces an API failure instead of silently dropping the edit', async () => {
    mock(setFxRate).mockRejectedValue(new Error('Rate service unavailable'));
    const { onRatesChanged } = renderSettings();

    fireEvent.change(rateInput('BTC'), { target: { value: '70000' } });
    fireEvent.blur(rateInput('BTC'));

    expect(await screen.findByText('Rate service unavailable')).toBeInTheDocument();
    expect(onRatesChanged).not.toHaveBeenCalled();
    // The unsaved input stays put so it can be retried.
    expect(rateInput('BTC').value).toBe('70000');
  });

  it('shows an unset rate as unset rather than as zero', () => {
    // The backend seeds a newly enabled currency at 0, and `convertAmount`
    // reads 0 as "cannot convert" — so a currency with no rate silently drops
    // out of every converted total. "$0" would claim a value; the box is empty
    // and says "not set". Invisible until wave 4 put these rows on a screen.
    renderSettings({ rates: { USD: 1, PLN: 0.25, BTC: 0 } });

    expect(rateInput('BTC').value).toBe('');
    expect(rateInput('BTC')).toHaveAttribute('placeholder', 'not set');
    expect(rateInput('PLN').value).toBe('0.25');
  });

  it('keeps a refused rate flagged on its own row when another currency is touched', async () => {
    // The draft stays in the box so it can be retried, so the message saying
    // "this is not the rate in force" is the only thing between the reader and
    // a row that looks saved. It must survive an unrelated enable/disable and
    // an unrelated successful save — a section-wide error line does not.
    mock(setCurrencyEnabled).mockResolvedValue({ code: 'EUR', enabled: true });
    mock(getCurrencies).mockResolvedValue(TEST_CURRENCIES);
    mock(setFxRate).mockResolvedValue({ rates: RATES });
    renderSettings();

    fireEvent.change(rateInput('PLN'), { target: { value: '' } });
    fireEvent.blur(rateInput('PLN'));
    expect(await screen.findByText(/rate must be a positive number/i)).toBeInTheDocument();

    fireEvent.click(currencyCheckbox('USD'));
    await waitFor(() => expect(setCurrencyEnabled).toHaveBeenCalled());
    expect(screen.getByText(/rate must be a positive number/i)).toBeInTheDocument();

    fireEvent.change(rateInput('BTC'), { target: { value: '70000' } });
    fireEvent.blur(rateInput('BTC'));
    await waitFor(() => expect(setFxRate).toHaveBeenCalledWith('BTC', 70000));
    // Still flagged, and flagged on the row it belongs to.
    expect(within(currencyRow('PLN')).getByText(/rate must be a positive number/i)).toBeInTheDocument();
  });

  it('clears a row\'s complaint once that row saves', async () => {
    mock(setFxRate).mockResolvedValue({ rates: RATES });
    renderSettings();

    fireEvent.change(rateInput('PLN'), { target: { value: '-1' } });
    fireEvent.blur(rateInput('PLN'));
    expect(await screen.findByText(/rate must be a positive number/i)).toBeInTheDocument();

    fireEvent.change(rateInput('PLN'), { target: { value: '0.3' } });
    fireEvent.blur(rateInput('PLN'));

    await waitFor(() => expect(screen.queryByText(/rate must be a positive number/i)).not.toBeInTheDocument());
  });

  it('does not call the API for a field nobody typed in', () => {
    renderSettings();

    fireEvent.blur(rateInput('PLN'));

    expect(setFxRate).not.toHaveBeenCalled();
  });
});

/**
 * Both blocks arrived with the navigation shell. The mobile bar has five slots
 * and no overflow sheet, so Settings is the only route on a phone to the theme,
 * to signing out, and to the one irreversible action in the product.
 */
describe('Settings — this device', () => {
  it('offers the theme the user is not currently on, and reports the toggle up', () => {
    const { onToggleTheme } = renderSettings({ theme: 'dark' });

    const button = screen.getByRole('button', { name: /switch to light mode/i });
    fireEvent.click(button);

    expect(onToggleTheme).toHaveBeenCalledTimes(1);
  });

  it('names the other theme when the user is already on light', () => {
    renderSettings({ theme: 'light' });

    expect(screen.getByRole('button', { name: /switch to dark mode/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /switch to light mode/i })).not.toBeInTheDocument();
  });

  it('offers Sign out only where there is a session to end', () => {
    const { unmount } = renderSettings({ authRequired: false });
    expect(screen.queryByRole('button', { name: /sign out/i })).not.toBeInTheDocument();
    unmount();

    const { onLogout } = renderSettings({ authRequired: true });
    fireEvent.click(screen.getByRole('button', { name: /sign out/i }));
    expect(onLogout).toHaveBeenCalledTimes(1);
  });

  /**
   * "This device is…" — the standing control for the row label
   * (docs/who-label-spec.md). The Add sheet asks once; this is the only place
   * either answer can be changed, including a "Not now" that became a yes.
   */
  describe('the who label', () => {
    const field = () => screen.getByLabelText(/this device is/i) as HTMLInputElement;

    beforeEach(() => localStorage.removeItem('sundry-who'));

    it('opens empty on a device that has never been named', () => {
      renderSettings();
      expect(field().value).toBe('');
    });

    it('shows the name this device already answers to', () => {
      localStorage.setItem('sundry-who', 'Ania');
      renderSettings();

      expect(field().value).toBe('Ania');
    });

    it('saves a typed name, normalised, when the field is left', () => {
      renderSettings();

      fireEvent.change(field(), { target: { value: '  Kasia   B ' } });
      fireEvent.blur(field());

      expect(localStorage.getItem('sundry-who')).toBe('Kasia B');
    });

    it('offers the names the ledger already holds, so a household agrees on one spelling', () => {
      renderSettings({ people: ['Ania', 'Alex'] });

      fireEvent.click(screen.getByRole('button', { name: 'Alex' }));

      expect(localStorage.getItem('sundry-who')).toBe('Alex');
      expect(field().value).toBe('Alex');
      expect(screen.getByRole('button', { name: 'Alex' })).toHaveAttribute('aria-pressed', 'true');
    });

    it('clears to the skip sentinel rather than to nothing, so the prompt stays away', () => {
      localStorage.setItem('sundry-who', 'Ania');
      renderSettings();

      fireEvent.click(screen.getByRole('button', { name: 'Clear' }));

      expect(field().value).toBe('');
      expect(localStorage.getItem('sundry-who')).toBe('');
    });

    it('says what the label is not, since a name beside a row is the shape of a login', () => {
      renderSettings();
      expect(screen.getByText(/it is not a login/i)).toBeInTheDocument();
    });

    /**
     * The Add sheet opens *over* this screen, so its prompt can answer the
     * question while these rows are on display. Without the event the field
     * would go on showing the answer from before it.
     */
    it('follows a name the Add sheet\'s prompt set while this screen was up', () => {
      renderSettings();
      expect(field().value).toBe('');

      // Wrapped, because the write happens outside React: the event listener is
      // what turns it into a state update, and nothing else flushes it here.
      act(() => setWho('Ania'));

      expect(field().value).toBe('Ania');
    });
  });
});

describe('Settings — danger zone', () => {
  it('holds Wipe database, and says what it destroys and what it keeps', () => {
    renderSettings();

    const zone = screen.getByRole('button', { name: /wipe database/i }).closest('.danger-zone');
    expect(zone).not.toBeNull();
    expect(within(zone as HTMLElement).getByText(/no undo/i)).toBeInTheDocument();
    expect(within(zone as HTMLElement).getByText(/budgets, categories and preferences stay/i)).toBeInTheDocument();
  });

  it('hands the wipe to App, which owns the ledger and both confirmations', () => {
    const { onWipeDatabase } = renderSettings();

    fireEvent.click(screen.getByRole('button', { name: /wipe database/i }));

    expect(onWipeDatabase).toHaveBeenCalledTimes(1);
  });

  it('renders the confirm style that had no caller — .btn-danger', () => {
    // F14 named `.btn-danger` and wave 0 fixed its contrast, then found nothing
    // rendered it. This is the element the fix was for.
    renderSettings();
    expect(screen.getByRole('button', { name: /wipe database/i })).toHaveClass('btn-danger');
  });
});
