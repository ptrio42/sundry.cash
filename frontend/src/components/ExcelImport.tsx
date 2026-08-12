/**
 * ExcelImport Component
 * Allows users to upload Excel files and import expenses with column mapping.
 *
 * **Not a destination.** It held one of ten nav slots for a single file picker
 * while its mirror image, Export, was two buttons inside a table header — the
 * same job at two levels of hierarchy (F17 in `docs/ux-review-findings.md`).
 * Change 12 puts it beside Export in the Expenses toolbar, and it is rendered
 * inline from there and from Home's Start card, which is the empty-ledger case
 * where importing is the lead action.
 */

import { useState, FormEvent, ChangeEvent } from 'react';
import { Currency, AppSettings, CurrencyInfo } from '../types/expense.types';
import { offeredCurrencies } from '../utils/currencies';
import { previewImport, confirmImport } from '../services/api';

interface PreviewData {
  columns: string[];
  preview: unknown[][];
  totalRows: number;
}

interface ImportResults {
  total: number;
  success: number;
  failed: number;
  skipped: number;
  errors: Array<{ row: number; error: string; data: unknown }>;
}

interface ExcelImportProps {
  settings: AppSettings;
  currencies: CurrencyInfo[];
  /**
   * Rows landed in the ledger. Optional because the importer does not care who
   * is watching — but a caller that renders the ledger beside it does: Home's
   * Start card is the empty state, and without this it would still say "nothing
   * recorded yet" after 600 rows arrived.
   */
  onImported?: () => void;
}

export default function ExcelImport({ settings, currencies, onImported }: ExcelImportProps) {
  const [file, setFile] = useState<File | null>(null);
  const [previewData, setPreviewData] = useState<PreviewData | null>(null);
  const [dateColumn, setDateColumn] = useState<string>('');
  const [amountColumn, setAmountColumn] = useState<string>('');
  const [descriptionColumn, setDescriptionColumn] = useState<string>('');
  const [categoryColumn, setCategoryColumn] = useState<string>('');
  const [currency, setCurrency] = useState<Currency>(settings.defaultCurrency);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const [importResults, setImportResults] = useState<ImportResults | null>(null);

  /**
   * Handle file selection
   */
  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      setFile(selectedFile);
      setPreviewData(null);
      setImportResults(null);
      setError('');
    }
  };

  /**
   * Handle preview upload
   */
  const handlePreview = async (e: FormEvent) => {
    e.preventDefault();
    if (!file) {
      setError('Please select a file');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const preview = await previewImport(file);
      setPreviewData(preview);

      // Auto-detect common column names
      preview.columns.forEach((col: string, index: number) => {
        const colLower = col.toLowerCase();
        if (colLower.includes('date') || colLower.includes('data')) {
          setDateColumn(String(index));
        } else if (colLower.includes('amount') || colLower.includes('kwota') || colLower.includes('price') || colLower.includes('cena')) {
          setAmountColumn(String(index));
        } else if (colLower.includes('description') || colLower.includes('opis') || colLower.includes('note')) {
          setDescriptionColumn(String(index));
        } else if (colLower.includes('category') || colLower.includes('kategoria') || colLower.includes('type')) {
          setCategoryColumn(String(index));
        }
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to preview file');
    } finally {
      setLoading(false);
    }
  };

  /**
   * Handle import confirmation
   */
  const handleImport = async (e: FormEvent) => {
    e.preventDefault();

    if (!file || !previewData) {
      setError('Please preview the file first');
      return;
    }

    if (!dateColumn || !amountColumn || !descriptionColumn) {
      setError('Please select date, amount, and description columns');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const results = await confirmImport(file, {
        dateColumn,
        amountColumn,
        descriptionColumn,
        categoryColumn: categoryColumn || undefined,
        currency,
      });
      setImportResults(results.results);
      setPreviewData(null); // Clear preview after successful import
      // Only when something actually landed: a file where every row failed
      // leaves the ledger exactly as it was, and re-reading it would be a
      // request that cannot change anything.
      if (results.results.success > 0) onImported?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to import file');
    } finally {
      setLoading(false);
    }
  };

  /**
   * Reset form
   */
  const handleReset = () => {
    setFile(null);
    setPreviewData(null);
    setImportResults(null);
    setDateColumn('');
    setAmountColumn('');
    setDescriptionColumn('');
    setCategoryColumn('');
    setCurrency(settings.defaultCurrency);
    setError('');
  };

  return (
    <div className="excel-import">
      <h2>Import from a spreadsheet</h2>

      {error && <div className="error-message">{error}</div>}

      {/* File Upload Section */}
      {!previewData && !importResults && (
        <form onSubmit={handlePreview} className="upload-form">
          <div className="form-group">
            <label htmlFor="file">Select Excel File (.xlsx)</label>
            <input
              type="file"
              id="file"
              accept=".xlsx,.xls"
              onChange={handleFileChange}
              required
            />
            {file && <p className="file-name">Selected: {file.name}</p>}
          </div>

          <button type="submit" disabled={loading || !file}>
            {loading ? 'Loading Preview...' : 'Preview File'}
          </button>
        </form>
      )}

      {/* Preview and Column Mapping Section */}
      {previewData && (
        <div className="preview-section">
          <h3>File Preview</h3>
          <p>Total rows: {previewData.totalRows}</p>
          <div className="info-box">
            <strong>ℹ️ Note:</strong> Merged cells have been automatically processed.
            Values from merged cells are filled forward to all rows in the merge.
          </div>

          {/* Column Mapping Form */}
          <form onSubmit={handleImport} className="mapping-form">
            <h4>Map Columns</h4>

            <div className="form-row">
              <div className="form-group">
                <label htmlFor="dateColumn">Date Column *</label>
                <select
                  id="dateColumn"
                  value={dateColumn}
                  onChange={(e) => setDateColumn(e.target.value)}
                  required
                >
                  <option value="">-- Select Date Column --</option>
                  {previewData.columns.map((col, index) => (
                    <option key={index} value={index}>
                      {col} (Column {index + 1})
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label htmlFor="amountColumn">Amount Column *</label>
                <select
                  id="amountColumn"
                  value={amountColumn}
                  onChange={(e) => setAmountColumn(e.target.value)}
                  required
                >
                  <option value="">-- Select Amount Column --</option>
                  {previewData.columns.map((col, index) => (
                    <option key={index} value={index}>
                      {col} (Column {index + 1})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label htmlFor="descriptionColumn">Description Column *</label>
                <select
                  id="descriptionColumn"
                  value={descriptionColumn}
                  onChange={(e) => setDescriptionColumn(e.target.value)}
                  required
                >
                  <option value="">-- Select Description Column --</option>
                  {previewData.columns.map((col, index) => (
                    <option key={index} value={index}>
                      {col} (Column {index + 1})
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label htmlFor="categoryColumn">Category Column (Optional)</label>
                <select
                  id="categoryColumn"
                  value={categoryColumn}
                  onChange={(e) => setCategoryColumn(e.target.value)}
                >
                  <option value="">-- None (Default: Other) --</option>
                  {previewData.columns.map((col, index) => (
                    <option key={index} value={index}>
                      {col} (Column {index + 1})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="form-group">
              <label htmlFor="currency">Currency *</label>
              <select
                id="currency"
                value={currency}
                onChange={(e) => setCurrency(e.target.value as Currency)}
                required
              >
                {offeredCurrencies(currencies).map((curr) => (
                  <option key={curr.code} value={curr.code}>
                    {curr.code}
                  </option>
                ))}
              </select>
            </div>

            {/* Preview Table */}
            <div className="preview-table-container">
              <h4>Data Preview (First {previewData.preview.length} rows)</h4>
              <div className="table-scroll">
                <table className="preview-table">
                  <thead>
                    <tr>
                      {previewData.columns.map((col, index) => (
                        <th key={index}>
                          {col}
                          <br />
                          <small>Col {index + 1}</small>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {previewData.preview.map((row, rowIndex) => (
                      <tr key={rowIndex}>
                        {row.map((cell, cellIndex) => (
                          // Cells come straight from the spreadsheet, so they are
                          // typed `unknown` — stringify explicitly for display.
                          <td key={cellIndex}>{cell == null ? '' : String(cell)}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="button-group">
              <button type="submit" disabled={loading} className="btn-primary">
                {loading ? 'Importing...' : 'Import Expenses'}
              </button>
              <button type="button" onClick={handleReset} className="btn-secondary">
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Import Results Section */}
      {importResults && (
        <div className="import-results">
          <h3>Import Results</h3>
          <div className="results-summary">
            <div className="result-card success">
              <h4>✓ Successful</h4>
              <p className="result-value">{importResults.success}</p>
            </div>
            <div className="result-card failed">
              <h4>✗ Failed</h4>
              <p className="result-value">{importResults.failed}</p>
            </div>
            {/* The server counts skipped rows (blank/summary lines) separately
                so nothing vanishes unexplained. Dropping it here put that back:
                130 successful + 5 failed against a total of 137 left the reader
                to wonder about the other two. */}
            {importResults.skipped > 0 && (
              <div className="result-card skipped">
                <h4>⤼ Skipped</h4>
                <p className="result-value">{importResults.skipped}</p>
              </div>
            )}
            <div className="result-card total">
              <h4>Total</h4>
              <p className="result-value">{importResults.total}</p>
            </div>
          </div>

          {importResults.errors.length > 0 && (
            <div className="error-details">
              <h4>Errors ({importResults.errors.length})</h4>
              <div className="error-list">
                {importResults.errors.slice(0, 10).map((err, index) => (
                  <div key={index} className="error-item">
                    <strong>Row {err.row}:</strong> {err.error}
                  </div>
                ))}
                {importResults.errors.length > 10 && (
                  <p className="more-errors">
                    ... and {importResults.errors.length - 10} more errors
                  </p>
                )}
              </div>
            </div>
          )}

          <button onClick={handleReset} className="btn-primary">
            Import Another File
          </button>
        </div>
      )}
    </div>
  );
}
