/**
 * Tests for the Add sheet — the two ways of recording an expense, in one
 * overlay (change 10).
 *
 * What is the sheet's own is here: which tab it opens on, that the choice is
 * remembered, that the two panels are the components that used to be
 * destinations, and the dialog behaviour. What the *shell* has to do with it —
 * opening over a destination, closing on save without navigating, Back — is in
 * `App.test.tsx`, because none of that is observable from here.
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import AddSheet, { AddedLine } from '../components/AddSheet';
import { TEST_CATEGORIES } from './categories.fixture';
import { TEST_CURRENCIES } from './currencies.fixture';
import { createExpense } from '../services/api';
import { AppSettings, Expense } from '../types/expense.types';

const TEST_SETTINGS: AppSettings = {
  defaultCurrency: 'PLN',
  defaultCategory: 'groceries',
  defaultBtcUnit: 'BTC',
  primaryCurrency: 'PLN',
};

vi.mock('../services/api', () => ({
  createExpense: vi.fn(),
  scanReceipt: vi.fn(),
  createReceiptExpense: vi.fn(),
}));

beforeAll(() => {
  // jsdom has no object-URL support, and the Scan panel makes one per photo.
  globalThis.URL.createObjectURL = vi.fn(() => 'blob:mock');
  globalThis.URL.revokeObjectURL = vi.fn();
});

const originalMatchMedia = window.matchMedia;

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

afterEach(() => {
  window.matchMedia = originalMatchMedia;
});

/** Answer the phone breakpoint however this case needs it answered. */
const setPhone = (isPhone: boolean) => {
  window.matchMedia = ((query: string) => ({
    matches: isPhone,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
};

const onExpenseAdded = vi.fn();
const onClose = vi.fn();

const sheet = (props: { open?: boolean; receiptsEnabled?: boolean } = {}) => (
  <AddSheet
    open={props.open ?? true}
    receiptsEnabled={props.receiptsEnabled ?? true}
    settings={TEST_SETTINGS}
    categories={TEST_CATEGORIES}
    currencies={TEST_CURRENCIES}
    onExpenseAdded={onExpenseAdded}
    onClose={onClose}
  />
);

const tab = (name: RegExp) => screen.getByRole('tab', { name });
const selectedTab = () => screen.getByRole('tab', { selected: true });

describe('AddSheet — the two methods', () => {
  it('renders nothing at all while closed', () => {
    const { container } = render(sheet({ open: false }));
    expect(container).toBeEmptyDOMElement();
  });

  it('offers Scan and Type as tabs of one dialog', () => {
    setPhone(false);
    render(sheet());

    const dialog = screen.getByRole('dialog', { name: 'Add expense' });
    expect(within(dialog).getAllByRole('tab')).toHaveLength(2);
    expect(tab(/scan a receipt/i)).toBeInTheDocument();
    expect(tab(/type it/i)).toBeInTheDocument();
  });

  it('says "Add expense" once, and neither panel repeats it', () => {
    // Both components used to carry their own <h2> because both were pages.
    setPhone(false);
    render(sheet());

    expect(screen.getAllByRole('heading')).toHaveLength(1);
    expect(screen.queryByText('Add New Expense')).not.toBeInTheDocument();
    expect(screen.queryByText('Scan a Receipt')).not.toBeInTheDocument();
  });

  it('opens on Type at a desk, where the keyboard is the cheap way in', () => {
    setPhone(false);
    render(sheet());

    expect(selectedTab()).toHaveTextContent('Type it');
    expect(screen.getByLabelText(/^amount$/i)).toBeInTheDocument();
  });

  it('opens on Scan on a phone, which already has the camera in hand', () => {
    setPhone(true);
    render(sheet());

    expect(selectedTab()).toHaveTextContent('Scan a receipt');
    expect(screen.getByLabelText(/receipt photo/i)).toBeInTheDocument();
  });

  it('does not read a viewport that has not been laid out yet as a phone', () => {
    // `innerWidth` is 0 before the first layout, and `(max-width: 680px)` is
    // true of a zero-width viewport — which opened a 1280px desktop on Scan
    // until the guard went in. Found by driving the demo, not by this suite.
    setPhone(true);
    Object.defineProperty(window, 'innerWidth', { value: 0, configurable: true });

    render(sheet());
    expect(selectedTab()).toHaveTextContent('Type it');

    Object.defineProperty(window, 'innerWidth', { value: 1024, configurable: true });
  });

  it('swaps the panel when the other method is chosen', () => {
    setPhone(false);
    render(sheet());

    fireEvent.click(tab(/scan a receipt/i));
    expect(screen.getByLabelText(/receipt photo/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/^date$/i)).not.toBeInTheDocument();

    fireEvent.click(tab(/type it/i));
    expect(screen.getByLabelText(/^date$/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/receipt photo/i)).not.toBeInTheDocument();
  });

  it('opens next time on the method used last', () => {
    setPhone(false);
    const first = render(sheet());
    fireEvent.click(tab(/scan a receipt/i));
    first.unmount();

    render(sheet());
    expect(selectedTab()).toHaveTextContent('Scan a receipt');
  });

  it('moves between the tabs with the arrow keys it claims to answer', () => {
    setPhone(false);
    render(sheet());

    fireEvent.keyDown(tab(/type it/i), { key: 'ArrowLeft' });
    expect(selectedTab()).toHaveTextContent('Scan a receipt');

    fireEvent.keyDown(tab(/scan a receipt/i), { key: 'ArrowRight' });
    expect(selectedTab()).toHaveTextContent('Type it');
  });
});

describe('AddSheet — an instance with scanning switched off', () => {
  it('offers no Scan tab, because the upload would 403', () => {
    setPhone(true);
    render(sheet({ receiptsEnabled: false }));

    expect(screen.queryByRole('tab', { name: /scan a receipt/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/receipt photo/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/^date$/i)).toBeInTheDocument();
  });

  it('opens on Type even when Scan is the remembered method', () => {
    localStorage.setItem('sundry-add-method', 'scan');
    setPhone(true);
    render(sheet({ receiptsEnabled: false }));

    expect(selectedTab()).toHaveTextContent('Type it');
  });
});

describe('AddSheet — dialog behaviour', () => {
  beforeEach(() => setPhone(false));

  it('closes on Escape', () => {
    render(sheet());
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('closes on the close button and on a backdrop click', () => {
    const { container } = render(sheet());

    fireEvent.click(screen.getByRole('button', { name: /close dialog/i }));
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(container.querySelector('.modal-backdrop') as Element);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('does not close when the click landed inside it', () => {
    render(sheet());
    fireEvent.click(screen.getByRole('dialog'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('is a modal dialog that takes focus', () => {
    render(sheet());
    const dialog = screen.getByRole('dialog');

    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog.contains(document.activeElement)).toBe(true);
  });
});

describe('AddSheet — saving', () => {
  it('hands the saved expense to the shell rather than routing anywhere itself', async () => {
    setPhone(false);
    const saved: Expense = {
      id: 7, amount: 24.9, date: '2026-08-11', description: 'Coffee',
      category: 'groceries', currency: 'PLN',
    };
    (createExpense as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(saved);

    render(sheet());
    fireEvent.change(screen.getByLabelText(/^amount$/i), { target: { value: '24.90' } });
    fireEvent.change(screen.getByLabelText(/^description$/i), { target: { value: 'Coffee' } });
    fireEvent.click(screen.getByRole('button', { name: /add expense/i }));

    await waitFor(() => expect(onExpenseAdded).toHaveBeenCalledWith(saved));
  });
});

describe('AddedLine — the confirmation that replaced being moved', () => {
  const props = {
    categories: TEST_CATEGORIES,
    onUndo: vi.fn(),
    onEdit: vi.fn(),
    onDismiss: vi.fn(),
  };

  const expense: Expense = {
    id: 7, amount: 24.9, date: '2026-08-11', description: 'Coffee',
    category: 'groceries', currency: 'PLN',
  };

  it('keeps its live region in the document while it has nothing to say', () => {
    // A role="status" inserted together with its text is a node a screen reader
    // may never announce — the region has to be there first.
    render(<AddedLine expense={null} {...props} />);

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('states the amount and the category of what was saved', () => {
    render(<AddedLine expense={expense} {...props} />);

    const line = screen.getByRole('status');
    // pl-PL puts a non-breaking space before the symbol; this asserts on the
    // number and the currency, not on which space Intl picked.
    expect(line.textContent?.replace(/\s/g, ' ')).toContain('24,90 zł');
    expect(line).toHaveTextContent('Groceries');
  });

  it('offers the two things wanted a second after saving', () => {
    render(<AddedLine expense={expense} {...props} />);

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(props.onUndo).toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(props.onEdit).toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    expect(props.onDismiss).toHaveBeenCalled();
  });
});
