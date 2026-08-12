/**
 * AddSheet — the two ways of recording an expense, over whatever you were
 * reading.
 *
 * Change 10 of `docs/ux-review-findings.md`. `ReceiptScan` and `ExpenseForm`
 * used to be destinations: two of ten nav slots holding one file picker apiece
 * (F17), while mobile had already worked out that this is wrong by promoting
 * Scan into the bottom bar and burying Insights. Recording is an **input
 * method, not a place** — so the two of them are tabs in one sheet that opens
 * from anywhere and puts you back where you were.
 *
 * The fields are exactly what the two components already rendered. This is a
 * move, not a redesign of the form; the only thing either of them lost is its
 * own `<h2>`, which the sheet's header now says once.
 *
 * **Only the selected tab is mounted.** Switching methods therefore discards
 * whatever was half-typed in the other one — which is the same thing closing
 * the sheet does, and the alternative (both mounted, one `hidden`) puts two
 * "Amount" fields in the document for the sake of a case that costs one retype.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import ExpenseForm from './ExpenseForm';
import ReceiptScan from './ReceiptScan';
import { AppSettings, Category, CurrencyInfo, Expense } from '../types/expense.types';
import { formatCurrency } from '../utils/format';
import { categoryLabel } from '../utils/categories';

/** Which of the two ways in. Persisted, because it is a habit, not a setting. */
export type AddMethod = 'scan' | 'type';

const METHOD_KEY = 'sundry-add-method';

/**
 * The phone breakpoint the stylesheet uses, asked here for the same reason it
 * is asked there: a device with a camera in hand and a device with a keyboard
 * under it do not open on the same tab.
 */
const PHONE_QUERY = '(max-width: 680px)';

const readStoredMethod = (): AddMethod | null => {
  if (typeof localStorage === 'undefined') return null;
  const stored = localStorage.getItem(METHOD_KEY);
  return stored === 'scan' || stored === 'type' ? stored : null;
};

/**
 * Is this the narrow layout — the one whose navigation is the bottom bar?
 *
 * The zero-width guard is load-bearing. `window.innerWidth` is 0 until the
 * first layout, and `(max-width: 680px)` is true of a zero-width viewport, so
 * a desktop that renders this on its very first paint — a reload straight into
 * `#/home/add` — would answer "phone" and open on Scan. An unknown width
 * answers "not a phone": typing is available everywhere, scanning is not.
 */
function isPhone(): boolean {
  if (typeof window.matchMedia !== 'function' || !window.innerWidth) return false;
  return window.matchMedia(PHONE_QUERY).matches;
}

/**
 * The tab a visit opens on: the method used last, and on a first visit the one
 * the device makes cheapest — Scan on a phone, Type on a desktop.
 */
function initialMethod(): AddMethod {
  return readStoredMethod() ?? (isPhone() ? 'scan' : 'type');
}

interface AddSheetProps {
  open: boolean;
  /** False on an instance with OCR switched off: the API 403s, so do not offer it. */
  receiptsEnabled: boolean;
  settings: AppSettings;
  categories: Category[];
  currencies: CurrencyInfo[];
  onExpenseAdded: (expense: Expense) => void;
  onClose: () => void;
}

const TABS: { method: AddMethod; label: string }[] = [
  { method: 'scan', label: 'Scan a receipt' },
  { method: 'type', label: 'Type it' },
];

export default function AddSheet({
  open,
  receiptsEnabled,
  settings,
  categories,
  currencies,
  onExpenseAdded,
  onClose,
}: AddSheetProps) {
  /**
   * `null` until something is chosen, rather than resolved at mount.
   *
   * The sheet is mounted with the shell, which is before the browser has laid
   * anything out — and the default depends on how wide the viewport is. Asking
   * at render time asks once the answer exists: the sheet is opened by a click,
   * long after layout, and the one case that renders it earlier (a URL naming
   * it) is what the zero-width guard in `isPhone` is for.
   */
  const [chosen, setChosen] = useState<AddMethod | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  // An instance can only lose scanning between renders in theory, but rendering
  // a tab whose panel would 403 is worse than the one line that prevents it.
  const active: AddMethod = receiptsEnabled ? (chosen ?? initialMethod()) : 'type';
  const tabs = receiptsEnabled ? TABS : TABS.filter(t => t.method === 'type');

  const chooseMethod = useCallback((next: AddMethod) => {
    setChosen(next);
    // Written on selection rather than on save: what should open next time is
    // the way you reached for, and a scan you abandoned still answers that.
    if (typeof localStorage !== 'undefined') localStorage.setItem(METHOD_KEY, next);
  }, []);

  /**
   * Accessible dialog behaviour, the same shape `EditExpenseModal` uses: move
   * focus in, trap Tab, close on Escape, restore focus to whatever opened it.
   */
  useEffect(() => {
    if (!open) return;

    previouslyFocused.current = document.activeElement as HTMLElement;
    const node = dialogRef.current;
    const firstField =
      node?.querySelector<HTMLElement>('input, select, textarea') ??
      node?.querySelector<HTMLElement>('button');
    firstField?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key === 'Tab' && node) {
        const focusable = Array.from(
          node.querySelectorAll<HTMLElement>(
            'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
          )
        ).filter((el) => el.offsetParent !== null);
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      previouslyFocused.current?.focus();
    };
  }, [open, onClose]);

  /** Arrow keys move between tabs, which is what `role="tab"` promises. */
  const handleTabKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const index = tabs.findIndex(t => t.method === active);
    const next = tabs[(index + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
    if (!next || next.method === active) return;
    e.preventDefault();
    chooseMethod(next.method);
    // Roving tabindex: the tab that is selected is the one Tab reaches, so
    // focus has to follow the selection rather than stay on a -1 element.
    dialogRef.current?.querySelector<HTMLElement>(`#add-tab-${next.method}`)?.focus();
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  if (!open) return null;

  return (
    // Backdrop click is a convenience: the sheet traps focus, closes on Escape,
    // and has a visible close button, so the keyboard path does not rely on it.
    <div className="modal-backdrop add-sheet-backdrop" onClick={handleBackdropClick} role="presentation">
      <div
        className="modal-content add-sheet"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-sheet-title"
      >
        <div className="modal-header">
          <h2 id="add-sheet-title">Add expense</h2>
          <button className="modal-close" onClick={onClose} type="button" aria-label="Close dialog">
            <span aria-hidden="true">✕</span>
          </button>
        </div>

        <div className="add-sheet-tabs" role="tablist" aria-label="How to record it">
          {tabs.map(tab => (
            <button
              key={tab.method}
              type="button"
              role="tab"
              id={`add-tab-${tab.method}`}
              className={active === tab.method ? 'active' : ''}
              aria-selected={active === tab.method}
              aria-controls="add-sheet-panel"
              tabIndex={active === tab.method ? 0 : -1}
              onClick={() => chooseMethod(tab.method)}
              onKeyDown={handleTabKeyDown}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div
          className="add-sheet-panel"
          id="add-sheet-panel"
          role="tabpanel"
          aria-labelledby={`add-tab-${active}`}
        >
          {active === 'scan' ? (
            <ReceiptScan
              onExpenseAdded={onExpenseAdded}
              settings={settings}
              categories={categories}
              currencies={currencies}
            />
          ) : (
            <ExpenseForm
              onExpenseAdded={onExpenseAdded}
              settings={settings}
              categories={categories}
              currencies={currencies}
            />
          )}
        </div>
      </div>
    </div>
  );
}

interface AddedLineProps {
  expense: Expense | null;
  categories: Category[];
  onUndo: () => void;
  onEdit: () => void;
  onDismiss: () => void;
}

/**
 * What replaced being thrown into the ledger (change 11, F7).
 *
 * Saving used to `setCurrentView('table')` and say nothing: no toast, no
 * highlight, no "saved" — the only evidence that anything happened was that the
 * app had moved you, on the most frequent action in the product. This says it
 * instead, where you already were, and offers the two things a person wants a
 * second after saving: take it back, or fix it.
 *
 * The wrapper renders whether or not there is anything in it, so the live
 * region exists before it has content — a `role="status"` inserted *with* its
 * text is a node screen readers may never announce.
 *
 * No timer. A confirmation that dismisses itself takes Undo with it, and the
 * one control that undoes an unwanted write should not be racing the reader.
 *
 * **"Is the new row findable?" — checked in wave 4, and this line is the
 * answer.** Usually: `App` prepends the saved row to the one ledger array and
 * the sort is date-descending and stable, so an expense dated today lands at
 * row one of an unfiltered table. Not always, and not only under a filter —
 * the date field is freely editable, so a back-dated expense sorts to where its
 * date belongs and can be off page 1 with nothing filtering at all. Add a
 * search, a category chip, a currency scope or a date window that excludes it
 * and the table shows nothing new; a scrolled page shows nothing at all, since
 * nothing in the frontend scrolls anywhere. Confirmed in the browser: search
 * "kawa", save an unrelated expense, and the table stays empty while this line
 * names what was saved.
 *
 * That is deliberate rather than unfinished. **Undo and Edit both act on the
 * row itself, whatever is filtering the table** — Edit opens it in the modal
 * from here — so the row is always reachable even when it is not visible. The
 * alternative, a line that knows whether the row survives the current filter,
 * would mean the shell knowing Expenses' query object; the shell renders this,
 * and Expenses owns that query. Reachability without that coupling is the
 * better trade.
 */
export function AddedLine({ expense, categories, onUndo, onEdit, onDismiss }: AddedLineProps) {
  return (
    <div className="added-line-slot" role="status">
      {expense && (
        <div className="added-line">
          <span className="added-line-text">
            Added — <strong>{formatCurrency(expense.amount, expense.currency)}</strong>
            {' · '}
            {categoryLabel(categories, expense.category)}.
          </span>
          <button type="button" className="link-button" onClick={onUndo}>Undo</button>
          <span className="added-line-sep" aria-hidden="true">·</span>
          <button type="button" className="link-button" onClick={onEdit}>Edit</button>
          <button
            type="button"
            className="added-line-dismiss"
            onClick={onDismiss}
            aria-label="Dismiss confirmation"
          >
            <span aria-hidden="true">✕</span>
          </button>
        </div>
      )}
    </div>
  );
}
