/**
 * Tests for the Settings component. The API layer is mocked.
 *
 * Two halves: the preference form, and the category manager that arrived when
 * categories stopped being a hardcoded enum.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import Settings from '../components/Settings';
import {
  updateSettings,
  getCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  getCurrencies,
  setCurrencyEnabled,
} from '../services/api';
import { AppSettings, Category } from '../types/expense.types';
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
}));

const mock = (fn: unknown) => fn as unknown as ReturnType<typeof vi.fn>;

const settings: AppSettings = { defaultCurrency: 'USD', defaultCategory: 'groceries', defaultBtcUnit: 'BTC', primaryCurrency: 'USD' };

const CUSTOM: Category = { slug: 'pet-food', label: 'Pet food', color: '#f472b6', sortOrder: 7, isBuiltin: false };

interface Overrides {
  categories?: Category[];
  onCategoriesChanged?: ReturnType<typeof vi.fn>;
  onCurrenciesChanged?: ReturnType<typeof vi.fn>;
  onExpensesStale?: ReturnType<typeof vi.fn>;
}

const renderSettings = ({ categories = TEST_CATEGORIES, onCategoriesChanged = vi.fn(), onCurrenciesChanged = vi.fn(), onExpensesStale = vi.fn() }: Overrides = {}) => {
  const onSaved = vi.fn();
  const view = render(
    <Settings
      settings={settings}
      categories={categories}
      currencies={TEST_CURRENCIES}
      onSaved={onSaved}
      onCurrenciesChanged={onCurrenciesChanged}
      onCategoriesChanged={onCategoriesChanged}
      onExpensesStale={onExpensesStale}
    />
  );
  return { ...view, onSaved, onCategoriesChanged, onCurrenciesChanged, onExpensesStale };
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
  const currencyCheckbox = (code: string) => screen.getByRole('checkbox', { name: new RegExp(`^${code}`) });

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
