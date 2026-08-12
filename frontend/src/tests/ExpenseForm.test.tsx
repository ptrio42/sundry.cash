/**
 * Tests for ExpenseForm component — the Add sheet's "Type it" tab.
 *
 * The fields, and only the fields: which tab it is, and what happens once it
 * saves, belong to `AddSheet.test.tsx` and `App.test.tsx`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ExpenseForm from '../components/ExpenseForm';
import { TEST_CATEGORIES } from './categories.fixture';
import { TEST_CURRENCIES } from './currencies.fixture';
import { AppSettings } from '../types/expense.types';
import { suggestCategory } from '../services/api';

// The form talks to the API as the description is typed (change 21), so this
// file needs a mock it never used to: without one, `apiFetch` hands jsdom a
// relative URL and the suggestion surfaces as an unhandled rejection rather
// than as a failing assertion.
vi.mock('../services/api', () => ({
  createExpense: vi.fn(),
  suggestCategory: vi.fn(),
}));

const mockSuggestCategory = vi.mocked(suggestCategory);

const TEST_SETTINGS: AppSettings = { defaultCurrency: 'USD', defaultCategory: 'groceries', defaultBtcUnit: 'BTC', primaryCurrency: 'USD' };

beforeEach(() => {
  vi.clearAllMocks();
  // Nothing matched, unless a case says otherwise — the answer that must leave
  // the configured default alone.
  mockSuggestCategory.mockResolvedValue('other');
});

describe('ExpenseForm', () => {
  it('renders form with all required fields', () => {
    const mockOnExpenseAdded = vi.fn();

    render(<ExpenseForm onExpenseAdded={mockOnExpenseAdded} settings={TEST_SETTINGS} categories={TEST_CATEGORIES} currencies={TEST_CURRENCIES} />);

    // No heading of its own: the sheet's header says "Add expense" once, and
    // the tab above says which of the two ways in this is.
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();

    // Check for all form fields
    expect(screen.getByLabelText(/amount/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/date/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/description/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/category/i)).toBeInTheDocument();

    // Check for submit button
    expect(screen.getByRole('button', { name: /add expense/i })).toBeInTheDocument();
  });

  it('has category dropdown with all options', () => {
    const mockOnExpenseAdded = vi.fn();

    render(<ExpenseForm onExpenseAdded={mockOnExpenseAdded} settings={TEST_SETTINGS} categories={TEST_CATEGORIES} currencies={TEST_CURRENCIES} />);

    const categorySelect = screen.getByLabelText(/category/i) as HTMLSelectElement;
    const options = Array.from(categorySelect.options).map(opt => opt.value);

    expect(options).toContain('groceries');
    expect(options).toContain('transport');
    expect(options).toContain('media');
    expect(options).toContain('entertainment');
    expect(options).toContain('other');
  });

  it('displays submit button with correct initial text', () => {
    const mockOnExpenseAdded = vi.fn();

    render(<ExpenseForm onExpenseAdded={mockOnExpenseAdded} settings={TEST_SETTINGS} categories={TEST_CATEGORIES} currencies={TEST_CURRENCIES} />);

    const submitButton = screen.getByRole('button', { name: /add expense/i });
    expect(submitButton).not.toBeDisabled();
  });
});

/**
 * The category suggestion (change 21).
 *
 * The claim under test is not "the categorizer works" — `categorize.test.ts`
 * owns that — but that the guess behaves like a guess: it fills the field, it
 * never overwrites a choice, and an answer carrying no information leaves the
 * configured default where it was.
 */
describe('ExpenseForm — suggesting a category', () => {
  const renderForm = () =>
    render(
      <ExpenseForm
        onExpenseAdded={vi.fn()}
        settings={TEST_SETTINGS}
        categories={TEST_CATEGORIES}
        currencies={TEST_CURRENCIES}
      />
    );

  const categorySelect = () => screen.getByLabelText(/category/i) as HTMLSelectElement;
  const type = (value: string) => fireEvent.change(screen.getByLabelText(/description/i), { target: { value } });

  it('pre-selects what the description points at', async () => {
    mockSuggestCategory.mockResolvedValue('transport');
    renderForm();

    expect(categorySelect().value).toBe('groceries'); // settings.defaultCategory
    type('Orlen paliwo');

    await waitFor(() => expect(categorySelect().value).toBe('transport'));
    expect(mockSuggestCategory).toHaveBeenCalledWith('Orlen paliwo');
  });

  it('leaves the configured default alone when the answer is other', async () => {
    mockSuggestCategory.mockResolvedValue('other');
    renderForm();

    type('Xyzzy');

    await waitFor(() => expect(mockSuggestCategory).toHaveBeenCalled());
    // `other` is both "nothing matched" and a real answer, so it is not worth
    // spending a configured default on.
    expect(categorySelect().value).toBe('groceries');
  });

  it('does not leave an old guess standing over a new description', async () => {
    mockSuggestCategory.mockResolvedValue('transport');
    renderForm();

    type('Orlen paliwo');
    await waitFor(() => expect(categorySelect().value).toBe('transport'));

    // "Apteka" categorises as `other`. Ignoring that answer would file a
    // pharmacy expense under Transport — a category neither the reader nor the
    // description chose.
    mockSuggestCategory.mockResolvedValue('other');
    type('Apteka');

    await waitFor(() => expect(categorySelect().value).toBe('groceries'));
  });

  it('returns to the default when the description is cleared', async () => {
    mockSuggestCategory.mockResolvedValue('transport');
    renderForm();

    type('Orlen paliwo');
    await waitFor(() => expect(categorySelect().value).toBe('transport'));

    type('');

    await waitFor(() => expect(categorySelect().value).toBe('groceries'));
  });

  it('does not overwrite a category the reader chose', async () => {
    mockSuggestCategory.mockResolvedValue('transport');
    renderForm();

    fireEvent.change(categorySelect(), { target: { value: 'entertainment' } });
    type('Orlen paliwo');

    // One explicit choice ends the guessing: no request, and the choice stands.
    await new Promise(resolve => setTimeout(resolve, 400));
    expect(categorySelect().value).toBe('entertainment');
    expect(mockSuggestCategory).not.toHaveBeenCalled();
  });

  it('keeps the reader\'s choice through a suggestion already in flight', async () => {
    // The race the cancel flag is for: the answer to "Orl" must not land on a
    // select the reader has since set by hand.
    let resolveSuggestion: (slug: string) => void = () => {};
    mockSuggestCategory.mockReturnValue(new Promise(resolve => { resolveSuggestion = resolve; }));
    renderForm();

    type('Orlen');
    await waitFor(() => expect(mockSuggestCategory).toHaveBeenCalled());
    fireEvent.change(categorySelect(), { target: { value: 'entertainment' } });
    resolveSuggestion('transport');

    await new Promise(resolve => setTimeout(resolve, 50));
    expect(categorySelect().value).toBe('entertainment');
  });

  it('asks for nothing while the description is empty', async () => {
    renderForm();

    fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: '12' } });
    type('   ');
    await new Promise(resolve => setTimeout(resolve, 400));

    expect(mockSuggestCategory).not.toHaveBeenCalled();
  });

  it('keeps typing usable when the suggestion fails', async () => {
    mockSuggestCategory.mockRejectedValue(new Error('offline'));
    renderForm();

    type('Lidl');

    await waitFor(() => expect(mockSuggestCategory).toHaveBeenCalled());
    // A guess that fails is a guess not made — not a save failure, which is
    // what the error box is for.
    expect(screen.queryByText(/failed/i)).not.toBeInTheDocument();
    expect(categorySelect().value).toBe('groceries');
  });
});
