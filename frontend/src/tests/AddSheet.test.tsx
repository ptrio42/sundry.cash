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
import { setWho } from '../utils/who';
import { AppSettings, Expense } from '../types/expense.types';

const TEST_SETTINGS: AppSettings = {
  defaultCurrency: 'PLN',
  defaultCategory: 'groceries',
  defaultBtcUnit: 'BTC',
  primaryCurrency: 'PLN',
};

vi.mock('../services/api', () => ({
  createExpense: vi.fn(),
  // The Type tab asks for a category as the description is typed (change 21).
  suggestCategory: vi.fn(async () => 'other'),
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

const sheet = (
  props: { open?: boolean; receiptsEnabled?: boolean; people?: string[]; demoMode?: boolean } = {}
) => (
  <AddSheet
    open={props.open ?? true}
    receiptsEnabled={props.receiptsEnabled ?? true}
    settings={TEST_SETTINGS}
    categories={TEST_CATEGORIES}
    currencies={TEST_CURRENCIES}
    people={props.people ?? []}
    demoMode={props.demoMode ?? false}
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

/**
 * "Who is adding this?" — the one-time prompt (docs/who-label-spec.md).
 *
 * A label, not a login: it stamps rows and grants nothing, which is why nothing
 * here blocks a save.
 */
describe('AddSheet — the who prompt', () => {
  const question = () => screen.queryByText(/who is adding this\?/i);

  beforeEach(() => setPhone(false));

  it('asks when this device has never been named, offering the ledger names and a free field', () => {
    render(sheet({ people: ['Ania', 'Alex'] }));

    expect(question()).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ania' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Alex' })).toBeInTheDocument();
    expect(screen.getByLabelText(/your name/i)).toBeInTheDocument();
  });

  it('says what it is not, because a name beside a row is the shape of a login', () => {
    render(sheet());
    expect(screen.getByText(/not a login/i)).toBeInTheDocument();
  });

  it('does not ask a device that already has a name', () => {
    localStorage.setItem('sundry-who', 'Ania');
    render(sheet({ people: ['Ania'] }));

    expect(question()).not.toBeInTheDocument();
  });

  /**
   * The sheet is mounted with the shell and never unmounts, so the answer has to
   * be read when it renders rather than once at mount: Settings is the obvious
   * place to look before you have added anything, and a device named there must
   * not still be asked here.
   */
  it('stops asking once the name is set from somewhere else', () => {
    const { rerender } = render(sheet({ open: false }));
    setWho('Ania');
    rerender(sheet({ open: true }));

    expect(question()).not.toBeInTheDocument();
  });

  /**
   * The demo is a shop window and its seed is one fictional person's life.
   * Asking a visitor what to call them would be asking a stranger for a name to
   * put in a ledger that is wiped every night.
   */
  it('never asks on the demo, whatever the key says', () => {
    render(sheet({ demoMode: true, people: ['Ania'] }));

    expect(question()).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/your name/i)).not.toBeInTheDocument();
  });

  it('remembers a name picked from the buttons and stops asking', () => {
    render(sheet({ people: ['Ania', 'Alex'] }));

    fireEvent.click(screen.getByRole('button', { name: 'Alex' }));

    expect(localStorage.getItem('sundry-who')).toBe('Alex');
    expect(question()).not.toBeInTheDocument();
  });

  it('remembers a typed name, normalised', () => {
    render(sheet());

    fireEvent.change(screen.getByLabelText(/your name/i), { target: { value: '  Kasia   B  ' } });
    fireEvent.click(screen.getByRole('button', { name: /use this/i }));

    expect(localStorage.getItem('sundry-who')).toBe('Kasia B');
    expect(question()).not.toBeInTheDocument();
  });

  it('takes Enter as the answer rather than as a save', () => {
    render(sheet());

    const field = screen.getByLabelText(/your name/i);
    fireEvent.change(field, { target: { value: 'Ola' } });
    fireEvent.keyDown(field, { key: 'Enter' });

    expect(localStorage.getItem('sundry-who')).toBe('Ola');
    expect(createExpense).not.toHaveBeenCalled();
  });

  it('offers nothing to confirm until something has been typed', () => {
    render(sheet());
    expect(screen.getByRole('button', { name: /use this/i })).toBeDisabled();
  });

  /**
   * Skipping is permanent. A prompt that reappears on every save is worse than
   * no feature; Settings is where someone changes their mind.
   */
  it('takes "Not now" as a permanent answer', () => {
    const first = render(sheet());
    fireEvent.click(screen.getByRole('button', { name: /not now/i }));

    expect(localStorage.getItem('sundry-who')).toBe('');
    expect(question()).not.toBeInTheDocument();
    first.unmount();

    render(sheet());
    expect(question()).not.toBeInTheDocument();
  });

  it('leaves focus on the form rather than on the question', () => {
    // The prompt is a note above the panel, not a gate in front of it: the
    // reader opened this to type an amount.
    render(sheet());
    expect(document.activeElement).toBe(screen.getByLabelText(/^amount$/i));
  });

  it('does not add a second heading to a dialog that already has one', () => {
    render(sheet({ people: ['Ania'] }));
    expect(screen.getAllByRole('heading')).toHaveLength(1);
  });
});

describe('AddSheet — stamping the label on what is saved', () => {
  const saved: Expense = {
    id: 7, amount: 24.9, date: '2026-08-11', description: 'Coffee',
    category: 'groceries', currency: 'PLN',
  };

  const save = () => {
    fireEvent.change(screen.getByLabelText(/^amount$/i), { target: { value: '24.90' } });
    fireEvent.change(screen.getByLabelText(/^description$/i), { target: { value: 'Coffee' } });
    fireEvent.click(screen.getByRole('button', { name: /add expense/i }));
  };

  beforeEach(() => {
    setPhone(false);
    (createExpense as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(saved);
  });

  it('sends the name this device answered with', async () => {
    render(sheet({ people: ['Ania'] }));
    fireEvent.click(screen.getByRole('button', { name: 'Ania' }));
    save();

    await waitFor(() => expect(createExpense).toHaveBeenCalledWith(
      expect.objectContaining({ who: 'Ania' })
    ));
  });

  it('saves an unlabelled row when the question was skipped — nothing here is a gate', async () => {
    render(sheet());
    fireEvent.click(screen.getByRole('button', { name: /not now/i }));
    save();

    await waitFor(() => expect(createExpense).toHaveBeenCalledWith(
      expect.objectContaining({ who: null })
    ));
  });

  it('saves an unlabelled row when the question was ignored altogether', async () => {
    render(sheet());
    save();

    await waitFor(() => expect(createExpense).toHaveBeenCalledWith(
      expect.objectContaining({ who: null })
    ));
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
