/**
 * Tests for the ExcelImport component. The API layer is mocked.
 *
 * The component is a two-step flow: upload -> preview + column mapping ->
 * import + result summary. What matters is that the sheet's own column names
 * drive the mapping controls, that the mapping the user ends up with is exactly
 * what reaches the API, and that everything the server reports back — counts and
 * per-row errors — is actually shown rather than swallowed.
 *
 * Preview cells are typed `unknown[][]` and stringified at render time, so the
 * fixture deliberately mixes strings, numbers and a null.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import ExcelImport from '../components/ExcelImport';
import { previewImport, confirmImport } from '../services/api';
import { AppSettings } from '../types/expense.types';

vi.mock('../services/api', () => ({
  previewImport: vi.fn(),
  confirmImport: vi.fn(),
}));

const mockPreviewImport = previewImport as unknown as ReturnType<typeof vi.fn>;
const mockConfirmImport = confirmImport as unknown as ReturnType<typeof vi.fn>;

const settings: AppSettings = {
  defaultCurrency: 'USD',
  defaultCategory: 'other',
  defaultBtcUnit: 'BTC',
  primaryCurrency: 'USD',
};

// Column names chosen so the component's auto-detection has something to match:
// "…Date" -> date, "Amount" -> amount, "Description" -> description,
// "Category" -> category. "Shop" matches nothing.
const preview = {
  columns: ['Transaction Date', 'Amount', 'Description', 'Category', 'Shop'],
  preview: [
    ['2026-07-01', 42.5, 'Coffee beans', 'groceries', 'Roastery'],
    ['2026-07-02', 12, 'Bus ticket', null, 'MPK'],
  ] as unknown[][],
  totalRows: 137,
};

const xlsx = () =>
  new File(['binary-ish'], 'expenses.xlsx', {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });

/**
 * Attach a file to the upload input and submit the upload form.
 *
 * The submit is dispatched on the form rather than by clicking the button:
 * jsdom never mirrors a programmatically attached file into the input's `value`,
 * so a `required` file input always reports itself invalid and jsdom's
 * constraint validation silently swallows the click. Real browsers submit fine.
 */
const submitUpload = (file: File): void => {
  const input = screen.getByLabelText(/select excel file/i) as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });
  fireEvent.submit(input.closest('form') as HTMLFormElement);
};

/** Run the whole preview step; returns the File that was selected. */
const previewFile = async (): Promise<File> => {
  const file = xlsx();
  submitUpload(file);
  await screen.findByRole('heading', { name: /file preview/i });
  return file;
};

const select = (label: RegExp): HTMLSelectElement =>
  screen.getByLabelText(label) as HTMLSelectElement;

beforeEach(() => {
  vi.clearAllMocks();
  mockPreviewImport.mockResolvedValue(preview);
  mockConfirmImport.mockResolvedValue({
    message: 'ok',
    results: { total: 137, success: 130, failed: 5, skipped: 2, errors: [] },
  });
});

describe('ExcelImport', () => {
  it('previews the selected file and renders its columns and rows', async () => {
    render(<ExcelImport settings={settings} />);

    // Nothing to preview until a file is chosen.
    expect(screen.getByRole('button', { name: /preview file/i })).toBeDisabled();

    const file = await previewFile();

    expect(mockPreviewImport).toHaveBeenCalledTimes(1);
    expect(mockPreviewImport).toHaveBeenCalledWith(file);

    expect(screen.getByText(/total rows: 137/i)).toBeInTheDocument();

    // Header cells carry the sheet's own column names.
    const table = screen.getByRole('table');
    const headers = within(table).getAllByRole('columnheader').map((th) => th.textContent);
    expect(headers).toEqual([
      'Transaction DateCol 1',
      'AmountCol 2',
      'DescriptionCol 3',
      'CategoryCol 4',
      'ShopCol 5',
    ]);

    // Body rows are stringified, including the numeric cells; null renders empty.
    const [first, second] = within(table).getAllByRole('row').slice(1);
    expect(within(first).getAllByRole('cell').map((td) => td.textContent)).toEqual([
      '2026-07-01', '42.5', 'Coffee beans', 'groceries', 'Roastery',
    ]);
    expect(within(second).getAllByRole('cell').map((td) => td.textContent)).toEqual([
      '2026-07-02', '12', 'Bus ticket', '', 'MPK',
    ]);
  });

  it('populates the mapping controls from the returned columns and pre-selects the obvious ones', async () => {
    render(<ExcelImport settings={settings} />);
    await previewFile();

    const dateSelect = select(/date column/i);
    expect(within(dateSelect).getAllByRole('option').map((o) => o.textContent)).toEqual([
      '-- Select Date Column --',
      'Transaction Date (Column 1)',
      'Amount (Column 2)',
      'Description (Column 3)',
      'Category (Column 4)',
      'Shop (Column 5)',
    ]);

    // Auto-detection maps each recognised header onto its column index.
    expect(dateSelect.value).toBe('0');
    expect(select(/amount column/i).value).toBe('1');
    expect(select(/description column/i).value).toBe('2');
    expect(select(/category column \(optional\)/i).value).toBe('3');
    expect(select(/currency/i).value).toBe('USD');

    // The optional category select is the only one offering "none".
    expect(
      within(select(/category column \(optional\)/i)).getByRole('option', { name: /none/i })
    ).toBeInTheDocument();
  });

  it('imports with the chosen mapping and currency and reports the counts it gets back', async () => {
    render(<ExcelImport settings={settings} />);
    const file = await previewFile();

    // Override the auto-detected mapping: use "Shop" as the description and
    // drop the category column entirely, then import in PLN.
    fireEvent.change(select(/description column/i), { target: { value: '4' } });
    fireEvent.change(select(/category column \(optional\)/i), { target: { value: '' } });
    fireEvent.change(select(/currency/i), { target: { value: 'PLN' } });

    fireEvent.click(screen.getByRole('button', { name: /import expenses/i }));

    await waitFor(() => expect(mockConfirmImport).toHaveBeenCalledTimes(1));
    expect(mockConfirmImport).toHaveBeenCalledWith(file, {
      dateColumn: '0',
      amountColumn: '1',
      descriptionColumn: '4',
      categoryColumn: undefined,
      currency: 'PLN',
    });

    // The preview gives way to the summary.
    await screen.findByRole('heading', { name: /import results/i });
    expect(screen.queryByRole('table')).not.toBeInTheDocument();

    const cardFor = (heading: RegExp) => {
      const el = screen.getByRole('heading', { name: heading }).closest('.result-card');
      if (!el) throw new Error(`no result card for ${heading}`);
      return el as HTMLElement;
    };
    expect(cardFor(/successful/i)).toHaveTextContent('130');
    expect(cardFor(/failed/i)).toHaveTextContent('5');
    expect(cardFor(/^total$/i)).toHaveTextContent('137');

    // No errors returned -> no error list.
    expect(screen.queryByRole('heading', { name: /^errors/i })).not.toBeInTheDocument();

    // Skipped rows are reported too, so the four numbers reconcile:
    // 130 successful + 5 failed + 2 skipped = 137 total.
    expect(cardFor(/skipped/i)).toHaveTextContent('2');
  });

  it('omits the skipped card when nothing was skipped', async () => {
    mockConfirmImport.mockResolvedValue({
      message: 'ok',
      results: { total: 135, success: 130, failed: 5, skipped: 0, errors: [] },
    });

    render(<ExcelImport settings={settings} />);
    await previewFile();
    fireEvent.click(screen.getByRole('button', { name: /import expenses/i }));
    await screen.findByRole('heading', { name: /import results/i });

    expect(screen.getByRole('heading', { name: /successful/i }).closest('.result-card'))
      .toHaveTextContent('130');
    expect(screen.queryByText(/skipped/i)).not.toBeInTheDocument();
  });

  it('shows the per-row errors the server returned, capped at ten', async () => {
    mockConfirmImport.mockResolvedValue({
      message: 'ok',
      results: {
        total: 137,
        success: 125,
        failed: 12,
        skipped: 0,
        errors: Array.from({ length: 12 }, (_, i) => ({
          row: i + 2,
          error: `Invalid amount in row ${i + 2}`,
          data: null,
        })),
      },
    });

    render(<ExcelImport settings={settings} />);
    await previewFile();
    fireEvent.click(screen.getByRole('button', { name: /import expenses/i }));

    await screen.findByRole('heading', { name: /errors \(12\)/i });
    expect(screen.getByText(/Invalid amount in row 2/)).toBeInTheDocument();
    expect(screen.getByText('Row 2:')).toBeInTheDocument();
    expect(screen.getByText(/Invalid amount in row 11/)).toBeInTheDocument();
    // Only the first ten are listed; the rest are summarised.
    expect(screen.queryByText(/Invalid amount in row 12/)).not.toBeInTheDocument();
    expect(screen.getByText(/and 2 more errors/i)).toBeInTheDocument();
  });

  it('surfaces a failed preview and keeps the upload form usable', async () => {
    mockPreviewImport.mockRejectedValue(new Error('Unsupported file format'));
    render(<ExcelImport settings={settings} />);

    submitUpload(xlsx());

    expect(await screen.findByText('Unsupported file format')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /file preview/i })).not.toBeInTheDocument();
    // Still on step one, with the chosen file and a retry available.
    expect(screen.getByText(/selected: expenses\.xlsx/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /preview file/i })).toBeEnabled();
  });

  it('surfaces a failed import and leaves the mapping form in place', async () => {
    mockConfirmImport.mockRejectedValue(new Error('Import failed: column out of range'));

    render(<ExcelImport settings={settings} />);
    await previewFile();
    fireEvent.click(screen.getByRole('button', { name: /import expenses/i }));

    expect(await screen.findByText('Import failed: column out of range')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /import results/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /import expenses/i })).toBeInTheDocument();
  });
});
