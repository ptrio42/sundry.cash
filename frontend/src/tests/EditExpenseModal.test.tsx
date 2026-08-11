/**
 * Tests for the EditExpenseModal component.
 *
 * The focus is the accessible-dialog contract (initial focus, focus restore,
 * Tab trap, Escape, backdrop click) plus the save path, since those are the
 * parts most likely to regress silently. No API layer is involved — the
 * component talks to its parent through the `onSave` / `onClose` props.
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import EditExpenseModal from '../components/EditExpenseModal';
import { TEST_CATEGORIES } from './categories.fixture';
import { Expense } from '../types/expense.types';

const EXPENSE: Expense = {
  id: 7,
  amount: 25.5,
  date: '2024-03-01',
  description: 'Coffee beans',
  category: 'groceries',
  currency: 'USD',
};

beforeAll(() => {
  // jsdom does no layout, so `offsetParent` is always null and the component's
  // visibility filter would consider every control hidden. Report the parent so
  // attached elements count as visible, matching a real browser.
  Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
    configurable: true,
    get() {
      return this.parentNode;
    },
  });
});

beforeEach(() => {
  vi.clearAllMocks();
});

const renderModal = (expense: Expense | null, onSave = vi.fn(), onClose = vi.fn()) => {
  const view = render(<EditExpenseModal expense={expense} categories={TEST_CATEGORIES} onSave={onSave} onClose={onClose} />);
  return { ...view, onSave, onClose };
};

describe('EditExpenseModal', () => {
  it('renders nothing when there is no expense to edit', () => {
    const { container } = renderModal(null);

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('pre-fills the form from the expense it is given', () => {
    renderModal(EXPENSE);

    expect(screen.getByRole('dialog')).toHaveAccessibleName('Edit Expense');
    expect((screen.getByLabelText(/amount/i) as HTMLInputElement).value).toBe('25.5');
    expect((screen.getByLabelText(/date/i) as HTMLInputElement).value).toBe('2024-03-01');
    expect((screen.getByLabelText(/description/i) as HTMLInputElement).value).toBe('Coffee beans');
    expect((screen.getByLabelText(/category/i) as HTMLSelectElement).value).toBe('groceries');
    expect((screen.getByLabelText(/currency/i) as HTMLSelectElement).value).toBe('USD');
  });

  it('saves the edited values and then closes', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { onClose } = renderModal(EXPENSE, onSave);

    fireEvent.change(screen.getByLabelText(/description/i), { target: { value: 'Espresso beans' } });
    fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: '31.75' } });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    // Only the fields the user actually touched are sent to the parent.
    expect(onSave).toHaveBeenCalledWith(7, { amount: 31.75, description: 'Espresso beans' });
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('closes when Escape is pressed', () => {
    const { onClose } = renderModal(EXPENSE);

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('moves focus into the dialog on open and restores it on close', () => {
    const onSave = vi.fn();
    const onClose = vi.fn();
    const harness = (expense: Expense | null) => (
      <>
        <button type="button">Edit expense</button>
        <EditExpenseModal expense={expense} categories={TEST_CATEGORIES} onSave={onSave} onClose={onClose} />
      </>
    );

    const { rerender } = render(harness(null));
    const trigger = screen.getByRole('button', { name: /edit expense/i });
    trigger.focus();

    rerender(harness(EXPENSE));
    expect(screen.getByLabelText(/amount/i)).toHaveFocus();

    rerender(harness(null));
    expect(trigger).toHaveFocus();
  });

  it('traps Tab inside the dialog', () => {
    renderModal(EXPENSE);

    const closeButton = screen.getByRole('button', { name: /close dialog/i });
    const cancelButton = screen.getByRole('button', { name: /cancel/i });

    // Tabbing off the last control wraps to the first one.
    cancelButton.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(closeButton).toHaveFocus();

    // Shift+Tab off the first control wraps back to the last one.
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(cancelButton).toHaveFocus();
  });

  it('closes on a backdrop click but not on a click inside the dialog', () => {
    const { onClose } = renderModal(EXPENSE);

    const dialog = screen.getByRole('dialog');
    fireEvent.click(dialog);
    fireEvent.click(screen.getByText('Edit Expense'));
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(dialog.parentElement as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
