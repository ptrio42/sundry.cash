/**
 * ReceiptScan Component
 * Snap a photo of a receipt, let the backend OCR extract the fields, then
 * review/correct them before saving the expense (with the photo attached).
 */

import { useState, useEffect, ChangeEvent, FormEvent } from 'react';
import { scanReceipt, createReceiptExpense } from '../services/api';
import { ExpenseFormProps, ExpenseCategory, Currency, ReceiptExtraction } from '../types/expense.types';

const CATEGORIES: ExpenseCategory[] = ['groceries', 'transport', 'media', 'entertainment', 'utilities', 'maintenance', 'other'];
const CURRENCIES: Currency[] = ['USD', 'PLN', 'BTC'];

type Phase = 'capture' | 'review';

export default function ReceiptScan({ onExpenseAdded, settings }: ExpenseFormProps) {
  const [phase, setPhase] = useState<Phase>('capture');
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string>('');
  const [extraction, setExtraction] = useState<ReceiptExtraction | null>(null);

  // Review-form fields (pre-filled from OCR, fully editable)
  const [amount, setAmount] = useState<string>('');
  const [date, setDate] = useState<string>('');
  const [description, setDescription] = useState<string>('');
  const [category, setCategory] = useState<ExpenseCategory>(settings.defaultCategory);
  const [currency, setCurrency] = useState<Currency>(settings.defaultCurrency);

  const [scanning, setScanning] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const [showRawText, setShowRawText] = useState<boolean>(false);

  // Revoke the object URL when it changes or the component unmounts.
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const resetAll = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPhase('capture');
    setFile(null);
    setPreviewUrl('');
    setExtraction(null);
    setAmount('');
    setDate('');
    setDescription('');
    setCategory(settings.defaultCategory);
    setCurrency(settings.defaultCurrency);
    setError('');
    setShowRawText(false);
  };

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (!selected) return;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setFile(selected);
    setPreviewUrl(URL.createObjectURL(selected));
    setExtraction(null);
    setError('');
  };

  const handleScan = async (e: FormEvent) => {
    e.preventDefault();
    if (!file) {
      setError('Please choose or take a photo first');
      return;
    }

    setScanning(true);
    setError('');

    try {
      const result = await scanReceipt(file);
      setExtraction(result);

      // Pre-fill the review form; fall back to sensible defaults where OCR was unsure.
      setAmount(result.amount != null ? String(result.amount) : '');
      setDate(result.date ?? new Date().toISOString().split('T')[0]);
      setDescription(result.merchant ?? '');
      setCategory(result.category);
      setCurrency(result.currency ?? settings.defaultCurrency);
      setPhase('review');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to read the receipt');
    } finally {
      setScanning(false);
    }
  };

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    setError('');

    const amountNum = parseFloat(amount);
    if (isNaN(amountNum) || amountNum <= 0) {
      setError('Amount must be a positive number');
      return;
    }
    if (!date) {
      setError('Date is required');
      return;
    }
    if (description.trim().length === 0) {
      setError('Description cannot be empty');
      return;
    }

    setSaving(true);
    try {
      const expense = await createReceiptExpense(
        { amount: amountNum, date, description: description.trim(), category, currency },
        file
      );
      onExpenseAdded(expense);
      resetAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save expense');
    } finally {
      setSaving(false);
    }
  };

  const confidencePct = extraction ? Math.round(extraction.confidence * 100) : 0;

  return (
    <div className="receipt-scan">
      <h2>Scan a Receipt</h2>
      <p className="receipt-intro">
        Take a photo of a receipt and we'll read the amount, date, and store for you.
        You can fix anything before saving.
      </p>

      {error && <div className="error-message">{error}</div>}

      {phase === 'capture' && (
        <form onSubmit={handleScan} className="receipt-capture">
          <div className="form-group">
            <label htmlFor="receipt-file">Receipt photo</label>
            <input
              type="file"
              id="receipt-file"
              accept="image/*"
              capture="environment"
              onChange={handleFileChange}
            />
            <p className="field-hint">On a phone this opens the camera. JPEG, PNG, or WebP.</p>
          </div>

          {previewUrl && (
            <div className="receipt-preview">
              <img src={previewUrl} alt="Receipt preview" />
            </div>
          )}

          <button type="submit" className="btn-primary" disabled={scanning || !file}>
            {scanning ? 'Reading receipt…' : 'Scan Receipt'}
          </button>
        </form>
      )}

      {phase === 'review' && extraction && (
        <div className="receipt-review">
          <div className="receipt-review-grid">
            {previewUrl && (
              <div className="receipt-preview">
                <img src={previewUrl} alt="Receipt" />
              </div>
            )}

            <form onSubmit={handleSave} className="receipt-form">
              <div className="receipt-confidence">
                OCR confidence: <strong>{confidencePct}%</strong>
              </div>

              {extraction.warnings.length > 0 && (
                <div className="info-box receipt-warnings">
                  <strong>⚠️ Please double-check:</strong>
                  <ul>
                    {extraction.warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="form-row">
                <div className="form-group">
                  <label htmlFor="receipt-amount">Amount</label>
                  <input
                    type="number"
                    id="receipt-amount"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0.00"
                    step="0.01"
                    min="0.01"
                    required
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="receipt-currency">Currency</label>
                  <select
                    id="receipt-currency"
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value as Currency)}
                    required
                  >
                    {CURRENCIES.map((curr) => (
                      <option key={curr} value={curr}>{curr}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="form-group">
                <label htmlFor="receipt-date">Date</label>
                <input
                  type="date"
                  id="receipt-date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  required
                />
              </div>

              <div className="form-group">
                <label htmlFor="receipt-description">Description</label>
                <input
                  type="text"
                  id="receipt-description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Store or description"
                  required
                />
              </div>

              <div className="form-group">
                <label htmlFor="receipt-category">Category</label>
                <select
                  id="receipt-category"
                  value={category}
                  onChange={(e) => setCategory(e.target.value as ExpenseCategory)}
                  required
                >
                  {CATEGORIES.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat.charAt(0).toUpperCase() + cat.slice(1)}
                    </option>
                  ))}
                </select>
              </div>

              <div className="button-group">
                <button type="submit" className="btn-primary" disabled={saving}>
                  {saving ? 'Saving…' : 'Save Expense'}
                </button>
                <button type="button" className="btn-secondary" onClick={resetAll} disabled={saving}>
                  Scan Another
                </button>
              </div>

              {extraction.rawText.trim() && (
                <div className="receipt-rawtext">
                  <button
                    type="button"
                    className="link-button"
                    onClick={() => setShowRawText((s) => !s)}
                  >
                    {showRawText ? 'Hide' : 'Show'} raw OCR text
                  </button>
                  {showRawText && <pre>{extraction.rawText}</pre>}
                </div>
              )}
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
