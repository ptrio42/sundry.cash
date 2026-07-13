/**
 * Tests for ExpenseForm component
 * Example test demonstrating component testing
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import ExpenseForm from '../components/ExpenseForm';

describe('ExpenseForm', () => {
  it('renders form with all required fields', () => {
    const mockOnExpenseAdded = vi.fn();

    render(<ExpenseForm onExpenseAdded={mockOnExpenseAdded} />);

    // Check for form heading
    expect(screen.getByText('Add New Expense')).toBeInTheDocument();

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

    render(<ExpenseForm onExpenseAdded={mockOnExpenseAdded} />);

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

    render(<ExpenseForm onExpenseAdded={mockOnExpenseAdded} />);

    const submitButton = screen.getByRole('button', { name: /add expense/i });
    expect(submitButton).not.toBeDisabled();
  });
});
