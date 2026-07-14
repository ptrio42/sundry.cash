/**
 * Receipt OCR provider abstraction.
 *
 * The scanner extracts expense fields from a receipt photo. The concrete engine
 * is pluggable: `tesseract` runs fully offline today; a `claude` (Claude Vision)
 * provider can be dropped in later without touching the routes or the frontend —
 * both speak this same interface. See services/receipt/index.ts for the factory.
 */

import { Currency, ExpenseCategory } from '../../types/expense.types';

/** Structured result of reading a receipt image. Any field may be null when the
 *  OCR could not confidently determine it — the user fills the gaps in the UI. */
export interface ReceiptExtraction {
  /** Total amount in major units (e.g. 42.99), or null if not found. */
  amount: number | null;
  /** ISO date (YYYY-MM-DD), or null if not found. */
  date: string | null;
  /** Merchant / store name used as the expense description, or null. */
  merchant: string | null;
  /** Detected currency, or null when ambiguous (UI defaults it). */
  currency: Currency | null;
  /** Category guessed from the merchant/keywords. */
  category: ExpenseCategory;
  /** Full OCR text, surfaced in the UI so the user can eyeball the source. */
  rawText: string;
  /** Overall OCR confidence, 0..1. */
  confidence: number;
  /** Human-readable notes about anything uncertain or unsupported. */
  warnings: string[];
}

/** A pluggable receipt-reading engine. */
export interface ReceiptExtractor {
  /** Stable identifier, e.g. 'tesseract' | 'claude' | 'stub'. */
  readonly name: string;
  /**
   * Read a receipt image and return the extracted fields.
   * @param image    raw image bytes
   * @param mimeType the uploaded file's MIME type (e.g. 'image/jpeg')
   */
  extract(image: Buffer, mimeType: string): Promise<ReceiptExtraction>;
}
