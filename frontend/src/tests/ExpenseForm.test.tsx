/**
 * Tests for ExpenseForm component — the Add sheet's "Type it" tab.
 *
 * The fields, and only the fields: which tab it is, and what happens once it
 * saves, belong to `AddSheet.test.tsx` and `App.test.tsx`.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import ExpenseForm from '../components/ExpenseForm';
import { TEST_CATEGORIES } from './categories.fixture';
import { TEST_CURRENCIES } from './currencies.fixture';
import { AppSettings } from '../types/expense.types';

const TEST_SETTINGS: AppSettings = { defaultCurrency: 'USD', defaultCategory: 'groceries', defaultBtcUnit: 'BTC', primaryCurrency: 'USD' };

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
